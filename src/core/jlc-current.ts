/**
 * JLC trace-current and via-current calculator formulas.
 *
 * Reverse-engineered from the official JLC calculators:
 * - https://www.jlc-fpc.com/trace-current-calculator (LineCurrentResistance component)
 * - https://www.jlc-fpc.com/via-current-calculator (ViaCurrent component)
 *
 * Both use IPC-2221 cross-section formulas with JLC-specific constants.
 */

export interface TraceCurrentInput {
  /** Current in amperes */
  current: number;
  /** Trace length in millimeters (JLC UI uses meters; we accept mm and convert) */
  lineLengthMm: number;
  /** Copper thickness in micrometers (12/18/35/70) */
  copperThicknessUm: number;
  /** true = outer layer (k=0.048), false = inner layer (k=0.024) */
  external: boolean;
  /** Ambient temperature in °C */
  ambientTemperature: number;
  /** Allowed temperature rise in °C */
  temperatureRise: number;
}

export interface TraceCurrentResult {
  /** Required trace width in mm */
  widthMm: number;
  /** Required trace width in mil */
  widthMil: number;
  /** Cross-sectional area in mil² (the IPC-2221 intermediate value) */
  crossSectionMil2: number;
  /** Trace resistance in ohms */
  resistanceOhm: number;
  /** Voltage drop in volts */
  voltageDropV: number;
  /** Power loss in watts */
  powerLossW: number;
  /** Operating temperature (ambient + rise) in °C */
  operatingTempC: number;
}

/**
 * Calculate required trace width for a given current.
 * Matches https://www.jlc-fpc.com/trace-current-calculator exactly.
 */
export function calculateTraceCurrent(input: TraceCurrentInput): TraceCurrentResult {
  const { current: I, copperThicknessUm, external, ambientTemperature, temperatureRise } = input;
  const lenM = input.lineLengthMm / 1000; // mm → m (JLC uses meters)
  const k = external ? 0.048 : 0.024;
  const dT = temperatureRise;
  const opTemp = ambientTemperature + dT;

  // IPC-2221 cross-section area in mil²
  const f = Math.pow(I / (k * Math.pow(dT, 0.44)), 1 / 0.725);

  // Convert f (mil²) to cm²: 1 mil = 2.54e-3 cm, so 1 mil² = (2.54e-3)² = 6.4516e-6 cm²
  const areaCm2 = (f * 2.54 * 2.54) / 1e6;

  // Copper thickness in cm (μm → cm: 1 μm = 1e-4 cm)
  const m = 1e-4 * copperThicknessUm;

  // Length in cm (m → cm)
  const v = lenM / 0.01;

  // Width: areaCm2 / thickness_cm = width_cm; /0.1 converts cm → mm
  const widthMm = areaCm2 / m / 0.1;
  const widthMil = widthMm / 0.0254;
  // Resistance: copper resistivity 1.7e-6 Ω·cm, temp coeff 0.0039/°C.
  // Divide by the physical cm² area, not the IPC mil² intermediate.
  const resistance = 17e-7 * v / areaCm2 * (1 + 0.0039 * (opTemp - 25));
  const voltageDrop = resistance * I;
  const powerLoss = resistance * I * I;

  return { widthMm, widthMil, crossSectionMil2: f, resistanceOhm: resistance, voltageDropV: voltageDrop, powerLossW: powerLoss, operatingTempC: opTemp };
}

export interface ViaCurrentInput {
  /** Maximum allowed temperature rise in °C */
  temperatureRise: number;
  /** Finished hole diameter in mm */
  apertureDiameterMm: number;
  /** Via plating copper thickness in μm */
  copperThicknessUm: number;
}

export interface ViaCurrentResult {
  /** Maximum current capacity of a single via in amperes */
  maxCurrentA: number;
}

/**
 * Calculate maximum via current capacity.
 * Matches https://www.jlc-fpc.com/via-current-calculator exactly.
 */
export function calculateViaCurrent(input: ViaCurrentInput): ViaCurrentResult {
  const { temperatureRise, apertureDiameterMm, copperThicknessUm } = input;
  // Cross-section: 3140 = π * 1000 (JLC empirical constant)
  // d_mil = d_mm / 25.4, t_mil = t_μm / 25.4
  const c = 3140 * apertureDiameterMm * (1 / 25.4) * copperThicknessUm / 25.4;
  const maxCurrent = 0.02 * Math.pow(temperatureRise, 0.44) * Math.pow(c, 0.725);
  return { maxCurrentA: maxCurrent };
}

export interface ViaDiameterInput {
  /** Required current in amperes */
  current: number;
  /** Maximum allowed temperature rise in °C */
  temperatureRise: number;
  /** Via plating copper thickness in μm */
  copperThicknessUm: number;
}

export interface ViaDiameterResult {
  /** Required hole diameter in mm */
  holeMm: number;
  /** Recommended pad diameter in mm */
  padMm: number;
  /** Hole diameter in mil */
  holeMil: number;
  /** Pad diameter in mil */
  padMil: number;
}

/**
 * Inverse of calculateViaCurrent: solve for hole diameter given current.
 * Returns diameter in mm. Used by the rule-generation pipeline.
 */
export function solveViaDiameter(input: ViaDiameterInput): ViaDiameterResult {
  const { current, temperatureRise, copperThicknessUm } = input;
  // Inverse: c = (I / (0.02 * dT^0.44))^(1/0.725)
  const c = Math.pow(current / (0.02 * Math.pow(temperatureRise, 0.44)), 1 / 0.725);
  // From c = 3140 * d_mm/25.4 * t_μm/25.4, solve for d_mm:
  // d_mm = c * 25.4 * 25.4 / (3140 * t_μm)
  const holeMm = Math.max(0.2, (c * 25.4 * 25.4) / (3140 * copperThicknessUm));
  const padMm = Math.max(holeMm + 0.3, holeMm * 1.75);
  return { holeMm, padMm, holeMil: holeMm / 0.0254, padMil: padMm / 0.0254 };
}
