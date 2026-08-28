import { describe, expect, it } from 'vitest';

import { buildRulePlan, classifyNets, mergeRuleConfiguration, mergeNetRules } from './rules';

const baseConfiguration = {
	config: {
		Spacing: {
			'Safe Spacing': {
				copperThickness1oz: {
					editName: 'copperThickness1oz',
					unit: 'mil',
					isSetDefault: true,
					column: ['Track', 'SMD Pad'],
					row: ['Track', 'SMD Pad'],
					status: 0,
					tables: { '1': { status: 1, content: [[4], [5, 7]] } },
				},
			},
		},
		Physics: {
			Track: {
				copperThickness1oz: {
					editName: 'copperThickness1oz',
					unit: 'mil',
					isSetDefault: true,
					form: { status: 1, data: { '1': { minValue: 3, defaultValue: 10, maxValue: 100 } } },
				},
			},
			'Differential Pair': {
				differentialPair: {
					editName: 'differentialPair',
					unit: 'mil',
					isSetDefault: true,
					form: {
						strokeWidthTables: { status: 1, data: { '1': { minValue: 5, defaultValue: 10, maxValue: 100 } } },
						diffPairSpacingTables: { status: 1, data: { '1': { minValue: 6, defaultValue: 6, maxValue: null } } },
						differentailPairLenTolerMax: 10,
					},
				},
			},
		},
	},
	name: 'test',
};

const defaultRule = (name: string) => ({
	type: 'net',
	name,
	'Safe Spacing': 'default',
	'Copper Safe Spacing': null,
	'Plane Safe Spacing': null,
	Track: 'default',
	'Net Length Range': 'default',
	'Net Length Tolerance': null,
	'Blind/Buried Via': 'default',
	'Via Size': 'default',
	'Plane Zone': 'default',
	'Copper Zone': 'default',
	'Solder Mask Expansion': 'default',
	'Paste Mask Expansion': 'default',
	'Creepage Distance': null,
	targetNet: null,
});

describe('classifyNets', () => {
	it('detects power, ground, explicit impedance and complete differential pairs', () => {
		const result = classifyNets(['GND', '+3V3', 'CLK_Z50', 'USB0_DP', 'USB0_DM', 'GPIO12']);
		expect(result.find(item => item.net === 'GND')?.category).toBe('ground');
		expect(result.find(item => item.net === '+3V3')?.category).toBe('power');
		expect(result.find(item => item.net === 'CLK_Z50')).toMatchObject({ category: 'impedance', targetOhms: 50 });
		expect(result.find(item => item.net === 'USB0_DP')).toMatchObject({ category: 'differential', mate: 'USB0_DM', targetOhms: 90 });
		expect(result.find(item => item.net === 'GPIO12')?.category).toBe('signal');
	});

	it('recognizes common high-speed interfaces and their standard differential impedance', () => {
		const result = classifyNets([
			'PCIE0_TX_P', 'PCIE0_TX_N',
			'USB3_SSTX_P', 'USB3_SSTX_N',
			'SATA_RXP', 'SATA_RXN',
			'HDMI_TX2+', 'HDMI_TX2-',
		]);
		expect(result.find(item => item.net === 'PCIE0_TX_P')).toMatchObject({ category: 'differential', mate: 'PCIE0_TX_N', targetOhms: 85 });
		expect(result.find(item => item.net === 'USB3_SSTX_P')).toMatchObject({ category: 'differential', mate: 'USB3_SSTX_N', targetOhms: 90 });
		expect(result.find(item => item.net === 'SATA_RXP')).toMatchObject({ category: 'differential', mate: 'SATA_RXN', targetOhms: 100 });
		expect(result.find(item => item.net === 'HDMI_TX2+')).toMatchObject({ category: 'differential', mate: 'HDMI_TX2-', targetOhms: 100 });
	});

	it('recognizes common board power rail naming styles', () => {
		const powerNets = ['VBUS', 'VUSB', 'VCORE', 'VDDA', 'VDDD', 'VCCA', 'VSYS', 'PWR_5V', 'SYS_3V3', '1V8_AON', 'DDR_VTT', 'VREF_DDR'];
		const result = classifyNets([...powerNets, 'PCIE_CLKREQ']);
		for (const net of powerNets)
			expect(result.find(item => item.net === net)?.category, net).toBe('power');
		expect(result.find(item => item.net === 'PCIE_CLKREQ')?.category).toBe('signal');
	});

	it('does not create a differential pair for an orphan suffix', () => {
		const result = classifyNets(['ONLY_P']);
		expect(result[0]).toMatchObject({ category: 'signal' });
		expect(result[0].warnings[0]).toContain('未找到');
	});
});

describe('buildRulePlan', () => {
	it('groups rules by electrical requirement and creates each pair once', () => {
		const classified = classifyNets(['GND', '+3V3', 'CLK_Z50', 'USB0_DP', 'USB0_DM', 'GPIO12']);
		const plan = buildRulePlan(classified, {
			clearanceMil: 6,
			powerWidthMil: 20,
			groundWidthMil: 24,
			signalWidthMil: 8,
			impedanceWidthMil: { 50: 7.2, 90: 5.1 },
			differentialGapMil: { 90: 6 },
		});
		expect(plan.rules).toEqual(expect.arrayContaining([
			expect.objectContaining({ profileName: 'ADR_POWER_20MIL', nets: ['+3V3'], widthMil: 20 }),
			expect.objectContaining({ profileName: 'ADR_GROUND_24MIL', nets: ['GND'], widthMil: 24 }),
			expect.objectContaining({ profileName: 'ADR_Z50_7_2MIL', nets: ['CLK_Z50'], widthMil: 7.2 }),
			expect.objectContaining({ profileName: 'ADR_DIFF90_5_1MIL_6GAP', nets: ['USB0_DM', 'USB0_DP'] }),
		]));
		expect(plan.differentialPairs).toEqual([{ name: 'ADR_USB0_D', positiveNet: 'USB0_DP', negativeNet: 'USB0_DM' }]);
	});
});

describe('mergeRuleConfiguration', () => {
	it('replaces only managed ADR profiles and preserves unrelated data', () => {
		const previous = structuredClone(baseConfiguration);
		(previous.config.Physics.Track as Record<string, unknown>).ADR_OLD = { editName: 'ADR_OLD' };
		const merged = mergeRuleConfiguration(previous, [{
			profileName: 'ADR_POWER_20MIL', category: 'power', nets: ['+3V3'], widthMil: 20, clearanceMil: 6,
		}]);
		expect(merged.config.Physics.Track.copperThickness1oz).toEqual(previous.config.Physics.Track.copperThickness1oz);
		expect(merged.config.Physics.Track.ADR_OLD).toBeUndefined();
		expect(merged.config.Physics.Track.ADR_POWER_20MIL.form.data['1'].defaultValue).toBe(20);
		expect(merged.config.Spacing['Safe Spacing'].ADR_POWER_20MIL.tables['1'].content).toEqual([[6], [5, 7]]);
	});
});

describe('mergeNetRules', () => {
	it('assigns generated profiles while preserving every unrelated field and net', () => {
		const oldRules = [defaultRule('+3V3'), { ...defaultRule('GPIO12'), Track: 'MANUAL' }];
		const merged = mergeNetRules(oldRules, [{
			profileName: 'ADR_POWER_20MIL', category: 'power', nets: ['+3V3'], widthMil: 20, clearanceMil: 6,
		}]);
		expect(merged.find(rule => rule.name === '+3V3')).toMatchObject({ Track: 'ADR_POWER_20MIL', 'Safe Spacing': 'ADR_POWER_20MIL' });
		expect(merged.find(rule => rule.name === 'GPIO12')).toMatchObject({ Track: 'MANUAL' });
	});
});
