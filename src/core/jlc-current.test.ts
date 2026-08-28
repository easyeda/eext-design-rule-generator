import { describe, expect, it } from 'vitest';

import { calculateTraceCurrent, calculateViaCurrent, solveViaDiameter } from './jlc-current';

describe('JLC trace current calculator', () => {
	it('matches JLC default: 1A, 1m, 35μm, external, 25°C ambient, 10°C rise', () => {
		const result = calculateTraceCurrent({
			current: 1, lineLengthMm: 1000, copperThicknessUm: 35,
			external: true, ambientTemperature: 25, temperatureRise: 10,
		});
		// f = (1/(0.048*10^0.44))^(1/0.725) ≈ 16.26 mil²
		// areaCm2 = 16.26 * 6.4516e-6 ≈ 1.049e-4
		// m = 0.0035 cm, widthMm = 1.049e-4 / 0.0035 / 0.1 ≈ 0.300 mm
		expect(Math.abs(result.widthMm - 0.3)).toBeLessThan(0.01);
		expect(Math.abs(result.widthMil - 11.8)).toBeLessThan(0.5);
	});

	it('matches JLC: 2A, 50mm, 35μm, external, 25°C, 20°C rise', () => {
		const result = calculateTraceCurrent({
			current: 2, lineLengthMm: 50, copperThicknessUm: 35,
			external: true, ambientTemperature: 25, temperatureRise: 20,
		});
		// f = (2/(0.048*20^0.44))^(1/0.725) ≈ 22.9
		// widthMm ≈ 0.513, widthMil ≈ 20.2
		expect(result.widthMil).toBeGreaterThan(18);
		expect(result.widthMil).toBeLessThan(22);
		// len=0.05m -> 5cm; resistance uses the physical cm² cross-section.
		expect(result.resistanceOhm).toBeGreaterThan(0.01);
		expect(result.resistanceOhm).toBeLessThan(0.1);
	});

	it('matches JLC: 5A, 100mm, 70μm, internal, 25°C, 30°C rise', () => {
		const result = calculateTraceCurrent({
			current: 5, lineLengthMm: 100, copperThicknessUm: 70,
			external: false, ambientTemperature: 25, temperatureRise: 30,
		});
		// k=0.024, f = (5/(0.024*30^0.44))^(1/0.725) ≈ 127.6
		// widthMm ≈ 1.847, widthMil ≈ 72.7
		expect(result.widthMil).toBeGreaterThan(65);
		expect(result.widthMil).toBeLessThan(80);
	});

	it('matches JLC: 0.5A, 10mm, 18μm, external, 25°C, 10°C rise', () => {
		const result = calculateTraceCurrent({
			current: 0.5, lineLengthMm: 10, copperThicknessUm: 18,
			external: true, ambientTemperature: 25, temperatureRise: 10,
		});
		// f = (0.5/(0.048*10^0.44))^(1/0.725) ≈ 8.13
		// widthMm ≈ 0.225, widthMil ≈ 8.84
		expect(Math.abs(result.widthMm - 0.225)).toBeLessThan(0.02);
	});

	it('internal layer uses k=0.024 (wider than external for same current)', () => {
		const ext = calculateTraceCurrent({ current: 3, lineLengthMm: 50, copperThicknessUm: 35, external: true, ambientTemperature: 25, temperatureRise: 20 });
		const intl = calculateTraceCurrent({ current: 3, lineLengthMm: 50, copperThicknessUm: 35, external: false, ambientTemperature: 25, temperatureRise: 20 });
		expect(intl.widthMil).toBeGreaterThan(ext.widthMil);
	});

	it('matches JLC resistance, voltage drop and loss for 2A over 50mm', () => {
		const result = calculateTraceCurrent({ current: 2, lineLengthMm: 50, copperThicknessUm: 35, external: true, ambientTemperature: 25, temperatureRise: 20 });
		expect(result.resistanceOhm).toBeCloseTo(0.0510234, 5);
		expect(result.voltageDropV).toBeCloseTo(0.1020468, 5);
		expect(result.powerLossW).toBeCloseTo(0.2040936, 5);
	});

	it('resistance scales linearly with length', () => {
		const short = calculateTraceCurrent({ current: 1, lineLengthMm: 50, copperThicknessUm: 35, external: true, ambientTemperature: 25, temperatureRise: 10 });
		const long = calculateTraceCurrent({ current: 1, lineLengthMm: 100, copperThicknessUm: 35, external: true, ambientTemperature: 25, temperatureRise: 10 });
		expect(Math.abs(long.resistanceOhm / short.resistanceOhm - 2)).toBeLessThan(0.01);
	});

	it('temperature coefficient increases resistance at higher ambient', () => {
		const cold = calculateTraceCurrent({ current: 1, lineLengthMm: 1000, copperThicknessUm: 35, external: true, ambientTemperature: 25, temperatureRise: 10 });
		const hot = calculateTraceCurrent({ current: 1, lineLengthMm: 1000, copperThicknessUm: 35, external: true, ambientTemperature: 60, temperatureRise: 10 });
		expect(hot.resistanceOhm).toBeGreaterThan(cold.resistanceOhm);
	});

	it('voltage drop = resistance * current', () => {
		const result = calculateTraceCurrent({ current: 2, lineLengthMm: 1000, copperThicknessUm: 35, external: true, ambientTemperature: 25, temperatureRise: 20 });
		expect(Math.abs(result.voltageDropV - result.resistanceOhm * 2)).toBeLessThan(1e-12);
	});

	it('power loss = resistance * current²', () => {
		const result = calculateTraceCurrent({ current: 3, lineLengthMm: 500, copperThicknessUm: 35, external: true, ambientTemperature: 25, temperatureRise: 20 });
		expect(Math.abs(result.powerLossW - result.resistanceOhm * 9)).toBeLessThan(1e-12);
	});

	it('wider current produces wider trace (monotonic)', () => {
		const widths: number[] = [];
		for (const current of [0.5, 1, 2, 3, 5, 10]) {
			const result = calculateTraceCurrent({ current, lineLengthMm: 50, copperThicknessUm: 35, external: true, ambientTemperature: 25, temperatureRise: 20 });
			widths.push(result.widthMil);
		}
		for (let i = 1; i < widths.length; i++)
			expect(widths[i]).toBeGreaterThan(widths[i - 1]);
	});
});

describe('JLC via current calculator', () => {
	it('matches JLC default: 10°C rise, 0.3mm hole, 10μm copper', () => {
		const result = calculateViaCurrent({
			temperatureRise: 10, apertureDiameterMm: 0.3, copperThicknessUm: 10,
		});
		// c = 3140 * 0.3/25.4 * 10/25.4 ≈ 14.601
		// I = 0.02 * 10^0.44 * 14.601^0.725 ≈ 0.02 * 2.754 * 6.985 ≈ 0.385
		expect(Math.abs(result.maxCurrentA - 0.385)).toBeLessThan(0.01);
	});

	it('matches JLC: 20°C rise, 0.5mm hole, 25μm copper', () => {
		const result = calculateViaCurrent({
			temperatureRise: 20, apertureDiameterMm: 0.5, copperThicknessUm: 25,
		});
		// c = 3140 * 0.5/25.4 * 25/25.4 ≈ 60.838
		// I = 0.02 * 20^0.44 * 60.838^0.725 ≈ 0.02 * 3.736 * 19.68 ≈ 1.469
		expect(Math.abs(result.maxCurrentA - 1.469)).toBeLessThan(0.01);
	});

	it('matches JLC: 30°C rise, 0.4mm hole, 18μm copper', () => {
		const result = calculateViaCurrent({
			temperatureRise: 30, apertureDiameterMm: 0.4, copperThicknessUm: 18,
		});
		// c = 3140 * 0.4/25.4 * 18/25.4 ≈ 35.043
		// I = 0.02 * 30^0.44 * 35.043^0.725 ≈ 0.02 * 4.466 * 13.20 ≈ 1.177
		expect(Math.abs(result.maxCurrentA - 1.177)).toBeLessThan(0.01);
	});

	it('larger holes carry more current', () => {
		const small = calculateViaCurrent({ temperatureRise: 20, apertureDiameterMm: 0.2, copperThicknessUm: 15 });
		const large = calculateViaCurrent({ temperatureRise: 20, apertureDiameterMm: 0.5, copperThicknessUm: 15 });
		expect(large.maxCurrentA).toBeGreaterThan(small.maxCurrentA);
	});

	it('thicker copper carries more current', () => {
		const thin = calculateViaCurrent({ temperatureRise: 20, apertureDiameterMm: 0.3, copperThicknessUm: 10 });
		const thick = calculateViaCurrent({ temperatureRise: 20, apertureDiameterMm: 0.3, copperThicknessUm: 25 });
		expect(thick.maxCurrentA).toBeGreaterThan(thin.maxCurrentA);
	});

	it('higher temp rise allows more current', () => {
		const cold = calculateViaCurrent({ temperatureRise: 5, apertureDiameterMm: 0.3, copperThicknessUm: 15 });
		const hot = calculateViaCurrent({ temperatureRise: 30, apertureDiameterMm: 0.3, copperThicknessUm: 15 });
		expect(hot.maxCurrentA).toBeGreaterThan(cold.maxCurrentA);
	});
});

describe('JLC via diameter inverse (solveViaDiameter)', () => {
	it('is the exact inverse of calculateViaCurrent', () => {
		// If we solve for diameter given current, then compute current back, we should get the same current
		for (const [current, dT, copper] of [[1, 10, 10], [2, 20, 15], [5, 30, 25]] as const) {
			const via = solveViaDiameter({ current, temperatureRise: dT, copperThicknessUm: copper });
			const back = calculateViaCurrent({ temperatureRise: dT, apertureDiameterMm: via.holeMm, copperThicknessUm: copper });
			expect(Math.abs(back.maxCurrentA - current)).toBeLessThan(0.01);
		}
	});

	it('produces reasonable hole sizes for typical currents', () => {
		const result = solveViaDiameter({ current: 2, temperatureRise: 20, copperThicknessUm: 25 });
		expect(result.holeMm).toBeGreaterThan(0.1);
		expect(result.holeMm).toBeLessThan(1.0);
		expect(result.padMm).toBeGreaterThanOrEqual(result.holeMm + 0.3);
	});

	it('enforces minimum 0.2mm hole', () => {
		const result = solveViaDiameter({ current: 0.1, temperatureRise: 10, copperThicknessUm: 35 });
		expect(result.holeMm).toBeGreaterThanOrEqual(0.2);
	});

	it('pad is at least hole + 0.3mm or 1.75x hole (whichever is larger)', () => {
		const result = solveViaDiameter({ current: 5, temperatureRise: 30, copperThicknessUm: 15 });
		const expectedPad = Math.max(result.holeMm + 0.3, result.holeMm * 1.75);
		expect(Math.abs(result.padMm - expectedPad)).toBeLessThan(0.001);
	});

	it('returns consistent mil/mm conversions', () => {
		const result = solveViaDiameter({ current: 3, temperatureRise: 20, copperThicknessUm: 18 });
		expect(Math.abs(result.holeMil - result.holeMm / 0.0254)).toBeLessThan(0.01);
		expect(Math.abs(result.padMil - result.padMm / 0.0254)).toBeLessThan(0.01);
	});
});
