import { describe, expect, it } from 'vitest';
import { auditModelHash, auditPlan } from '../../scripts/calibration-audit-design.mjs';
import { samplePlan } from '../../scripts/calibration-design.mjs';
import { dimensionsAtWidth, JLC_IMPEDANCE_MODES } from './jlc-offline';

const core = { dimensionsAtWidth, JLC_IMPEDANCE_MODES };
describe('resumable sampling and sealed audit design', () => {
	it('audits each multivariable boundary face without changing the trace taper', () => {
		const region = { model: { f: ['W1', 'S1', 'D1'], a: [1] }, min: 2.5, max: 100, bounds: { W1: [2.5, 100], S1: [2.5, 100], D1: [2.5, 80] } };
		const g = { H1: 8, Er1: 4.3, T1: 1.6, W1: 8, W2: 7.5, S1: 5, D1: 8 };
		const jobs = auditPlan(core, { processVersion: 'v1' }, 'key', region, g, 'DiffCoatedCoplanarWaveguideWithLowerGnd1B', false);
		expect(jobs).toHaveLength(38);
		for (const [index, job] of jobs.slice(32).entries()) {
			const field = region.model.f[Math.floor(index / 2)];
			expect(job.args[field]).toBe(region.bounds[field][index % 2]);
			expect(job.args.W1 - job.args.W2).toBeCloseTo(0.5, 8);
		}
	});
	it('includes all eight joint width/spacing corners for 3D calibration', () => {
		const region = { mode: 'DiffCoatedCoplanarWaveguideWithLowerGnd1B', geometry: { H1: 8, Er1: 4.3, T1: 1.6, W1: 8, W2: 7.5, S1: 5, D1: 8 } };
		const training = samplePlan(core, region, { spacingGrid: true }).filter(j => j.kind === 'forward' && j.split === 'train');
		for (const W1 of [2.5, 100]) {
			for (const S1 of [2.5, 100]) {
				for (const D1 of [2.5, 80]) expect(training.some(j => j.args.W1 === W1 && j.args.S1 === S1 && j.args.D1 === D1)).toBe(true);
			}
		}
	});
	it('deduplicates collapsed 2D corners without losing held-out interior samples', () => {
		const region = { mode: 'DiffEdgeCoupledCoatedMicrostrip1B', geometry: { H1: 8, Er1: 4.3, T1: 1.6, W1: 8, W2: 7.5, S1: 5, C1: 1, C2: 0.6, C3: 1, CEr: 3.3 } };
		const jobs = samplePlan(core, region, { spacingGrid: true });
		const ids = jobs.map(j => JSON.stringify(j.args));
		expect(new Set(ids).size).toBe(ids.length);
		expect(jobs.filter(j => j.kind === 'forward' && j.split === 'test').length).toBeGreaterThanOrEqual(6);
		const resumed = samplePlan(core, region, { spacingGrid: true });
		expect(resumed).toEqual(jobs);
		const trained = new Set(jobs.filter(j => j.split === 'train').map(j => JSON.stringify(j.args)));
		for (const j of jobs.filter(j => j.split === 'test')) expect(trained.has(JSON.stringify(j.args))).toBe(false);
	});
	it('invalidates old audit evidence when coefficients or domain change', () => {
		const region = { model: { f: ['W1'], a: [1] }, min: 2.5, max: 100, bounds: { W1: [2.5, 100] } };
		const before = auditModelHash('v1', region);
		expect(auditModelHash('v2', region)).not.toBe(before);
		expect(auditModelHash('v1', { ...region, model: { ...region.model, a: [2] } })).not.toBe(before);
		expect(auditModelHash('v1', { ...region, max: 50 })).not.toBe(before);
		const g = { H1: 8, Er1: 4.3, T1: 1.6, W1: 8, W2: 7.5 };
		const plan = auditPlan(core, { processVersion: 'v1' }, 'key', region, g, 'CoatedMicrostrip1B', false);
		expect(plan).toHaveLength(12);
		for (const j of plan) {
			expect(j.args.W1).toBeGreaterThan(2.5);
			expect(j.args.W1).toBeLessThan(100);
		}
		expect(auditPlan(core, { processVersion: 'v1' }, 'key', region, g, 'CoatedMicrostrip1B', false)).toEqual(plan);
	});
});
