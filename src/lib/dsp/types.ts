import type { Complex } from './complex';

/**
 * Zeros / poles / gain.
 *
 * Analog:  H(s) = k · Π(s − zᵢ) / Π(s − pᵢ)   (frequencies in rad/s)
 * Digital: H(z) = k · Π(z − zᵢ) / Π(z − pᵢ)
 */
export interface ZPK {
	z: Complex[];
	p: Complex[];
	k: number;
}

/**
 * Second-order sections. Each row is [b0, b1, b2, a0, a1, a2].
 *
 * Digital: Hᵢ(z) = (b0 + b1 z⁻¹ + b2 z⁻²) / (a0 + a1 z⁻¹ + a2 z⁻²)
 * Analog:  Hᵢ(s) = (b0 s² + b1 s + b2) / (a0 s² + a1 s + a2)
 */
export type SOS = number[][];

/** Transfer function polynomials (descending powers of s, or ascending powers of z⁻¹). */
export interface TF {
	b: number[];
	a: number[];
}

export type BandType = 'lowpass' | 'highpass' | 'bandpass' | 'bandstop';

/** A continuous-time filter described by its poles and zeros in rad/s. */
export interface AnalogFilter {
	kind: 'analog';
	zpk: ZPK;
}

/**
 * A discrete-time filter. At least one of `sos`, `tf` or `zpk` must be provided;
 * `fir` is a shorthand for tf = { b: fir, a: [1] }.
 */
export interface DigitalFilter {
	kind: 'digital';
	fs: number;
	zpk?: ZPK;
	sos?: SOS;
	tf?: TF;
	fir?: number[];
}

export type Filter = AnalogFilter | DigitalFilter;
