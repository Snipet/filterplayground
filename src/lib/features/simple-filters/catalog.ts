/**
 * Catalogue of small digital filters. Each entry describes its parameters and
 * builds a DigitalFilter (as b/a), a TeX difference equation with the actual
 * numbers, a block-diagram description, a one-line code snippet and stats.
 */
import type { DigitalFilter, TF, ZPK } from '$lib/dsp/types';
import { evaluate, findCrossing, linspace } from '$lib/dsp/response';
import { formatSI, trimNumber } from '$lib/dsp/units';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ParamValues = Record<string, number | string>;

interface ParamBase {
	key: string;
	label: string;
	/** Only show when this returns true. */
	show?: (v: ParamValues) => boolean;
	help?: string;
}
export interface SliderParam extends ParamBase {
	kind: 'slider';
	min: number | ((fs: number) => number);
	max: number | ((fs: number) => number);
	log?: boolean;
	integer?: boolean;
	step?: number;
	unit?: string;
	si?: boolean;
	default: number;
}
export interface ChoiceParam extends ParamBase {
	kind: 'choice';
	options: { value: string; label: string }[];
	default: string;
}
export type Param = SliderParam | ChoiceParam;

export interface Tap {
	/** Delay in samples. */
	delay: number;
	/** Multiplier value on that path (for feedback taps: −a_k). */
	coef: number;
}

export interface Diagram {
	ff: Tap[];
	fb: Tap[];
	/** Text drawn beside a feed-forward delay block that hides several taps. */
	ffNote?: string;
}

export interface SimpleStat {
	label: string;
	value: string;
	hint?: string;
	status?: 'good' | 'warning' | 'critical';
}

export interface Built {
	filter: DigitalFilter;
	/** Difference equation(s), TeX. */
	equation: string[];
	diagram: Diagram;
	code: string;
	stats: SimpleStat[];
	/** Analog/ideal reference response for the plots. */
	reference?: { zpk: ZPK; label: string };
	vlines?: { value: number; label?: string }[];
	/** Samples for the time-domain plots. */
	n?: number;
	warning?: string;
}

export interface SimpleFilter {
	id: string;
	name: string;
	summary: string;
	uses: string[];
	params: Param[];
	/** Preferred frequency axis. */
	scale: 'log' | 'linear';
	build: (v: ParamValues, fs: number) => Built;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Number for TeX: 5 significant digits, exponents as ×10ⁿ. */
export function tn(v: number, digits = 5): string {
	const s = trimNumber(v, digits);
	const m = s.match(/^(-?[\d.]+)e([+-]?\d+)$/);
	if (m) return `${m[1]}\\times10^{${Number(m[2])}}`;
	return s;
}
/** "+ 0.5" / "- 0.5" for building sums in TeX. */
const sg = (v: number, digits = 5) => (v < 0 ? `- ${tn(-v, digits)}` : `+ ${tn(v, digits)}`);
/** Number for code. */
const cn = (v: number) => {
	const s = String(Number(v.toPrecision(7)));
	return /[.e]/.test(s) ? s : `${s}.0`;
};

const num = (v: ParamValues, k: string) => Number(v[k]);
const str = (v: ParamValues, k: string) => String(v[k]);
const clampF = (f: number, fs: number) => Math.min(Math.max(f, fs * 1e-6), 0.4999 * fs);

const dig = (fs: number, b: number[], a: number[]): DigitalFilter => ({
	kind: 'digital',
	fs,
	tf: { b, a }
});

/** Gain in dB of a b/a filter at a frequency (Hz). */
export function gainDbAt(tf: TF, fs: number, f: number): number {
	return evaluate({ kind: 'digital', fs, tf }, [f]).magDb[0];
}

/**
 * −3 dB point (relative to the reference gain at DC for 'lp', at Nyquist for
 * 'hp'), found on a fine linear grid. Null if the response never crosses.
 */
export function cutoff3dB(tf: TF, fs: number, kind: 'lp' | 'hp'): number | null {
	const f = linspace(0, fs / 2, 8001);
	const db = evaluate({ kind: 'digital', fs, tf }, f).magDb;
	if (kind === 'lp') {
		const ref = db[0];
		return findCrossing(
			f,
			db.map((v) => v - ref),
			-3.0103
		);
	}
	const ref = db[db.length - 1];
	const rf = [...f].reverse();
	const rd = db.map((v) => v - ref).reverse();
	return findCrossing(rf, rd, -3.0103);
}

const hz = (f: number | null) => (f === null || !Number.isFinite(f) ? '—' : formatSI(f, 'Hz', 4));
/** dB value; anything below −250 dB is an exact zero lost to rounding or toDb's floor, so −∞. */
const db = (v: number) =>
	Number.isFinite(v) && v > -250 ? `${trimNumber(v, 4)} dB` : v < 0 ? '−∞ dB' : '∞ dB';
const samplesAndTime = (n: number, fs: number) =>
	Number.isFinite(n) ? `${trimNumber(n, 4)} samples (${formatSI(n / fs, 's', 3)})` : '∞';

/**
 * α of a one-pole smoother whose −3 dB point is exactly at fc: solving
 * α²/(1 − 2(1−α)cos ω + (1−α)²) = ½ gives α = −y + √(y² + 2y), y = 1 − cos ω.
 * Reaches its largest value 2√2 − 2 ≈ 0.828 at fc = fs/2.
 */
export function alphaExact3dB(fc: number, fs: number): number | null {
	const y = 1 - Math.cos((2 * Math.PI * fc) / fs);
	const a = -y + Math.sqrt(y * y + 2 * y);
	return a > 0 ? a : null;
}

/** α from the usual approximation α = 1 − e^{−2π fc / fs}. */
export const alphaApprox = (fc: number, fs: number): number =>
	1 - Math.exp((-2 * Math.PI * fc) / fs);

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

const ema: SimpleFilter = {
	id: 'ema',
	name: 'One-pole low-pass (EMA)',
	summary:
		'The exponential moving average: each output moves a fraction α of the way towards the new input. One multiply, one state variable, no overshoot — the default smoother for sensor data and control parameters.',
	uses: [
		'Smoothing noisy sensor readings and meters',
		'Parameter smoothing (de-zippering) in audio plug-ins',
		'Envelope followers and RMS detectors',
		'Exponentially weighted statistics (EWMA)'
	],
	scale: 'log',
	params: [
		{
			kind: 'choice',
			key: 'mode',
			label: 'Set by',
			options: [
				{ value: 'fc', label: 'Cutoff' },
				{ value: 'tau', label: 'Time constant' },
				{ value: 'alpha', label: 'α' }
			],
			default: 'fc'
		},
		{
			kind: 'slider',
			key: 'alpha',
			label: 'Smoothing factor α',
			min: 0.0005,
			max: 1,
			log: true,
			default: 0.05,
			show: (v) => v.mode === 'alpha'
		},
		{
			kind: 'slider',
			key: 'tau',
			label: 'Time constant τ',
			min: (fs) => 0.5 / fs,
			max: (fs) => 2000 / fs,
			log: true,
			unit: 's',
			si: true,
			default: 0.0005,
			show: (v) => v.mode === 'tau'
		},
		{
			kind: 'slider',
			key: 'fc',
			label: 'Cutoff fc',
			min: (fs) => fs * 1e-4,
			max: (fs) => 0.45 * fs,
			log: true,
			unit: 'Hz',
			default: 500,
			show: (v) => v.mode === 'fc'
		},
		{
			kind: 'choice',
			key: 'fcMethod',
			label: 'α from fc',
			options: [
				{ value: 'approx', label: '1 − e^(−2πfc/fs)' },
				{ value: 'exact', label: 'Exact −3 dB' }
			],
			default: 'approx',
			show: (v) => v.mode === 'fc'
		}
	],
	build(v, fs) {
		const mode = str(v, 'mode');
		let alpha: number;
		if (mode === 'alpha') alpha = num(v, 'alpha');
		else if (mode === 'tau') alpha = 1 - Math.exp(-1 / (fs * num(v, 'tau')));
		else {
			const fc = clampF(num(v, 'fc'), fs);
			alpha = str(v, 'fcMethod') === 'exact' ? (alphaExact3dB(fc, fs) ?? 1) : alphaApprox(fc, fs);
		}
		alpha = Math.min(Math.max(alpha, 1e-9), 1);
		const p = 1 - alpha;
		const b = [alpha];
		const a = [1, -p];
		const tf = { b, a };
		const wRC = p > 0 ? -fs * Math.log(p) : Infinity;
		const f3 = cutoff3dB(tf, fs, 'lp');
		const n63 = p > 0 ? -1 / Math.log(p) : 0;
		const n99 = p > 0 ? Math.log(0.01) / Math.log(p) : 0;
		return {
			filter: dig(fs, b, a),
			equation: [
				`y[n] = y[n-1] + \\alpha\\,\\big(x[n] - y[n-1]\\big)`,
				`y[n] = ${tn(alpha)}\\,x[n] ${sg(p)}\\,y[n-1]`
			],
			diagram: { ff: [{ delay: 0, coef: alpha }], fb: [{ delay: 1, coef: p }] },
			code: `y += ${cn(alpha)}f * (x - y);   /* α = ${trimNumber(alpha, 5)} */`,
			stats: [
				{ label: 'α', value: trimNumber(alpha, 5) },
				{ label: 'Pole (1 − α)', value: trimNumber(p, 6) },
				{ label: '−3 dB frequency', value: f3 === null ? 'none (α > 0.828)' : hz(f3) },
				{
					label: 'Time constant',
					value: samplesAndTime(n63, fs),
					hint: 'Samples for a step to reach 63 %: −1/ln(1 − α)'
				},
				{ label: 'Settling to 1 %', value: samplesAndTime(n99, fs) },
				{
					label: 'Noise variance ratio',
					value: trimNumber(alpha / (2 - alpha), 4),
					hint: 'Output/input variance for white noise: α/(2 − α). Equivalent to a moving average of about 2/α − 1 samples.'
				}
			],
			reference: Number.isFinite(wRC)
				? {
						zpk: { z: [], p: [{ re: -wRC, im: 0 }], k: wRC },
						label: `Analog RC (τ = ${formatSI(1 / wRC, 's', 3)})`
					}
				: undefined,
			vlines: f3 ? [{ value: f3, label: '−3 dB' }] : [],
			warning:
				f3 === null
					? 'With α above 2√2 − 2 ≈ 0.828 the response never falls 3 dB below its DC gain.'
					: undefined
		};
	}
};

const hp1: SimpleFilter = {
	id: 'hp1',
	name: 'One-pole high-pass',
	summary:
		'Everything the EMA removes: x − EMA(x). The bilinear version puts its −3 dB point exactly at fc and has unity gain at Nyquist; the "x − EMA" version is what you get by subtracting a smoother.',
	uses: [
		'Removing slow drift and offsets',
		'AC coupling of sensor signals',
		'Splitting a signal into slow and fast parts (with the EMA)',
		'Gentle low-cut in audio'
	],
	scale: 'log',
	params: [
		{
			kind: 'choice',
			key: 'variant',
			label: 'Variant',
			options: [
				{ value: 'bilinear', label: 'Bilinear (exact fc)' },
				{ value: 'ema', label: 'x − EMA' }
			],
			default: 'bilinear'
		},
		{
			kind: 'slider',
			key: 'fc',
			label: 'Cutoff fc',
			min: (fs) => fs * 1e-4,
			max: (fs) => 0.45 * fs,
			log: true,
			unit: 'Hz',
			default: 100
		}
	],
	build(v, fs) {
		const fc = clampF(num(v, 'fc'), fs);
		let g: number;
		let p: number;
		let equation: string[];
		if (str(v, 'variant') === 'ema') {
			const alpha = alphaApprox(fc, fs);
			p = 1 - alpha;
			g = p;
			equation = [
				`m[n] = m[n-1] + ${tn(alpha)}\\,\\big(x[n]-m[n-1]\\big),\\qquad y[n] = x[n] - m[n]`,
				`y[n] = ${tn(g)}\\,\\big(x[n] - x[n-1]\\big) ${sg(p)}\\,y[n-1]`
			];
		} else {
			const K = Math.tan((Math.PI * fc) / fs);
			g = 1 / (1 + K);
			p = (1 - K) / (1 + K);
			equation = [
				`K = \\tan(\\pi f_c/f_s) = ${tn(K)},\\quad g = \\tfrac{1}{1+K},\\quad p = \\tfrac{1-K}{1+K}`,
				`y[n] = ${tn(g)}\\,\\big(x[n] - x[n-1]\\big) ${sg(p)}\\,y[n-1]`
			];
		}
		const b = [g, -g];
		const a = [1, -p];
		const tf = { b, a };
		const f3 = cutoff3dB(tf, fs, 'hp');
		const wc = 2 * Math.PI * fc;
		return {
			filter: dig(fs, b, a),
			equation,
			diagram: {
				ff: [
					{ delay: 0, coef: g },
					{ delay: 1, coef: -g }
				],
				fb: [{ delay: 1, coef: p }]
			},
			code: `y = ${cn(g)}f * (x - x1) + ${cn(p)}f * y;  x1 = x;`,
			stats: [
				{ label: 'Pole p', value: trimNumber(p, 6) },
				{ label: '−3 dB frequency', value: hz(f3), hint: 'Relative to the gain at Nyquist' },
				{ label: 'Gain at Nyquist', value: db(gainDbAt(tf, fs, fs / 2)) },
				{ label: 'Gain at DC', value: '−∞ dB (zero at z = 1)' }
			],
			reference: {
				zpk: { z: [{ re: 0, im: 0 }], p: [{ re: -wc, im: 0 }], k: 1 },
				label: `Analog RC high-pass (fc = ${formatSI(fc, 'Hz', 3)})`
			},
			vlines: [{ value: fc, label: 'fc' }]
		};
	}
};

const dcblock: SimpleFilter = {
	id: 'dcblock',
	name: 'DC blocker',
	summary:
		'A zero exactly at DC (z = 1) and a pole just inside it at z = R. Away from DC the pole and zero almost cancel, so the response is flat; at DC the zero wins. The closer R is to 1, the narrower the notch.',
	uses: [
		'Removing ADC and microphone offsets',
		'Keeping DC out of feedback loops (Karplus–Strong, reverbs)',
		'Before non-linear processing (distortion, compression)',
		'Audio recording chains'
	],
	scale: 'log',
	params: [
		{
			kind: 'choice',
			key: 'mode',
			label: 'Set by',
			options: [
				{ value: 'R', label: 'Pole radius R' },
				{ value: 'fc', label: 'Cutoff' }
			],
			default: 'R'
		},
		{
			kind: 'slider',
			key: 'R',
			label: 'R',
			min: 0.9,
			max: 0.9999,
			step: 0.0001,
			default: 0.995,
			show: (v) => v.mode === 'R'
		},
		{
			kind: 'slider',
			key: 'fc',
			label: 'Cutoff ≈',
			min: (fs) => fs * 2e-5,
			max: (fs) => fs * 0.015,
			log: true,
			unit: 'Hz',
			default: 20,
			show: (v) => v.mode === 'fc',
			help: 'R = 1 − 2π·fc/fs'
		}
	],
	build(v, fs) {
		const R =
			str(v, 'mode') === 'fc' ? 1 - (2 * Math.PI * clampF(num(v, 'fc'), fs)) / fs : num(v, 'R');
		const b = [1, -1];
		const a = [1, -R];
		const tf = { b, a };
		const f3 = cutoff3dB(tf, fs, 'hp');
		return {
			filter: dig(fs, b, a),
			equation: [
				`y[n] = x[n] - x[n-1] ${sg(R, 6)}\\,y[n-1]`,
				`H(z) = \\frac{1 - z^{-1}}{1 - ${tn(R, 6)}\\,z^{-1}}`
			],
			diagram: {
				ff: [
					{ delay: 0, coef: 1 },
					{ delay: 1, coef: -1 }
				],
				fb: [{ delay: 1, coef: R }]
			},
			code: `y = x - x1 + ${cn(R)}f * y;  x1 = x;`,
			stats: [
				{ label: 'R', value: trimNumber(R, 6) },
				{ label: '−3 dB frequency', value: hz(f3), hint: '≈ (1 − R)·fs/2π for R close to 1' },
				{
					label: 'Time constant',
					value: samplesAndTime(1 / (1 - R), fs),
					hint: '1/(1 − R) samples'
				},
				{
					label: 'Gain at Nyquist',
					value: db(20 * Math.log10(2 / (1 + R))),
					hint: '2/(1 + R): multiply by (1 + R)/2 for exactly unity'
				}
			],
			vlines: f3 ? [{ value: f3, label: '−3 dB' }] : []
		};
	}
};

const leaky: SimpleFilter = {
	id: 'leaky',
	name: 'Leaky integrator / accumulator',
	summary:
		'A running sum that forgets: y[n] = x[n] + R·y[n−1]. With R = 1 it is a pure accumulator — a pole on the unit circle, infinite DC gain, and an output that drifts forever on any offset. A little leak (R < 1) makes it stable.',
	uses: [
		'Integral term of PI controllers (with anti-windup leak)',
		'Running sums and energy accumulators',
		'Integrator stages of CIC decimators (R = 1, integer maths)',
		'Phase accumulators of oscillators'
	],
	scale: 'log',
	params: [
		{
			kind: 'choice',
			key: 'kind',
			label: 'Type',
			options: [
				{ value: 'leaky', label: 'Leaky (R < 1)' },
				{ value: 'acc', label: 'Accumulator (R = 1)' }
			],
			default: 'leaky'
		},
		{
			kind: 'slider',
			key: 'leak',
			label: 'Leak 1 − R',
			min: 0.0001,
			max: 0.5,
			log: true,
			default: 0.01,
			show: (v) => v.kind === 'leaky'
		}
	],
	build(v, fs) {
		const R = str(v, 'kind') === 'acc' ? 1 : 1 - num(v, 'leak');
		const b = [1];
		const a = [1, -R];
		const marginal = R >= 1;
		return {
			filter: dig(fs, b, a),
			equation: [`y[n] = x[n] ${sg(R, 6)}\\,y[n-1]`, `H(z) = \\frac{1}{1 - ${tn(R, 6)}\\,z^{-1}}`],
			diagram: { ff: [{ delay: 0, coef: 1 }], fb: [{ delay: 1, coef: R }] },
			code: marginal ? `acc += x;` : `y = x + ${cn(R)}f * y;`,
			stats: [
				{ label: 'R', value: trimNumber(R, 6) },
				{
					label: 'Stability',
					value: marginal ? 'marginal (pole on |z| = 1)' : 'stable',
					status: marginal ? 'warning' : 'good',
					hint: 'A pole on the unit circle: bounded input can give unbounded output (any DC offset ramps).'
				},
				{
					label: 'DC gain',
					value: marginal ? '∞' : `${trimNumber(1 / (1 - R), 5)} (${db(-20 * Math.log10(1 - R))})`
				},
				{ label: 'Memory (1/(1 − R))', value: marginal ? '∞' : samplesAndTime(1 / (1 - R), fs) },
				{ label: 'Gain at Nyquist', value: db(-20 * Math.log10(1 + R)) }
			],
			reference: { zpk: { z: [], p: [{ re: 0, im: 0 }], k: fs }, label: 'Ideal integrator fs/s' },
			n: marginal ? 64 : undefined,
			warning: marginal
				? 'With R = 1 the step response ramps without bound: an accumulator is only marginally stable.'
				: undefined
		};
	}
};

const ma: SimpleFilter = {
	id: 'ma',
	name: 'Moving average',
	summary:
		'The average of the last N samples. Its frequency response is a periodic sinc (Dirichlet kernel) with perfect nulls at multiples of fs/N, and it has exactly linear phase. The recursive form needs only one add and one subtract per sample, whatever N.',
	uses: [
		'Smoothing with linear phase and no overshoot',
		'Rejecting a periodic disturbance: average over exactly one period (e.g. 20 ms for 50 Hz)',
		'Decimation (CIC filters are cascaded moving averages)',
		'Box-car integration of pulses'
	],
	scale: 'linear',
	params: [
		{ kind: 'slider', key: 'N', label: 'Length N', min: 2, max: 64, integer: true, default: 8 },
		{
			kind: 'choice',
			key: 'impl',
			label: 'Implementation',
			options: [
				{ value: 'recursive', label: 'Recursive (comb + integrator)' },
				{ value: 'direct', label: 'Direct FIR' }
			],
			default: 'recursive'
		}
	],
	build(v, fs) {
		const N = Math.max(2, Math.round(num(v, 'N')));
		const recursive = str(v, 'impl') === 'recursive';
		const filter: DigitalFilter = recursive
			? { kind: 'digital', fs, tf: { b: [1 / N, ...new Array(N - 1).fill(0), -1 / N], a: [1, -1] } }
			: { kind: 'digital', fs, fir: new Array(N).fill(1 / N) };
		const tf: TF = { b: new Array(N).fill(1 / N), a: [1] };
		const f3 = cutoff3dB(tf, fs, 'lp');
		// first sidelobe: largest magnitude between the first and second null
		let side = -Infinity;
		if (N >= 3) {
			const f = linspace(fs / N, Math.min((2 * fs) / N, fs / 2), 400);
			for (const d of evaluate({ kind: 'digital', fs, tf }, f).magDb) if (d > side) side = d;
		}
		const nulls = Array.from({ length: Math.min(6, Math.floor(N / 2)) }, (_, k) => ({
			value: ((k + 1) * fs) / N,
			label: k === 0 ? 'fs/N' : undefined
		}));
		return {
			filter,
			equation: recursive
				? [
						`y[n] = y[n-1] + \\tfrac{1}{${N}}\\big(x[n] - x[n-${N}]\\big)`,
						`H(z) = \\frac{1}{${N}}\\,\\frac{1 - z^{-${N}}}{1 - z^{-1}}`
					]
				: [
						`y[n] = \\frac{1}{${N}}\\sum_{k=0}^{${N - 1}} x[n-k]`,
						`|H(e^{j\\omega})| = \\left|\\frac{\\sin(${N}\\omega/2)}{${N}\\,\\sin(\\omega/2)}\\right|`
					],
			diagram: recursive
				? {
						ff: [
							{ delay: 0, coef: 1 / N },
							{ delay: N, coef: -1 / N }
						],
						fb: [{ delay: 1, coef: 1 }]
					}
				: N <= 4
					? { ff: Array.from({ length: N }, (_, k) => ({ delay: k, coef: 1 / N })), fb: [] }
					: {
							ff: [
								{ delay: 0, coef: 1 / N },
								{ delay: 1, coef: 1 / N },
								{ delay: N - 1, coef: 1 / N }
							],
							fb: [],
							ffNote: `${N - 3} more taps`
						},
			code: recursive
				? `acc += x - buf[i]; buf[i] = x; i = (i + 1) % ${N}; y = acc / ${N};`
				: `y = 0; for (k = 0; k < ${N}; k++) y += x[n - k]; y /= ${N};`,
			stats: [
				{ label: 'First null', value: hz(fs / N), hint: 'Nulls at every multiple of fs/N' },
				{ label: '−3 dB frequency', value: hz(f3), hint: '≈ 0.443·fs/N for large N' },
				{
					label: 'First sidelobe',
					value: N >= 3 ? db(side) : '—',
					hint: 'Tends to −13.3 dB for large N'
				},
				{ label: 'Group delay', value: `${trimNumber((N - 1) / 2, 4)} samples (constant)` },
				{ label: 'Noise variance ratio', value: `1/${N} = ${trimNumber(1 / N, 4)}` }
			],
			vlines: nulls,
			n: Math.max(24, 2 * N + 8)
		};
	}
};

const comb: SimpleFilter = {
	id: 'comb',
	name: 'Comb filters',
	summary:
		'Add a delayed copy of the input (feed-forward) or of the output (feedback). The response repeats every fs/D, like the teeth of a comb. Feed-forward combs have zeros (notches); feedback combs have poles (resonant peaks) and ring.',
	uses: [
		'Flangers and chorus (feed-forward, modulated delay)',
		'Echo and the building blocks of Schroeder reverbs (feedback)',
		'Karplus–Strong plucked strings (feedback comb + low-pass)',
		'Removing or enhancing a harmonic series'
	],
	scale: 'linear',
	params: [
		{
			kind: 'choice',
			key: 'kind',
			label: 'Type',
			options: [
				{ value: 'ff', label: 'Feed-forward' },
				{ value: 'fb', label: 'Feedback' }
			],
			default: 'ff'
		},
		{
			kind: 'slider',
			key: 'D',
			label: 'Delay D',
			min: 1,
			max: 100,
			integer: true,
			unit: 'samples',
			default: 8
		},
		{
			kind: 'slider',
			key: 'g',
			label: 'Gain g',
			min: -1,
			max: 1,
			step: 0.01,
			default: 0.7,
			show: (v) => v.kind === 'ff'
		},
		{
			kind: 'slider',
			key: 'gfb',
			label: 'Feedback g',
			min: -0.99,
			max: 0.99,
			step: 0.01,
			default: 0.7,
			show: (v) => v.kind === 'fb'
		}
	],
	build(v, fs) {
		const D = Math.max(1, Math.round(num(v, 'D')));
		const ff = str(v, 'kind') === 'ff';
		const g = ff ? num(v, 'g') : num(v, 'gfb');
		const zeros = new Array(D - 1).fill(0);
		const b = ff ? [1, ...zeros, g] : [1];
		const a = ff ? [1] : [1, ...zeros, -g];
		const ag = Math.abs(g);
		const peaksAt = g >= 0 ? 'k·fs/D' : '(k + ½)·fs/D';
		const teeth = Array.from({ length: Math.min(8, D) }, (_, k) => ({
			value: g >= 0 ? ((k + 1) * fs) / D : ((k + 0.5) * fs) / D
		})).filter((l) => l.value <= fs / 2);
		const stats: SimpleStat[] = [
			{ label: 'Tooth spacing fs/D', value: hz(fs / D) },
			{ label: 'Peaks at', value: peaksAt },
			{ label: 'Peak gain', value: db(ff ? 20 * Math.log10(1 + ag) : -20 * Math.log10(1 - ag)) },
			{
				label: 'Dip gain',
				value: db(ff ? 20 * Math.log10(Math.abs(1 - ag)) : -20 * Math.log10(1 + ag))
			},
			{ label: 'Delay', value: formatSI(D / fs, 's', 3) }
		];
		if (!ff && ag > 0)
			stats.push({
				label: 'Decay to −60 dB',
				value: samplesAndTime((D * Math.log(1e-3)) / Math.log(ag), fs),
				hint: 'D·ln(0.001)/ln|g|'
			});
		return {
			filter: dig(fs, b, a),
			equation: ff
				? [`y[n] = x[n] ${sg(g, 4)}\\,x[n-${D}]`, `H(z) = 1 ${sg(g, 4)}\\,z^{-${D}}`]
				: [`y[n] = x[n] ${sg(g, 4)}\\,y[n-${D}]`, `H(z) = \\frac{1}{1 ${sg(-g, 4)}\\,z^{-${D}}}`],
			diagram: ff
				? {
						ff: [
							{ delay: 0, coef: 1 },
							{ delay: D, coef: g }
						],
						fb: []
					}
				: { ff: [{ delay: 0, coef: 1 }], fb: [{ delay: D, coef: g }] },
			// ring buffer of exactly D samples: read the slot before overwriting it, so it is D samples old
			code: ff
				? `y = x + ${cn(g)}f * xd[i];  xd[i] = x;  i = (i + 1) % ${D};   /* float xd[${D}] = {0}; */`
				: `y = x + ${cn(g)}f * yd[i];  yd[i] = y;  i = (i + 1) % ${D};   /* float yd[${D}] = {0}; */`,
			stats,
			vlines: teeth,
			n: ff
				? Math.max(24, 2 * D + 8)
				: Math.min(
						1024,
						Math.max(48, Math.ceil(ag > 0 ? (D * Math.log(1e-3)) / Math.log(ag) : 4 * D))
					)
		};
	}
};

const reson: SimpleFilter = {
	id: 'reson',
	name: 'Two-pole resonator',
	summary:
		'A conjugate pole pair at radius r and angle θ = 2π·f₀/fs. The angle sets the resonant frequency, the distance from the unit circle sets the bandwidth: r ≈ e^{−πB/fs}. Adding zeros at z = ±1 keeps the peak gain nearly constant as you sweep f₀.',
	uses: [
		'Formant and modal synthesis (voices, bells, drums)',
		'Narrow band-pass for tone detection',
		'Sine oscillators (r = 1)',
		'Resonant peaks in synth filters'
	],
	scale: 'linear',
	params: [
		{
			kind: 'slider',
			key: 'f0',
			label: 'Centre f₀',
			min: (fs) => fs * 1e-3,
			max: (fs) => 0.49 * fs,
			log: true,
			unit: 'Hz',
			default: 4000
		},
		{
			kind: 'slider',
			key: 'B',
			label: 'Bandwidth B',
			min: (fs) => fs * 1e-4,
			max: (fs) => 0.2 * fs,
			log: true,
			unit: 'Hz',
			default: 300
		},
		{
			kind: 'choice',
			key: 'zeros',
			label: 'Zeros',
			options: [
				{ value: 'none', label: 'None' },
				{ value: 'pm1', label: 'At z = ±1' }
			],
			default: 'none'
		},
		{
			kind: 'choice',
			key: 'gain',
			label: 'Scaling',
			options: [
				{ value: 'unity', label: 'Unity at f₀' },
				{ value: 'fixed', label: 'Fixed (1 − r²)/2' }
			],
			default: 'unity'
		}
	],
	build(v, fs) {
		const f0 = clampF(num(v, 'f0'), fs);
		const B = num(v, 'B');
		const r = Math.exp((-Math.PI * B) / fs);
		const th = (2 * Math.PI * f0) / fs;
		const a1 = -2 * r * Math.cos(th);
		const a2 = r * r;
		const withZeros = str(v, 'zeros') === 'pm1';
		const shape = withZeros ? [1, 0, -1] : [1];
		const a = [1, a1, a2];
		let g: number;
		if (str(v, 'gain') === 'fixed') g = (1 - r * r) / 2;
		else {
			const h = gainDbAt({ b: shape, a }, fs, f0);
			g = Math.pow(10, -h / 20);
		}
		const b = shape.map((c) => c * g);
		const tf = { b, a };
		// measured peak & bandwidth
		const f = linspace(0, fs / 2, 8001);
		const resp = evaluate({ kind: 'digital', fs, tf }, f).magDb;
		let ip = 0;
		for (let i = 1; i < resp.length; i++) if (resp[i] > resp[ip]) ip = i;
		const rel = resp.map((d) => d - resp[ip]);
		const lo = findCrossing(
			[...f.slice(0, ip + 1)].reverse(),
			[...rel.slice(0, ip + 1)].reverse(),
			-3.0103
		);
		const hi = findCrossing(f.slice(ip), rel.slice(ip), -3.0103);
		const bw = lo !== null && hi !== null ? hi - lo : null;
		const decay = Math.log(1e-3) / Math.log(r);
		return {
			filter: dig(fs, b, a),
			equation: [
				`r = e^{-\\pi B/f_s} = ${tn(r, 6)},\\qquad \\theta = 2\\pi f_0/f_s = ${tn(th, 5)}`,
				withZeros
					? `y[n] = ${tn(g)}\\,\\big(x[n] - x[n-2]\\big) ${sg(-a1, 6)}\\,y[n-1] ${sg(-a2, 6)}\\,y[n-2]`
					: `y[n] = ${tn(g)}\\,x[n] ${sg(-a1, 6)}\\,y[n-1] ${sg(-a2, 6)}\\,y[n-2]`
			],
			diagram: {
				ff: withZeros
					? [
							{ delay: 0, coef: g },
							{ delay: 2, coef: -g }
						]
					: [{ delay: 0, coef: g }],
				fb: [
					{ delay: 1, coef: -a1 },
					{ delay: 2, coef: -a2 }
				]
			},
			code: withZeros
				? `y = ${cn(g)}f*(x - x2) + ${cn(-a1)}f*y1 + ${cn(-a2)}f*y2;  x2 = x1; x1 = x; y2 = y1; y1 = y;`
				: `y = ${cn(g)}f*x + ${cn(-a1)}f*y1 + ${cn(-a2)}f*y2;  y2 = y1; y1 = y;`,
			stats: [
				{ label: 'Pole radius r', value: trimNumber(r, 6) },
				{ label: 'Pole angle θ', value: `${trimNumber((th * 180) / Math.PI, 4)}°` },
				{ label: 'Peak', value: `${db(resp[ip])} @ ${hz(f[ip])}` },
				{ label: 'Measured −3 dB width', value: hz(bw) },
				{ label: 'Q = f₀/B', value: trimNumber(f0 / B, 4) },
				{ label: 'Ring-down (−60 dB)', value: samplesAndTime(decay, fs) }
			],
			vlines: [{ value: f0, label: 'f₀' }],
			n: Math.min(1024, Math.max(48, Math.ceil(decay)))
		};
	}
};

const notch: SimpleFilter = {
	id: 'notch',
	name: 'Notch from pole/zero pairs',
	summary:
		'Zeros on the unit circle at ±θ remove one frequency completely; poles at the same angle just inside the circle (radius r) cancel the zeros everywhere else, so the rest of the spectrum is untouched. r sets the notch width.',
	uses: [
		'Removing 50/60 Hz mains hum',
		'Suppressing a single interfering tone or feedback whistle',
		'Removing a known vibration frequency from sensor data',
		'ECG power-line interference'
	],
	scale: 'linear',
	params: [
		{
			kind: 'slider',
			key: 'f0',
			label: 'Notch f₀',
			min: (fs) => fs * 1e-3,
			max: (fs) => 0.49 * fs,
			log: true,
			unit: 'Hz',
			default: 4000
		},
		{
			kind: 'slider',
			key: 'B',
			label: '−3 dB width B',
			min: (fs) => fs * 1e-4,
			max: (fs) => 0.1 * fs,
			log: true,
			unit: 'Hz',
			default: 400
		}
	],
	build(v, fs) {
		const f0 = clampF(num(v, 'f0'), fs);
		const B = num(v, 'B');
		const r = Math.exp((-Math.PI * B) / fs);
		const th = (2 * Math.PI * f0) / fs;
		const c = Math.cos(th);
		const a = [1, -2 * r * c, r * r];
		const shape = [1, -2 * c, 1];
		// unity gain at whichever end of the spectrum is farther from the notch
		const fRef = th < Math.PI / 2 ? fs / 2 : 0;
		const g = Math.pow(10, -gainDbAt({ b: shape, a }, fs, fRef) / 20);
		const b = shape.map((x) => x * g);
		const tf = { b, a };
		const f = linspace(0, fs / 2, 8001);
		const resp = evaluate({ kind: 'digital', fs, tf }, f).magDb;
		const i0 = Math.round((f0 / (fs / 2)) * 8000);
		const lo = findCrossing(
			[...f.slice(0, i0 + 1)].reverse(),
			[...resp.slice(0, i0 + 1)].reverse(),
			-3.0103
		);
		const hi = findCrossing(f.slice(i0), resp.slice(i0), -3.0103);
		return {
			filter: dig(fs, b, a),
			equation: [
				`H(z) = g\\,\\frac{1 - 2\\cos\\theta\\,z^{-1} + z^{-2}}{1 - 2r\\cos\\theta\\,z^{-1} + r^2 z^{-2}}`,
				`g = ${tn(g)},\\quad r = ${tn(r, 6)},\\quad \\theta = ${tn(th)}\\ \\text{rad}`,
				`y[n] = ${tn(g)}\\big(x[n] ${sg(-2 * c)}\\,x[n-1] + x[n-2]\\big) ${sg(-a[1], 6)}\\,y[n-1] ${sg(-a[2], 6)}\\,y[n-2]`
			],
			diagram: {
				ff: [
					{ delay: 0, coef: g },
					{ delay: 1, coef: -2 * c * g },
					{ delay: 2, coef: g }
				],
				fb: [
					{ delay: 1, coef: -a[1] },
					{ delay: 2, coef: -a[2] }
				]
			},
			code: `y = ${cn(g)}f*(x + ${cn(-2 * c)}f*x1 + x2) + ${cn(-a[1])}f*y1 + ${cn(-a[2])}f*y2;  x2 = x1; x1 = x; y2 = y1; y1 = y;`,
			stats: [
				{ label: 'Pole radius r', value: trimNumber(r, 6) },
				{ label: 'Notch depth', value: '−∞ dB (zeros on |z| = 1)' },
				{ label: 'Measured −3 dB width', value: lo !== null && hi !== null ? hz(hi - lo) : '—' },
				{ label: 'Q = f₀/B', value: trimNumber(f0 / B, 4) },
				{
					label: 'Settling',
					value: samplesAndTime(Math.log(1e-3) / Math.log(r), fs),
					hint: 'Time for the transient to decay by 60 dB after the tone starts or stops'
				}
			],
			vlines: [{ value: f0, label: 'f₀' }],
			n: Math.min(1024, Math.max(48, Math.ceil(Math.log(1e-3) / Math.log(r))))
		};
	}
};

const allpass1: SimpleFilter = {
	id: 'allpass1',
	name: 'First-order all-pass',
	summary:
		'A pole at −c and a zero at its reciprocal −1/c: the magnitude is exactly 1 at every frequency, only the phase changes — from 0° at DC to −180° at Nyquist. Use it to shift phase around a break frequency, or as a fractional delay.',
	uses: [
		'Phaser effects (a chain of all-passes mixed with the dry signal)',
		'Fractional-delay interpolation (tuning waveguides, Karplus–Strong)',
		'Phase equalisation of crossovers',
		'Building Hilbert-transformer pairs'
	],
	scale: 'log',
	params: [
		{
			kind: 'choice',
			key: 'mode',
			label: 'Set by',
			options: [
				{ value: 'phase', label: 'Break frequency' },
				{ value: 'delay', label: 'Fractional delay' }
			],
			default: 'phase'
		},
		{
			kind: 'slider',
			key: 'fc',
			label: '−90° frequency',
			min: (fs) => fs * 1e-3,
			max: (fs) => 0.49 * fs,
			log: true,
			unit: 'Hz',
			default: 2000,
			show: (v) => v.mode === 'phase'
		},
		{
			kind: 'slider',
			key: 'd',
			label: 'Delay d (at DC)',
			min: 0.1,
			max: 3,
			step: 0.01,
			unit: 'samples',
			default: 0.5,
			show: (v) => v.mode === 'delay'
		}
	],
	build(v, fs) {
		const byPhase = str(v, 'mode') === 'phase';
		let c: number;
		let fc = 0;
		if (byPhase) {
			fc = clampF(num(v, 'fc'), fs);
			const K = Math.tan((Math.PI * fc) / fs);
			c = (K - 1) / (K + 1);
		} else {
			const d = num(v, 'd');
			c = (1 - d) / (1 + d);
		}
		const b = [c, 1];
		const a = [1, c];
		const gd0 = (1 - c) / (1 + c);
		const gdN = (1 + c) / (1 - c);
		const wc = 2 * Math.PI * fc;
		return {
			filter: dig(fs, b, a),
			equation: [
				`y[n] = ${tn(c)}\\,x[n] + x[n-1] ${sg(-c)}\\,y[n-1]`,
				`H(z) = \\frac{${tn(c)} + z^{-1}}{1 ${sg(c)}\\,z^{-1}},\\qquad \\tau(\\omega) = \\frac{1-c^2}{1+2c\\cos\\omega+c^2}`
			],
			diagram: {
				ff: [
					{ delay: 0, coef: c },
					{ delay: 1, coef: 1 }
				],
				fb: [{ delay: 1, coef: -c }]
			},
			code: `y = ${cn(c)}f * (x - y1) + x1;  x1 = x;  y1 = y;`,
			stats: [
				{ label: 'Coefficient c', value: trimNumber(c, 6) },
				{ label: 'Magnitude', value: '1 (0 dB) everywhere' },
				{ label: 'Group delay at DC', value: `${trimNumber(gd0, 5)} samples` },
				{
					label: 'Group delay at fs/2',
					value: Number.isFinite(gdN) ? `${trimNumber(gdN, 5)} samples` : '∞'
				},
				...(byPhase ? [{ label: 'Phase at break', value: '−90°' }] : [])
			],
			reference: byPhase
				? {
						zpk: { z: [{ re: wc, im: 0 }], p: [{ re: -wc, im: 0 }], k: -1 },
						label: `Analog all-pass (ωc − s)/(ωc + s)`
					}
				: undefined,
			vlines: byPhase ? [{ value: fc, label: '−90°' }] : [],
			n: 32
		};
	}
};

const diff: SimpleFilter = {
	id: 'diff',
	name: 'First difference (differentiator)',
	summary:
		'x[n] − x[n−1] approximates the derivative times T. Its gain rises like ω at low frequencies (the ideal differentiator) but saturates at 2 (+6 dB) at Nyquist — and it amplifies high-frequency noise. The central difference trades accuracy near DC for a zero at Nyquist.',
	uses: [
		'Velocity from position samples, slope detection',
		'Onset and edge detection',
		'Speech pre-emphasis y = x[n] − 0.97·x[n−1]',
		'Crude drift removal'
	],
	scale: 'log',
	params: [
		{
			kind: 'choice',
			key: 'variant',
			label: 'Variant',
			options: [
				{ value: 'backward', label: 'Backward' },
				{ value: 'central', label: 'Central' },
				{ value: 'pre', label: 'Pre-emphasis' }
			],
			default: 'backward'
		},
		{
			kind: 'slider',
			key: 'a',
			label: 'Coefficient a',
			min: 0.5,
			max: 1,
			step: 0.005,
			default: 0.97,
			show: (v) => v.variant === 'pre'
		}
	],
	build(v, fs) {
		const variant = str(v, 'variant');
		let b: number[];
		let equation: string[];
		let gd: string;
		let diagram: Diagram;
		let code: string;
		if (variant === 'central') {
			b = [0.5, 0, -0.5];
			equation = [
				`y[n] = \\tfrac{1}{2}\\big(x[n] - x[n-2]\\big)`,
				`|H(e^{j\\omega})| = |\\sin\\omega|`
			];
			gd = '1 sample';
			diagram = {
				ff: [
					{ delay: 0, coef: 0.5 },
					{ delay: 2, coef: -0.5 }
				],
				fb: []
			};
			code = `y = 0.5f * (x - x2);  x2 = x1;  x1 = x;`;
		} else if (variant === 'pre') {
			const a = num(v, 'a');
			b = [1, -a];
			equation = [`y[n] = x[n] ${sg(-a, 4)}\\,x[n-1]`, `H(z) = 1 ${sg(-a, 4)}\\,z^{-1}`];
			gd = 'frequency dependent';
			diagram = {
				ff: [
					{ delay: 0, coef: 1 },
					{ delay: 1, coef: -a }
				],
				fb: []
			};
			code = `y = x - ${cn(a)}f * x1;  x1 = x;`;
		} else {
			b = [1, -1];
			equation = [`y[n] = x[n] - x[n-1]`, `|H(e^{j\\omega})| = 2\\,|\\sin(\\omega/2)|`];
			gd = '½ sample';
			diagram = {
				ff: [
					{ delay: 0, coef: 1 },
					{ delay: 1, coef: -1 }
				],
				fb: []
			};
			code = `y = x - x1;  x1 = x;   /* ×fs for units per second */`;
		}
		const tf = { b, a: [1] };
		// |H| at DC and Nyquist are plain sums of the taps (z = ±1): no trigonometry, so the
		// exact zeros of the differences stay exact instead of becoming −6000 or −318 dB
		const edgeGain = (z: 1 | -1) => {
			const g = Math.abs(b.reduce((s, c, k) => s + c * z ** k, 0));
			return g < 1e-12 ? `−∞ dB (zero at z = ${z === 1 ? '1' : '−1'})` : db(20 * Math.log10(g));
		};
		const f10 = fs / 10;
		const ideal = (2 * Math.PI * f10) / fs;
		const err = (Math.pow(10, gainDbAt(tf, fs, f10) / 20) / ideal - 1) * 100;
		return {
			filter: { kind: 'digital', fs, fir: b },
			equation,
			diagram,
			code,
			stats: [
				{ label: 'Gain at Nyquist', value: edgeGain(-1) },
				{ label: 'Gain at DC', value: edgeGain(1) },
				{
					label: 'Error vs ideal at fs/10',
					value: `${err > 0 ? '+' : ''}${trimNumber(err, 3)} %`,
					hint: 'Compared with |H| = ω (rad/sample), the ideal differentiator scaled by T'
				},
				{ label: 'Group delay', value: gd }
			],
			reference: {
				zpk: { z: [{ re: 0, im: 0 }], p: [], k: 1 / fs },
				label: 'Ideal differentiator s·T'
			},
			n: 16
		};
	}
};

export const SIMPLE_FILTERS: SimpleFilter[] = [
	ema,
	hp1,
	dcblock,
	leaky,
	ma,
	comb,
	reson,
	notch,
	allpass1,
	diff
];

export function defaults(f: SimpleFilter): ParamValues {
	const out: ParamValues = {};
	for (const p of f.params) out[p.key] = p.default;
	return out;
}

export const resolve = (v: number | ((fs: number) => number), fs: number): number =>
	typeof v === 'function' ? v(fs) : v;
