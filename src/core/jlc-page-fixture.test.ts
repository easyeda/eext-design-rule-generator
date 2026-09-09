import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const fixture = JSON.parse(fs.readFileSync('tmp-jlc/page-mode-structured-fixtures.json', 'utf8'));

describe('browser DOM JLC fixtures', () => {
	it('contains twelve modes and 18 official stackup cards per mode', () => {
		expect(fixture.count).toBe(216);
		expect(fixture.modes).toHaveLength(12);
		for (const mode of fixture.modes)
			expect(fixture.records.filter((record: { mode: string }) => record.mode === mode)).toHaveLength(18);
	});

	it('contains finite displayed W1 values for every mode and stackup', () => {
		for (const record of fixture.records) {
			expect(record.source).toBe('DOM');
			expect(Number.isFinite(record.W1), `${record.mode} card ${record.cardIndex}`).toBe(true);
			expect(record.targetOhms).toBe(50);
		}
	});
});
