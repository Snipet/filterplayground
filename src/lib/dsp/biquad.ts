/**
 * Robert Bristow-Johnson's "Audio EQ Cookbook" biquads plus first-order
 * sections. Every function returns one SOS row [b0, b1, b2, 1, a1, a2].
 */

export type BiquadType =
	| 'lowpass'
	| 'highpass'
	| 'bandpass'
	| 'bandpass-peak'
	| 'notch'
	| 'allpass'
	| 'peaking'
	| 'lowshelf'
	| 'highshelf'
	| 'lowpass1'
	| 'highpass1'
	| 'allpass1'
	| 'lowshelf1'
	| 'highshelf1';

export interface BiquadInfo {
	id: BiquadType;
	name: string;
	usesQ: boolean;
	usesGain: boolean;
	firstOrder?: boolean;
	description: string;
}

export const BIQUAD_TYPES: BiquadInfo[] = [
	{
		id: 'lowpass',
		name: 'Low-pass',
		usesQ: true,
		usesGain: false,
		description: '12 dB/oct above f₀; Q sets the resonance at the corner (0.707 = Butterworth).'
	},
	{
		id: 'highpass',
		name: 'High-pass',
		usesQ: true,
		usesGain: false,
		description: '12 dB/oct below f₀; Q sets the resonance at the corner.'
	},
	{
		id: 'bandpass',
		name: 'Band-pass (0 dB peak)',
		usesQ: true,
		usesGain: false,
		description: 'Unity gain at f₀; Q sets the bandwidth (BW = f₀/Q).'
	},
	{
		id: 'bandpass-peak',
		name: 'Band-pass (peak = Q)',
		usesQ: true,
		usesGain: false,
		description: 'Constant skirt gain; peak gain equals Q.'
	},
	{
		id: 'notch',
		name: 'Notch (band-reject)',
		usesQ: true,
		usesGain: false,
		description: 'Zeros on the unit circle at f₀ — infinite attenuation there.'
	},
	{
		id: 'allpass',
		name: 'All-pass',
		usesQ: true,
		usesGain: false,
		description: 'Flat magnitude; phase rotates through 360° around f₀.'
	},
	{
		id: 'peaking',
		name: 'Peaking EQ (bell)',
		usesQ: true,
		usesGain: true,
		description: 'Boost or cut around f₀ with bandwidth set by Q.'
	},
	{
		id: 'lowshelf',
		name: 'Low shelf',
		usesQ: true,
		usesGain: true,
		description: 'Boost or cut below f₀. Q = 0.707 gives the steepest shelf without overshoot.'
	},
	{
		id: 'highshelf',
		name: 'High shelf',
		usesQ: true,
		usesGain: true,
		description: 'Boost or cut above f₀.'
	},
	{
		id: 'lowpass1',
		name: 'Low-pass (1st order)',
		usesQ: false,
		usesGain: false,
		firstOrder: true,
		description: '6 dB/oct one-pole low-pass (bilinear).'
	},
	{
		id: 'highpass1',
		name: 'High-pass (1st order)',
		usesQ: false,
		usesGain: false,
		firstOrder: true,
		description: '6 dB/oct one-pole high-pass (bilinear).'
	},
	{
		id: 'allpass1',
		name: 'All-pass (1st order)',
		usesQ: false,
		usesGain: false,
		firstOrder: true,
		description: '180° phase shift, −90° at f₀.'
	},
	{
		id: 'lowshelf1',
		name: 'Low shelf (1st order)',
		usesQ: false,
		usesGain: true,
		firstOrder: true,
		description: 'Gentle first-order shelf, half-gain at f₀.'
	},
	{
		id: 'highshelf1',
		name: 'High shelf (1st order)',
		usesQ: false,
		usesGain: true,
		firstOrder: true,
		description: 'Gentle first-order shelf, half-gain at f₀.'
	}
];

export interface BiquadParams {
	type: BiquadType;
	/** Centre / corner frequency, Hz. */
	f0: number;
	fs: number;
	q?: number;
	/** Gain in dB for peaking/shelving types. */
	gainDb?: number;
}

/** Convert bandwidth in octaves to Q (and back). */
export const bwToQ = (bwOct: number): number => {
	const p = Math.pow(2, bwOct);
	return Math.sqrt(p) / (p - 1);
};
export const qToBw = (q: number): number => (2 / Math.LN2) * Math.asinh(1 / (2 * q));

/** Shelf slope S → Q for a given shelf gain (RBJ). */
export function shelfSlopeToQ(S: number, gainDb: number): number {
	const A = Math.pow(10, gainDb / 40);
	return 1 / Math.sqrt((A + 1 / A) * (1 / S - 1) + 2);
}

export function biquad(params: BiquadParams): number[] {
	const { type, fs } = params;
	const f0 = Math.min(Math.max(params.f0, 1e-6), fs / 2 - 1e-6);
	const q = params.q ?? Math.SQRT1_2;
	const gainDb = params.gainDb ?? 0;
	const A = Math.pow(10, gainDb / 40);
	const w0 = (2 * Math.PI * f0) / fs;
	const cw = Math.cos(w0);
	const sw = Math.sin(w0);
	const alpha = sw / (2 * q);
	const sqA = Math.sqrt(A);
	let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
	switch (type) {
		case 'lowpass':
			b0 = (1 - cw) / 2;
			b1 = 1 - cw;
			b2 = (1 - cw) / 2;
			a0 = 1 + alpha;
			a1 = -2 * cw;
			a2 = 1 - alpha;
			break;
		case 'highpass':
			b0 = (1 + cw) / 2;
			b1 = -(1 + cw);
			b2 = (1 + cw) / 2;
			a0 = 1 + alpha;
			a1 = -2 * cw;
			a2 = 1 - alpha;
			break;
		case 'bandpass':
			b0 = alpha;
			b1 = 0;
			b2 = -alpha;
			a0 = 1 + alpha;
			a1 = -2 * cw;
			a2 = 1 - alpha;
			break;
		case 'bandpass-peak':
			b0 = sw / 2;
			b1 = 0;
			b2 = -sw / 2;
			a0 = 1 + alpha;
			a1 = -2 * cw;
			a2 = 1 - alpha;
			break;
		case 'notch':
			b0 = 1;
			b1 = -2 * cw;
			b2 = 1;
			a0 = 1 + alpha;
			a1 = -2 * cw;
			a2 = 1 - alpha;
			break;
		case 'allpass':
			b0 = 1 - alpha;
			b1 = -2 * cw;
			b2 = 1 + alpha;
			a0 = 1 + alpha;
			a1 = -2 * cw;
			a2 = 1 - alpha;
			break;
		case 'peaking':
			b0 = 1 + alpha * A;
			b1 = -2 * cw;
			b2 = 1 - alpha * A;
			a0 = 1 + alpha / A;
			a1 = -2 * cw;
			a2 = 1 - alpha / A;
			break;
		case 'lowshelf':
			b0 = A * (A + 1 - (A - 1) * cw + 2 * sqA * alpha);
			b1 = 2 * A * (A - 1 - (A + 1) * cw);
			b2 = A * (A + 1 - (A - 1) * cw - 2 * sqA * alpha);
			a0 = A + 1 + (A - 1) * cw + 2 * sqA * alpha;
			a1 = -2 * (A - 1 + (A + 1) * cw);
			a2 = A + 1 + (A - 1) * cw - 2 * sqA * alpha;
			break;
		case 'highshelf':
			b0 = A * (A + 1 + (A - 1) * cw + 2 * sqA * alpha);
			b1 = -2 * A * (A - 1 + (A + 1) * cw);
			b2 = A * (A + 1 + (A - 1) * cw - 2 * sqA * alpha);
			a0 = A + 1 - (A - 1) * cw + 2 * sqA * alpha;
			a1 = 2 * (A - 1 - (A + 1) * cw);
			a2 = A + 1 - (A - 1) * cw - 2 * sqA * alpha;
			break;
		case 'lowpass1': {
			const K = Math.tan(w0 / 2);
			b0 = K;
			b1 = K;
			b2 = 0;
			a0 = 1 + K;
			a1 = K - 1;
			a2 = 0;
			break;
		}
		case 'highpass1': {
			const K = Math.tan(w0 / 2);
			b0 = 1;
			b1 = -1;
			b2 = 0;
			a0 = 1 + K;
			a1 = K - 1;
			a2 = 0;
			break;
		}
		case 'allpass1': {
			const K = Math.tan(w0 / 2);
			b0 = K - 1;
			b1 = K + 1;
			b2 = 0;
			a0 = K + 1;
			a1 = K - 1;
			a2 = 0;
			break;
		}
		case 'lowshelf1': {
			// H(s) = (s + G·ωc)/(s + ωc); ωc = ω0/√G puts the half-dB-gain point at f0
			const G = Math.pow(10, gainDb / 20);
			const K = Math.tan(w0 / 2) / Math.sqrt(G);
			// H(s) = (s + G·K)/(s + K) evaluated with s = (1 − z⁻¹)/(1 + z⁻¹) (prewarped units)
			b0 = 1 + G * K;
			b1 = G * K - 1;
			b2 = 0;
			a0 = 1 + K;
			a1 = K - 1;
			a2 = 0;
			break;
		}
		case 'highshelf1': {
			const G = Math.pow(10, gainDb / 20);
			const K = Math.tan(w0 / 2) * Math.sqrt(G);
			// H(s) = (G·s + K)/(s + K)
			b0 = G + K;
			b1 = K - G;
			b2 = 0;
			a0 = 1 + K;
			a1 = K - 1;
			a2 = 0;
			break;
		}
	}
	return [b0 / a0, b1 / a0, b2 / a0, 1, a1 / a0, a2 / a0];
}
