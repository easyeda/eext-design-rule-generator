import type { JlcGeometry, JlcRbfModel } from './jlc-surrogate';
import { getJlcMode } from './jlc-modes';
import { dimensionsAtWidth, processFor, solveDimensions } from './jlc-offline';
import { evaluateJlcSurrogate } from './jlc-surrogate';

export function getTraceWidthDelta(copperOz: number, layer: 'outer' | 'inner'): number | null {
	try {
		return processFor(copperOz, layer === 'outer').copper.traceWidthDelta;
	}
	catch {
		return null;
	}
}

export interface JlcImpedanceConstraint {
	mode: string;
	target: number;
}

export interface JlcDimensionRow {
	mode: string;
	width: number;
	gap?: number;
	distance?: number;
}

export interface JlcComplementedDimensions {
	width: number;
	gap?: number;
	distance?: number;
}

export function evaluateJlcImpedance(type: string, geometry: JlcGeometry, model: JlcRbfModel): number {
	return evaluateJlcSurrogate(type, geometry, model);
}

export function solveW1(constraint: JlcImpedanceConstraint, geometry: JlcGeometry, model: JlcRbfModel): number {
	return solveDimensions(constraint.mode, geometry, constraint.target, g => evaluateJlcImpedance(constraint.mode, g, model)).W1;
}

/** @deprecated Pure geometry conversion only; use solveDimensions for a target-impedance solve. */
export function complementDimensions(row: JlcDimensionRow, solvedW1: number): JlcComplementedDimensions {
	const mode = getJlcMode(row.mode);
	const g = dimensionsAtWidth(row.mode, { W1: row.width, W2: row.width, S1: row.gap, D1: row.distance }, solvedW1, true);
	if ((mode.usesS1 && !(g.S1! >= 2.5 && g.S1! <= 100)) || (mode.usesD1 && !(g.D1! >= 2.5 && g.D1! <= 80)))
		throw new Error('互补结果超出有效尺寸区间');
	const dimensions: JlcComplementedDimensions = { width: solvedW1 };
	if (mode.usesS1 && row.gap !== undefined)
		dimensions.gap = g.S1;
	if (mode.usesD1 && row.distance !== undefined)
		dimensions.distance = g.D1;
	return dimensions;
}
