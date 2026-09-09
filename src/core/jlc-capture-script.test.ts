import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildCalculationRequest } from '../../scripts/capture-jlc-impedance-fixtures.mjs';

const metadata = JSON.parse(fs.readFileSync('fixtures/jlc-impedance-metadata.json', 'utf8'));
const coated = metadata.body.list.find((record: any) => record.impedanceType === 'CoatedMicrostrip1B');

describe('JLC fixture capture request', () => {
	it('uses the official calculator request envelope and hashes its exact argument JSON', () => {
		const request = buildCalculationRequest(coated, {
			uuid: '0123456789abcdef0123456789abcdef',
			accessId: 'fedcba9876543210fedcba9876543210',
			targetOhms: 50,
		});

		expect(request).toMatchObject({
			uuid: '0123456789abcdef0123456789abcdef',
			accessId: 'fedcba9876543210fedcba9876543210',
			impedance_calc_mark: 'CoatedMicrostrip1B',
			impedance_calc_arg: {
				H1: 5,
				Er1: 4.3,
				W1: 8,
				W2: 7.3,
				Zo: 50,
				dCalculateMode: 3,
				isLinkComputingMode: false,
				W2LinkW1Incr: 0,
			},
		});
		expect(request).not.toHaveProperty('impedanceType');
		expect(request).not.toHaveProperty('arg');
		expect(request.paramMd5).toMatch(/^[0-9a-f]{32}$/);
	});
});
