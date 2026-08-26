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
	materials: unknown[];
}

export interface BoardFilter {
	boardType: number;
	layers: number;
	thickness: number;
	innerOz: number;
	outerOz: number;
}

export interface ImpedanceInput {
	targetOhms: number;
	kind: 'single' | 'differential';
	mode?: 'single' | 'differential' | 'coplanar-single' | 'coplanar-differential';
	dielectricHeightMm: number;
	copperThicknessMm: number;
	dielectricConstant: number;
	spacingMil: number;
	copperDistanceMil?: number;
	outerLayer?: boolean;
}

export function matchStackups(templates: StackupTemplate[], filter: BoardFilter): StackupTemplate[] {
	return templates.filter(template => template.recommended === 1
		&& template.boardType === filter.boardType
		&& template.layers === filter.layers
		&& Math.abs(template.thickness - filter.thickness) < 0.001
		&& (template.layers === 2 || Math.abs(template.innerOz - filter.innerOz) < 0.001)
		&& Math.abs(template.outerOz - filter.outerOz) < 0.001);
}

function microstripImpedance(widthMm: number, heightMm: number, thicknessMm: number, er: number): number {
	const u0 = Math.max(0.01, widthMm / heightMm);
	const th = Math.max(0.0001, thicknessMm / heightMm);
	const coth = 1 / Math.tanh(Math.sqrt(6.517 * u0));
	const deltaU = (th / Math.PI) * Math.log(1 + 4 * Math.E / (th * th * coth * coth));
	const u = u0 + Math.max(0, deltaU);
	const effectiveEr = (er + 1) / 2 + (er - 1) / 2 * (1 / Math.sqrt(1 + 12 / u) + (u < 1 ? 0.04 * (1 - u) ** 2 : 0));
	return u <= 1
		? 60 / Math.sqrt(effectiveEr) * Math.log(8 / u + 0.25 * u)
		: 120 * Math.PI / (Math.sqrt(effectiveEr) * (u + 1.393 + 0.667 * Math.log(u + 1.444)));
}

function coplanarCorrection(widthMm: number, heightMm: number, copperDistanceMm: number): number {
	const distanceRatio = Math.max(0.1, copperDistanceMm / Math.max(0.001, heightMm));
	// JLC treats D1 as the trace-to-copper spacing; this bounded first-order correction
	// keeps the CPW estimate finite while preserving the expected lower impedance.
	return 1 - 0.35 / (1 + distanceRatio);
}

export function calculateImpedance(widthMil: number, input: Omit<ImpedanceInput, 'targetOhms'>): number {
	const widthMm = widthMil * 0.0254;
	let impedance = microstripImpedance(widthMm, input.dielectricHeightMm, input.copperThicknessMm, input.dielectricConstant);
	const mode = input.mode ?? (input.kind === 'differential' ? 'differential' : 'single');
	if (mode === 'coplanar-single' || mode === 'coplanar-differential') {
		impedance *= coplanarCorrection(widthMm, input.dielectricHeightMm, (input.copperDistanceMil ?? 20) * 0.0254);
	}
	if (mode === 'differential' || mode === 'coplanar-differential') {
		const spacingMm = input.spacingMil * 0.0254;
		impedance = 2 * impedance * (1 - 0.48 * Math.exp(-0.96 * spacingMm / input.dielectricHeightMm));
	}
	return impedance;
}

export function calculateWidth(input: ImpedanceInput): number {
	let low = 1;
	let high = 200;
	for (let index = 0; index < 72; index++) {
		const middle = (low + high) / 2;
		if (calculateImpedance(middle, input) > input.targetOhms)
			low = middle;
		else high = middle;
	}
	let width = (low + high) / 2;
	if ((input.mode ?? input.kind) === 'single' && input.outerLayer) {
		const heightMil = input.dielectricHeightMm / 0.0254;
		width *= 0.99583832 + 0.91684773 / (heightMil + 10);
	}
	return width;
}
