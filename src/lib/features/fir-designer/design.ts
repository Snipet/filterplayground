/**
 * FIR designer: specification handling, design dispatch, automatic length
 * search, spec measurement and linear-phase type bookkeeping.
 * All frequencies are in Hz; `fs` is the sampling rate.
 */
import {
	firls,
	firwin2,
	passbandRippleToDelta,
	remezOrderEstimate,
	stopbandAttenToDelta,
	type WindowSpec
} from '$lib/dsp/fir';
import { remez, type RemezResult } from '$lib/dsp/remez';
import { kaiserBeta, kaiserOrder } from '$lib/dsp/windows';
import { fftReal, nextPow2 } from '$lib/dsp/fft';
import { cachedWindow, firwinFast } from './windowing';
import { firlsSweep } from './fastLs';
import type { BandType } from '$lib/dsp/types';

export type Method = 'window' | 'kaiser' | 'ls' | 'fsamp' | 'pm';
export type Shape = BandType | 'custom';
export type Symmetry = 'even' | 'odd';

export interface Band {
	f1: number;
	f2: number;
	/** Desired (linear) amplitude at f1 and f2. */
	d1: number;
	d2: number;
	weight: number;
}

export interface Spec {
	band: BandType;
	/**
	 * Band edges in increasing order (Hz):
	 * LP [fpass, fstop] · HP [fstop, fpass] · BP [fstop1, fpass1, fpass2, fstop2] · BS [fpass1, fstop1, fstop2, fpass2]
	 */
	edges: number[];
	/** Peak-to-peak passband ripple, dB. */
	rp: number;
	/** Minimum stopband attenuation, dB. */
	rs: number;
}

export interface MethodInfo {
	id: Method;
	name: string;
	summary: string;
	maxTaps: number;
	/** Supports the custom multiband editor. */
	custom: boolean;
}

export const METHODS: MethodInfo[] = [
	{
		id: 'window',
		name: 'Window method',
		summary:
			'Truncate the ideal (sinc) impulse response and taper it with a window. Simple and robust; the window sets the stopband floor.',
		maxTaps: 1023,
		custom: false
	},
	{
		id: 'kaiser',
		name: 'Kaiser (from specs)',
		summary:
			"Window method with a Kaiser window whose β and length come straight from Kaiser's empirical formulas.",
		maxTaps: 1023,
		custom: false
	},
	{
		id: 'ls',
		name: 'Least squares',
		summary:
			'Minimises the weighted integrated squared error over the bands (firls). Odd lengths only (type I).',
		maxTaps: 401,
		custom: true
	},
	{
		id: 'fsamp',
		name: 'Frequency sampling',
		summary:
			'Samples a piecewise-linear desired response on a dense grid, inverse-FFTs it and applies a window (firwin2).',
		maxTaps: 1023,
		custom: true
	},
	{
		id: 'pm',
		name: 'Parks–McClellan',
		summary:
			'Optimal equiripple (minimax) design by the Remez exchange algorithm: the fewest taps for a given ripple spec.',
		maxTaps: 511,
		custom: true
	}
];

export const methodInfo = (m: Method): MethodInfo => METHODS.find((x) => x.id === m) ?? METHODS[0];

// ---------------------------------------------------------------------------
// Specifications
// ---------------------------------------------------------------------------

export const deltas = (rp: number, rs: number) => ({
	dp: passbandRippleToDelta(rp),
	ds: stopbandAttenToDelta(rs)
});

/** Edge labels in the same order as Spec.edges. */
export function edgeLabels(band: BandType): string[] {
	switch (band) {
		case 'lowpass':
			return ['Passband edge', 'Stopband edge'];
		case 'highpass':
			return ['Stopband edge', 'Passband edge'];
		case 'bandpass':
			return [
				'Lower stopband edge',
				'Lower passband edge',
				'Upper passband edge',
				'Upper stopband edge'
			];
		case 'bandstop':
			return [
				'Lower passband edge',
				'Lower stopband edge',
				'Upper stopband edge',
				'Upper passband edge'
			];
	}
}

/** Returns an error message, or null if the spec is usable. */
export function validateSpec(spec: Spec, fs: number): string | null {
	const nyq = fs / 2;
	if (!(fs > 0)) return 'The sampling rate must be positive.';
	const e = spec.edges;
	if (e.some((v) => !Number.isFinite(v))) return 'Band edges must be numbers.';
	if (e[0] <= 0) return 'Band edges must be above 0 Hz.';
	if (e[e.length - 1] >= nyq) return `Band edges must be below fs/2 = ${nyq} Hz.`;
	for (let i = 1; i < e.length; i++)
		if (e[i] <= e[i - 1]) {
			const names = edgeLabels(spec.band);
			return `The ${names[i - 1].toLowerCase()} must be below the ${names[i].toLowerCase()} (a transition band needs a positive width).`;
		}
	if (!(spec.rp > 0)) return 'The passband ripple must be positive.';
	if (!(spec.rs > 0)) return 'The stopband attenuation must be positive.';
	return null;
}

export interface SpecBands {
	bands: Band[];
	kinds: ('pass' | 'stop')[];
}

/** Standard spec → bands (0 … fs/2) with weights W_pass = 1, W_stop = δp/δs. */
export function specBands(spec: Spec, fs: number): SpecBands {
	const nyq = fs / 2;
	const { dp, ds } = deltas(spec.rp, spec.rs);
	const ws = dp / ds;
	const e = spec.edges;
	const P = (f1: number, f2: number): Band => ({ f1, f2, d1: 1, d2: 1, weight: 1 });
	const S = (f1: number, f2: number): Band => ({ f1, f2, d1: 0, d2: 0, weight: ws });
	switch (spec.band) {
		case 'lowpass':
			return { bands: [P(0, e[0]), S(e[1], nyq)], kinds: ['pass', 'stop'] };
		case 'highpass':
			return { bands: [S(0, e[0]), P(e[1], nyq)], kinds: ['stop', 'pass'] };
		case 'bandpass':
			return { bands: [S(0, e[0]), P(e[1], e[2]), S(e[3], nyq)], kinds: ['stop', 'pass', 'stop'] };
		case 'bandstop':
			return { bands: [P(0, e[0]), S(e[1], e[2]), P(e[3], nyq)], kinds: ['pass', 'stop', 'pass'] };
	}
}

/**
 * Frequency `f` rescaled from sampling rate `fsOld` to `fsNew` (6 significant digits), kept
 * within the new fs/2: an edge at the old fs/2 lands exactly on the new one, and rounding up
 * never pushes an edge past it.
 */
export function rescaleFreq(f: number, fsOld: number, fsNew: number): number {
	const nyq = fsNew / 2;
	if (f >= fsOld / 2) return nyq;
	return Math.min(nyq, Number((f * (fsNew / fsOld)).toPrecision(6)));
}

/** Narrowest transition band (Hz). */
export function transitionWidth(spec: Spec): number {
	const e = spec.edges;
	let w = Infinity;
	for (let i = 0; i + 1 < e.length; i += 2) w = Math.min(w, e[i + 1] - e[i]);
	return w;
}

/** Window-method cutoffs: the middle of each transition band. */
export function firwinCutoffs(spec: Spec): number[] {
	const e = spec.edges;
	const out: number[] = [];
	for (let i = 0; i + 1 < e.length; i += 2) out.push((e[i] + e[i + 1]) / 2);
	return out;
}

export const passZero = (band: BandType): boolean => band === 'lowpass' || band === 'bandstop';

/** HP and BS need gain at fs/2, which only odd-length (type I) symmetric filters provide. */
export const needsOdd = (band: BandType): boolean => band === 'highpass' || band === 'bandstop';

/** Kaiser attenuation figure: windows give equal ripple in both bands, so use the tighter δ. */
export function kaiserAttenuation(spec: Spec): number {
	const { dp, ds } = deltas(spec.rp, spec.rs);
	return -20 * Math.log10(Math.min(dp, ds));
}

// ---------------------------------------------------------------------------
// Custom bands
// ---------------------------------------------------------------------------

export function validateBands(bands: Band[], fs: number, method: Method): string[] {
	const nyq = fs / 2;
	const errs: string[] = [];
	if (bands.length === 0) errs.push('Add at least one band.');
	bands.forEach((b, i) => {
		const n = i + 1;
		if (![b.f1, b.f2, b.d1, b.d2, b.weight].every(Number.isFinite))
			errs.push(`Band ${n}: all fields must be numbers.`);
		else {
			if (b.f1 < 0 || b.f2 > nyq)
				errs.push(`Band ${n}: edges must lie between 0 and fs/2 = ${nyq} Hz.`);
			if (b.f2 <= b.f1) errs.push(`Band ${n}: the upper edge must be above the lower edge.`);
			if (method !== 'fsamp' && !(b.weight > 0))
				errs.push(`Band ${n}: the weight must be positive.`);
		}
		if (i > 0 && b.f1 < bands[i - 1].f2)
			errs.push(
				`Band ${n} starts before band ${i} ends: bands must be in increasing order without overlap.`
			);
	});
	return errs;
}

/** firwin2 break points from bands; gaps are interpolated linearly, ends extended to 0 and fs/2. */
export function bandsToPoints(bands: Band[], fs: number): { freq: number[]; gain: number[] } {
	const nyq = fs / 2;
	const freq: number[] = [];
	const gain: number[] = [];
	if (bands.length === 0) return { freq: [0, nyq], gain: [0, 0] };
	if (bands[0].f1 > 0) {
		freq.push(0);
		gain.push(bands[0].d1);
	}
	for (const b of bands) {
		freq.push(b.f1, b.f2);
		gain.push(b.d1, b.d2);
	}
	if (bands[bands.length - 1].f2 < nyq) {
		freq.push(nyq);
		gain.push(bands[bands.length - 1].d2);
	}
	return { freq, gain };
}

/**
 * firwin2 break points for a standard spec. The window smooths the corners of the
 * desired response, so the linear transition is narrowed to `frac` of the spec's
 * transition band (centred on it) to leave room for that smoothing.
 */
export function fsampPoints(
	spec: Spec,
	fs: number,
	frac: number
): { freq: number[]; gain: number[] } {
	const e = spec.edges.slice();
	for (let i = 0; i + 1 < e.length; i += 2) {
		const mid = (e[i] + e[i + 1]) / 2;
		const half = (Math.max(0, Math.min(1, frac)) * (e[i + 1] - e[i])) / 2;
		e[i] = mid - half;
		e[i + 1] = mid + half;
	}
	return bandsToPoints(specBands({ ...spec, edges: e }, fs).bands, fs);
}

/** Desired response at f (Hz) inside a band. */
export const desiredAt = (b: Band, f: number): number =>
	b.f2 === b.f1 ? b.d1 : b.d1 + ((f - b.f1) / (b.f2 - b.f1)) * (b.d2 - b.d1);

// ---------------------------------------------------------------------------
// Linear-phase types
// ---------------------------------------------------------------------------

export type LpType = 1 | 2 | 3 | 4;

export function linearPhaseType(N: number, sym: Symmetry): LpType {
	const odd = N % 2 === 1;
	if (sym === 'even') return odd ? 1 : 2;
	return odd ? 3 : 4;
}

export const TYPE_NAMES: Record<LpType, string> = {
	1: 'Type I',
	2: 'Type II',
	3: 'Type III',
	4: 'Type IV'
};

/** Which band ends a type forces to zero gain. */
export function forcedZeros(t: LpType): { dc: boolean; nyq: boolean } {
	return { dc: t === 3 || t === 4, nyq: t === 2 || t === 3 };
}

/** Problems caused by forced zeros: desired gain ≠ 0 where the type forces H = 0. */
export function typeConflicts(t: LpType, bands: Band[], fs: number): string[] {
	const nyq = fs / 2;
	const fz = forcedZeros(t);
	const out: string[] = [];
	const tolF = nyq * 1e-6;
	const first = bands[0];
	const last = bands[bands.length - 1];
	if (fz.dc && first && first.f1 <= tolF && Math.abs(first.d1) > 1e-9)
		out.push(
			`${TYPE_NAMES[t]} has a forced zero at z = +1, so H(0) = 0 — but the design asks for gain ${trim(first.d1)} at DC.`
		);
	if (fz.nyq && last && last.f2 >= nyq - tolF && Math.abs(last.d2) > 1e-9)
		out.push(
			`${TYPE_NAMES[t]} has a forced zero at z = −1, so H(fs/2) = 0 — but the design asks for gain ${trim(last.d2)} at fs/2.`
		);
	return out;
}

const trim = (v: number) => String(Number(v.toPrecision(4)));

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/**
 * Real amplitude A(f) of a linear-phase FIR (zero-phase response):
 * symmetric H = A·e^{−jωM}; antisymmetric H = j·A·e^{−jωM}, with M = (N−1)/2.
 */
export function amplitudeAt(h: readonly number[], sym: Symmetry, fNorm: number): number {
	const M = (h.length - 1) / 2;
	const w = 2 * Math.PI * fNorm;
	let s = 0;
	for (let n = 0; n < h.length; n++) {
		const t = (M - n) * w;
		s += h[n] * (sym === 'even' ? Math.cos(t) : Math.sin(t));
	}
	return s;
}

export interface DenseResponse {
	/** Frequencies in Hz (0 … fs/2). */
	f: number[];
	/** Real amplitude A(f). */
	A: number[];
	/** |H(f)|. */
	mag: number[];
}

/** Dense amplitude/magnitude via a zero-padded FFT. */
export function denseResponse(
	h: readonly number[],
	fs: number,
	sym: Symmetry,
	minPoints = 8192
): DenseResponse {
	const n = nextPow2(Math.max(minPoints, 16 * h.length));
	const { re, im } = fftReal(h, n);
	const M = (h.length - 1) / 2;
	const f: number[] = [];
	const A: number[] = [];
	const mag: number[] = [];
	for (let k = 0; k <= n / 2; k++) {
		const w = (2 * Math.PI * k) / n;
		// H·e^{jωM}
		const c = Math.cos(w * M);
		const s = Math.sin(w * M);
		const r = re[k] * c - im[k] * s;
		const i = re[k] * s + im[k] * c;
		f.push((k / n) * fs);
		A.push(sym === 'even' ? r : i);
		mag.push(Math.hypot(re[k], im[k]));
	}
	return { f, A, mag };
}

/** Evaluate `fn` at every dense-grid point inside [f1, f2] plus the exact edges. */
function forBand(
	h: readonly number[],
	fs: number,
	sym: Symmetry,
	dense: DenseResponse,
	f1: number,
	f2: number,
	fn: (f: number, A: number) => void
) {
	fn(f1, amplitudeAt(h, sym, f1 / fs));
	fn(f2, amplitudeAt(h, sym, f2 / fs));
	const df = dense.f[1] - dense.f[0];
	const k0 = Math.ceil(f1 / df);
	const k1 = Math.min(dense.f.length - 1, Math.floor(f2 / df));
	for (let k = k0; k <= k1; k++) fn(dense.f[k], dense.A[k]);
}

export interface SpecMeasure {
	/** max/min |H| over the passbands. */
	passMax: number;
	passMin: number;
	/** Peak-to-peak passband ripple, dB. */
	rippleDb: number;
	/** max |H| over the stopbands. */
	stopMax: number;
	/** Minimum stopband attenuation, dB. */
	attenDb: number;
	passOk: boolean;
	stopOk: boolean;
	met: boolean;
}

/** Relative tolerance on the deviations when deciding whether a spec is met. */
export const SPEC_TOL = 0.005;

export function measureSpec(
	h: readonly number[],
	spec: Spec,
	fs: number,
	dense?: DenseResponse
): SpecMeasure {
	const sb = specBands(spec, fs);
	const d = dense ?? denseResponse(h, fs, 'even');
	const { dp, ds } = deltas(spec.rp, spec.rs);
	let passMax = 0;
	let passMin = Infinity;
	let stopMax = 0;
	sb.bands.forEach((b, i) => {
		forBand(h, fs, 'even', d, b.f1, b.f2, (_f, A) => {
			const m = Math.abs(A);
			if (sb.kinds[i] === 'pass') {
				passMax = Math.max(passMax, m);
				passMin = Math.min(passMin, m);
			} else stopMax = Math.max(stopMax, m);
		});
	});
	const passOk = passMax <= 1 + dp * (1 + SPEC_TOL) && passMin >= 1 - dp * (1 + SPEC_TOL);
	const stopOk = stopMax <= ds * (1 + SPEC_TOL);
	return {
		passMax,
		passMin,
		rippleDb: 20 * Math.log10(passMax / Math.max(passMin, 1e-300)),
		stopMax,
		attenDb: -20 * Math.log10(Math.max(stopMax, 1e-300)),
		passOk,
		stopOk,
		met: passOk && stopOk
	};
}

/**
 * Same verdict as measureSpec(h, spec, fs).met, but most failing designs are rejected
 * cheaply first: the coarse FFT grid used for that is a subset of measureSpec's dense grid
 * (both sizes are powers of two, and |H| = |A| up to rounding), so a violation found there
 * is a violation there too.
 */
export function meetsSpec(h: readonly number[], spec: Spec, fs: number): boolean {
	const n = nextPow2(Math.max(256, 2 * h.length));
	const { re, im } = fftReal(h, n);
	const sb = specBands(spec, fs);
	const { dp, ds } = deltas(spec.rp, spec.rs);
	const passHi = 1 + dp * (1 + SPEC_TOL);
	const passLo = 1 - dp * (1 + SPEC_TOL);
	const stopHi = ds * (1 + SPEC_TOL);
	const df = fs / n;
	for (let i = 0; i < sb.bands.length; i++) {
		const pass = sb.kinds[i] === 'pass';
		const k1 = Math.min(n / 2, Math.floor(sb.bands[i].f2 / df));
		for (let k = Math.ceil(sb.bands[i].f1 / df); k <= k1; k++) {
			const m = Math.hypot(re[k], im[k]);
			if (pass ? m > passHi || m < passLo : m > stopHi) return false;
		}
	}
	return measureSpec(h, spec, fs).met;
}

export interface BandError {
	/** max |A − D| over the band. */
	maxErr: number;
	/** max W·|A − D| (unweighted when no weight). */
	maxWeighted: number;
	/** For a stopband (D ≡ 0): attenuation in dB. */
	attenDb: number | null;
}

export function bandErrors(
	h: readonly number[],
	bands: Band[],
	fs: number,
	sym: Symmetry,
	relWeight = false,
	dense?: DenseResponse
): BandError[] {
	const d = dense ?? denseResponse(h, fs, sym);
	return bands.map((b) => {
		let maxErr = 0;
		let maxWeighted = 0;
		forBand(h, fs, sym, d, b.f1, b.f2, (f, A) => {
			const D = desiredAt(b, f);
			const e = Math.abs(A - D);
			maxErr = Math.max(maxErr, e);
			maxWeighted = Math.max(maxWeighted, e * weightAt(b, D, relWeight));
		});
		const stop = b.d1 === 0 && b.d2 === 0;
		return {
			maxErr,
			maxWeighted,
			attenDb: stop ? -20 * Math.log10(Math.max(maxErr, 1e-300)) : null
		};
	});
}

/** Weight used by the Remez grid (optionally W/|D| for differentiators). */
export function weightAt(b: Band, D: number, relWeight: boolean): number {
	if (relWeight && Math.abs(b.d2 - b.d1) > 0 && Math.abs(D) > 1e-4) return b.weight / Math.abs(D);
	return b.weight;
}

// ---------------------------------------------------------------------------
// Design
// ---------------------------------------------------------------------------

export interface FirConfig {
	method: Method;
	fs: number;
	shape: Shape;
	spec: Spec;
	/** Custom bands (shape === 'custom'). */
	bands: Band[];
	numtaps: number;
	auto: boolean;
	/** Window for the window method and frequency sampling. */
	window: WindowSpec;
	/** Parks–McClellan custom designs only. */
	symmetry: Symmetry;
	relWeight: boolean;
	/**
	 * Frequency sampling from a spec: width of the desired linear transition as a
	 * fraction of the spec's transition band, centred on it (0 = brick wall).
	 */
	fsampFrac?: number;
}

export interface AutoInfo {
	/** Formula estimate (Kaiser or Herrmann) before any refinement. */
	estimate: number;
	formula: string;
	/** Whether the final length meets the spec on a dense grid. */
	met: boolean;
	/** True when the length search hit the method's maximum. */
	capped: boolean;
	/** Number of trial designs evaluated. */
	trials: number;
}

export interface FirDesign {
	h: number[];
	numtaps: number;
	symmetry: Symmetry;
	/** Bands used (spec-derived or custom). */
	bands: Band[];
	kinds: ('pass' | 'stop' | 'other')[];
	remez?: RemezResult;
	beta?: number;
	cutoffs?: number[];
	points?: { freq: number[]; gain: number[] };
	auto?: AutoInfo;
}

/** Effective symmetry: only Parks–McClellan custom designs can be antisymmetric. */
export const effectiveSymmetry = (cfg: FirConfig): Symmetry =>
	cfg.method === 'pm' && cfg.shape === 'custom' ? cfg.symmetry : 'even';

function workingBands(cfg: FirConfig): { bands: Band[]; kinds: ('pass' | 'stop' | 'other')[] } {
	if (cfg.shape === 'custom') {
		return {
			bands: cfg.bands.map((b) => ({ ...b })),
			kinds: cfg.bands.map((b) => (b.d1 === 0 && b.d2 === 0 ? 'stop' : 'other'))
		};
	}
	return specBands(cfg.spec, cfg.fs);
}

/** One design at a fixed length (no search). Throws on invalid input. */
export function designAt(cfg: FirConfig, N: number): FirDesign {
	const { bands, kinds } = workingBands(cfg);
	const sym = effectiveSymmetry(cfg);
	const base = { numtaps: N, symmetry: sym, bands, kinds };
	switch (cfg.method) {
		case 'window': {
			const cutoffs = firwinCutoffs(cfg.spec);
			return {
				...base,
				h: firwinFast(N, cutoffs, cfg.window, passZero(cfg.spec.band), cfg.fs),
				cutoffs
			};
		}
		case 'kaiser': {
			const beta = kaiserBeta(kaiserAttenuation(cfg.spec));
			const cutoffs = firwinCutoffs(cfg.spec);
			return {
				...base,
				h: firwinFast(N, cutoffs, { type: 'kaiser', param: beta }, passZero(cfg.spec.band), cfg.fs),
				cutoffs,
				beta
			};
		}
		case 'ls': {
			const n = N % 2 === 0 ? N + 1 : N;
			return { ...base, numtaps: n, h: firls(n, bands, cfg.fs) };
		}
		case 'fsamp': {
			const points =
				cfg.shape === 'custom'
					? bandsToPoints(bands, cfg.fs)
					: fsampPoints(cfg.spec, cfg.fs, cfg.fsampFrac ?? 0.5);
			const w = cachedWindow(cfg.window.type, N, cfg.window.param);
			const h0 = firwin2(N, points.freq, points.gain, cfg.fs, null);
			return { ...base, h: h0.map((v, i) => v * w[i]), points };
		}
		case 'pm': {
			const r = remez(N, bands, cfg.fs, {
				symmetry: sym,
				relativeWeighting: sym === 'odd' && cfg.relWeight
			});
			// remez uses H = −j·A·e^{−jωM} for antisymmetric designs; we use the +j convention
			// (as SciPy/MATLAB do), so negate.
			const h = sym === 'odd' ? r.h.map((v) => -v) : r.h;
			if (!h.every(Number.isFinite) || !h.some((v) => v !== 0))
				throw new Error(
					'The Remez exchange produced invalid taps — try other band edges or a different length.'
				);
			// below ~1e-8 the barycentric interpolation runs out of double precision and the exchange collapses
			if (r.delta < 1e-8)
				throw new Error(
					`At N = ${N} the optimal ripple would be below 10⁻⁸ (over 160 dB), beyond the numerical range of the Remez exchange. Use fewer taps, narrower bands or a tighter spec.`
				);
			return { ...base, h, remez: { ...r, h } };
		}
	}
}

/**
 * Smallest length (within the allowed parity) whose design passes `test`.
 * Gallops from `start`, then bisects. Assumes pass/fail is (roughly) monotonic in N.
 */
export function searchLength(
	test: (N: number) => boolean,
	start: number,
	oddOnly: boolean,
	maxN: number,
	minN = 3,
	maxTrials = 30
): { N: number; met: boolean; trials: number } {
	const toN = (i: number) => (oddOnly ? 2 * i + 1 : i);
	const toI = (N: number) => (oddOnly ? Math.ceil((N - 1) / 2) : Math.ceil(N));
	const iMin = toI(minN);
	const iMax = oddOnly ? Math.floor((maxN - 1) / 2) : Math.floor(maxN);
	let trials = 0;
	const memo = new Map<number, boolean>();
	const ok = (i: number) => {
		const hit = memo.get(i);
		if (hit !== undefined) return hit;
		trials++;
		let r = false;
		try {
			r = test(toN(i));
		} catch {
			r = false;
		}
		memo.set(i, r);
		return r;
	};
	let i = Math.min(iMax, Math.max(iMin, toI(start)));
	let lo: number; // fails (or iMin − 1)
	let hi: number; // passes
	if (ok(i)) {
		hi = i;
		let step = Math.max(1, Math.round(i * 0.03));
		lo = iMin - 1;
		while (trials < maxTrials) {
			const cand = hi - step;
			if (cand < iMin) break;
			if (ok(cand)) {
				hi = cand;
				step *= 2;
			} else {
				lo = cand;
				break;
			}
		}
	} else {
		lo = i;
		let step = Math.max(1, Math.round(i * 0.04));
		hi = -1;
		while (trials < maxTrials) {
			const cand = Math.min(iMax, lo + step);
			if (ok(cand)) {
				hi = cand;
				break;
			}
			lo = cand;
			if (cand >= iMax) break;
			step *= 2;
		}
		if (hi < 0) return { N: toN(iMax), met: false, trials };
	}
	while (hi - lo > 1 && trials < maxTrials) {
		const mid = Math.floor((lo + hi) / 2);
		if (ok(mid)) hi = mid;
		else lo = mid;
	}
	return { N: toN(hi), met: true, trials };
}

/**
 * Smallest length (within the allowed parity) whose design passes `test`, found by trying
 * every allowed length from `minN` upwards. Needed where pass/fail is not monotonic in N:
 * window, frequency-sampling and least-squares designs pass in islands (as N grows, a band
 * edge moves between sidelobe peaks and nulls), so a gallop/bisection can skip the first pass.
 */
export function scanLength(
	test: (N: number) => boolean,
	oddOnly: boolean,
	maxN: number,
	minN = 3
): { N: number; met: boolean; trials: number } {
	const step = oddOnly ? 2 : 1;
	let N = oddOnly && minN % 2 === 0 ? minN + 1 : minN;
	let last = N;
	let trials = 0;
	for (; N <= maxN; N += step) {
		trials++;
		last = N;
		let r = false;
		try {
			r = test(N);
		} catch {
			r = false;
		}
		if (r) return { N, met: true, trials };
	}
	return { N: last, met: false, trials };
}

/** Design with the configured or automatically found length. */
export function designFir(cfg: FirConfig): FirDesign {
	const info = methodInfo(cfg.method);
	const maxN = info.maxTaps;
	const clampN = (n: number) => Math.max(3, Math.min(maxN, Math.round(n)));
	if (!cfg.auto || cfg.shape === 'custom') {
		return designAt(cfg, clampN(cfg.numtaps));
	}
	const spec = cfg.spec;
	const oddOnly = needsOdd(spec.band) || cfg.method === 'ls';
	const dfNorm = transitionWidth(spec) / cfg.fs;
	const { dp, ds } = deltas(spec.rp, spec.rs);
	const fixParity = (n: number) => (oddOnly && n % 2 === 0 ? n + 1 : n);

	if (cfg.method === 'kaiser') {
		const est = kaiserOrder(kaiserAttenuation(spec), dfNorm).numtaps;
		const N = Math.min(fixParity(est), oddOnly && maxN % 2 === 0 ? maxN - 1 : maxN);
		const d = designAt(cfg, N);
		const m = measureSpec(d.h, spec, cfg.fs);
		return {
			...d,
			auto: { estimate: est, formula: 'Kaiser', met: m.met, capped: est > maxN, trials: 1 }
		};
	}

	let estimate: number;
	let formula: string;
	if (cfg.method === 'pm') {
		estimate = remezOrderEstimate(dp, ds, dfNorm);
		formula = 'Herrmann';
	} else {
		estimate = kaiserOrder(kaiserAttenuation(spec), dfNorm).numtaps;
		formula = 'Kaiser';
	}
	let test = (N: number) => meetsSpec(designAt(cfg, N).h, spec, cfg.fs);
	if (cfg.method === 'ls') {
		// screen each length with the O(M²)-per-length least-squares sweep; confirm a pass with firls
		const sweep = firlsSweep(specBands(spec, cfg.fs).bands, cfg.fs, maxN);
		const full = test;
		test = (N: number) => {
			const h = sweep(N);
			return h ? meetsSpec(h, spec, cfg.fs) && full(N) : full(N);
		};
	}
	// Parks–McClellan is optimal at every length, so its pass/fail is monotonic within each parity
	// (and in practice across them): a gallop/bisection from the estimate finds the minimum. The
	// other methods pass in islands and need the full scan.
	const r =
		cfg.method === 'pm'
			? searchLength(test, fixParity(clampN(estimate)), oddOnly, maxN)
			: scanLength(test, oddOnly, maxN);
	const d = designAt(cfg, r.N);
	return { ...d, auto: { estimate, formula, met: r.met, capped: !r.met, trials: r.trials } };
}

// ---------------------------------------------------------------------------
// Plot helpers
// ---------------------------------------------------------------------------

export interface MaskRegion {
	x0: number;
	x1: number;
	y0: number;
	y1: number;
	kind: 'forbidden' | 'neutral';
	label: string;
}

const BIG = 1e4;

/** dB mask: passband within 20·log10(1 ± δp), stopband below −Rs. */
export function maskRegions(spec: Spec, fs: number): MaskRegion[] {
	const { bands, kinds } = specBands(spec, fs);
	const { dp } = deltas(spec.rp, spec.rs);
	const hi = 20 * Math.log10(1 + dp);
	const lo = 20 * Math.log10(1 - dp);
	const out: MaskRegion[] = [];
	bands.forEach((b, i) => {
		const x1 = b.f2 >= fs / 2 ? fs : b.f2;
		const x0 = b.f1 <= 0 ? -fs : b.f1;
		if (kinds[i] === 'pass') {
			out.push({
				x0,
				x1,
				y0: hi,
				y1: BIG,
				kind: 'forbidden',
				label: `Passband: must stay below +${fmt(hi)} dB`
			});
			out.push({
				x0,
				x1,
				y0: -BIG,
				y1: lo,
				kind: 'forbidden',
				label: `Passband: must stay above ${fmt(lo)} dB`
			});
		} else {
			out.push({
				x0,
				x1,
				y0: -spec.rs,
				y1: BIG,
				kind: 'forbidden',
				label: `Stopband: must stay below −${spec.rs} dB`
			});
		}
	});
	return out;
}

/** "Don't care" regions between custom bands. */
export function gapRegions(bands: Band[], fs: number): MaskRegion[] {
	const out: MaskRegion[] = [];
	let prev = 0;
	for (const b of bands) {
		if (b.f1 > prev)
			out.push({
				x0: prev,
				x1: b.f1,
				y0: -BIG,
				y1: BIG,
				kind: 'neutral',
				label: 'Transition (don’t care)'
			});
		prev = Math.max(prev, b.f2);
	}
	if (prev < fs / 2)
		out.push({
			x0: prev,
			x1: fs,
			y0: -BIG,
			y1: BIG,
			kind: 'neutral',
			label: 'Transition (don’t care)'
		});
	return out;
}

const fmt = (v: number) => String(Number(v.toPrecision(3)));

/** A series that is NaN outside the bands, so lines break in the transition gaps. */
export function bandSeries(
	dense: DenseResponse,
	bands: Band[],
	value: (f: number, A: number, mag: number, b: Band) => number
): { x: number[]; y: number[] } {
	const x: number[] = [];
	const y: number[] = [];
	for (const b of bands) {
		for (let k = 0; k < dense.f.length; k++) {
			const f = dense.f[k];
			if (f < b.f1 || f > b.f2) continue;
			x.push(f);
			y.push(value(f, dense.A[k], dense.mag[k], b));
		}
		x.push(b.f2);
		y.push(NaN);
	}
	return { x, y };
}

/** Decimate a dense series for plotting, keeping per-bucket min and max (envelope-preserving). */
export function decimateMinMax(
	x: readonly number[],
	y: readonly number[],
	buckets = 700
): { x: number[]; y: number[] } {
	const n = x.length;
	if (n <= buckets * 2) return { x: [...x], y: [...y] };
	const ox: number[] = [];
	const oy: number[] = [];
	// split at non-finite values so gaps survive, then decimate each run
	let start = 0;
	const per = n / buckets;
	const flush = (i0: number, i1: number) => {
		const nb = Math.max(1, Math.round((i1 - i0) / per));
		const step = (i1 - i0) / nb;
		for (let b = 0; b < nb; b++) {
			const a0 = i0 + Math.floor(b * step);
			const a1 = Math.min(i1, i0 + Math.floor((b + 1) * step));
			if (a1 <= a0) continue;
			let iMin = a0;
			let iMax = a0;
			for (let i = a0 + 1; i < a1; i++) {
				if (y[i] < y[iMin]) iMin = i;
				if (y[i] > y[iMax]) iMax = i;
			}
			const lo = Math.min(iMin, iMax);
			const hi = Math.max(iMin, iMax);
			ox.push(x[lo]);
			oy.push(y[lo]);
			if (hi !== lo) {
				ox.push(x[hi]);
				oy.push(y[hi]);
			}
		}
	};
	for (let i = 0; i <= n; i++) {
		if (i === n || !Number.isFinite(y[i])) {
			if (i > start) flush(start, i);
			if (i < n) {
				ox.push(x[i]);
				oy.push(NaN);
			}
			start = i + 1;
		}
	}
	return { x: ox, y: oy };
}
