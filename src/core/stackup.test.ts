import { describe, expect, it } from 'vitest';

import { evaluateStackups, matchingStackups, resolveDifferentialGap, selectStackup, templateToStack } from './stackup';

const templates = [
	{
		id: 'wide', code: 'JLC-A', name: '标准 A', layers: 4, thickness: 1.6, innerOz: 0.5, outerOz: 1, boardType: 1, recommended: 1, charge: false,
		materials: [
			{ type: 1, top: 0.035 },
			{ type: 0, d: 0.18, er: 4.1, name: 'PP-A' },
			{ type: 2, d: 1.12, er: 4.3, top: 0.018, bottom: 0.018, name: 'Core' },
			{ type: 0, d: 0.18, er: 4.1, name: 'PP-A' },
			{ type: 1, top: 0.035 },
		],
	},
	{
		id: 'compact', code: 'JLC-B', name: '标准 B', layers: 4, thickness: 1.6, innerOz: 0.5, outerOz: 1, boardType: 1, recommended: 1, charge: false,
		materials: [
			{ type: 1, top: 0.035 },
			{ type: 0, d: 0.10, er: 4.0, name: 'PP-B' },
			{ type: 2, d: 1.28, er: 4.3, top: 0.018, bottom: 0.018, name: 'Core' },
			{ type: 0, d: 0.10, er: 4.0, name: 'PP-B' },
			{ type: 1, top: 0.035 },
		],
	},
	{ id: 'bad', code: 'JLC-X', name: '无要求', layers: 4, thickness: 1.6, innerOz: 0.5, outerOz: 1, boardType: 1, recommended: 1, materials: [] },
];

const filter = { boardType: 1, layers: 4, thickness: 1.6, innerOz: 0.5, outerOz: 1 };

describe('stackup selection', () => {
	it('filters unusable templates and converts material layers', () => {
		expect(matchingStackups(templates, filter).map(item => item.id)).toEqual(['wide', 'compact']);
		const stack = templateToStack(templates[0]);
		expect(stack).toMatchObject({ gaps: [0.18, 1.12, 0.18], gapEr: [4.1, 4.3, 4.1] });
	});

	it('ranks every matching stack and allows explicit selection', () => {
		const results = evaluateStackups(templates, filter, [
			{ targetOhms: 90, kind: 'differential', gapMil: 6 },
			{ targetOhms: 100, kind: 'differential', gapMil: 6 },
		]);
		expect(results).toHaveLength(2);
		expect(results[0].results).toHaveLength(2);
		expect(selectStackup(results, 'auto')?.stack.id).toBe(results[0].stack.id);
		expect(selectStackup(results, 'manual', 'wide')?.stack.id).toBe('wide');
	});

	it('uses an existing-rule gap and clearly falls back to manual input', () => {
		expect(resolveDifferentialGap(90, 'existing', 6, { 90: 7.5 })).toEqual({ value: 7.5, source: 'existing' });
		expect(resolveDifferentialGap(100, 'existing', 6, {})).toEqual({ value: 6, source: 'fallback' });
	});
});
