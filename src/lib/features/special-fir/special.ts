/**
 * Special-purpose FIR filters: designs, demos (analytic signal, derivative,
 * eye diagram, smoothing) and the bookkeeping behind their stats.
 */
import { firfilt } from '$lib/dsp/time';
import { fftInPlace, fftReal, nextPow2 } from '$lib/dsp/fft';

export type SpecialType =
	'hilbert' | 'differentiator' | 'rc' | 'gaussian' | 'savgol' | 'halfband' | 'cic' | 'movavg';

export const SPECIAL_TYPES: { id: SpecialType; name: string; summary: string }[] = [
	{
		id: 'hilbert',
		name: 'Hilbert transformer',
		summary: 'Shifts every frequency by −90°: the imaginary part of the analytic signal.'
	},
	{
		id: 'differentiator',
		name: 'Differentiator',
		summary: 'Approximates H(ω) = jω: the derivative of the input.'
	},
	{
		id: 'rc',
		name: 'Raised cosine / root raised cosine',
		summary: 'Nyquist pulse shaping for data transmission: zero ISI at the symbol instants.'
	},
	{
		id: 'gaussian',
		name: 'Gaussian pulse',
		summary: 'The pulse shaper of GMSK/GFSK: compact in time and frequency, at the price of ISI.'
	},
	{
		id: 'savgol',
		name: 'Savitzky–Golay',
		summary: 'Local least-squares polynomial fit: smooths noise while keeping peak shapes.'
	},
	{
		id: 'halfband',
		name: 'Half-band',
		summary: 'Cutoff at fs/4: every other tap is zero, ideal for decimation or interpolation by 2.'
	},
	{
		id: 'cic',
		name: 'CIC (cascaded integrator–comb)',
		summary: 'Multiplier-free decimator: N cascaded moving sums of length R·M.'
	},
	{
		id: 'movavg',
		name: 'Moving average',
		summary: 'The simplest FIR: the mean of the last L samples.'
	}
];

// ---------------------------------------------------------------------------
// Random numbers (seeded, so demos are reproducible)
// ---------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function gaussianNoise(n: number, sigma: number, seed: number): number[] {
	const rnd = mulberry32(seed);
	const out: number[] = [];
	while (out.length < n) {
		const u = Math.max(rnd(), 1e-12);
		const v = rnd();
		const r = Math.sqrt(-2 * Math.log(u));
		out.push(r * Math.cos(2 * Math.PI * v) * sigma, r * Math.sin(2 * Math.PI * v) * sigma);
	}
	return out.slice(0, n);
}

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

/**
 * Real amplitude A(f) (f normalised to fs) of a linear-phase FIR:
 * symmetric H = A·e^{−jωM}, antisymmetric H = −j·A·e^{−jωM} (the Hilbert convention).
 */
export function amplitude(h: readonly number[], fNorm: number, anti: boolean): number {
	const M = (h.length - 1) / 2;
	const w = 2 * Math.PI * fNorm;
	let s = 0;
	for (let n = 0; n < h.length; n++)
		s += h[n] * (anti ? -Math.sin((M - n) * w) : Math.cos((M - n) * w));
	// for anti: H e^{jωM} = Σ h[n] e^{jω(M−n)} → imag part Σ h sin(ω(M−n)) = −A
	return s;
}

/** Dense |H| (linear) on 0..fs/2 via FFT; frequencies normalised to fs. */
export function denseMag(h: readonly number[], minPoints = 4096): { f: number[]; mag: number[] } {
	const n = nextPow2(Math.max(minPoints, 8 * h.length));
	const { re, im } = fftReal(h, n);
	const f: number[] = [];
	const mag: number[] = [];
	for (let k = 0; k <= n / 2; k++) {
		f.push(k / n);
		mag.push(Math.hypot(re[k], im[k]));
	}
	return { f, mag };
}

/**
 * Centred ("zero-phase") filtering of a finite record; NaN where the window runs
 * off the ends. For even lengths the output sits half a sample early: out[n]
 * belongs to time n − `offset` with offset = ½.
 */
export function centredFilter(h: readonly number[], x: readonly number[]): number[] {
	const N = h.length;
	const Mi = Math.floor((N - 1) / 2);
	const out = new Array<number>(x.length).fill(NaN);
	for (let n = Mi; n < x.length - (N - 1 - Mi); n++) {
		let s = 0;
		for (let k = 0; k < N; k++) s += h[k] * x[n + Mi - k];
		out[n] = s;
	}
	return out;
}

/** Time offset of centredFilter's output (0 for odd lengths, ½ for even). */
export const centredOffset = (N: number): number => (N - 1) / 2 - Math.floor((N - 1) / 2);

/** Folded multiplier count for a (possibly sparse) symmetric/antisymmetric FIR. */
export function foldedMultiplies(h: readonly number[]): {
	direct: number;
	nonzero: number;
	folded: number;
} {
	const N = h.length;
	const peak = Math.max(...h.map(Math.abs)) || 1;
	const nz = (v: number) => Math.abs(v) > 1e-12 * peak;
	let nonzero = 0;
	for (const v of h) if (nz(v)) nonzero++;
	let folded = 0;
	for (let i = 0; i < Math.ceil(N / 2); i++) if (nz(h[i])) folded++;
	return { direct: N, nonzero, folded };
}

const rms = (a: readonly number[]) => {
	let s = 0;
	let c = 0;
	for (const v of a)
		if (Number.isFinite(v)) {
			s += v * v;
			c++;
		}
	return c ? Math.sqrt(s / c) : NaN;
};

// ---------------------------------------------------------------------------
// Hilbert transformer demo: envelope of an AM tone
// ---------------------------------------------------------------------------

export interface AmDemo {
	n: number[];
	x: number[];
	trueEnv: number[];
	env: number[];
	/** Max envelope error after the start-up transient. */
	maxErr: number;
}

/**
 * x[n] = (1 + m cos(2π fm n)) cos(2π fc n), frequencies normalised to fs.
 * Analytic signal: x_a = x[n−M] + j·(h ∗ x)[n] — the real path is delayed by M
 * to line up with the filter. Results are shown on the input's time axis.
 */
export function amEnvelope(
	h: readonly number[],
	fc: number,
	fm: number,
	m: number,
	len: number,
	compensate: boolean
): AmDemo {
	const N = h.length;
	const M = Math.round((N - 1) / 2);
	const total = len + N;
	const xs = Array.from(
		{ length: total },
		(_, n) => (1 + m * Math.cos(2 * Math.PI * fm * n)) * Math.cos(2 * Math.PI * fc * n)
	);
	const y = firfilt(h, xs);
	const n: number[] = [];
	const x: number[] = [];
	const trueEnv: number[] = [];
	const env: number[] = [];
	let maxErr = 0;
	for (let k = 0; k < len; k++) {
		const t = k + N; // skip the start-up transient of the filter
		const re = compensate ? xs[t - M] : xs[t];
		const tIn = compensate ? t - M : t; // input time the pair refers to
		const e = Math.hypot(re, y[t]);
		const te = 1 + m * Math.cos(2 * Math.PI * fm * tIn);
		n.push(tIn);
		x.push(xs[tIn]);
		trueEnv.push(te);
		env.push(e);
		maxErr = Math.max(maxErr, Math.abs(e - te));
	}
	return { n, x, trueEnv, env, maxErr };
}

/**
 * Two-sided spectra (dB, Hann-windowed, peak = 0 dB) of a real AM signal and of
 * its analytic signal x[n−M] + j·(h∗x)[n]. Frequencies normalised to fs, −½ … ½.
 */
export function analyticSpectra(
	h: readonly number[],
	fc: number,
	fm: number,
	m: number,
	len = 1024
): { f: number[]; real: number[]; analytic: number[] } {
	const N = h.length;
	const M = Math.round((N - 1) / 2);
	const total = len + N;
	const xs = Array.from(
		{ length: total },
		(_, n) => (1 + m * Math.cos(2 * Math.PI * fm * n)) * Math.cos(2 * Math.PI * fc * n)
	);
	const y = firfilt(h, xs);
	const nfft = nextPow2(len);
	const spec = (re: Float64Array, im: Float64Array) => {
		fftInPlace(re, im);
		const mag = Array.from({ length: nfft }, (_, k) => Math.hypot(re[k], im[k]));
		const peak = Math.max(...mag) || 1;
		// reorder to −½ … ½
		const out: number[] = [];
		for (let k = 0; k < nfft; k++)
			out.push(20 * Math.log10(Math.max(mag[(k + nfft / 2) % nfft] / peak, 1e-12)));
		return out;
	};
	const reR = new Float64Array(nfft);
	const imR = new Float64Array(nfft);
	const reA = new Float64Array(nfft);
	const imA = new Float64Array(nfft);
	for (let k = 0; k < len && k < nfft; k++) {
		const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / len);
		const t = k + N;
		reR[k] = xs[t - M] * w;
		reA[k] = xs[t - M] * w;
		imA[k] = y[t] * w;
	}
	const f = Array.from({ length: nfft }, (_, k) => (k - nfft / 2) / nfft);
	return { f, real: spec(reR, imR), analytic: spec(reA, imA) };
}

// ---------------------------------------------------------------------------
// Differentiator demo
// ---------------------------------------------------------------------------

export interface DiffDemo {
	n: number[];
	est: number[];
	truth: number[];
	rmsErr: number;
	truthRms: number;
}

/** Differentiate A·sin(2π f0 n) (+ noise) with h; output scaled by fs to units per second. */
export function differentiate(
	h: readonly number[],
	f0: number,
	fs: number,
	noise: number,
	len: number,
	seed = 7
): DiffDemo {
	const N = h.length;
	const M = (N - 1) / 2; // may be a half-integer (type IV)
	const total = len + N;
	const nz = gaussianNoise(total, noise, seed);
	const x = Array.from({ length: total }, (_, n) => Math.sin(2 * Math.PI * f0 * n) + nz[n]);
	const y = firfilt(h, x);
	const n: number[] = [];
	const est: number[] = [];
	const truth: number[] = [];
	const err: number[] = [];
	for (let k = 0; k < len; k++) {
		const t = k + N;
		const tIn = t - M;
		n.push(tIn);
		const e = y[t] * fs;
		const tr = 2 * Math.PI * f0 * fs * Math.cos(2 * Math.PI * f0 * tIn);
		est.push(e);
		truth.push(tr);
		err.push(e - tr);
	}
	return { n, est, truth, rmsErr: rms(err), truthRms: rms(truth) };
}

// ---------------------------------------------------------------------------
// Eye diagrams
// ---------------------------------------------------------------------------

export interface Eye {
	/** Traces, each with x in symbol periods (−1 … 1). */
	traces: { x: number[]; y: number[] }[];
	/** Peak deviation of the samples at the symbol instants from ±1 (relative). */
	peakIsi: number;
	/** Worst-case vertical eye opening at the symbol instant (1 = fully open). */
	opening: number;
}

export function randomSymbols(n: number, seed = 11): number[] {
	const r = mulberry32(seed);
	return Array.from({ length: n }, () => (r() < 0.5 ? -1 : 1));
}

/**
 * Pass random ±1 symbols through h and fold the output into 2-symbol traces.
 * `nrz` holds each symbol for sps samples (rectangular input, as in GMSK);
 * otherwise symbols are impulses (zero-stuffed). Impulse input is normalised so
 * an isolated symbol peaks at 1; NRZ input so that long runs of one symbol sit at ±1.
 */
export function eyeDiagram(
	h: readonly number[],
	sps: number,
	nrz: boolean,
	nTraces = 70,
	seed = 11
): Eye {
	const L = h.length;
	const span = Math.ceil(L / sps) + 2;
	const nsym = nTraces + 2 * span + 2;
	const sym = randomSymbols(nsym, seed);
	const x = new Array<number>(nsym * sps).fill(0);
	for (let k = 0; k < nsym; k++) {
		if (nrz) for (let i = 0; i < sps; i++) x[k * sps + i] = sym[k];
		else x[k * sps] = sym[k];
	}
	const y = firfilt(h, x);
	// delay from symbol k's reference point to its peak in y
	const pulse = nrz ? firfilt(h, [...new Array(sps).fill(1), ...new Array(L).fill(0)]) : [...h];
	let pk = 0;
	for (let i = 1; i < pulse.length; i++) if (Math.abs(pulse[i]) > Math.abs(pulse[pk])) pk = i;
	// impulses: scale by the pulse peak; NRZ: by the DC gain, so long runs sit at ±1
	const g = nrz ? h.reduce((a, v) => a + v, 0) || 1 : pulse[pk] || 1;
	const traces: { x: number[]; y: number[] }[] = [];
	let peakIsi = 0;
	let opening = Infinity;
	for (let j = 0; j < nTraces; j++) {
		const k = span + j;
		const c = k * sps + pk;
		if (c + sps >= y.length) break;
		const tx: number[] = [];
		const ty: number[] = [];
		for (let i = -sps; i <= sps; i++) {
			tx.push(i / sps);
			ty.push(y[c + i] / g);
		}
		traces.push({ x: tx, y: ty });
		const v = y[c] / g;
		peakIsi = Math.max(peakIsi, Math.abs(v - sym[k]));
		opening = Math.min(opening, v * sym[k]);
	}
	return { traces, peakIsi, opening };
}

/** Convolution (full length). */
export function conv(a: readonly number[], b: readonly number[]): number[] {
	const out = new Array<number>(a.length + b.length - 1).fill(0);
	for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
	return out;
}

// ---------------------------------------------------------------------------
// Smoothing demo (Savitzky–Golay vs moving average)
// ---------------------------------------------------------------------------

export interface Peak {
	c: number;
	sigma: number;
	a: number;
}

export const DEMO_PEAKS: Peak[] = [
	{ c: 70, sigma: 3, a: 1 },
	{ c: 170, sigma: 9, a: 0.8 },
	{ c: 260, sigma: 5, a: 1 },
	{ c: 330, sigma: 14, a: 0.6 }
];

/** d-th derivative (per sample^d) of a sum of Gaussian peaks, d = 0…2. */
export function peaksSignal(n: number, peaks: Peak[], d = 0): number {
	let s = 0;
	for (const p of peaks) {
		const u = (n - p.c) / p.sigma;
		const g = p.a * Math.exp(-0.5 * u * u);
		if (d === 0) s += g;
		else if (d === 1) s += (-u / p.sigma) * g;
		else s += ((u * u - 1) / (p.sigma * p.sigma)) * g;
	}
	return s;
}

export interface SmoothDemo {
	n: number[];
	noisy: number[];
	clean: number[];
	outputs: { x: number[]; y: number[]; rmsErr: number; peakErr: number }[];
}

/**
 * Filter a noisy multi-peak signal with each kernel (centred) and measure the
 * error against the clean signal or its d-th derivative. `peakErr` is the height
 * error at the narrowest peak (smoothing only).
 */
export function smoothingDemo(
	kernels: number[][],
	deriv: number,
	noise: number,
	len = 400,
	seed = 5
): SmoothDemo {
	const nz = gaussianNoise(len, noise, seed);
	const n = Array.from({ length: len }, (_, i) => i);
	const noisy = n.map((i) => peaksSignal(i, DEMO_PEAKS, 0) + nz[i]);
	const clean = n.map((i) => peaksSignal(i, DEMO_PEAKS, deriv));
	const narrow = DEMO_PEAKS[0];
	const outputs = kernels.map((h) => {
		const off = centredOffset(h.length);
		const y = centredFilter(h, noisy);
		const x = n.map((i) => i - off);
		const err = y.map((v, i) => v - peaksSignal(x[i], DEMO_PEAKS, deriv));
		let top = -Infinity;
		for (let i = narrow.c - 3; i <= narrow.c + 3; i++)
			if (Number.isFinite(y[i])) top = Math.max(top, y[i]);
		const peakErr = deriv === 0 && Number.isFinite(top) ? top - narrow.a : NaN;
		return { x, y, rmsErr: rms(err), peakErr };
	});
	return { n, noisy, clean, outputs };
}

/** Simple central differences for comparison with Savitzky–Golay derivatives. */
export const centralDifference = (d: number): number[] =>
	d === 1 ? [0.5, 0, -0.5] : d === 2 ? [1, -2, 1] : [1];

// ---------------------------------------------------------------------------
// CIC
// ---------------------------------------------------------------------------

/** Normalised CIC magnitude |sin(π R M f) / (R M sin(π f))|^N, f normalised to the input rate. */
export function cicMag(f: number, R: number, M: number, N: number): number {
	const L = R * M;
	const s = Math.sin(Math.PI * f);
	if (Math.abs(s) < 1e-15) return 1;
	return Math.pow(Math.abs(Math.sin(Math.PI * L * f) / (L * s)), N);
}

export interface CicStats {
	dcGain: number;
	bitGrowth: number;
	outBits: number;
	droopDb: number;
	/** Smallest attenuation over all bands that alias into [0, fc] after decimation (dB). */
	aliasAttenDb: number;
	/** Alias bands (normalised to the input rate). */
	aliasBands: [number, number][];
}

/** fc normalised to the input rate (must be < 1/(2R)). */
export function cicStats(R: number, M: number, N: number, fc: number, inBits: number): CicStats {
	const L = R * M;
	const dcGain = Math.pow(L, N);
	const bitGrowth = Math.ceil(N * Math.log2(L) - 1e-12);
	const aliasBands: [number, number][] = [];
	for (let k = 1; k <= Math.floor(R / 2); k++) {
		const lo = k / R - fc;
		const hi = Math.min(0.5, k / R + fc);
		if (lo < 0.5) aliasBands.push([lo, hi]);
	}
	let worst = 0;
	for (const [lo, hi] of aliasBands) {
		for (let i = 0; i <= 200; i++)
			worst = Math.max(worst, cicMag(lo + ((hi - lo) * i) / 200, R, M, N));
	}
	return {
		dcGain,
		bitGrowth,
		outBits: inBits + bitGrowth,
		droopDb: 20 * Math.log10(cicMag(fc, R, M, N)),
		aliasAttenDb: -20 * Math.log10(Math.max(worst, 1e-300)),
		aliasBands
	};
}
