/**
 * Window explorer helpers: spectra in bins, slicing/decimation for plotting,
 * and the two-tone spectral-leakage experiment.
 */
import { fftReal, nextPow2 } from '$lib/dsp/fft';
import { WINDOWS, windowInfo, windowMetrics, windowValues, type WindowMetrics, type WindowType } from '$lib/dsp/windows';

export interface WindowChoice {
	type: WindowType;
	param?: number;
}

export function makeWindow(c: WindowChoice, N: number, periodic: boolean): number[] {
	const p = windowInfo(c.type).param ? (c.param ?? windowInfo(c.type).param!.default) : undefined;
	return windowValues(c.type, N, p, periodic);
}

/** Keep the points with x in [x0, x1] (plus one neighbour each side), then min/max-decimate. */
export function sliceDecimate(x: readonly number[], y: readonly number[], x0: number, x1: number, buckets = 700): { x: number[]; y: number[] } {
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

export type MetricKey = 'width3dB' | 'width6dB' | 'mainLobeWidth' | 'peakSidelobeDb' | 'enbw' | 'coherentGain' | 'scallopLossDb';

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
		(_, n) => Math.cos((2 * Math.PI * s.f1 * n) / s.N + 0.3) + a2 * Math.cos((2 * Math.PI * s.f2 * n) / s.N + 1.1)
	);
}

/**
 * Windowed, zero-padded magnitude spectrum in dB, scaled so a unit-amplitude
 * sinusoid reads 0 dB at its peak (divide by the coherent gain Σw/2).
 */
export function windowedSpectrum(x: readonly number[], w: readonly number[], pad: number): { bins: number[]; db: number[] } {
	const N = x.length;
	const n = nextPow2(Math.max(N, Math.round(N * pad)));
	const xw = x.map((v, i) => v * w[i]);
	const { re, im } = fftReal(xw, n);
	const norm = w.reduce((s, v) => s + v, 0) / 2;
	const bins: number[] = [];
	const db: number[] = [];
	for (let k = 0; k <= n / 2; k++) {
		bins.push((k * N) / n);
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
		if (Math.abs(strongOnly.bins[i] - s.f2) <= reach) leakageDb = Math.max(leakageDb, strongOnly.db[i]);
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
