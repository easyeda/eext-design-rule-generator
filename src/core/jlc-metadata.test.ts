import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { JLC_IMPEDANCE_MODES } from './jlc-modes';

type MetadataParameter = { paramName: string; displayStatus: number };
type MetadataRecord = { impedanceType: string; parameterList: MetadataParameter[] };

describe('official JLC impedance metadata fixture', () => {
	it('contains the twelve official modes', () => {
		const fixture = JSON.parse(fs.readFileSync('fixtures/jlc-impedance-metadata.json', 'utf8')) as {
			body: { total: number; list: MetadataRecord[] };
		};

		expect(fixture.body.total).toBe(12);
		expect(fixture.body.list).toHaveLength(12);
		expect(fixture.body.list.map(record => record.impedanceType).sort()).toEqual(
			JLC_IMPEDANCE_MODES.map(mode => mode.type).sort(),
		);
	});

	it('matches S1 and D1 applicability to the mode schema', () => {
		const fixture = JSON.parse(fs.readFileSync('fixtures/jlc-impedance-metadata.json', 'utf8')) as {
			body: { list: MetadataRecord[] };
		};

		for (const mode of JLC_IMPEDANCE_MODES) {
			const record = fixture.body.list.find(item => item.impedanceType === mode.type);
			expect(record).toBeDefined();
			const parameters = new Map(record!.parameterList.map(parameter => [parameter.paramName, parameter]));
			expect(parameters.has('S1')).toBe(true);
			expect(parameters.has('D1')).toBe(true);
			expect(parameters.get('S1')!.displayStatus < 4).toBe(mode.usesS1);
			expect(parameters.get('D1')!.displayStatus < 4).toBe(mode.usesD1);
		}
	});
});
