import * as fs from 'node:fs';
import * as vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
	complementDimensions,
	evaluateJlcImpedance,
	getTraceWidthDelta,
	solveW1,
} from './jlc-impedance-solver';

const context: { __ADR_JLC_MODELS__?: Record<string, any> } = {};
vm.runInNewContext(fs.readFileSync('iframe/jlc-models.js', 'utf8'), context);
const models = context.__ADR_JLC_MODELS__!;

const geometry = {
	H1: 5,
	Er1: 4.3,
	W1: 8,
	W2: 7.3,
	T1: 1.6,
	C1: 1.2,
	C2: 0.6,
	CEr: 3.8,
};

describe('JLC impedance solver', () => {
	it.each([
		['outer', 1, 0.5],
		['outer', 1.5, 1],
		['outer', 2, 1],
		['outer', 2.5, 1.2],
		['inner', 0.5, 0.5],
		['inner', 1, 0.8],
		['inner', 1.5, 1],
		['inner', 2, 1.2],
	] as const)('uses the official %s %s oz trace-width delta', (layer, oz, expected) => {
		expect(getTraceWidthDelta(oz, layer)).toBe(expected);
	});

	it('rejects unsupported copper thickness instead of applying a neighboring delta', () => {
		expect(getTraceWidthDelta(0.5, 'outer')).toBeNull();
		expect(getTraceWidthDelta(2.5, 'inner')).toBeNull();
	});

	it('evaluates the shared RBF surrogate and validates the mode', () => {
		expect(evaluateJlcImpedance('CoatedMicrostrip1B', geometry, models.CoatedMicrostrip1B)).toBeCloseTo(47.901, 3);
		expect(() => evaluateJlcImpedance('not-a-mode', geometry, models.CoatedMicrostrip1B)).toThrow(/未知嘉立创阻抗模式/);
	});

	it('solves W1 while preserving the JLC W1-to-W2 copper-width delta', () => {
		const target = evaluateJlcImpedance('CoatedMicrostrip1B', geometry, models.CoatedMicrostrip1B);
		const solved = solveW1({ mode: 'CoatedMicrostrip1B', target }, { ...geometry, W1: 12, W2: 11.3 }, models.CoatedMicrostrip1B);
		expect(solved).toBe(8);
	});

	it('complements coplanar-single D1 without introducing S1', () => {
		expect(complementDimensions({ mode: 'CoatedCoplanarWaveguideWithLowerGnd1B', width: 5, distance: 8 }, 7)).toEqual({
			width: 7,
			distance: 7,
		});
	});

	it('rejects invalid coupled dimensions instead of clamping them', () => {
		expect(() => complementDimensions({ mode: 'DiffCoatedCoplanarWaveguideWithLowerGnd1B', width: 5, gap: 2.5, distance: 3 }, 8)).toThrow(/有效尺寸/);
		expect(complementDimensions({ mode: 'CoatedMicrostrip1B', width: 5, gap: 8, distance: 8 }, 8)).toEqual({ width: 8 });
	});
});
