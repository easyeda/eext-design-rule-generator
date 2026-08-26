export interface JlcImpedanceMode {
	type: string;
	label: string;
	pattern: 0 | 1 | 2 | 3;
	layer: 'outer' | 'inner';
	coated: boolean;
	usesS1: boolean;
	usesD1: boolean;
}

export const JLC_IMPEDANCE_MODES: JlcImpedanceMode[] = [
	{ type: 'CoatedMicrostrip1B', label: '单端阻抗（外层）', pattern: 0, layer: 'outer', coated: true, usesS1: false, usesD1: false },
	{ type: 'SurfaceMicrostrip1B', label: '单端阻抗（不带防焊）', pattern: 0, layer: 'outer', coated: false, usesS1: false, usesD1: false },
	{ type: 'OffsetStripline1B1A', label: '单端阻抗（内层）', pattern: 0, layer: 'inner', coated: false, usesS1: false, usesD1: false },
	{ type: 'DiffEdgeCoupledCoatedMicrostrip1B', label: '差分阻抗（外层）', pattern: 1, layer: 'outer', coated: true, usesS1: true, usesD1: false },
	{ type: 'DiffEdgeCoupledSurfaceMicrostrip1B', label: '差分阻抗（不带防焊）', pattern: 1, layer: 'outer', coated: false, usesS1: true, usesD1: false },
	{ type: 'DiffOffsetStripline1B1A', label: '差分阻抗（内层）', pattern: 1, layer: 'inner', coated: false, usesS1: true, usesD1: false },
	{ type: 'CoatedCoplanarWaveguideWithLowerGnd1B', label: '共面单端（外层）', pattern: 2, layer: 'outer', coated: true, usesS1: false, usesD1: true },
	{ type: 'SurfaceCoplanarWaveguideWithLowerGnd1B', label: '共面单端（不带防焊）', pattern: 2, layer: 'outer', coated: false, usesS1: false, usesD1: true },
	{ type: 'OffsetCoplanarWaveguide1B1A', label: '共面单端（内层）', pattern: 2, layer: 'inner', coated: false, usesS1: false, usesD1: true },
	{ type: 'DiffCoatedCoplanarWaveguideWithLowerGnd1B', label: '共面差分（外层）', pattern: 3, layer: 'outer', coated: true, usesS1: true, usesD1: true },
	{ type: 'DiffSurfaceCoplanarWaveguideWithLowerGnd1B', label: '共面差分（不带防焊）', pattern: 3, layer: 'outer', coated: false, usesS1: true, usesD1: true },
	{ type: 'DiffOffsetCoplanarWaveguide1B1A', label: '共面差分（内层）', pattern: 3, layer: 'inner', coated: false, usesS1: true, usesD1: true },
];

export function getJlcMode(type: string): JlcImpedanceMode {
	const mode = JLC_IMPEDANCE_MODES.find(item => item.type === type);
	if (!mode)
		throw new Error(`未知嘉立创阻抗模式：${type}`);
	return mode;
}
