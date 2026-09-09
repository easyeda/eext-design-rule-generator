import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { calculateRow, dimensionsAtWidth, evaluateGeometry, geometryFromStack, parseStack, regionKey } from './jlc-offline';
import type { StackupTemplate } from './stackup';
import pageOracle from '../../fixtures/calibration/page-oracle.json';
import currentPage from '../../fixtures/calibration/page-observations-2026-09-03.json';

const globals: any = {};
for (const name of ['stackups', 'jlc-models', 'jlc-calibration']) vm.runInNewContext(fs.readFileSync(`iframe/${name}.js`, 'utf8'), globals);
const templates: StackupTemplate[] = globals.__ADR_STACKUPS__;
const calibration = globals.__ADR_JLC_CALIBRATION__;
const legacy = globals.__ADR_JLC_MODELS__;
const row = { mode: 'CoatedMicrostrip1B', target: 50, layer: 1, upperRef: 0, lowerRef: 2, width: 8, gap: 5, distance: 8 };

describe('shipped calibration data and final JavaScript evaluator', () => {
	it('retains at least one verified representative for every listed layer count and mode', () => {
		const coverage = JSON.parse(fs.readFileSync('fixtures/calibration/coverage-report.json', 'utf8'));
		expect(coverage.byLayerCount).toHaveLength(32);
		for (const entry of coverage.byLayerCount) {
			expect(entry.templatesWithVerifiedRegion, `${entry.layers} layers`).toBeGreaterThan(0);
			expect(entry.allInputsVerified).toBe(false);
		}
		expect(coverage.summary.allModes).toHaveLength(12);
		for (const mode of coverage.summary.allModes)
			expect(mode.verified, mode.mode).toBeGreaterThan(0);
	});
	it.each(currentPage.cases)('matches the current 8-layer page baseline $code', record => {
		const template = templates.find(t => t.code === record.code && t.outerOz === record.request.cuprumThickness && t.innerOz === record.request.innerCopperThickness)!;
		const result = calculateRow(parseStack(template), { ...record.row, mode: record.mode }, record.complement, calibration, legacy);
		expect(result.width).toBe(record.pageW1);
		expect(result.verified).toBe(true);
		expect(Math.abs(result.calculated / record.row.target - 1)).toBeLessThanOrEqual(0.01);
	});
	it.each(pageOracle.records)('matches the official page baseline $code', record => {
		const template = templates.find(t => t.code === record.code && t.outerOz === 1 && t.innerOz === 0.5)!;
		const stack = parseStack(template);
		const result = calculateRow(stack, row, false, calibration, legacy);
		expect(result.width).toBe(record.pageW1);
		expect(result.verified).toBe(true);
		expect(Math.abs(result.calculated / row.target - 1)).toBeLessThanOrEqual(0.01);
		const geometry = geometryFromStack(stack, row);
		for (const [name, value] of Object.entries(geometry)) expect(record.request.impedance_calc_arg[name as keyof typeof record.request.impedance_calc_arg]).toBe(value);
	});
	it('enforces forward and inverse limits against every accepted independent point using shipped JS coefficients', () => {
		const report = JSON.parse(fs.readFileSync('fixtures/calibration/validation-report.json', 'utf8'));
		expect(report.summary.version).toBe(calibration.version);
		const samples = fs.readFileSync('fixtures/calibration/samples.jsonl', 'utf8').trim().split('\n').map(s => JSON.parse(s));
		const byId = new Map(samples.map(s => [s.sampleId, s]));
		for (const region of report.regions.filter((r: any) => r.verified)) {
			expect(region.domainSupported).toBe(true);
			expect(region.finalAudit.status).toBe('passed');
			expect(region.finalAudit.checks.length).toBeGreaterThanOrEqual(12);
			for(const point of [...region.finalAudit.checks,...(region.historicalAudit||[]).filter((p:any)=>p.status!=='outside-current-domain')]){
				const result=evaluateGeometry(region.mode,point.geometry,calibration,legacy,region.complement);
				expect(result.verified).toBe(true);
				expect(Math.abs(result.impedance/point.official-1),point.auditId).toBeLessThanOrEqual(0.01);
			}
			expect(region.independentForwardTests.length).toBeGreaterThanOrEqual(6);
			for (const point of region.independentForwardTests) {
				const s = byId.get(point.sampleId)!;
				const g = s.design?.startsWith('spacing-') ? s.geometry : dimensionsAtWidth(s.mode, s.geometry, s.request.impedance_calc_arg.W1, s.complement);
				const result = evaluateGeometry(s.mode, g, calibration, legacy, s.complement);
				expect(result.verified).toBe(true);
				expect(Math.abs(result.impedance / s.result.dImpedance - 1), point.sampleId).toBeLessThanOrEqual(0.01);
			}
			for (const point of region.officialInverseChecks.filter((p:any)=>p.solverVerified)) {
				const s=byId.get(point.sampleId)!;
				const evaluate=(g:any)=>evaluateGeometry(s.mode,g,calibration,legacy,s.complement).impedance;
				const anchor=(calibration.regions[region.key].anchors as any[]).find(a=>a.sourceSampleId===point.sampleId);
				expect(anchor.width).toBe(point.officialW1);
				expect(point.runtimeWidthError).toBe(0);
				const g=dimensionsAtWidth(s.mode,s.geometry,anchor.width,s.complement);
				expect(Math.abs(evaluate(g)/point.target-1)).toBeLessThanOrEqual(0.01);
				if(s.complement && g.S1!==undefined)expect(g.W1+g.S1).toBeCloseTo(s.geometry.W1+s.geometry.S1,8);
				if(s.complement && g.D1!==undefined)expect(g.W1+2*g.D1).toBeCloseTo(s.geometry.W1+2*s.geometry.D1,8);
			}
		}
	});
	it('does not reuse verification outside width, coating, spacing or target coverage', () => {
		const stack = parseStack(templates.find(t => t.code === pageOracle.records[0].code && t.outerOz === 1 && t.innerOz === 0.5)!);
		const g = geometryFromStack(stack, row);
		expect(() => evaluateGeometry(row.mode, { ...g, W1: 101, W2: 100.5 }, calibration, legacy)).toThrow(/W1/);
		expect(evaluateGeometry(row.mode, { ...g, C2: 0.7 }, calibration, legacy).verified).toBe(false);
		expect(calculateRow(stack, { ...row, target: 51 }, false, calibration, legacy).verified).toBe(false);
		expect(calculateRow(stack, { ...row, width: 9 }, false, calibration, legacy).verified).toBe(false);
		expect(regionKey(row.mode, { ...g, C2: 0.7 })).not.toBe(regionKey(row.mode, g));
	});
	it('verifies only sampled multivariable S1/D1 bounds',()=>{
		const production8=parseStack(templates.find(t=>t.code==='JLC081611-2116D')!);
		const spacingRow={...row,mode:'DiffCoatedCoplanarWaveguideWithLowerGnd1B',target:100,gap:5,distance:8};
		const spacingGeometry=geometryFromStack(production8,spacingRow);
		expect(evaluateGeometry(spacingRow.mode,{...spacingGeometry,W1:50,W2:49.5,S1:100,D1:80},calibration,legacy).verified).toBe(true);
		const fixedStack=parseStack(templates.find(t=>t.code==='JLC04161H-7628C')!);
		const fixedGeometry=geometryFromStack(fixedStack,spacingRow);
		expect(evaluateGeometry(spacingRow.mode,{...fixedGeometry,S1:6},calibration,legacy).verified).toBe(false);
	});
	it('uses only an exact accepted official anchor and invalidates a modified one',()=>{
		const stack=parseStack(templates.find(t=>t.code===pageOracle.records[0].code&&t.outerOz===1&&t.innerOz===0.5)!);
		const modified=structuredClone(calibration);
		for(const region of Object.values(modified.regions) as any[])for(const reference of region.anchors)reference.width+=10;
		const result=calculateRow(stack,row,false,modified,legacy);
		expect(result.width).toBe(23.57);
		expect(result.verified).toBe(false);
	});
	it('matches the coupled dimensions recorded from the official backend', () => {
		const records = JSON.parse(fs.readFileSync('fixtures/calibration/complement-oracle.json', 'utf8'));
		for (const r of records.records || records) {
			const mode = r.request.impedance_calc_mark.replace(/^W2_/, '');
			const result = dimensionsAtWidth(mode, r.request.impedance_calc_arg, r.result.jBackCalc.W1, true);
			for (const field of ['W1', 'S1', 'D1']) if (r.result.jBackCalc[field] !== undefined) expect(result[field as keyof typeof result]).toBeCloseTo(r.result.jBackCalc[field], 7);
		}
	});
});
