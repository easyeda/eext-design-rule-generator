import { describe, expect, it } from 'vitest';
import { loadGlobal, readJson } from '../../scripts/calibration-lib.mjs';
import { isProductionTemplate, TEMPLATE_PROCESS } from './jlc-offline';

const templates = loadGlobal('iframe/stackups.js', '__ADR_STACKUPS__');
const byId = new Map(templates.map(t => [t.id, t]));
const snapshot = readJson('fixtures/calibration/availability-snapshot.json');
const key = t => [t.layers, t.thickness, t.outerOz, t.layers === 2 ? 0 : t.innerOz, t.boardType].join('|');
const queries = new Map(snapshot.cases.map(c => [key({ layers: c.request.plateLayerNumber, thickness: c.request.plateThickness, outerOz: c.request.cuprumThickness, innerOz: c.request.innerCopperThickness, boardType: c.request.boardType }), new Set(c.ids)]));

describe('all-layer official availability snapshot', () => {
	it('preserves every visible official template and its exact board configuration', () => {
		expect(snapshot.cases).toHaveLength(720);
		expect(new Set(snapshot.cases.map(c => c.request.plateLayerNumber)).size).toBe(32);
		for (const c of snapshot.cases) {
			for (const id of c.ids) {
				const template = byId.get(id);
				expect(template, id).toBeDefined();
				expect(TEMPLATE_PROCESS.records[id].productionAvailable, id).toBe(true);
				expect(TEMPLATE_PROCESS.records[id].consistent, id).toBe(true);
				expect(queries.get(key(template)).has(id), id).toBe(true);
			}
		}
	});
	it('never promotes a template absent from its matching official query', () => {
		for (const template of templates.filter(isProductionTemplate))
			expect(queries.get(key(template))?.has(template.id), template.id).toBe(true);
	});
});
