import { describe, expect, it, vi } from 'vitest';

import { applyPlan, createSnapshot, restoreBackup } from './runtime';

function fakeEda() {
	const state = {
		configuration: { config: { Spacing: { 'Safe Spacing': { base: { isSetDefault: true, editName: 'base', column: ['Track'], row: ['Track'], tables: { '1': { content: [[4]] } } } } }, Physics: { Track: { base: { isSetDefault: true, editName: 'base', form: { data: { '1': { minValue: 3, defaultValue: 10, maxValue: 100 } } } } }, 'Differential Pair': { base: { isSetDefault: true, editName: 'base', form: { strokeWidthTables: { data: { '1': { minValue: 3, defaultValue: 10 } } }, diffPairSpacingTables: { data: { '1': { minValue: 6, defaultValue: 6 } } } } } } } } },
		netRules: [{ type: 'net', name: '+3V3', Track: 'default', 'Safe Spacing': 'default' }],
		pairs: [] as Array<{ name: string; positiveNet: string; negativeNet: string }>,
	};
	const store = new Map<string, string>();
	return {
		state,
		sys_Storage: {
			getExtensionUserConfig: vi.fn(async (key: string) => store.get(key)),
			setExtensionUserConfig: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
		},
		pcb_Net: { getAllNetsName: vi.fn(async () => ['+3V3']) },
		pcb_Drc: {
			getCurrentRuleConfiguration: vi.fn(async () => structuredClone(state.configuration)),
			getNetRules: vi.fn(async () => structuredClone(state.netRules)),
			getNetByNetRules: vi.fn(async () => ({ 'Safe Spacing': [], 'Creepage Distance': [] })),
			getAllDifferentialPairs: vi.fn(async () => structuredClone(state.pairs)),
			getAllNetClasses: vi.fn(async () => []),
			createNetClass: vi.fn(async (name: string, nets: string[]) => { (state.netRules as any[]).push({ type: 'netClass', name, Track: 'PWR', sub: nets.map(net => ({ type: 'net', name: net, Track: 'PWR' })) }); return true; }),
			addNetToNetClass: vi.fn(async () => true),
			overwriteCurrentRuleConfiguration: vi.fn(async (value) => { state.configuration = structuredClone(value); return true; }),
			overwriteNetRules: vi.fn(async (value) => { state.netRules = structuredClone(value); return true; }),
			createDifferentialPair: vi.fn(async (name, positiveNet, negativeNet) => { state.pairs.push({ name, positiveNet, negativeNet }); return true; }),
			deleteDifferentialPair: vi.fn(async (name) => { state.pairs = state.pairs.filter(pair => pair.name !== name); return true; }),
		},
	};
}

describe('runtime transaction', () => {
	it('backs up, applies, verifies and can restore rules', async () => {
		const eda = fakeEda();
		const snapshot = await createSnapshot(eda as any);
		const report = await applyPlan(eda as any, snapshot, {
				rules: [{ profileName: 'ADR_POWER_20MIL', category: 'power', nets: ['+3V3'], widthMil: 20, clearanceMil: 6 }],
			powerClass: { name: 'PWR_Class', nets: ['+3V3'], color: { r: 153, g: 153, b: 153, alpha: 1 } },
			differentialPairs: [],
			warnings: [],
		});
		expect(report.applied).toBe(true);
		expect(eda.state.netRules[0].Track).toBe('ADR_POWER_20MIL');
		await restoreBackup(eda as any);
		expect(eda.state.netRules[0].Track).toBe('default');
	});

	it('rolls back if a write reports failure', async () => {
		const eda = fakeEda();
		eda.pcb_Drc.overwriteNetRules.mockResolvedValueOnce(false);
		const snapshot = await createSnapshot(eda as any);
		await expect(applyPlan(eda as any, snapshot, {
				rules: [{ profileName: 'ADR_POWER_20MIL', category: 'power', nets: ['+3V3'], widthMil: 20, clearanceMil: 6 }],
			powerClass: { name: 'PWR_Class', nets: ['+3V3'], color: { r: 153, g: 153, b: 153, alpha: 1 } },
			differentialPairs: [],
			warnings: [],
		})).rejects.toThrow('网络规则写入失败');
		expect(eda.state.netRules[0].Track).toBe('default');
	});
});
