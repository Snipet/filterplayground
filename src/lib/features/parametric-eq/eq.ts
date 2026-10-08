/**
 * Parametric EQ model: bands with fixed colour slots, their RBJ biquads, the
 * analog prototypes they are derived from (to show bilinear "cramping"), and
 * presets.
 */
import { biquad, type BiquadType } from '$lib/dsp/biquad';
import type { SOS } from '$lib/dsp/types';

export type EqType = 'peaking' | 'lowshelf' | 'highshelf' | 'lowpass' | 'highpass' | 'notch' | 'bandpass' | 'allpass';

export interface EqTypeInfo {
	id: EqType;
	name: string;
	short: string;
	usesGain: boolean;
}

export const EQ_TYPES: EqTypeInfo[] = [
	{ id: 'peaking', name: 'Peaking (bell)', short: 'Bell', usesGain: true },
	{ id: 'lowshelf', name: 'Low shelf', short: 'Low shelf', usesGain: true },
	{ id: 'highshelf', name: 'High shelf', short: 'High shelf', usesGain: true },
	{ id: 'lowpass', name: 'Low-pass (12 dB/oct)', short: 'Low-pass', usesGain: false },
	{ id: 'highpass', name: 'High-pass (12 dB/oct)', short: 'High-pass', usesGain: false },
	{ id: 'notch', name: 'Notch', short: 'Notch', usesGain: false },
	{ id: 'bandpass', name: 'Band-pass (0 dB peak)', short: 'Band-pass', usesGain: false },
	{ id: 'allpass', name: 'All-pass', short: 'All-pass', usesGain: false }
];

export const eqTypeInfo = (t: EqType): EqTypeInfo => EQ_TYPES.find((e) => e.id === t) ?? EQ_TYPES[0];

export const MAX_BANDS = 8;
export const MIN_Q = 0.1;
export const MAX_Q = 30;
export const MAX_GAIN = 24;

export interface EqBand {
	id: number;
	/** Colour slot 0…7, assigned on creation and kept for the band's lifetime. */
	slot: number;
	type: EqType;
	f: number;
	q: number;
	gain: number;
	enabled: boolean;
}

/** Lowest colour slot not used by any existing band (−1 if all are taken). */
export function freeSlot(bands: readonly EqBand[]): number {
	for (let s = 0; s < MAX_BANDS; s++) if (!bands.some((b) => b.slot === s)) return s;
	return -1;
}

export const slotColor = (slot: number): string => `var(--s${slot + 1})`;

/** Highest usable centre frequency for a sample rate. */
export const maxFreq = (fs: number): number => 0.49 * fs;

/** One RBJ biquad row [b0, b1, b2, 1, a1, a2] for a band. */
export function bandSection(b: EqBand, fs: number): number[] {
	return biquad({
		type: b.type as BiquadType,
		f0: Math.min(Math.max(b.f, 1), maxFreq(fs)),
		fs,
		q: b.q,
		gainDb: b.gain
	});
}

/** The cascade of all enabled bands (an identity section if none). */
export function cascade(bands: readonly EqBand[], fs: number): SOS {
	const on = bands.filter((b) => b.enabled);
	if (!on.length) return [[1, 0, 0, 1, 0, 0]];
	return on.map((b) => bandSection(b, fs));
}

/**
 * Magnitude (dB) of the analog RBJ prototype of a band at frequency f (Hz) —
 * the response the digital band would have without bilinear warping.
 */
export function analogBandDb(b: EqBand, f: number): number {
	const A = Math.pow(10, b.gain / 40);
	const w = f / Math.max(b.f, 1e-9); // normalised frequency, s = jw
	const Q = b.q;
	// numerator and denominator as (re, im) of polynomials in s = jw
	let nr: number, ni: number, dr: number, di: number;
	const w2 = w * w;
	switch (b.type) {
		case 'lowpass':
			nr = 1; ni = 0; dr = 1 - w2; di = w / Q;
			break;
		case 'highpass':
			nr = -w2; ni = 0; dr = 1 - w2; di = w / Q;
			break;
		case 'bandpass':
			nr = 0; ni = w / Q; dr = 1 - w2; di = w / Q;
			break;
		case 'notch':
			nr = 1 - w2; ni = 0; dr = 1 - w2; di = w / Q;
			break;
		case 'allpass':
			nr = 1 - w2; ni = -w / Q; dr = 1 - w2; di = w / Q;
			break;
		case 'peaking':
			nr = 1 - w2; ni = (w * A) / Q; dr = 1 - w2; di = w / (A * Q);
			break;
		case 'lowshelf': {
			const sA = Math.sqrt(A);
			// A·(s² + (√A/Q)s + A) / (A s² + (√A/Q)s + 1)
			nr = A * (A - w2); ni = (A * sA * w) / Q; dr = 1 - A * w2; di = (sA * w) / Q;
			break;
		}
		case 'highshelf': {
			const sA = Math.sqrt(A);
			// A·(A s² + (√A/Q)s + 1) / (s² + (√A/Q)s + A)
			nr = A * (1 - A * w2); ni = (A * sA * w) / Q; dr = A - w2; di = (sA * w) / Q;
			break;
		}
	}
	const num = Math.hypot(nr, ni);
	const den = Math.hypot(dr, di);
	return 20 * Math.log10(Math.max(num, 1e-300) / Math.max(den, 1e-300));
}

/** Where to draw a band's handle: the gain it controls, or its own level at f₀. */
export function markerLevel(b: EqBand, ownDbAtF0: number): number {
	switch (b.type) {
		case 'peaking':
			return b.gain;
		case 'lowshelf':
		case 'highshelf':
			return b.gain / 2; // RBJ shelves pass through half their dB gain at f₀
		default:
			return ownDbAtF0;
	}
}

/** Inverse of markerLevel for gain types: dragged level → band gain (dB). */
export function gainFromLevel(b: EqBand, level: number): number {
	const g = b.type === 'lowshelf' || b.type === 'highshelf' ? 2 * level : level;
	return Math.round(Math.max(-MAX_GAIN, Math.min(MAX_GAIN, g)) * 10) / 10;
}

export type PresetBand = Omit<EqBand, 'id' | 'slot' | 'enabled'>;

export interface Preset {
	id: string;
	name: string;
	description: string;
	bands: PresetBand[];
}

// Butterworth Q values for a 4th-order response built from two biquads
const BW4 = [0.5411961, 1.3065630];

export const PRESETS: Preset[] = [
	{
		id: 'vocal',
		name: 'Vocal polish',
		description: 'Low-cut, a little less mud, more presence, tamed sibilance and some air.',
		bands: [
			{ type: 'highpass', f: 70, q: 0.707, gain: 0 },
			{ type: 'peaking', f: 300, q: 1.4, gain: -3 },
			{ type: 'peaking', f: 2500, q: 1.2, gain: 4 },
			{ type: 'peaking', f: 6500, q: 4, gain: -3 },
			{ type: 'highshelf', f: 12000, q: 0.707, gain: 3 }
		]
	},
	{ id: 'flat', name: 'Flat', description: 'No bands — click the plot to add some.', bands: [] },
	{
		id: 'bass',
		name: 'Bass boost',
		description: 'A single low shelf: +6 dB below about 100 Hz.',
		bands: [{ type: 'lowshelf', f: 100, q: 0.707, gain: 6 }]
	},
	{
		id: 'loudness',
		name: 'Loudness',
		description: 'Boost lows and highs, as the ear loses sensitivity there at low listening levels.',
		bands: [
			{ type: 'lowshelf', f: 120, q: 0.6, gain: 8 },
			{ type: 'peaking', f: 3000, q: 1, gain: -1.5 },
			{ type: 'highshelf', f: 9000, q: 0.6, gain: 4 }
		]
	},
	{
		id: 'telephone',
		name: 'Telephone band-limit',
		description: '300 Hz – 3.4 kHz, 24 dB/oct each side: two biquads with Butterworth Q values make a 4th-order Butterworth.',
		bands: [
			{ type: 'highpass', f: 300, q: BW4[0], gain: 0 },
			{ type: 'highpass', f: 300, q: BW4[1], gain: 0 },
			{ type: 'lowpass', f: 3400, q: BW4[0], gain: 0 },
			{ type: 'lowpass', f: 3400, q: BW4[1], gain: 0 },
			{ type: 'peaking', f: 1500, q: 1, gain: 4 }
		]
	},
	{
		id: 'deesser',
		name: 'De-esser (static)',
		description: 'A narrow cut where sibilance lives, around 6–7 kHz.',
		bands: [{ type: 'peaking', f: 6500, q: 3, gain: -8 }]
	},
	{
		id: 'rumble',
		name: 'Rumble filter',
		description: '4th-order Butterworth high-pass at 25 Hz removes turntable rumble and stage thumps.',
		bands: [
			{ type: 'highpass', f: 25, q: BW4[0], gain: 0 },
			{ type: 'highpass', f: 25, q: BW4[1], gain: 0 }
		]
	},
	{
		id: 'hum',
		name: 'Mains hum notches',
		description: 'Notches at 50 Hz and its harmonics.',
		bands: [
			{ type: 'notch', f: 50, q: 20, gain: 0 },
			{ type: 'notch', f: 100, q: 20, gain: 0 },
			{ type: 'notch', f: 150, q: 20, gain: 0 },
			{ type: 'notch', f: 200, q: 20, gain: 0 }
		]
	},
	{
		id: 'cramp',
		name: 'Cramping demo',
		description: 'A wide bell at 16 kHz: watch it squeeze against Nyquist compared with its analog prototype.',
		bands: [{ type: 'peaking', f: 16000, q: 0.7, gain: 9 }]
	}
];

/** Build bands from a preset, assigning ids and slots 0, 1, 2… */
export function bandsFromPreset(p: Preset, firstId: number): EqBand[] {
	return p.bands.map((b, i) => ({ ...b, id: firstId + i, slot: i, enabled: true }));
}

/** Validate a band read from a shared link. */
export function sanitizeBand(v: unknown, id: number): EqBand | null {
	if (!v || typeof v !== 'object') return null;
	const o = v as Record<string, unknown>;
	const type = EQ_TYPES.find((t) => t.id === o.type)?.id;
	const f = Number(o.f);
	const q = Number(o.q);
	const gain = Number(o.gain);
	const slot = Number(o.slot);
	if (!type || !(f > 0) || !(q > 0) || !Number.isFinite(gain) || !Number.isInteger(slot) || slot < 0 || slot >= MAX_BANDS) return null;
	return {
		id,
		slot,
		type,
		f,
		q: Math.min(MAX_Q, Math.max(MIN_Q, q)),
		gain: Math.max(-MAX_GAIN, Math.min(MAX_GAIN, gain)),
		enabled: o.enabled !== false
	};
}
