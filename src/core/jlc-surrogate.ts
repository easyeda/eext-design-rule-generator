import { getJlcMode } from './jlc-modes';

export interface JlcGeometry {
	H1: number;
	Er1: number;
	H2?: number;
	Er2?: number;
	W1: number;
	W2: number;
	S1?: number;
	D1?: number;
	T1: number;
	C1?: number;
	C2?: number;
	C3?: number;
	CEr?: number;
}

export interface JlcRbfModel {
	f: string[];
	s: number[];
	c: number[][];
	a: number[];
	p: number[];
	h: number[];
	q: number[];
}

export function validateJlcGeometry(type: string, geometry: JlcGeometry): void {
	const mode = getJlcMode(type);
	for (const key of ['H1', 'H2', 'Er1', 'Er2', 'W1', 'W2', 'S1', 'D1', 'T1', 'C1', 'C2', 'C3', 'CEr'] as const) {
		if (geometry[key] !== undefined && !Number.isFinite(geometry[key]))
			throw new Error(`${key} 必须是有限数`);
	}
	for (const key of ['C1', 'C2', 'C3'] as const) {
		if (geometry[key] !== undefined && geometry[key]! < 0)
			throw new Error(`${key} 不能为负数`);
	}
	if (geometry.CEr !== undefined && geometry.CEr <= 0)
		throw new Error('CEr 必须是有限正数');
	for (const key of ['H1', 'Er1', 'W2', 'T1'] as const) {
		if (!Number.isFinite(geometry[key]) || geometry[key] <= 0)
			throw new Error(`${key} 必须是有限正数`);
	}
	if (!(geometry.W1 >= 2.5 && geometry.W1 <= 100))
		throw new Error('W1 必须在 2.5~100 mil 范围内');
	if (mode.usesS1 && !(geometry.S1! >= 2.5 && geometry.S1! <= 100))
		throw new Error('S1 必须在 2.5~100 mil 范围内');
	if (mode.usesD1 && !(Number.isFinite(geometry.D1) && geometry.D1! >= 2.5 && geometry.D1! <= 80))
		throw new Error('D1 必须在 2.5~80 mil 范围内');
	if (mode.layer === 'inner' && (!(Number.isFinite(geometry.H2) && geometry.H2! > 0) || !(Number.isFinite(geometry.Er2) && geometry.Er2! > 0)))
		throw new Error('内层阻抗模式需要 H2 和 Er2');
}

export function evaluateJlcSurrogate(type: string, geometry: JlcGeometry, model: JlcRbfModel): number {
	validateJlcGeometry(type, geometry);
	// scipy RBF protocol: kernel distances in XX=log(x)/s space,
	// polynomial tail on (XX-h)/q, centers stored normalized (c*q+h = XX-space centers).
	const xx = model.f.map((field, index) => Math.log(Math.max(1e-6, Number(geometry[field as keyof JlcGeometry] ?? 1))) / model.s[index]);
	const point = xx.map((v, i) => (v - model.h[i]) / model.q[i]);
	let value = model.p[0];
	for (let index = 0; index < point.length; index++)
		value += model.p[index + 1] * point[index];
	for (let row = 0; row < model.c.length; row++) {
		let sumSq = 0;
		for (let column = 0; column < xx.length; column++)
			sumSq += (xx[column] - (model.c[row][column] * model.q[column] + model.h[column])) ** 2;
		value += model.a[row] * sumSq ** 1.5;
	}
	const result = Math.exp(value);
	if (!Number.isFinite(result) || result <= 0)
		throw new Error('RBF 返回非有限或非正数阻抗');
	return result;
}
