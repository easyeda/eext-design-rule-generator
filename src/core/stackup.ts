export interface Material {
	type: number;
	material?: string;
	name?: string;
	d?: number;
	er?: number;
	top?: number;
	bottom?: number;
}

export interface StackupTemplate {
	id: string;
	code: string;
	name: string;
	layers: number;
	thickness: number;
	innerOz: number;
	outerOz: number;
	boardType: number;
	recommended: number;
	charge?: boolean;
	materials: Material[];
}

export interface StackModel {
	id: string;
	code: string;
	name: string;
	layers: number;
	thickness: number;
	charge: boolean;
	gaps: number[];
	gapEr: number[];
	gapLabels: string[];
	copper: number[];
}

export interface StackupFilter {
	boardType: number;
	layers: number;
	thickness: number;
	innerOz: number;
	outerOz: number;
}

export interface Constraint {
	targetOhms: number;
	kind: 'single' | 'differential';
	gapMil?: number;
}

export interface StackupEvaluation {
	stack: StackModel;
	results: Array<{ targetOhms: number; kind: Constraint['kind']; gapMil: number; widthMil: number; referenceHeightMm: number }>;
	score: number;
}

export function matchingStackups(templates: StackupTemplate[], filter: StackupFilter): StackupTemplate[] {
	return templates.filter(template => template.recommended === 1
		&& template.boardType === filter.boardType
		&& template.layers === filter.layers
		&& Math.abs(template.thickness - filter.thickness) < 0.001
		&& (filter.layers === 2 || Math.abs(template.innerOz - filter.innerOz) < 0.001)
		&& Math.abs(template.outerOz - filter.outerOz) < 0.001
		&& !/自定义|无要求|Custom|No requirement|不要选用|后续取消|叠构重复|废弃|作废/.test(template.name || ''));
}

export function templateToStack(template: StackupTemplate, fallbackEr = 4.2): StackModel | null {
	const copper: number[] = [];
	const gaps: number[] = [];
	const gapEr: number[] = [];
	const gapLabels: string[] = [];
	let pendingD = 0;
	let pendingErD = 0;
	let pendingNames: string[] = [];
	const flushPending = () => {
		if (!copper.length || pendingD <= 0)
			return;
		gaps.push(pendingD);
		gapEr.push(pendingErD / pendingD || fallbackEr);
		gapLabels.push(Array.from(new Set(pendingNames)).join(' + ') || '介质');
		pendingD = 0;
		pendingErD = 0;
		pendingNames = [];
	};
	for (const material of template.materials) {
		if (material.type === 1) {
			flushPending();
			copper.push(material.top || material.bottom || template.outerOz * 0.035);
		}
		else if (material.type === 2 || material.type === 3) {
			if (copper.length)
				flushPending();
			copper.push(material.top || template.innerOz * 0.035);
			gaps.push(material.d || 0);
			gapEr.push(material.er || fallbackEr);
			gapLabels.push(material.name || material.material || '芯板');
			copper.push(material.bottom || template.innerOz * 0.035);
		}
		else if ((material.d || 0) > 0) {
			pendingD += material.d || 0;
			pendingErD += (material.d || 0) * (material.er || fallbackEr);
			pendingNames.push(material.name || material.material || 'PP');
		}
	}
	flushPending();
	while (copper.length > template.layers)
		copper.splice(Math.floor(copper.length / 2), 1);
	while (gaps.length > template.layers - 1) {
		const index = Math.floor(gaps.length / 2) - 1;
		const distance = gaps[index] + gaps[index + 1];
		gapEr[index] = (gapEr[index] * gaps[index] + gapEr[index + 1] * gaps[index + 1]) / distance;
		gaps[index] = distance;
		gapLabels[index] += ` + ${gapLabels[index + 1]}`;
		gaps.splice(index + 1, 1);
		gapEr.splice(index + 1, 1);
		gapLabels.splice(index + 1, 1);
	}
	if (copper.length !== template.layers || gaps.length !== template.layers - 1)
		return null;
	return { id: template.id, code: template.code, name: template.name, layers: template.layers, thickness: template.thickness, charge: Boolean(template.charge), gaps, gapEr, gapLabels, copper };
}

function microstrip(width: number, height: number, thickness: number, er: number): number {
	const u0 = Math.max(0.01, width / height);
	const th = Math.max(0.0001, thickness / height);
	const coth = 1 / Math.tanh(Math.sqrt(6.517 * u0));
	const u = u0 + Math.max(0, th / Math.PI * Math.log(1 + 4 * Math.E / (th * th * coth * coth)));
	let effectiveEr = (er + 1) / 2 + (er - 1) / 2 * (1 / Math.sqrt(1 + 12 / u) + (u < 1 ? 0.04 * (1 - u) ** 2 : 0));
	effectiveEr += Math.min(0.18, 0.045 * (er - 1));
	return u <= 1 ? 60 / Math.sqrt(effectiveEr) * Math.log(8 / u + 0.25 * u) : 120 * Math.PI / (Math.sqrt(effectiveEr) * (u + 1.393 + 0.667 * Math.log(u + 1.444)));
}

function impedance(widthMm: number, stack: StackModel, constraint: Constraint): number {
	const height = stack.gaps[0];
	const er = stack.gapEr[0];
	const thickness = stack.copper[0];
	const calibration = Math.max(0.96, Math.min(1.10, 1 + 0.16 * (er - 4)));
	let result = microstrip(widthMm / calibration, height, thickness, er);
	if (constraint.kind === 'differential')
		result = 2 * result * (1 - 0.48 * Math.exp(-0.96 * Math.max(0.02, (constraint.gapMil || 6) * 0.0254) / height));
	return result;
}

function solveWidth(stack: StackModel, constraint: Constraint): number | null {
	let low = 0.025;
	let high = 12;
	if (constraint.targetOhms > impedance(low, stack, constraint) || constraint.targetOhms < impedance(high, stack, constraint))
		return null;
	for (let index = 0; index < 72; index++) {
		const middle = (low + high) / 2;
		if (impedance(middle, stack, constraint) > constraint.targetOhms)
			low = middle;
		else high = middle;
	}
	return (low + high) / 2 / 0.0254;
}

export function evaluateStackups(templates: StackupTemplate[], filter: StackupFilter, constraints: Constraint[]): StackupEvaluation[] {
	return matchingStackups(templates, filter).map(template => templateToStack(template)).filter((stack): stack is StackModel => Boolean(stack)).map((stack) => {
		const results = constraints.map((constraint) => {
			const widthMil = solveWidth(stack, constraint);
			return widthMil === null ? null : { targetOhms: constraint.targetOhms, kind: constraint.kind, gapMil: constraint.gapMil || 0, widthMil, referenceHeightMm: stack.gaps[0] };
		});
		const valid = results.filter((result): result is NonNullable<typeof result> => Boolean(result));
		const manufacturability = valid.reduce((score, result) => score + Math.abs(result.widthMil - 6) + (result.widthMil < 3.5 ? 30 : 0) + (result.widthMil > 20 ? 15 : 0), 0);
		return { stack, results: valid, score: results.length === valid.length ? manufacturability + (stack.charge ? 3 : 0) : Number.POSITIVE_INFINITY };
	}).sort((left, right) => left.score - right.score || left.stack.code.localeCompare(right.stack.code));
}

export function selectStackup(evaluations: StackupEvaluation[], mode: 'auto' | 'manual', selectedId?: string): StackupEvaluation | null {
	if (!evaluations.length)
		return null;
	if (mode === 'manual')
		return evaluations.find(item => item.stack.id === selectedId) || null;
	return evaluations[0];
}

type GapSource = 'manual' | 'existing';

export function resolveDifferentialGap(targetOhms: number, source: GapSource, manualMil: number, existingRules: Record<number, number>): { value: number; source: GapSource | 'fallback' } {
	if (source === 'existing' && Number.isFinite(existingRules[targetOhms]))
		return { value: existingRules[targetOhms], source };
	if (Number.isFinite(manualMil) && manualMil > 0)
		return { value: manualMil, source: source === 'existing' ? 'fallback' : 'manual' };
	throw new Error(`${targetOhms} Ω 差分线距无效`);
}
