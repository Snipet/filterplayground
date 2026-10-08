/**
 * Window functions for FIR design and spectral analysis, with metrics.
 * All windows are symmetric by default (filter design); pass `periodic: true`
 * for DFT-even windows (spectral analysis).
 */
import { fftReal, nextPow2 } from './fft';

export type WindowType =
	| 'rectangular'
	| 'triangular'
	| 'bartlett'
	| 'hann'
	| 'hamming'
	| 'blackman'
	| 'blackmanharris'
	| 'nuttall'
	| 'blackmannuttall'
	| 'flattop'
	| 'kaiser'
	| 'gaussian'
	| 'tukey'
	| 'chebyshev'
	| 'dpss'
	| 'bohman'
	| 'parzen'
	| 'cosine'
	| 'lanczos'
	| 'welch';

export interface WindowInfo {
	id: WindowType;
	name: string;
	/** Name and default of the adjustable parameter, if any. */
	param?: { label: string; default: number; min: number; max: number; step: number; help: string };
	description: string;
}

export const WINDOWS: WindowInfo[] = [
	{
		id: 'rectangular',
		name: 'Rectangular (boxcar)',
		description: 'No tapering. Narrowest main lobe but −13 dB sidelobes: the "do nothing" window.'
	},
	{
		id: 'triangular',
		name: 'Triangular',
		description: 'Convolution of two rectangles. −27 dB sidelobes falling at 12 dB/oct.'
	},
	{ id: 'bartlett', name: 'Bartlett', description: 'Triangular window with zero end points.' },
	{
		id: 'hann',
		name: 'Hann',
		description:
			'Raised cosine reaching zero at both ends. −31 dB first sidelobe, 18 dB/oct roll-off. The common default.'
	},
	{
		id: 'hamming',
		name: 'Hamming',
		description:
			'Raised cosine optimised to cancel the first sidelobe (−43 dB), but sidelobes barely decay.'
	},
	{
		id: 'blackman',
		name: 'Blackman',
		description: 'Three-term cosine sum. −58 dB sidelobes at the cost of a 3× wider main lobe.'
	},
	{
		id: 'blackmanharris',
		name: 'Blackman–Harris (4-term)',
		description: 'Minimum 4-term cosine sum: −92 dB sidelobes.'
	},
	{
		id: 'nuttall',
		name: 'Nuttall (continuous 1st derivative)',
		description: '4-term window with fast sidelobe decay (−93 dB, 18 dB/oct).'
	},
	{
		id: 'blackmannuttall',
		name: 'Blackman–Nuttall',
		description: '4-term minimum-sidelobe window: −98 dB.'
	},
	{
		id: 'flattop',
		name: 'Flat top',
		description: 'Very flat main lobe for accurate amplitude measurement; very wide.'
	},
	{
		id: 'kaiser',
		name: 'Kaiser',
		param: {
			label: 'β',
			default: 8.6,
			min: 0,
			max: 20,
			step: 0.1,
			help: 'β trades main-lobe width for sidelobe level (β≈0: rectangular, 5: Hamming-like, 8.6: Blackman-like).'
		},
		description:
			'Near-optimal concentration of energy in the main lobe with a single tunable parameter β. The workhorse for FIR design.'
	},
	{
		id: 'gaussian',
		name: 'Gaussian',
		param: {
			label: 'σ',
			default: 0.4,
			min: 0.05,
			max: 1,
			step: 0.01,
			help: 'Standard deviation relative to the half-length.'
		},
		description:
			'Gaussian bell. Its transform is (nearly) Gaussian too — no sidelobes until truncation.'
	},
	{
		id: 'tukey',
		name: 'Tukey (tapered cosine)',
		param: {
			label: 'α',
			default: 0.5,
			min: 0,
			max: 1,
			step: 0.01,
			help: 'Fraction of the window inside the cosine tapers (0 = rectangular, 1 = Hann).'
		},
		description: 'Flat middle with cosine tapers at each end.'
	},
	{
		id: 'chebyshev',
		name: 'Dolph–Chebyshev',
		param: {
			label: 'Sidelobe dB',
			default: 100,
			min: 20,
			max: 200,
			step: 1,
			help: 'All sidelobes sit exactly at this level below the main lobe.'
		},
		description: 'Equiripple sidelobes: the narrowest main lobe for a given sidelobe level.'
	},
	{
		id: 'dpss',
		name: 'DPSS (Slepian)',
		param: {
			label: 'NW',
			default: 3,
			min: 0.5,
			max: 10,
			step: 0.1,
			help: 'Time–half-bandwidth product. Main lobe half-width ≈ NW bins.'
		},
		description:
			'Maximises the energy inside a chosen bandwidth — the optimal concentration problem that Kaiser approximates.'
	},
	{
		id: 'bohman',
		name: 'Bohman',
		description: 'Convolution of two half-cosines. −46 dB sidelobes, 24 dB/oct decay.'
	},
	{
		id: 'parzen',
		name: 'Parzen (de la Vallée Poussin)',
		description: 'Piecewise cubic. −53 dB sidelobes with 24 dB/oct decay.'
	},
	{ id: 'cosine', name: 'Cosine (sine)', description: 'Half a sine period. −23 dB sidelobes.' },
	{ id: 'lanczos', name: 'Lanczos (sinc)', description: 'Central lobe of a sinc function.' },
	{
		id: 'welch',
		name: 'Welch (parabolic)',
		description:
			'Parabola 1 − ((n − M/2)/(M/2 + 1))², M = N − 1. It reaches zero one sample beyond each end, so the end samples are small but not zero (0.22 at N = 16).'
	}
];

export const windowInfo = (id: WindowType): WindowInfo =>
	WINDOWS.find((w) => w.id === id) ?? WINDOWS[0];

function cosineSum(N: number, a: number[], periodic: boolean): number[] {
	const M = periodic ? N : N - 1;
	if (N === 1) return [1];
	return Array.from({ length: N }, (_, n) => {
		let s = 0;
		for (let k = 0; k < a.length; k++)
			s += (k % 2 ? -1 : 1) * a[k] * Math.cos((2 * Math.PI * k * n) / M);
		return s;
	});
}

/** Modified Bessel function of the first kind, order 0. */
export function besselI0(x: number): number {
	let sum = 1;
	let term = 1;
	const q = (x * x) / 4;
	for (let k = 1; k < 500; k++) {
		term *= q / (k * k);
		sum += term;
		if (term < 1e-17 * sum) break;
	}
	return sum;
}

/**
 * Range of a window's parameter at length N. DPSS needs NW < N/2 (W = NW/N below 0.5
 * cycles/sample; SciPy raises otherwise): beyond it the cos(2πW) term of the tridiagonal
 * problem folds W back to 1 − W and silently returns the window for N − NW, and NW = N/2
 * degenerates to the binomial window. Its max is the largest step multiple below N/2.
 */
export function windowParamRange(type: WindowType, N: number): WindowInfo['param'] {
	const p = windowInfo(type).param;
	if (!p || type !== 'dpss') return p;
	// N/2 is a multiple of 0.5, hence of the step
	const below = Number((Math.round((N / 2 - p.step) / p.step) * p.step).toPrecision(12));
	return { ...p, max: Math.max(p.min, Math.min(p.max, below)) };
}

/** The parameter used at length N: the given value (or the default), with DPSS NW kept below N/2. */
export function windowParamAt(type: WindowType, N: number, param?: number): number | undefined {
	const r = windowParamRange(type, N);
	if (!r) return undefined;
	const v = param ?? r.default;
	return type === 'dpss' ? Math.min(v, r.max) : v;
}

export function windowValues(
	type: WindowType,
	N: number,
	param?: number,
	periodic = false
): number[] {
	if (N <= 0) return [];
	if (N === 1) return [1];
	const p = param ?? windowInfo(type).param?.default ?? 0;
	// For periodic windows compute N+1 symmetric points and drop the last.
	if (periodic && !['rectangular'].includes(type)) {
		return windowValues(type, N + 1, p, false).slice(0, N);
	}
	const M = N - 1;
	switch (type) {
		case 'rectangular':
			return new Array(N).fill(1);
		case 'triangular':
			return Array.from({ length: N }, (_, n) => {
				const k = n < N / 2 ? n + 1 : N - n;
				return N % 2 ? (2 * k) / (N + 1) : (2 * k - 1) / N;
			});
		case 'bartlett':
			return Array.from({ length: N }, (_, n) => 1 - Math.abs((2 * n) / M - 1));
		case 'hann':
			return cosineSum(N, [0.5, 0.5], false);
		case 'hamming':
			return cosineSum(N, [0.54, 0.46], false);
		case 'blackman':
			return cosineSum(N, [0.42, 0.5, 0.08], false).map((v) => Math.max(0, v));
		case 'blackmanharris':
			return cosineSum(N, [0.35875, 0.48829, 0.14128, 0.01168], false);
		case 'nuttall':
			return cosineSum(N, [0.355768, 0.487396, 0.144232, 0.012604], false);
		case 'blackmannuttall':
			return cosineSum(N, [0.3635819, 0.4891775, 0.1365995, 0.0106411], false);
		case 'flattop':
			return cosineSum(N, [0.21557895, 0.41663158, 0.277263158, 0.083578947, 0.006947368], false);
		case 'kaiser': {
			const den = besselI0(p);
			return Array.from({ length: N }, (_, n) => {
				const r = (2 * n) / M - 1;
				return besselI0(p * Math.sqrt(Math.max(0, 1 - r * r))) / den;
			});
		}
		case 'gaussian': {
			const sigma = p * (M / 2);
			return Array.from({ length: N }, (_, n) => Math.exp(-0.5 * Math.pow((n - M / 2) / sigma, 2)));
		}
		case 'tukey': {
			const alpha = p;
			if (alpha <= 0) return new Array(N).fill(1);
			if (alpha >= 1) return windowValues('hann', N);
			const width = Math.floor((alpha * M) / 2);
			return Array.from({ length: N }, (_, n) => {
				if (n < width + 1 && n <= M / 2)
					return 0.5 * (1 + Math.cos(Math.PI * ((2 * n) / (alpha * M) - 1)));
				if (n > M - width - 1 && n > M / 2)
					return 0.5 * (1 + Math.cos(Math.PI * ((2 * n) / (alpha * M) - 2 / alpha + 1)));
				return 1;
			});
		}
		case 'chebyshev':
			return chebwin(N, p);
		case 'dpss':
			return dpss(N, p);
		case 'bohman':
			return Array.from({ length: N }, (_, n) => {
				const x = Math.abs((2 * n) / M - 1);
				return (1 - x) * Math.cos(Math.PI * x) + Math.sin(Math.PI * x) / Math.PI;
			});
		case 'parzen':
			return Array.from({ length: N }, (_, n) => {
				const x = n - M / 2;
				const ax = Math.abs(x);
				const L = N / 2;
				if (ax <= M / 4) return 1 - 6 * Math.pow(ax / L, 2) + 6 * Math.pow(ax / L, 3);
				return 2 * Math.pow(1 - ax / L, 3);
			});
		case 'cosine':
			return Array.from({ length: N }, (_, n) => Math.sin((Math.PI * (n + 0.5)) / N));
		case 'lanczos':
			return Array.from({ length: N }, (_, n) => {
				const x = (2 * n) / M - 1;
				return x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
			});
		case 'welch':
			return Array.from({ length: N }, (_, n) => 1 - Math.pow((n - M / 2) / (M / 2 + 1), 2));
	}
}

/** Dolph–Chebyshev window with sidelobes `at` dB below the main lobe. */
export function chebwin(M: number, at: number): number[] {
	const order = M - 1;
	const beta = Math.cosh(Math.acosh(Math.pow(10, Math.abs(at) / 20)) / order);
	const p = new Float64Array(M);
	for (let k = 0; k < M; k++) {
		const x = beta * Math.cos((Math.PI * k) / M);
		if (x > 1) p[k] = Math.cosh(order * Math.acosh(x));
		else if (x < -1) p[k] = (2 * (M % 2) - 1) * Math.cosh(order * Math.acosh(-x));
		else p[k] = Math.cos(order * Math.acos(x));
	}
	let w: number[];
	if (M % 2) {
		const re = dftReal(p, () => [1, 0]);
		const n = (M + 1) / 2;
		const half = re.slice(0, n);
		w = [...half.slice(1).reverse(), ...half];
	} else {
		const re = dftReal(p, (k) => [Math.cos((Math.PI * k) / M), Math.sin((Math.PI * k) / M)]);
		const n = M / 2 + 1;
		w = [...re.slice(1, n).reverse(), ...re.slice(1, n)];
	}
	const mx = Math.max(...w);
	return w.map((v) => v / mx);
}

/** Real part of DFT of p[k]·e^{jθ_k} (θ given by `rot`). O(M²) with a twiddle table. */
function dftReal(p: Float64Array, rot: (k: number) => [number, number]): number[] {
	const M = p.length;
	const cosT = new Float64Array(M);
	const sinT = new Float64Array(M);
	for (let i = 0; i < M; i++) {
		cosT[i] = Math.cos((-2 * Math.PI * i) / M);
		sinT[i] = Math.sin((-2 * Math.PI * i) / M);
	}
	const ar = new Float64Array(M);
	const ai = new Float64Array(M);
	for (let k = 0; k < M; k++) {
		const [cr, ci] = rot(k);
		ar[k] = p[k] * cr;
		ai[k] = p[k] * ci;
	}
	const out: number[] = new Array(M).fill(0);
	for (let m = 0; m < M; m++) {
		let s = 0;
		let idx = 0;
		for (let k = 0; k < M; k++) {
			// Re{(ar + j ai)(cos + j sin)}
			s += ar[k] * cosT[idx] - ai[k] * sinT[idx];
			idx += m;
			if (idx >= M) idx -= M;
		}
		out[m] = s;
	}
	return out;
}

/**
 * First discrete prolate spheroidal (Slepian) sequence, normalised to peak 1.
 * NW must be below N/2; larger values are clamped to the largest valid slider step.
 */
export function dpss(N: number, NW: number): number[] {
	if (NW >= N / 2) NW = windowParamRange('dpss', N)!.max;
	const W = NW / N;
	const d = Array.from(
		{ length: N },
		(_, n) => Math.pow((N - 1 - 2 * n) / 2, 2) * Math.cos(2 * Math.PI * W)
	);
	const e = Array.from({ length: N }, (_, n) => (n === 0 ? 0 : (n * (N - n)) / 2)); // e[n] couples n−1,n
	// largest eigenvalue by Sturm bisection
	const countLess = (x: number) => {
		let count = 0;
		let q = d[0] - x;
		if (q < 0) count++;
		for (let i = 1; i < N; i++) {
			q = d[i] - x - (e[i] * e[i]) / (q === 0 ? 1e-300 : q);
			if (q < 0) count++;
		}
		return count;
	};
	let lo = Infinity;
	let hi = -Infinity;
	for (let i = 0; i < N; i++) {
		const r = Math.abs(e[i]) + (i + 1 < N ? Math.abs(e[i + 1]) : 0);
		lo = Math.min(lo, d[i] - r);
		hi = Math.max(hi, d[i] + r);
	}
	for (let it = 0; it < 200; it++) {
		const mid = (lo + hi) / 2;
		if (countLess(mid) >= N) hi = mid;
		else lo = mid;
		if (hi - lo < 1e-13 * Math.max(1, Math.abs(hi))) break;
	}
	const lambda = hi + 1e-10 * Math.max(1, Math.abs(hi));
	// inverse iteration with Thomas algorithm on (T − λI)
	let v = new Array(N).fill(1);
	for (let it = 0; it < 6; it++) {
		const diag = d.map((di) => di - lambda);
		const cp = new Array(N).fill(0);
		const dp = new Array(N).fill(0);
		// sub/super diagonal = e[i] (between i−1 and i)
		cp[0] = (N > 1 ? e[1] : 0) / diag[0];
		dp[0] = v[0] / diag[0];
		for (let i = 1; i < N; i++) {
			const m = diag[i] - e[i] * cp[i - 1];
			cp[i] = (i + 1 < N ? e[i + 1] : 0) / m;
			dp[i] = (v[i] - e[i] * dp[i - 1]) / m;
		}
		const x = new Array(N).fill(0);
		x[N - 1] = dp[N - 1];
		for (let i = N - 2; i >= 0; i--) x[i] = dp[i] - cp[i] * x[i + 1];
		const nrm = Math.sqrt(x.reduce((s, val) => s + val * val, 0));
		v = x.map((val) => val / nrm);
	}
	const mid = v[Math.floor(N / 2)];
	const sign = mid < 0 ? -1 : 1;
	const mx = Math.max(...v.map((val) => val * sign));
	return v.map((val) => (val * sign) / mx);
}

export interface WindowMetrics {
	coherentGain: number;
	/** Equivalent noise bandwidth in bins. */
	enbw: number;
	/** Scalloping loss in dB (worst-case amplitude error between bins). */
	scallopLossDb: number;
	/** −3 dB main-lobe full width in bins. */
	width3dB: number;
	/** −6 dB main-lobe full width in bins. */
	width6dB: number;
	/** Null-to-null main-lobe width in bins. */
	mainLobeWidth: number;
	/** Highest sidelobe level relative to the main lobe, dB. */
	peakSidelobeDb: number;
}

/** Spectrum of a window normalised to 0 dB at DC, frequencies in bins (0..N/2). */
export function windowSpectrum(w: readonly number[], pad = 64): { bins: number[]; db: number[] } {
	const N = w.length;
	const n = nextPow2(Math.max(4096, N * pad));
	const { re, im } = fftReal(w, n);
	const dc = Math.hypot(re[0], im[0]) || 1;
	const bins: number[] = [];
	const db: number[] = [];
	for (let k = 0; k <= n / 2; k++) {
		bins.push((k * N) / n);
		db.push(20 * Math.log10(Math.max(Math.hypot(re[k], im[k]) / dc, 1e-12)));
	}
	return { bins, db };
}

export function windowMetrics(w: readonly number[]): WindowMetrics {
	const N = w.length;
	const sum = w.reduce((s, v) => s + v, 0);
	const sum2 = w.reduce((s, v) => s + v * v, 0);
	const coherentGain = sum / N;
	const enbw = (N * sum2) / (sum * sum);
	// half-bin response
	let re = 0;
	let im = 0;
	for (let n = 0; n < N; n++) {
		re += w[n] * Math.cos((Math.PI * n) / N);
		im -= w[n] * Math.sin((Math.PI * n) / N);
	}
	const scallopLossDb = -20 * Math.log10(Math.hypot(re, im) / sum);
	const { bins, db } = windowSpectrum(w);
	const crossing = (level: number) => {
		for (let i = 1; i < db.length; i++) {
			if (db[i] < level) {
				const t = (db[i - 1] - level) / (db[i - 1] - db[i]);
				return 2 * (bins[i - 1] + t * (bins[i] - bins[i - 1]));
			}
		}
		return NaN;
	};
	// first null: first local minimum
	let nullIdx = -1;
	for (let i = 1; i < db.length - 1; i++) {
		if (db[i] <= db[i - 1] && db[i] < db[i + 1]) {
			nullIdx = i;
			break;
		}
	}
	let peakSidelobeDb = -Infinity;
	if (nullIdx > 0)
		for (let i = nullIdx; i < db.length; i++) peakSidelobeDb = Math.max(peakSidelobeDb, db[i]);
	return {
		coherentGain,
		enbw,
		scallopLossDb,
		width3dB: crossing(-3.0103),
		width6dB: crossing(-6.0206),
		mainLobeWidth: nullIdx > 0 ? 2 * bins[nullIdx] : NaN,
		peakSidelobeDb
	};
}

/** Kaiser's empirical β for a desired stopband attenuation A (dB). */
export function kaiserBeta(A: number): number {
	if (A > 50) return 0.1102 * (A - 8.7);
	if (A >= 21) return 0.5842 * Math.pow(A - 21, 0.4) + 0.07886 * (A - 21);
	return 0;
}

/**
 * Kaiser's order estimate: taps needed for attenuation A (dB) and a transition
 * width Δf normalised to the sampling rate (cycles/sample).
 */
export function kaiserOrder(A: number, transition: number): { numtaps: number; beta: number } {
	const numtaps = Math.ceil((A - 7.95) / (2.285 * 2 * Math.PI * transition) + 1);
	return { numtaps: Math.max(3, numtaps), beta: kaiserBeta(A) };
}
