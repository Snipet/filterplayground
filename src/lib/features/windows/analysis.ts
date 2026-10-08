/**
 * Window explorer helpers: spectra in bins, slicing/decimation for plotting,
 * and the two-tone spectral-leakage experiment.
 */
import { fftInPlace, fftReal, nextPow2 } from '$lib/dsp/fft';
import {
	WINDOWS,
	windowInfo,
	windowMetrics,
	windowParamAt,
	windowParamRange,
	windowValues,
	type WindowMetrics,
	type WindowType
} from '$lib/dsp/windows';
import { chebwinFast } from '$lib/features/fir-designer/windowing';

export interface WindowChoice {
	type: WindowType;
	param?: number;
}

/** Slider range of a window's parameter at length N (DPSS needs NW < N/2). */
export const paramRange = windowParamRange;

/** The parameter actually used at length N: the chosen value (or the default), kept in range. */
export const effectiveParam = (c: WindowChoice, N: number): number | undefined =>
	windowParamAt(c.type, N, c.param);

/** Window values; Dolph–Chebyshev via the table-driven fast path (same values as the shared chebwin). */
export function makeWindow(c: WindowChoice, N: number, periodic: boolean): number[] {
	const p = effectiveParam(c, N);
	if (c.type === 'chebyshev' && N > 1)
		return periodic ? chebwinFast(N + 1, p!).slice(0, N) : chebwinFast(N, p!);
	return windowValues(c.type, N, p, periodic);
}

/** Keep the points with x in [x0, x1] (plus one neighbour each side), then min/max-decimate. */
export function sliceDecimate(
	x: readonly number[],
	y: readonly number[],
	x0: number,
	x1: number,
	buckets = 700
): { x: number[]; y: number[] } {
	let i0 = 0;
	while (i0 < x.length && x[i0] < x0) i0++;
	let i1 = x.length - 1;
	while (i1 > 0 && x[i1] > x1) i1--;
	i0 = Math.max(0, i0 - 1);
	i1 = Math.min(x.length - 1, i1 + 1);
	const n = i1 - i0 + 1;
	if (n <= 2 * buckets) return { x: x.slice(i0, i1 + 1), y: y.slice(i0, i1 + 1) };
	const ox: number[] = [];
	const oy: number[] = [];
	const per = n / buckets;
	for (let b = 0; b < buckets; b++) {
		const a0 = i0 + Math.floor(b * per);
		const a1 = Math.min(i1 + 1, i0 + Math.floor((b + 1) * per));
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
	return { x: ox, y: oy };
}

// ---------------------------------------------------------------------------
// Reference table
// ---------------------------------------------------------------------------

export interface MetricsRow extends WindowMetrics {
	type: WindowType;
	name: string;
	param?: number;
}

/** Metrics of every window at length N with default parameters. */
export function allWindowMetrics(N: number, periodic: boolean): MetricsRow[] {
	return WINDOWS.map((info) => {
		const w = makeWindow({ type: info.id }, N, periodic);
		return { type: info.id, name: info.name, param: info.param?.default, ...windowMetrics(w) };
	});
}

export type MetricKey =
	| 'width3dB'
	| 'width6dB'
	| 'mainLobeWidth'
	| 'peakSidelobeDb'
	| 'enbw'
	| 'coherentGain'
	| 'scallopLossDb';

/**
 * Item with the smallest key. NaN (not measured) is skipped and −∞ counts as the
 * smallest, which a plain `a − b` sort gets wrong (−∞ − −∞ is NaN).
 */
export function lowest<T>(items: readonly T[], key: (t: T) => number): T | undefined {
	let best: T | undefined;
	for (const it of items) {
		const v = key(it);
		if (!Number.isNaN(v) && (best === undefined || v < key(best))) best = it;
	}
	return best;
}

export function sortRows(rows: MetricsRow[], key: MetricKey | 'name', dir: 1 | -1): MetricsRow[] {
	return [...rows].sort((a, b) => {
		if (key === 'name') return dir * a.name.localeCompare(b.name);
		const va = a[key];
		const vb = b[key];
		const fa = Number.isFinite(va);
		const fb = Number.isFinite(vb);
		if (!fa || !fb) return fa === fb ? 0 : fa ? -1 : 1; // NaN last
		return dir * (va - vb);
	});
}

// ---------------------------------------------------------------------------
// Two-tone leakage experiment
// ---------------------------------------------------------------------------

export interface ToneSetup {
	N: number;
	/** Strong tone frequency in bins (cycles per N samples), amplitude 1. */
	f1: number;
	/** Weak tone frequency in bins. */
	f2: number;
	/** Weak tone amplitude, dB relative to the strong tone. */
	weakDb: number;
	/** Zero-padding factor (1 = plain N-point DFT). */
	pad: number;
}

export function twoTones(s: ToneSetup, weak = true): number[] {
	const a2 = weak ? Math.pow(10, s.weakDb / 20) : 0;
	// fixed, unrelated phases so the result does not hinge on a lucky alignment
	return Array.from(
		{ length: s.N },
		(_, n) =>
			Math.cos((2 * Math.PI * s.f1 * n) / s.N + 0.3) +
			a2 * Math.cos((2 * Math.PI * s.f2 * n) / s.N + 1.1)
	);
}

// FFT of the conjugate chirp for the last (length, DFT size) pair: the leakage demo
// transforms several signals of the same length in a row.
let chirpCache: { key: string; re: Float64Array; im: Float64Array } | null = null;

/**
 * DFT of a real sequence zero-padded to exactly L ≥ x.length points, bins
 * k = 0..⌊L/2⌋. A radix-2 FFT when L is a power of two, Bluestein's chirp-z
 * algorithm otherwise (X[k] = c[k]·Σ x[n]c[n]·c*[k−n], c[m] = e^(−jπm²/L)), so
 * an N-point DFT really samples at the N bins — not on a denser power-of-2 grid.
 */
export function dftReal(x: readonly number[], L: number): { re: Float64Array; im: Float64Array } {
	const K = Math.floor(L / 2);
	if (L === nextPow2(L)) {
		const { re, im } = fftReal(x, L);
		return { re: re.slice(0, K + 1), im: im.slice(0, K + 1) };
	}
	const N = x.length;
	const M = nextPow2(N + K); // linear convolution of N inputs with lags −(N−1)..K
	// chirp phase πm²/L, with m² reduced mod 2L so large m keep full precision
	const theta = (m: number) => (Math.PI * ((m * m) % (2 * L))) / L;
	const key = `${N}:${L}`;
	if (chirpCache?.key !== key) {
		const re = new Float64Array(M);
		const im = new Float64Array(M);
		for (let m = 0; m <= K; m++) {
			re[m] = Math.cos(theta(m));
			im[m] = Math.sin(theta(m));
		}
		for (let m = 1; m < N; m++) {
			re[M - m] = Math.cos(theta(m));
			im[M - m] = Math.sin(theta(m));
		}
		fftInPlace(re, im);
		chirpCache = { key, re, im };
	}
	const are = new Float64Array(M);
	const aim = new Float64Array(M);
	for (let n = 0; n < N; n++) {
		are[n] = x[n] * Math.cos(theta(n));
		aim[n] = -x[n] * Math.sin(theta(n));
	}
	fftInPlace(are, aim);
	const { re: bre, im: bim } = chirpCache;
	for (let i = 0; i < M; i++) {
		const r = are[i] * bre[i] - aim[i] * bim[i];
		aim[i] = are[i] * bim[i] + aim[i] * bre[i];
		are[i] = r;
	}
	fftInPlace(are, aim, true);
	const re = new Float64Array(K + 1);
	const im = new Float64Array(K + 1);
	for (let k = 0; k <= K; k++) {
		const c = Math.cos(theta(k));
		const s = -Math.sin(theta(k));
		re[k] = are[k] * c - aim[k] * s;
		im[k] = are[k] * s + aim[k] * c;
	}
	return { re, im };
}

/**
 * Windowed magnitude spectrum in dB, zero-padded to exactly N·pad points (pad = 1:
 * the plain N-point DFT, bins at the integers), scaled so a unit-amplitude
 * sinusoid reads 0 dB at its peak (divide by the coherent gain Σw/2).
 */
export function windowedSpectrum(
	x: readonly number[],
	w: readonly number[],
	pad: number
): { bins: number[]; db: number[] } {
	const N = x.length;
	const L = Math.max(N, Math.round(N * pad));
	const xw = x.map((v, i) => v * w[i]);
	const { re, im } = dftReal(xw, L);
	const norm = w.reduce((s, v) => s + v, 0) / 2;
	const bins: number[] = [];
	const db: number[] = [];
	for (let k = 0; k < re.length; k++) {
		bins.push((k * N) / L);
		db.push(20 * Math.log10(Math.max(Math.hypot(re[k], im[k]) / norm, 1e-15)));
	}
	return { bins, db };
}

/** |W(f)| / W(0) in dB for a window at an offset of `d` bins (exact DTFT). */
export function windowLevelAt(w: readonly number[], d: number): number {
	const N = w.length;
	let re = 0;
	let im = 0;
	let s = 0;
	for (let n = 0; n < N; n++) {
		const a = (-2 * Math.PI * d * n) / N;
		re += w[n] * Math.cos(a);
		im += w[n] * Math.sin(a);
		s += w[n];
	}
	return 20 * Math.log10(Math.max(Math.hypot(re, im) / Math.abs(s), 1e-15));
}

export interface Resolution {
	resolved: boolean;
	/** Level of the local peak attributed to the weak tone (dB), if any. */
	peakDb: number | null;
	/** Strong tone's leakage around the weak tone's frequency (dB, max within ±½ bin on the plotted grid). */
	leakageDb: number;
	reason: 'resolved' | 'mainlobe' | 'leakage' | 'nopeak';
}

/**
 * Is the weak tone visible as its own peak? It must stand at least 3 dB above
 * the strong tone's leakage there (measured on the same frequency grid, within
 * ±½ bin), and the spectrum must show a local maximum within ±0.6 bins of f2 at
 * the expected level (±3 dB, or ±4.5 dB without zero padding, which adds
 * scalloping).
 */
export function resolveWeak(
	spec: { bins: number[]; db: number[] },
	strongOnly: { bins: number[]; db: number[] },
	s: ToneSetup,
	halfMainLobe: number
): Resolution {
	const { bins, db } = spec;
	const d = s.f2 - s.f1;
	const step = bins[1] - bins[0];
	const reach = Math.max(0.5, step / 2 + 1e-9);
	let leakageDb = -Infinity;
	for (let i = 0; i < strongOnly.bins.length; i++)
		if (Math.abs(strongOnly.bins[i] - s.f2) <= reach)
			leakageDb = Math.max(leakageDb, strongOnly.db[i]);
	let best = -1;
	for (let i = 1; i < bins.length - 1; i++) {
		if (Math.abs(bins[i] - s.f2) > Math.max(0.6, step)) continue;
		if (db[i] >= db[i - 1] && db[i] >= db[i + 1] && (best < 0 || db[i] > db[best])) best = i;
	}
	const tol = s.pad < 2 ? 4.5 : 3;
	const peakDb = best >= 0 ? db[best] : null;
	const levelOk = peakDb !== null && Math.abs(peakDb - s.weakDb) <= tol;
	const clear = leakageDb <= s.weakDb - 3;
	const resolved = levelOk && clear;
	let reason: Resolution['reason'] = 'resolved';
	if (!resolved) reason = Math.abs(d) < halfMainLobe ? 'mainlobe' : !clear ? 'leakage' : 'nopeak';
	return { resolved, peakDb, leakageDb, reason };
}
