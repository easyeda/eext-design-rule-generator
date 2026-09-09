import type { JlcGeometry, JlcRbfModel } from './jlc-surrogate';
import type { StackupTemplate } from './stackup';
import processSnapshot from '../../fixtures/calibration/process.json';
import templateSnapshot from '../../fixtures/calibration/template-process.json';
import { getJlcMode, JLC_IMPEDANCE_MODES } from './jlc-modes';
import { evaluateJlcSurrogate } from './jlc-surrogate';

export { JLC_IMPEDANCE_MODES };
export const PROCESS = processSnapshot;
export const TEMPLATE_PROCESS = templateSnapshot;
export const VERSION = `offline-3/${PROCESS.version}`;
export const SOLVER_VERSION = 'jlc-sealed-audit-4';
export const INVALID_NAMES = /自定义|无要求|Custom|No requirement|不要选用|后续取消|叠构重复|废弃|作废/i;
const round = (x: number, digits = 4) => Number(x.toFixed(digits));
const mil = (x: number) => round(x / 0.0254);
export interface OfflineStack {
	template: StackupTemplate;
	copper: number[];
	gaps: number[];
	calculationGaps: number[];
	ers: number[];
	labels: string[];
	coreSides: Array<'top' | 'bottom' | 'foil'>;
}
export interface OfflineRow {
	mode: string;
	target: number;
	layer: number;
	upperRef: number;
	lowerRef: number;
	width: number;
	gap: number;
	distance: number;
}
export interface Region {
	model: JlcRbfModel;
	min: number;
	max: number;
	bounds?: Record<string, [number, number]>;
	domainSupported?: boolean;
	verified: boolean;
	maxForwardError: number;
	anchors: Array<{ target: number; width: number; initialWidth?: number; solverVerified?: boolean; gap?: number; distance?: number; error: number; verified: boolean }>;
}
export interface Calibration {
	solverVersion?: string;
	version: string;
	processVersion: string;
	regions: Record<string, Region>;
}
interface TemplateProcessRecord {
	consistent: boolean;
	selectionKey?: string;
	materialSignature?: string;
	productionAvailable?: boolean;
	usePurpose?: number;
	auditStatus?: number;
	massLaminations?: Array<{ startPosition: number; endPosition: number }>;
}
export function isProductionTemplate(template: StackupTemplate): boolean {
	const record = (TEMPLATE_PROCESS.records as Record<string, TemplateProcessRecord>)[template.id];
	return !INVALID_NAMES.test(template.name || '')
		&& record?.consistent === true
		&& record.selectionKey === [template.layers, template.thickness, template.outerOz, template.layers === 2 ? 0 : template.innerOz, template.boardType].join('|')
		&& record.materialSignature === JSON.stringify(template.materials.map(m => [m.type, Number(m.d) || 0, Number(m.er) || 0, Number(m.top) || 0, Number(m.bottom) || 0]))
		&& record.productionAvailable === true;
}
export function parseStack(template: StackupTemplate): OfflineStack {
	const stack: OfflineStack = { template, copper: [], gaps: [], calculationGaps: [], ers: [], labels: [], coreSides: [] };
	let d = 0;
	let spanAdjustment = 0;
	let erd = 0;
	let names: string[] = [];
	const dielectric = (thickness: number, er: number, name: string) => {
		if (!(Number.isFinite(thickness) && thickness > 0 && Number.isFinite(er) && er > 0))
			throw new Error(`${template.code}: 无效介质参数`);
		d += thickness;
		erd += thickness * er;
		names.push(name);
	};
	const conductor = (thickness: number, side: OfflineStack['coreSides'][number]) => {
		if (!(Number.isFinite(thickness) && thickness > 0))
			throw new Error(`${template.code}: 缺少铜厚`);
		if (stack.copper.length) {
			if (!(d > 0))
				throw new Error(`${template.code}: 相邻铜层间缺少介质`);
			stack.gaps.push(d);
			stack.calculationGaps.push(d + spanAdjustment);
			stack.ers.push(erd / d);
			stack.labels.push(names.join(' + '));
		}
		else
			if (d > 0) {
				throw new Error(`${template.code}: 首铜层前存在未支持的介质`);
			}
		d = 0;
		spanAdjustment = 0;
		erd = 0;
		names = [];
		stack.copper.push(thickness);
		stack.coreSides.push(side);
	};
	for (const m of template.materials) {
		if (m.type === 1) {
			conductor(Number(m.top || m.bottom), 'foil');
		}
		else
			if (m.type === 2) {
				conductor(Number(m.top), 'top');
				dielectric(Number(m.d), Number(m.er), m.name || 'Core');
				conductor(Number(m.bottom), 'bottom');
			}
			else
				if (m.type === 0 || m.type === 3) {
					// Bare core (type 3) has no copper: never manufacture two copper layers.
					dielectric(Number(m.d), Number(m.er), m.name || 'Dielectric');
					if (m.type === 3) {
						// The website's computedFinalThinkness includes these fields in
						// the calculation span, without assigning them signal-layer numbers.
						const extra = Number(m.top || 0) + Number(m.bottom || 0);
						if (!Number.isFinite(extra) || extra < 0)
							throw new Error(`${template.code}: 无效裸芯板计算厚度`);
						spanAdjustment += extra;
					}
				}
				else {
					throw new Error(`${template.code}: 官网硬板模型不支持材料类型 ${m.type}`);
				}
	}
	if (d > 0 || stack.copper.length !== template.layers || stack.gaps.length !== template.layers - 1)
		throw new Error(`${template.code}: 叠层结构与层数不符`);
	return stack;
}
export function processFor(oz: number, outer: boolean) {
	const select = <T extends { systemCopperThickness: number; layerType: number; baseCopperThickness: number }>(rows: T[]) => {
		const matches = rows.filter(x => Math.abs(x.systemCopperThickness - oz) < 0.01 && x.layerType === (outer ? 1 : 2));
		return matches.find(x => Math.abs(x.baseCopperThickness - 0.5) < 0.01) || matches[0];
	};
	const copper = select(PROCESS.copper);
	const coverlay = select(PROCESS.coverlay);
	if (!copper || !coverlay)
		throw new Error(`缺少 ${outer ? '外层' : '内层'} ${oz} oz 官网工艺配置`);
	return { copper, coverlay };
}
export function geometryFromStack(stack: OfflineStack, row: OfflineRow): JlcGeometry {
	if (!Number.isFinite(row.width) || (row.width !== 0 && (row.width < 2.5 || row.width > 100)))
		throw new Error('W1 必须为空或在 2.5～100 mil 内');
	const mode = getJlcMode(row.mode);
	const n = stack.copper.length;
	if (!Number.isInteger(row.layer) || row.layer < 1 || row.layer > n)
		throw new Error('无效信号层');
	const outer = row.layer === 1 || row.layer === n;
	if (outer !== (mode.layer === 'outer'))
		throw new Error('阻抗模式与信号层不一致');
	if ((row.upperRef && (!Number.isInteger(row.upperRef) || row.upperRef < 1 || row.upperRef >= row.layer))
		|| (row.lowerRef && (!Number.isInteger(row.lowerRef) || row.lowerRef > n || row.lowerRef <= row.layer))) {
		throw new Error('参考层方向错误');
	}
	if ((!row.upperRef && !row.lowerRef) || (!outer && (!row.upperRef || !row.lowerRef)))
		throw new Error('内层模型需要上下两个参考层');
	const between = (a: number, b: number) => {
		let sum = 0;
		for (let i = a - 1; i < b - 1; i++) {
			sum += stack.calculationGaps[i];
			if (i > a - 1)
				sum += stack.copper[i];
		}
		return sum;
	};
	const p = processFor(outer ? stack.template.outerOz : stack.template.innerOz, outer);
	const metadata = PROCESS.modes.find(x => x.impedanceType === row.mode)!;
	const g: Record<string, number> = Object.fromEntries(metadata.parameterList.filter(x => x.displayStatus !== 4).map(x => [x.paramName, Number(x.defaultValue) || 0]));
	if (outer) {
		g.H1 = mil(row.upperRef ? between(row.upperRef, row.layer) : between(row.layer, row.lowerRef));
	}
	else {
		const up = between(row.upperRef, row.layer);
		const down = between(row.layer, row.lowerRef);
		const side = stack.coreSides[row.layer - 1];
		// Website defines H1 on the core side; H2 includes signal copper on the other side.
		const details = (TEMPLATE_PROCESS.records as Record<string, TemplateProcessRecord>)[stack.template.id];
		const blocks = details?.massLaminations || [];
		const nearest = blocks.map((block, index) => ({ ...block, index, distance: row.layer < block.startPosition ? block.startPosition - row.layer : row.layer > block.endPosition ? row.layer - block.endPosition : 0 }))
			.sort((a, b) => a.distance - b.distance || a.index - b.index)[0];
		const upperFoil = nearest ? row.layer < (nearest.startPosition + nearest.endPosition) / 2 : row.layer <= n / 2;
		const h1Down = side === 'top' || (side === 'foil' && upperFoil);
		g.H1 = mil(h1Down ? down : up);
		g.H2 = mil((h1Down ? up : down) + stack.copper[row.layer - 1]);
	}
	// The target web page initializes Er from model metadata, not the material labels.
	g.W1 = row.width || 8;
	g.W2 = round(g.W1 - p.copper.traceWidthDelta, 2);
	g.T1 = p.copper.traceCopperThickness;
	if (mode.usesS1)
		g.S1 = row.gap;
	if (mode.usesD1)
		g.D1 = row.distance;
	if (mode.coated) {
		g.C1 = p.coverlay.coatingAboveSubstrate;
		g.C2 = p.coverlay.coatingAboveTrace;
		if (mode.usesS1)
			g.C3 = p.coverlay.coatingBetweenTraces;
	}
	return g as unknown as JlcGeometry;
}
export function regionKey(mode: string, geometry: JlcGeometry, complement = false): string {
	const g = geometry as unknown as Record<string, number>;
	const info = getJlcMode(mode);
	// Fixed-spacing and spacing-grid samples share a model family. Linked paths
	// remain separated by their conserved W1+S1 / W1+2D1 relationship.
	const excluded = ['W1', 'W2', 'S1', 'D1'];
	return [mode, PROCESS.version, `delta=${round(g.W1 - g.W2, 2)}`, ...Object.keys(g).filter(k => !excluded.includes(k)).sort().map(k => `${k}=${round(g[k])}`), ...(complement ? ['linked', ...(info.usesS1 ? [`S-total=${round(g.W1 + g.S1)}`] : []), ...(info.usesD1 ? [`D-total=${round(g.W1 + 2 * g.D1)}`] : [])] : [])].join('|');
}
export function dimensionsAtWidth<T extends { W1: number; W2: number; S1?: number; D1?: number }>(mode: string, base: T, width: number, complement = false): T {
	const info = getJlcMode(mode);
	const delta = width - base.W1;
	const g = { ...base, W1: width, W2: width - (base.W1 - base.W2) };
	if (complement && info.usesS1)
		g.S1 = base.S1! - delta;
	if (complement && info.usesD1)
		g.D1 = base.D1! - delta / 2;
	return g;
}
export function evaluateGeometry(mode: string, geometry: JlcGeometry, calibration: Calibration, legacy: Record<string, JlcRbfModel>, complement = false) {
	const region = calibration.processVersion === PROCESS.version ? calibration.regions[regionKey(mode, geometry, complement)] : undefined;
	const inside = region && Object.entries(region.bounds || { W1: [region.min, region.max] as [number, number] }).every(([field, [min, max]]) => {
		const value = Number((geometry as unknown as Record<string, number>)[field]);
		return Number.isFinite(value) && value >= min - 1e-6 && value <= max + 1e-6;
	});
	const model = inside ? region.model : legacy[mode];
	if (!model)
		throw new Error(`缺少 ${mode} 模型`);
	const impedance = evaluateJlcSurrogate(mode, geometry, model);
	if (!Number.isFinite(impedance) || impedance <= 0)
		throw new Error('模型返回无效阻抗');
	return { impedance, verified: Boolean(inside && region.verified && region.domainSupported !== false), region: inside ? region : undefined };
}
export function solveDimensions(mode: string, base: JlcGeometry, target: number, evaluate: (g: JlcGeometry) => number, complement = false): JlcGeometry {
	if (!Number.isFinite(target) || target <= 0)
		throw new Error('无效目标阻抗');
	const info = getJlcMode(mode);
	const delta = base.W1 - base.W2;
	let min = Math.max(2.5, delta + 0.01);
	let max = 100;
	if (complement) {
		if (info.usesS1) {
			max = Math.min(max, base.W1 + base.S1! - 2.5);
			min = Math.max(min, base.W1 + base.S1! - 100);
		}
		if (info.usesD1) {
			max = Math.min(max, base.W1 + 2 * (base.D1! - 2.5));
			min = Math.max(min, base.W1 + 2 * (base.D1! - 80));
		}
	}
	if (min > max)
		throw new Error('互补尺寸没有有效求解区间');
	const at = (w: number) => {
		const g = dimensionsAtWidth(mode, base, w, complement);
		const z = evaluate(g);
		if (!Number.isFinite(z) || z <= 0)
			throw new Error('无效模型值');
		return z - target;
	};
	// Scan for a bracket: RBF extrapolation cannot be assumed globally monotonic.
	let lo = min;
	let fl = at(lo);
	let hi = lo;
	let found = Math.abs(fl) < 1e-8;
	for (let i = 1; !found && i <= 128; i++) {
		hi = min + (max - min) * i / 128;
		const fh = at(hi);
		if (fl * fh <= 0) {
			found = true;
			break;
		}
		lo = hi;
		fl = fh;
	}
	if (!found)
		throw new Error('目标阻抗在有效尺寸区间内无解');
	for (let i = 0; i < 64 && hi - lo > 1e-7; i++) {
		const mid = (hi + lo) / 2;
		const fm = at(mid);
		if (fl * fm <= 0) {
			hi = mid;
		}
		else {
			lo = mid;
			fl = fm;
		}
	}
	const result = dimensionsAtWidth(mode, base, round((lo + hi) / 2, 2), complement);
	if (result.W1 < min || result.W1 > max)
		throw new Error('舍入后的尺寸超出有效区间');
	if (Math.abs(evaluate(result) - target) / target > 0.01)
		throw new Error('舍入后的阻抗残差超过 1%');
	return result;
}

/** Reproduce the observed website inverse search: test the initial W2, then bisect its side of [2,150]. */
export function solveWebsiteDimensions(mode: string, base: JlcGeometry, target: number, evaluate: (g: JlcGeometry) => number, complement = false): JlcGeometry {
	if (!Number.isFinite(target) || target <= 0)
		throw new Error('无效目标阻抗');
	const delta = base.W1 - base.W2;
	let lo = 2 + delta;
	let hi = 150 + delta;
	let w = base.W1;
	for (let i = 0; i < 64; i++) {
		const g = dimensionsAtWidth(mode, base, w, complement);
		const z = evaluate(g);
		if (!Number.isFinite(z) || z <= 0)
			throw new Error('无效模型值');
		if (Math.abs(z - target) <= 0.5) {
			const rounded = dimensionsAtWidth(mode, base, round(w, 2), complement);
			if (Math.abs(evaluate(rounded) / target - 1) > 0.01)
				throw new Error('官网容差搜索结果的阻抗残差超过 1%');
			return rounded;
		}
		if (z > target)
			lo = w;
		else hi = w;
		if (hi - lo < 1e-8)
			break;
		w = (lo + hi) / 2;
	}
	throw new Error('官网容差搜索未收敛');
}
export function solveCalibratedDimensions(mode: string, base: JlcGeometry, target: number, evaluate: (g: JlcGeometry) => number, complement = false) {
	try {
		return { geometry: solveWebsiteDimensions(mode, base, target, evaluate, complement), method: 'website' };
	}
	catch {
		return { geometry: solveDimensions(mode, base, target, evaluate, complement), method: 'residual' };
	}
}
export function calculateRow(stack: OfflineStack, row: OfflineRow, complement: boolean, calibration: Calibration, legacy: Record<string, JlcRbfModel>) {
	const base = geometryFromStack(stack, row);
	const mode = getJlcMode(row.mode);
	if (complement && (mode.usesS1 || mode.usesD1) && row.width < 2.5)
		throw new Error('互补计算需要有效的初始 W1，不能同时省略线宽基准');
	const linked = complement && row.width >= 2.5 && (mode.usesS1 || mode.usesD1);
	const region = calibration.processVersion === PROCESS.version ? calibration.regions[regionKey(row.mode, base, linked)] : undefined;
	const matchingAnchors = region?.anchors.filter(a => a.initialWidth === base.W1
		&& (a.gap === undefined || Math.abs(a.gap - (base.S1 ?? 0)) < 1e-6)
		&& (a.distance === undefined || Math.abs(a.distance - (base.D1 ?? 0)) < 1e-6)) || [];
	const reference = matchingAnchors.find(a => a.target === row.target && a.solverVerified);
	const evalZ = (g: JlcGeometry) => evaluateGeometry(row.mode, g, calibration, legacy, linked).impedance;
	// An exact independently captured website inverse point is stronger than
	// re-running an inferred stopping rule. It also removes up to one ZoTol
	// bisection step of width drift while remaining completely offline.
	const solved = reference
		? { geometry: dimensionsAtWidth(row.mode, base, reference.width, linked), method: 'official-anchor' }
		: solveCalibratedDimensions(row.mode, base, row.target, evalZ, linked);
	const g = solved.geometry;
	const result = evaluateGeometry(row.mode, g, calibration, legacy, linked);
	const residual = Math.abs(result.impedance - row.target) / row.target;
	const templateCurrent = isProductionTemplate(stack.template);
	const verified = Boolean(calibration.solverVersion === SOLVER_VERSION && templateCurrent && reference && region?.verified && result.verified && residual <= 0.01 && Math.abs(g.W1 - reference.width) <= Math.max(0.1, reference.width * 0.01));
	const boundsText = region ? Object.entries(region.bounds || { W1: [region.min, region.max] as [number, number] }).map(([field, values]) => `${field} ${values[0]}～${values[1]} mil`).join('；') : '';
	return {
		...row,
		width: g.W1,
		gap: g.S1 ?? 0,
		distance: g.D1 ?? 0,
		calculated: result.impedance,
		errorPercent: (result.impedance - row.target) / row.target * 100,
		status: verified ? 'verified' : 'unverified',
		verified,
		reason: verified ? 'RBF正算审计通过，精确匹配官网反算采样' : !templateCurrent ? '叠层不在匹配参数的官网可选名单或结构已变更，禁止推荐' : '未通过完整官网尺寸与阻抗校验，仅供估算',
		modelVersion: calibration.version,
		processVersion: PROCESS.version,
		geometry: g,
		solverMethod: solved.method,
		calibrationRange: region ? `正算区间：${boundsText}；固定工艺和${linked ? '互补关系' : '已采样参数范围'}；初始 W1=${base.W1}；当前输入已验证的反算目标 ${[...new Set(matchingAnchors.filter(a => a.solverVerified).map(a => a.target))].join('/') || '无'} Ω` : '无匹配的已校准参数区间',
		reference: [row.upperRef && `上 L${row.upperRef}`, row.lowerRef && `下 L${row.lowerRef}`].filter(Boolean).join(' / '),
		widthSource: verified ? (solved.method === 'official-anchor' ? '官网反算采样·离线精确匹配' : solved.method === 'website' ? '官网流程·RBF反算' : '残差求解·独立验证') : linked ? '互补求解·估算' : 'RBF反算·估算',
	};
}
