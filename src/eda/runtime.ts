import type { PlannedDifferentialPair, RulePlan } from '../core/rules';

import { mergeDifferentialPairs, mergeNetRules, mergeRuleConfiguration } from '../core/rules';

const backupKey = 'adr:last-backup';

type JsonRecord = Record<string, any>;

export interface RuleSnapshot {
	configuration: JsonRecord;
	netRules: JsonRecord[];
	netByNetRules: JsonRecord;
	differentialPairs: PlannedDifferentialPair[];
	netClasses: JsonRecord[];
	nets: string[];
	timestamp: string;
}

export interface RuntimeEda {
	sys_Storage: {
		getExtensionUserConfig: (key: string) => Promise<string | undefined>;
		setExtensionUserConfig: (key: string, value: string) => Promise<void>;
	};
	pcb_Net: {
		getAllNetsName: () => Promise<string[]>;
	};
	pcb_Drc: {
		getCurrentRuleConfiguration: () => Promise<JsonRecord | undefined>;
		getNetRules: () => Promise<JsonRecord[]>;
		getNetByNetRules: () => Promise<JsonRecord>;
		getAllDifferentialPairs: () => Promise<PlannedDifferentialPair[]>;
		getAllNetClasses: () => Promise<JsonRecord[]>;
		overwriteCurrentRuleConfiguration: (configuration: JsonRecord) => Promise<boolean | undefined>;
		overwriteNetRules: (rules: JsonRecord[]) => Promise<boolean>;
		createDifferentialPair: (name: string, positiveNet: string, negativeNet: string) => Promise<boolean>;
		deleteDifferentialPair: (name: string) => Promise<boolean>;
		createNetClass: (name: string, nets: string[], color: JsonRecord | null) => Promise<boolean>;
		addNetToNetClass: (name: string, nets: string | string[]) => Promise<boolean>;
	};
}

export async function createSnapshot(edaApi: RuntimeEda): Promise<RuleSnapshot> {
	const [configuration, netRules, netByNetRules, differentialPairs, netClasses, nets] = await Promise.all([
		edaApi.pcb_Drc.getCurrentRuleConfiguration(),
		edaApi.pcb_Drc.getNetRules(),
		edaApi.pcb_Drc.getNetByNetRules(),
		edaApi.pcb_Drc.getAllDifferentialPairs(),
		edaApi.pcb_Drc.getAllNetClasses(),
		edaApi.pcb_Net.getAllNetsName(),
	]);
	if (!configuration?.config?.Spacing?.['Safe Spacing'] || !configuration.config?.Physics?.Track) {
		throw new Error('当前设计规则结构不受支持');
	}
	return {
		configuration,
		netRules,
		netByNetRules,
		differentialPairs,
		netClasses,
		nets,
		timestamp: new Date().toISOString(),
	};
}

async function replaceManagedPairs(edaApi: RuntimeEda, original: PlannedDifferentialPair[], target: PlannedDifferentialPair[]): Promise<void> {
	for (const pair of original) {
		if (pair.name.startsWith('ADR_'))
			await edaApi.pcb_Drc.deleteDifferentialPair(pair.name);
	}
	for (const pair of target) {
		if (!pair.name.startsWith('ADR_'))
			continue;
		const ok = await edaApi.pcb_Drc.createDifferentialPair(pair.name, pair.positiveNet, pair.negativeNet);
		if (!ok)
			throw new Error(`差分对创建失败：${pair.name}`);
	}
}

async function restoreSnapshot(edaApi: RuntimeEda, snapshot: RuleSnapshot): Promise<void> {
	const currentPairs = await edaApi.pcb_Drc.getAllDifferentialPairs();
	await replaceManagedPairs(edaApi, currentPairs, snapshot.differentialPairs);
	if (await edaApi.pcb_Drc.overwriteCurrentRuleConfiguration(snapshot.configuration) === false)
		throw new Error('设计规则配置恢复失败');
	if (!await edaApi.pcb_Drc.overwriteNetRules(snapshot.netRules))
		throw new Error('网络规则恢复失败');
}

export async function applyPlan(edaApi: RuntimeEda, snapshot: RuleSnapshot, plan: RulePlan & { powerClass?: { name: string; nets: string[]; color: JsonRecord | null } | null }): Promise<{ applied: true; rules: number; pairs: number; powerClass: boolean }> {
	await edaApi.sys_Storage.setExtensionUserConfig(backupKey, JSON.stringify(snapshot));
	const configuration = mergeRuleConfiguration(snapshot.configuration, plan.rules);
	const netRules = mergeNetRules(snapshot.netRules, plan.rules);
	const newPairs = plan.differentialPairs.filter(pair => !snapshot.differentialPairs.some(existing => existing.positiveNet === pair.positiveNet && existing.negativeNet === pair.negativeNet));
	const differentialPairs = mergeDifferentialPairs(snapshot.differentialPairs, newPairs);
	try {
		if (await edaApi.pcb_Drc.overwriteCurrentRuleConfiguration(configuration) === false)
			throw new Error('设计规则配置写入失败');
		if (!await edaApi.pcb_Drc.overwriteNetRules(netRules))
			throw new Error('网络规则写入失败');
		let powerClassApplied = false;
		if (plan.powerClass) {
			const classes = await edaApi.pcb_Drc.getAllNetClasses();
			const current = classes.find(item => item.name === plan.powerClass?.name);
			if (!current) {
				if (!await edaApi.pcb_Drc.createNetClass(plan.powerClass.name, plan.powerClass.nets, plan.powerClass.color))
					throw new Error(`网络类 ${plan.powerClass.name} 创建失败`);
			}
			else {
				const missing = plan.powerClass.nets.filter(net => !(current.nets || []).includes(net));
				if (missing.length && !await edaApi.pcb_Drc.addNetToNetClass(plan.powerClass.name, missing))
					throw new Error(`网络类 ${plan.powerClass.name} 添加网络失败`);
			}
			powerClassApplied = true;
		}
		await replaceManagedPairs(edaApi, snapshot.differentialPairs, differentialPairs);
		const [actualConfiguration, actualNetRules, actualPairs] = await Promise.all([
			edaApi.pcb_Drc.getCurrentRuleConfiguration(),
			edaApi.pcb_Drc.getNetRules(),
			edaApi.pcb_Drc.getAllDifferentialPairs(),
		]);
		const powerClassReadback = plan.powerClass ? actualNetRules.find(item => item.type === 'netClass' && item.name === plan.powerClass?.name) : undefined;
		if (!actualConfiguration || (!plan.powerClass && JSON.stringify(actualNetRules) !== JSON.stringify(netRules)) || (plan.powerClass && !powerClassReadback))
			throw new Error('规则回读验证失败');
		for (const pair of plan.differentialPairs) {
			if (!actualPairs.some(item => item.positiveNet === pair.positiveNet && item.negativeNet === pair.negativeNet)) {
				throw new Error(`差分对回读验证失败：${pair.name}`);
			}
		}
		return { applied: true, rules: plan.rules.length, pairs: newPairs.length, powerClass: powerClassApplied };
	}
	catch (error) {
		await restoreSnapshot(edaApi, snapshot);
		throw error;
	}
}

export async function restoreBackup(edaApi: RuntimeEda): Promise<void> {
	const raw = await edaApi.sys_Storage.getExtensionUserConfig(backupKey);
	if (!raw)
		throw new Error('没有可恢复的规则备份');
	await restoreSnapshot(edaApi, JSON.parse(raw) as RuleSnapshot);
}

export async function readBackupSummary(edaApi: RuntimeEda): Promise<{ available: boolean; timestamp?: string; nets?: number }> {
	const raw = await edaApi.sys_Storage.getExtensionUserConfig(backupKey);
	if (!raw)
		return { available: false };
	const snapshot = JSON.parse(raw) as RuleSnapshot;
	return { available: true, timestamp: snapshot.timestamp, nets: snapshot.nets.length };
}
