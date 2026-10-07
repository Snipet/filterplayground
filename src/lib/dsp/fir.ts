/**
 * FIR design: windowed sinc, least squares, frequency sampling, and a set of
 * special-purpose filters. Frequencies are in Hz with sampling rate `fs`.
 */
import { fftInPlace, nextPow2 } from './fft';
import { solve } from './linalg';
import { type WindowType, windowValues } from './windows';

export const sinc = (x: number): number => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));

export interface WindowSpec {
	type: WindowType;
	param?: number;
}

/**
 * Window-method FIR (like scipy.signal.firwin).
 * `cutoffs` are band edges in Hz; `passZero` says whether DC is in a passband.
 * Lowpass: [fc], true · Highpass: [fc], false · Bandpass: [f1,f2], false · Bandstop: [f1,f2], true.
 */
export function firwin(
	numtaps: number,
	cutoffs: number[],
	window: WindowSpec,
	passZero: boolean,
	fs: number,
	scale = true
): number[] {
	const nyq = fs / 2;
	const c = cutoffs.map((f) => f / nyq);
	const passNyquist = (c.length % 2 === 1) !== passZero;
	const edges = [...(passZero ? [0] : []), ...c, ...(passNyquist ? [1] : [])];
	const alpha = (numtaps - 1) / 2;
	const h = new Array<number>(numtaps).fill(0);
	for (let b = 0; b + 1 < edges.length; b += 2) {
		const left = edges[b];
		const right = edges[b + 1];
		for (let n = 0; n < numtaps; n++) {
			const m = n - alpha;
			h[n] += right * sinc(right * m) - left * sinc(left * m);
		}
	}
	const w = windowValues(window.type, numtaps, window.param);
	for (let n = 0; n < numtaps; n++) h[n] *= w[n];
	if (scale && edges.length >= 2) {
		const left = edges[0];
		const right = edges[1];
		const sf = left === 0 ? 0 : right === 1 ? 1 : (left + right) / 2;
		let s = 0;
		for (let n = 0; n < numtaps; n++) s += h[n] * Math.cos(Math.PI * (n - alpha) * sf);
		if (s !== 0) for (let n = 0; n < numtaps; n++) h[n] /= s;
	}
	return h;
}

export interface LsBand {
	/** Band edges in Hz. */
	f1: number;
	f2: number;
	/** Desired gain at f1 and f2 (linear). */
	d1: number;
	d2: number;
	weight: number;
}

/** Least-squares linear-phase FIR (type I, odd length) — like scipy.signal.firls. */
export function firls(numtaps: number, bands: LsBand[], fs: number): number[] {
	if (numtaps % 2 === 0) numtaps += 1;
	const M = (numtaps - 1) / 2;
	const nyq = fs / 2;
	const B = bands.map((b) => ({ ...b, f1: b.f1 / nyq, f2: b.f2 / nyq }));
	const q = new Array<number>(numtaps).fill(0);
	for (let n = 0; n < numtaps; n++) {
		for (const b of B) q[n] += b.weight * (b.f2 * sinc(b.f2 * n) - b.f1 * sinc(b.f1 * n));
	}
	const Q = Array.from({ length: M + 1 }, (_, i) =>
		Array.from({ length: M + 1 }, (_, j) => q[Math.abs(i - j)] + q[i + j])
	);
	const rhs = new Array<number>(M + 1).fill(0);
	for (const b of B) {
		const m = b.f2 === b.f1 ? 0 : (b.d2 - b.d1) / (b.f2 - b.f1);
		const cc = b.d1 - b.f1 * m;
		const term = (f: number, n: number) => {
			let v = f * (m * f + cc) * sinc(f * n);
			if (n === 0) v -= (m * f * f) / 2;
			else v += (m * Math.cos(n * Math.PI * f)) / Math.pow(Math.PI * n, 2);
			return v;
		};
		for (let n = 0; n <= M; n++) rhs[n] += b.weight * (term(b.f2, n) - term(b.f1, n));
	}
	const a = solve(
		Q,
		rhs.map((v) => [v])
	).map((r) => r[0]);
	const h: number[] = [];
	for (let k = M; k >= 1; k--) h.push(a[k]);
	h.push(2 * a[0]);
	for (let k = 1; k <= M; k++) h.push(a[k]);
	return h;
}

/**
 * Frequency-sampling FIR (like scipy.signal.firwin2): piecewise-linear desired
 * gain through (freq, gain) points from 0 to fs/2, then windowed.
 */
export function firwin2(
	numtaps: number,
	freq: number[],
	gain: number[],
	fs: number,
	window: WindowSpec | null = { type: 'hamming' },
	nfreqs?: number
): number[] {
	const nyq = fs / 2;
	const nf = nfreqs ?? 1 + Math.pow(2, Math.ceil(Math.log2(numtaps)));
	const n = 2 * (nf - 1);
	const re = new Float64Array(n);
	const im = new Float64Array(n);
	const interp = (x: number) => {
		if (x <= freq[0]) return gain[0];
		for (let i = 1; i < freq.length; i++) {
			if (x <= freq[i]) {
				const t = freq[i] === freq[i - 1] ? 1 : (x - freq[i - 1]) / (freq[i] - freq[i - 1]);
				return gain[i - 1] + t * (gain[i] - gain[i - 1]);
			}
		}
		return gain[gain.length - 1];
	};
	for (let k = 0; k < nf; k++) {
		const x = (k / (nf - 1)) * nyq;
		const g = interp(x);
		const ph = (-(numtaps - 1) / 2) * Math.PI * (x / nyq);
		re[k] = g * Math.cos(ph);
		im[k] = g * Math.sin(ph);
		if (k > 0 && k < nf - 1) {
			re[n - k] = re[k];
			im[n - k] = -im[k];
		}
	}
	// Nyquist bin must be real
	im[nf - 1] = 0;
	fftInPlace(re, im, true);
	const w = window ? windowValues(window.type, numtaps, window.param) : new Array(numtaps).fill(1);
	return Array.from({ length: numtaps }, (_, i) => re[i] * w[i]);
}

// ---------------------------------------------------------------------------
// Special-purpose FIR filters
// ---------------------------------------------------------------------------

/** Windowed ideal Hilbert transformer (type III, odd length). */
export function hilbertFir(numtaps: number, window: WindowSpec): number[] {
	if (numtaps % 2 === 0) numtaps += 1;
	const M = (numtaps - 1) / 2;
	const w = windowValues(window.type, numtaps, window.param);
	return Array.from({ length: numtaps }, (_, n) => {
		const m = n - M;
		return m % 2 === 0 ? 0 : (2 / (Math.PI * m)) * w[n];
	});
}

/**
 * Windowed ideal differentiator H(ω) = jω (per sample). Odd length → type III,
 * even length → type IV (better at high frequencies).
 */
export function differentiatorFir(numtaps: number, window: WindowSpec): number[] {
	const M = (numtaps - 1) / 2;
	const w = windowValues(window.type, numtaps, window.param);
	return Array.from({ length: numtaps }, (_, n) => {
		const t = n - M;
		if (t === 0) return 0;
		return (Math.cos(Math.PI * t) / t - Math.sin(Math.PI * t) / (Math.PI * t * t)) * w[n];
	});
}

/** Raised-cosine pulse (Nyquist filter). sps = samples per symbol, span in symbols. */
export function raisedCosine(sps: number, beta: number, span: number): number[] {
	const N = span * sps + 1;
	const M = (N - 1) / 2;
	return Array.from({ length: N }, (_, n) => {
		const t = (n - M) / sps;
		const denom = 1 - Math.pow(2 * beta * t, 2);
		if (beta > 0 && Math.abs(denom) < 1e-10) return (Math.PI / 4) * sinc(1 / (2 * beta));
		return (sinc(t) * Math.cos(Math.PI * beta * t)) / denom;
	});
}

/** Root-raised-cosine pulse (matched-filter half of a raised cosine). */
export function rootRaisedCosine(sps: number, beta: number, span: number): number[] {
	const N = span * sps + 1;
	const M = (N - 1) / 2;
	const h = Array.from({ length: N }, (_, n) => {
		const t = (n - M) / sps;
		if (t === 0) return 1 + beta * (4 / Math.PI - 1);
		if (beta > 0 && Math.abs(Math.abs(t) - 1 / (4 * beta)) < 1e-10) {
			return (
				(beta / Math.SQRT2) *
				((1 + 2 / Math.PI) * Math.sin(Math.PI / (4 * beta)) +
					(1 - 2 / Math.PI) * Math.cos(Math.PI / (4 * beta)))
			);
		}
		const num = Math.sin(Math.PI * t * (1 - beta)) + 4 * beta * t * Math.cos(Math.PI * t * (1 + beta));
		const den = Math.PI * t * (1 - Math.pow(4 * beta * t, 2));
		return num / den;
	});
	const energy = Math.sqrt(h.reduce((s, v) => s + v * v, 0));
	return h.map((v) => v / energy);
}

/** Gaussian pulse-shaping filter (as in GMSK). bt = bandwidth–symbol-time product. */
export function gaussianPulse(sps: number, bt: number, span: number): number[] {
	const N = span * sps + 1;
	const M = (N - 1) / 2;
	const a = Math.sqrt(Math.LN2 / 2) / bt;
	const h = Array.from({ length: N }, (_, n) => {
		const t = (n - M) / sps;
		return (Math.sqrt(Math.PI) / a) * Math.exp(-Math.pow((Math.PI * t) / a, 2));
	});
	const s = h.reduce((acc, v) => acc + v, 0);
	return h.map((v) => v / s);
}

export function movingAverage(N: number): number[] {
	return new Array(N).fill(1 / N);
}

/** Savitzky–Golay smoothing / differentiation coefficients (odd window). */
export function savitzkyGolay(window: number, polyorder: number, deriv = 0): number[] {
	if (window % 2 === 0) window += 1;
	const m = (window - 1) / 2;
	const order = Math.min(polyorder, window - 1);
	// A[i][j] = x_i^j
	const xs = Array.from({ length: window }, (_, i) => i - m);
	const A = xs.map((x) => Array.from({ length: order + 1 }, (_, j) => Math.pow(x, j)));
	const AtA = Array.from({ length: order + 1 }, (_, i) =>
		Array.from({ length: order + 1 }, (_, j) => A.reduce((s, row) => s + row[i] * row[j], 0))
	);
	// coefficients = e_deriv^T (AᵀA)⁻¹ Aᵀ · deriv!
	const e = Array.from({ length: order + 1 }, (_, i) => [i === deriv ? 1 : 0]);
	const v = solve(AtA, e).map((r) => r[0]);
	let fact = 1;
	for (let i = 2; i <= deriv; i++) fact *= i;
	// h is applied as convolution: y[n] = Σ h[k] x[n−k] → reverse the correlation kernel
	const corr = xs.map((_, i) => fact * A[i].reduce((s, val, j) => s + val * v[j], 0));
	return corr.reverse();
}

/** Impulse response of an N-stage CIC filter with rate change R and differential delay M. */
export function cicFir(R: number, M: number, N: number): number[] {
	const L = R * M;
	let h = new Array(L).fill(1);
	for (let s = 1; s < N; s++) {
		const out = new Array(h.length + L - 1).fill(0);
		for (let i = 0; i < h.length; i++) for (let j = 0; j < L; j++) out[i + j] += h[i];
		h = out;
	}
	const g = Math.pow(L, N);
	return h.map((v) => v / g);
}

/**
 * Minimum-phase FIR with (approximately) the same magnitude response as h,
 * via the real cepstrum (homomorphic method).
 */
export function minimumPhase(h: readonly number[]): number[] {
	const N = h.length;
	const n = nextPow2(Math.max(1024, 16 * N));
	const re = new Float64Array(n);
	const im = new Float64Array(n);
	for (let i = 0; i < N; i++) re[i] = h[i];
	fftInPlace(re, im);
	let maxMag = 0;
	for (let k = 0; k < n; k++) maxMag = Math.max(maxMag, Math.hypot(re[k], im[k]));
	const floor = maxMag * 1e-8;
	for (let k = 0; k < n; k++) {
		re[k] = Math.log(Math.max(Math.hypot(re[k], im[k]), floor));
		im[k] = 0;
	}
	fftInPlace(re, im, true); // real cepstrum
	// fold: keep c[0], double positive quefrencies, zero negative
	for (let k = 1; k < n / 2; k++) {
		re[k] *= 2;
		im[k] *= 2;
	}
	for (let k = n / 2 + 1; k < n; k++) {
		re[k] = 0;
		im[k] = 0;
	}
	fftInPlace(re, im);
	for (let k = 0; k < n; k++) {
		const m = Math.exp(re[k]);
		const ph = im[k];
		re[k] = m * Math.cos(ph);
		im[k] = m * Math.sin(ph);
	}
	fftInPlace(re, im, true);
	return Array.from(re.slice(0, N));
}

/** Kaiser/Herrmann-style length estimate for an equiripple (Parks–McClellan) design. */
export function remezOrderEstimate(dp: number, ds: number, transition: number): number {
	// Herrmann, Rabiner & Chan (1973)
	const a1 = 5.309e-3,
		a2 = 7.114e-2,
		a3 = -4.761e-1,
		a4 = -2.66e-3,
		a5 = -5.941e-1,
		a6 = -4.278e-1;
	const ldp = Math.log10(dp);
	const lds = Math.log10(ds);
	const Dinf = (a1 * ldp * ldp + a2 * ldp + a3) * lds + (a4 * ldp * ldp + a5 * ldp + a6);
	const f = 11.01217 + 0.51244 * (ldp - lds);
	const N = Dinf / transition - f * transition + 1;
	return Math.max(3, Math.ceil(N));
}

/** Convert ripple specs between dB and linear deviations. */
export const passbandRippleToDelta = (rpDb: number): number =>
	(Math.pow(10, rpDb / 20) - 1) / (Math.pow(10, rpDb / 20) + 1);
export const stopbandAttenToDelta = (rsDb: number): number => Math.pow(10, -rsDb / 20);
