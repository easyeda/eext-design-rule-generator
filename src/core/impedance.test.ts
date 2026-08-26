import { describe, expect, it } from 'vitest';

import { calculateWidth, matchStackups } from './impedance';

const templates = [
	{ id: 'a', code: 'JLC0416', name: '4层', layers: 4, thickness: 1.6, innerOz: 0.5, outerOz: 1, boardType: 1, recommended: 1, materials: [] },
	{ id: 'b', code: 'JLC0616', name: '6层', layers: 6, thickness: 1.6, innerOz: 0.5, outerOz: 1, boardType: 1, recommended: 1, materials: [] },
];

describe('offline impedance helpers', () => {
	it('matches board parameters exactly', () => {
		expect(matchStackups(templates as any, { boardType: 1, layers: 4, thickness: 1.6, innerOz: 0.5, outerOz: 1 })).toHaveLength(1);
	});

	it('solves a practical single-ended width', () => {
		const width = calculateWidth({ targetOhms: 50, kind: 'single', dielectricHeightMm: 0.18, copperThicknessMm: 0.035, dielectricConstant: 4.2, spacingMil: 6 });
		expect(width).toBeGreaterThan(3);
		expect(width).toBeLessThan(20);
	});

	it('models JLC-style coplanar modes with copper distance as D1', () => {
		const base = { targetOhms: 50, kind: 'single' as const, dielectricHeightMm: 0.18, copperThicknessMm: 0.035, dielectricConstant: 4.2, spacingMil: 6, copperDistanceMil: 20 };
		const microstrip = calculateWidth(base);
		const coplanar = calculateWidth({ ...base, mode: 'coplanar-single' });
		expect(coplanar).toBeLessThan(microstrip);
		const differential = calculateWidth({ ...base, targetOhms: 90, kind: 'differential', mode: 'coplanar-differential' });
		expect(differential).toBeGreaterThanOrEqual(1);
		expect(differential).toBeLessThanOrEqual(200);
	});

	it('matches measured JLC coated outer-layer single-ended widths', () => {
		const samples = [
			[8.126, 13.5664], [11.5906, 20.2461], [21.748, 39.1719],
			[25.4488, 46.9648], [16.8661, 30.2656], [7.8898, 13.2881],
			[4.5827, 7.1406], [3.9134, 5.9375], [8.2835, 14.123],
		];
		for (const [heightMil, expectedWidthMil] of samples) {
			const actual = calculateWidth({ targetOhms: 50, kind: 'single', mode: 'single', outerLayer: true, dielectricHeightMm: heightMil * 0.0254, copperThicknessMm: 1.6 * 0.0254, dielectricConstant: 4.3, spacingMil: 0 });
			expect(Math.abs(actual - expectedWidthMil) / expectedWidthMil).toBeLessThan(0.025);
		}
	});
});
