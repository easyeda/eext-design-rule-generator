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
	if (!(geometry.W1 >= 2.5 && geometry.W1 <= 80))
		throw new Error('W1 必须在 2.5~80 mil 范围内');
	if (mode.usesS1 && !(geometry.S1! >= 2.5 && geometry.S1! <= 100))
		throw new Error('S1 必须在 2.5~100 mil 范围内');
	if (mode.usesD1 && !(geometry.D1! >= 2.5))
		throw new Error('D1 必须不小于 2.5 mil');
	if (mode.layer === 'inner' && (!(geometry.H2! > 0) || !(geometry.Er2! > 0)))
		throw new Error('内层阻抗模式需要 H2 和 Er2');
}

export function evaluateJlcSurrogate(type: string, geometry: JlcGeometry, model: JlcRbfModel): number {
	validateJlcGeometry(type, geometry);
	const raw = model.f.map((field, index) => Math.log(Math.max(1e-6, Number(geometry[field as keyof JlcGeometry] ?? 1))) / model.s[index]);
	const point = raw.map((v, i) => (v - model.h[i]) / model.q[0]);
	let value = 0;
	for (let row = 0; row < model.c.length; row++) {
		let sumSq = 0;
		for (let column = 0; column < point.length; column++)
			sumSq += (point[column] - model.c[row][column]) ** 2;
		value += model.a[row] * sumSq ** 1.5;
	}
	value += model.p[0];
	for (let index = 0; index < point.length; index++)
		value += model.p[index + 1] * point[index];
	return Math.exp(value);
}
