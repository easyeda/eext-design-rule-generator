export type NetCategory = 'ground' | 'power' | 'impedance' | 'differential' | 'signal';

export interface ClassifiedNet {
	net: string;
	category: NetCategory;
	targetOhms?: number;
	mate?: string;
	polarity?: 'positive' | 'negative';
	pairName?: string;
	warnings: string[];
}

export interface RuleSettings {
	clearanceMil: number;
	powerWidthMil: number;
	groundWidthMil: number;
	signalWidthMil: number;
	impedanceWidthMil: Record<number, number>;
	differentialGapMil: Record<number, number>;
}

export interface PlannedRule {
	profileName: string;
	category: NetCategory;
	nets: string[];
	widthMil: number;
	clearanceMil: number;
	targetOhms?: number;
	gapMil?: number;
}

export interface PlannedDifferentialPair {
	name: string;
	positiveNet: string;
	negativeNet: string;
}

export interface RulePlan {
	rules: PlannedRule[];
	differentialPairs: PlannedDifferentialPair[];
	warnings: string[];
}

type JsonRecord = Record<string, any>;

const explicitImpedancePattern = /(?:^|_)Z(\d{2,3})D?(?:_|$)/i;
const groundPattern = /^(?:GND|AGND|DGND|PGND|GNDA|GNDD)(?:$|[_-])/i;
const powerPattern = /^(?:\+?\d+(?:V\d+|V)|VCC|VDD|VSS|VBAT|VIN|VOUT|AVDD|DVDD|PVDD)(?:$|[_-])/i;

const pairSuffixes = [
	{ positive: /_DP$/i, negativeSuffix: '_DM', keySuffix: '_D' },
	{ positive: /_P$/i, negativeSuffix: '_N', keySuffix: '' },
	{ positive: /P$/i, negativeSuffix: 'N', keySuffix: '' },
];

function profileNumber(value: number): string {
	return String(value).replace('.', '_');
}

function differentialTarget(net: string, explicit?: number): number {
	if (explicit)
		return explicit;
	if (/USB/i.test(net))
		return 90;
	return 100;
}

function findPair(net: string, allNets: Set<string>): { mate: string; pairName: string } | undefined {
	for (const suffix of pairSuffixes) {
		if (!suffix.positive.test(net))
			continue;
		const stem = net.replace(suffix.positive, '');
		const mate = `${stem}${suffix.negativeSuffix}`;
		if (allNets.has(mate))
			return { mate, pairName: `${stem}${suffix.keySuffix}` };
	}
	return undefined;
}

function findPositiveMate(net: string, allNets: Set<string>): { mate: string; pairName: string } | undefined {
	const candidates = [
		{ negative: /_DM$/i, positiveSuffix: '_DP', keySuffix: '_D' },
		{ negative: /_N$/i, positiveSuffix: '_P', keySuffix: '' },
		{ negative: /N$/i, positiveSuffix: 'P', keySuffix: '' },
	];
	for (const suffix of candidates) {
		if (!suffix.negative.test(net))
			continue;
		const stem = net.replace(suffix.negative, '');
		const mate = `${stem}${suffix.positiveSuffix}`;
		if (allNets.has(mate))
			return { mate, pairName: `${stem}${suffix.keySuffix}` };
	}
	return undefined;
}

export function classifyNets(nets: string[]): ClassifiedNet[] {
	const allNets = new Set(nets);
	return nets.map((net) => {
		const warnings: string[] = [];
		if (groundPattern.test(net))
			return { net, category: 'ground', warnings };
		if (powerPattern.test(net))
			return { net, category: 'power', warnings };

		const explicit = explicitImpedancePattern.exec(net);
		const explicitTarget = explicit ? Number(explicit[1]) : undefined;
		const positive = findPair(net, allNets);
		if (positive) {
			return {
				net,
				category: 'differential',
				targetOhms: differentialTarget(net, explicitTarget),
				mate: positive.mate,
				polarity: 'positive',
				pairName: positive.pairName,
				warnings,
			};
		}
		const negative = findPositiveMate(net, allNets);
		if (negative) {
			return {
				net,
				category: 'differential',
				targetOhms: differentialTarget(net, explicitTarget),
				mate: negative.mate,
				polarity: 'negative',
				pairName: negative.pairName,
				warnings,
			};
		}
		if (explicit)
			return { net, category: 'impedance', targetOhms: explicitTarget, warnings };
		if (/(?:_P|_N|_DP|_DM)$/i.test(net))
			warnings.push('疑似差分网络，但未找到对应的另一端');
		return { net, category: 'signal', warnings };
	});
}

export function buildRulePlan(classified: ClassifiedNet[], settings: RuleSettings): RulePlan {
	const groups = new Map<string, PlannedRule>();
	const pairs: PlannedDifferentialPair[] = [];
	const warnings = classified.flatMap(item => item.warnings.map(warning => `${item.net}: ${warning}`));

	for (const item of classified) {
		if (item.category === 'signal')
			continue;
		let profileName: string;
		let widthMil: number;
		let gapMil: number | undefined;
		if (item.category === 'power') {
			widthMil = settings.powerWidthMil;
			profileName = `ADR_POWER_${profileNumber(widthMil)}MIL`;
		}
		else if (item.category === 'ground') {
			widthMil = settings.groundWidthMil;
			profileName = `ADR_GROUND_${profileNumber(widthMil)}MIL`;
		}
		else if (item.category === 'differential') {
			const target = item.targetOhms ?? 100;
			widthMil = settings.impedanceWidthMil[target] ?? settings.signalWidthMil;
			gapMil = settings.differentialGapMil[target] ?? settings.clearanceMil;
			profileName = `ADR_DIFF${target}_${profileNumber(widthMil)}MIL_${profileNumber(gapMil)}GAP`;
		}
		else {
			const target = item.targetOhms ?? 50;
			widthMil = settings.impedanceWidthMil[target] ?? settings.signalWidthMil;
			profileName = `ADR_Z${target}_${profileNumber(widthMil)}MIL`;
		}

		const existing = groups.get(profileName);
		if (existing) {
			existing.nets.push(item.net);
		}
		else {
			groups.set(profileName, {
				profileName,
				category: item.category,
				nets: [item.net],
				widthMil,
				clearanceMil: settings.clearanceMil,
				targetOhms: item.targetOhms,
				gapMil,
			});
		}

		if (item.category === 'differential' && item.polarity === 'positive' && item.mate && item.pairName) {
			pairs.push({ name: `ADR_${item.pairName}`, positiveNet: item.net, negativeNet: item.mate });
		}
	}

	const rules = Array.from(groups.values());
	for (const rule of rules) rule.nets.sort();
	return { rules, differentialPairs: pairs, warnings };
}

function updateLayerValues(data: JsonRecord, defaultValue: number, minimum?: number): void {
	for (const value of Object.values(data)) {
		if (!value || typeof value !== 'object')
			continue;
		value.defaultValue = defaultValue;
		if (minimum !== undefined)
			value.minValue = Math.min(minimum, defaultValue);
	}
}

function removeManagedProfiles(section: JsonRecord): void {
	for (const key of Object.keys(section)) {
		if (key.startsWith('ADR_'))
			delete section[key];
	}
}

export function mergeRuleConfiguration(configuration: JsonRecord, rules: PlannedRule[]): JsonRecord {
	const merged = structuredClone(configuration);
	const safeSpacing = merged.config?.Spacing?.['Safe Spacing'];
	const tracks = merged.config?.Physics?.Track;
	const differential = merged.config?.Physics?.['Differential Pair'];
	if (!safeSpacing || !tracks || !differential)
		throw new Error('当前设计规则结构不受支持');
	removeManagedProfiles(safeSpacing);
	removeManagedProfiles(tracks);
	removeManagedProfiles(differential);

	const spacingTemplate = Object.values(safeSpacing).find((item: any) => item?.isSetDefault) ?? Object.values(safeSpacing)[0];
	const trackTemplate = Object.values(tracks).find((item: any) => item?.isSetDefault) ?? Object.values(tracks)[0];
	const diffTemplate = Object.values(differential).find((item: any) => item?.isSetDefault) ?? Object.values(differential)[0];
	if (!spacingTemplate || !trackTemplate || !diffTemplate)
		throw new Error('当前设计规则缺少默认模板');

	for (const rule of rules) {
		const spacing = structuredClone(spacingTemplate as JsonRecord);
		spacing.editName = rule.profileName;
		spacing.isSetDefault = false;
		const trackRow = spacing.row?.indexOf('Track') ?? -1;
		const trackColumn = spacing.column?.indexOf('Track') ?? -1;
		if (trackRow < 0 || trackColumn < 0)
			throw new Error('安全间距模板缺少 Track 行列');
		for (const table of Object.values(spacing.tables ?? {}) as JsonRecord[]) {
			if (!Array.isArray(table.content?.[trackRow]) || trackColumn >= table.content[trackRow].length)
				throw new Error('安全间距模板的 Track-Track 单元格无效');
			table.content[trackRow][trackColumn] = rule.clearanceMil;
		}
		safeSpacing[rule.profileName] = spacing;

		if (rule.category === 'differential') {
			const profile = structuredClone(diffTemplate as JsonRecord);
			profile.editName = rule.profileName;
			profile.isSetDefault = false;
			updateLayerValues(profile.form.strokeWidthTables.data, rule.widthMil, rule.widthMil);
			updateLayerValues(profile.form.diffPairSpacingTables.data, rule.gapMil ?? rule.clearanceMil, rule.gapMil ?? rule.clearanceMil);
			differential[rule.profileName] = profile;
		}
		else {
			const profile = structuredClone(trackTemplate as JsonRecord);
			profile.editName = rule.profileName;
			profile.isSetDefault = false;
			updateLayerValues(profile.form.data, rule.widthMil, rule.widthMil);
			tracks[rule.profileName] = profile;
		}
	}
	return merged;
}

export function mergeNetRules(netRules: JsonRecord[], rules: PlannedRule[]): JsonRecord[] {
	const assignments = new Map<string, PlannedRule>();
	for (const rule of rules) {
		for (const net of rule.nets) assignments.set(net, rule);
	}
	return netRules.map((source) => {
		const assignment = assignments.get(source.name);
		if (!assignment)
			return structuredClone(source);
		const result = structuredClone(source);
		result['Safe Spacing'] = assignment.profileName;
		if (assignment.category === 'differential') {
			result['Differential Pair'] = assignment.profileName;
			result.Track = 'default';
		}
		else {
			result.Track = assignment.profileName;
			delete result['Differential Pair'];
		}
		return result;
	});
}

export function mergeDifferentialPairs(existing: PlannedDifferentialPair[], planned: PlannedDifferentialPair[]): PlannedDifferentialPair[] {
	const unmanaged = existing.filter(pair => !pair.name.startsWith('ADR_'));
	return [...unmanaged, ...planned];
}

export function summarizePlan(plan: RulePlan): { rules: number; nets: number; pairs: number; warnings: number } {
	return {
		rules: plan.rules.length,
		nets: plan.rules.reduce((total, rule) => total + rule.nets.length, 0),
		pairs: plan.differentialPairs.length,
		warnings: plan.warnings.length,
	};
}
