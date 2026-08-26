import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { JLC_IMPEDANCE_MODES, getJlcMode } from './jlc-modes';

describe('JLC impedance modes', () => {
	it('exposes all twelve official calculator modes', () => {
		expect(JLC_IMPEDANCE_MODES).toHaveLength(12);
		expect(new Set(JLC_IMPEDANCE_MODES.map(mode => mode.type)).size).toBe(12);
		expect(JLC_IMPEDANCE_MODES.filter(mode => mode.layer === 'outer')).toHaveLength(8);
		expect(JLC_IMPEDANCE_MODES.filter(mode => mode.layer === 'inner')).toHaveLength(4);
	});

	it('defines S1 and D1 only for applicable modes', () => {
		for (const mode of JLC_IMPEDANCE_MODES) {
			expect(mode.usesS1).toBe(mode.pattern === 1 || mode.pattern === 3);
			expect(mode.usesD1).toBe(mode.pattern === 2 || mode.pattern === 3);
		}
	});

	it('preserves differential mode lookup without falling back to single-ended', () => {
		expect(getJlcMode('DiffEdgeCoupledCoatedMicrostrip1B').pattern).toBe(1);
		expect(getJlcMode('DiffOffsetCoplanarWaveguide1B1A').pattern).toBe(3);
	});

	it('keeps the iframe mode selector and W1 behavior aligned with JLC', () => {
		const source = fs.readFileSync('iframe/app.js', 'utf8');
		for (const mode of JLC_IMPEDANCE_MODES)
			expect(source).toContain(mode.type);
		expect(source).toContain('solveW1');
		expect(source).toContain('placeholder="自动反算"');
	});
});
