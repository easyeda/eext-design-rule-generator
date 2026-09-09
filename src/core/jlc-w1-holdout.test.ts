import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { solveW1 } from './jlc-impedance-solver';

const context: { __ADR_JLC_MODELS__?: Record<string, any> } = {};
// eslint-disable-next-line n/prefer-global/fs
const vm = require('node:vm') as typeof import('node:vm');
vm.runInNewContext(fs.readFileSync('iframe/jlc-models.js', 'utf8'), context);
const models = context.__ADR_JLC_MODELS__!;

const fixture = JSON.parse(fs.readFileSync('fixtures/jlc-w1-holdout.json', 'utf8'));

describe('Retrained RBF W1 accuracy vs official held-out fixtures', () => {
	it('solves W1 within 0.2 mil for all twelve modes (held-out official API)', () => {
		expect(Object.keys(models)).toHaveLength(12);
		const records = fixture.records.filter((r: any) => r.officialW1 != null);
		expect(records.length).toBeGreaterThanOrEqual(24);
		const errors: string[] = [];
		for (const r of records) {
			const model = models[r.mode];
			expect(model, `missing model ${r.mode}`).toBeDefined();
			const geometry = { ...r.geometry, W1: 10, W2: 9.5 } as any;
			const local = solveW1({ mode: r.mode, target: r.target }, geometry, model);
			const err = Math.abs(local - r.officialW1);
			if (err > 0.2)
				errors.push(`${r.mode}: local=${local} official=${r.officialW1} err=${err.toFixed(4)}`);
		}
		expect(errors.join('\n')).toBe('');
	});
});
