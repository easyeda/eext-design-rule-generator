import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateJlcMetadata } from '../../scripts/validate-jlc-impedance-fixtures.mjs';

const fixture = JSON.parse(fs.readFileSync('fixtures/jlc-impedance-metadata.json', 'utf8'));

describe('JLC impedance fixture validation', () => {
	it('accepts the complete official twelve-mode metadata fixture', () => {
		expect(validateJlcMetadata(fixture)).toEqual([]);
	});

	it('rejects missing modes and invalid S1/D1 applicability', () => {
		const broken = structuredClone(fixture);
		broken.body.list = broken.body.list.filter((item: { impedanceType: string }) => item.impedanceType !== 'CoatedMicrostrip1B');
		broken.body.list.find((item: { impedanceType: string }) => item.impedanceType === 'SurfaceMicrostrip1B').parameterList.find((item: { paramName: string }) => item.paramName === 'D1').displayStatus = 1;
		const errors = validateJlcMetadata(broken);
		expect(errors.some(error => error.includes('CoatedMicrostrip1B'))).toBe(true);
		expect(errors.some(error => error.includes('SurfaceMicrostrip1B') && error.includes('D1'))).toBe(true);
	});
});
