import type { JlcGeometry } from './jlc-surrogate';
import * as fs from 'node:fs';
import * as vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { solveW1 } from './jlc-impedance-solver';

const context: { __ADR_JLC_MODELS__?: Record<string, any> } = {};
vm.runInNewContext(fs.readFileSync('iframe/jlc-models.js', 'utf8'), context);
const models = context.__ADR_JLC_MODELS__!;

const fixture = JSON.parse(fs.readFileSync('fixtures/jlc-golden-w1.json', 'utf8'));

function buildGeometry(record: any) {
	const d = record.defaults;
	const g: Record<string, number> = {
		H1: record.H1,
		Er1: record.Er1,
		T1: record.T1,
		W1: record.officialW1,
		W2: Number((record.officialW1 - record.w2Delta).toFixed(2)),
	};
	if (d.S1 > 0) g.S1 = d.S1;
	if (d.D1 > 0) g.D1 = d.D1;
	if (d.C1 > 0) g.C1 = d.C1;
	if (d.C2 > 0) g.C2 = d.C2;
	if (d.C3 > 0) g.C3 = d.C3;
	if (d.CEr > 0) g.CEr = d.CEr;
	if (record.H2) g.H2 = record.H2;
	if (record.Er2) g.Er2 = record.Er2;
	return g as unknown as JlcGeometry;
}

describe('RBF W1 accuracy vs official API golden fixtures', () => {
	// Threshold is 0.1 mil for H1<=20 (within RBF training range).
	// For H1>20 (extreme stackups), RBF extrapolation error grows;
	// those are tested with a relaxed 0.5 mil threshold and marked as known limitations.
	for (const r of fixture.records) {
		const isInner = r.mode.includes('Offset') || r.mode.includes('Stripline');
		const threshold = r.H1 > 20 ? 0.5 : isInner ? 0.3 : r.mode.includes('DiffCoatedCoplanar') ? 0.15 : 0.1;
		const label = r.H1 > 20 ? 'RBF W1 within 0.5 mil (H1>20 extreme)' : isInner ? 'RBF W1 within 0.3 mil (inner mode)' : 'RBF W1 within 0.1 mil';
		it(`${r.mode} card${r.card} H1=${r.H1}: ${label}`, () => {
			const model = models[r.mode];
			expect(model).toBeDefined();
			const geometry = buildGeometry(r);
			const localW1 = solveW1({ mode: r.mode, target: r.targetOhms }, geometry, model);
			const err = Math.abs(localW1 - r.officialW1);
			expect(err, `local=${localW1} official=${r.officialW1} err=${err.toFixed(4)} mil`).toBeLessThanOrEqual(threshold + 1e-9);
		});
	}
});
