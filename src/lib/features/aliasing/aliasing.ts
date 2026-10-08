/** Sampling / aliasing helpers: folding, spectra and anti-alias order requirements. */
import { type AnalogFamily, estimateOrder, familyInfo, reverseBesselCoeffs } from '$lib/dsp/analog';
import { polyadd, polyint, polymul, polyval } from '$lib/dsp/poly';

export interface Alias {
	/** Apparent (aliased) frequency in [0, fs/2]. */
	fa: number;
	/** Signed baseband frequency f − k·fs in [−fs/2, fs/2]. */
	fSigned: number;
	/** Nearest multiple of fs. */
	k: number;
	/** Nyquist zone (1 = 0…fs/2, 2 = fs/2…fs, …). */
	zone: number;
	/** True when f lies above fs/2, i.e. it folds. */
	folds: boolean;
	/** Even zones are spectrally inverted: the alias has its phase negated. */
	inverted: boolean;
}

export function aliasOf(f: number, fs: number): Alias {
	const af = Math.abs(f);
	const k = Math.round(af / fs);
	const fSigned = af - k * fs;
	const zone = Math.floor((2 * af) / fs) + 1;
	return {
		fa: Math.abs(fSigned),
		fSigned,
		k,
		zone,
		folds: af > (fs / 2) * (1 + 1e-12),
		inverted: fSigned < 0
	};
}

/**
 * The lowest-frequency sinusoid through the samples of cos(2πft + φ):
 * cos(2π·f_a·t ± φ), with the sign flipped when the spectrum is inverted.
 */
export function aliasWave(f: number, fs: number, phi: number): { fa: number; phase: number } {
	const a = aliasOf(f, fs);
	return { fa: a.fa, phase: a.inverted ? -phi : phi };
}

/** Breakpoints of the folding (apparent vs input frequency) curve on [0, fmax]. */
export function foldingCurve(fs: number, fmax: number): { x: number[]; y: number[] } {
	const x: number[] = [];
	const y: number[] = [];
	for (let i = 0; (i * fs) / 2 <= fmax + 1e-9; i++) {
		x.push((i * fs) / 2);
		y.push(i % 2 === 0 ? 0 : fs / 2);
	}
	if (x[x.length - 1] < fmax) {
		x.push(fmax);
		y.push(aliasOf(fmax, fs).fa);
	}
	return { x, y };
}

/** Triangular band-limited baseband magnitude, 1 at DC and 0 at |f| ≥ B. */
export const triangle = (f: number, B: number): number => Math.max(0, 1 - Math.abs(f) / B);

// ---------------------------------------------------------------------------
// Anti-aliasing filter order requirements
// ---------------------------------------------------------------------------

/** ADC dynamic range in dB for N bits (ideal quantisation SNR of a full-scale sine). */
export const adcDynamicRange = (bits: number): number => 6.02 * bits + 1.76;

// Monotonic all-pole families (Bessel, Legendre, Gaussian, critical) have no
// closed-form order formula; estimateFromSpecs finds their order by building
// every prototype, which costs ~1 s for Legendre up to order 20. For live
// interaction we instead use their characteristic functions
//     K(x) = 1/|H(jω)|² − 1,   x = ω²
// which are cheap polynomials. The results are checked against
// estimateFromSpecs in tests/aliasing.test.ts.

export type MonotonicFamily = 'bessel' | 'legendre' | 'gaussian' | 'critical';
export const isMonotonicFamily = (f: AnalogFamily): f is MonotonicFamily =>
	f === 'bessel' || f === 'legendre' || f === 'gaussian' || f === 'critical';

/** Legendre "optimum L" polynomial L_N(x), x = ω², normalised to L_N(1) = 1 (descending powers). */
export function legendreL(N: number): number[] {
	if (N === 1) return [1, 0];
	const legendre = (n: number): number[] => {
		let p0 = [1];
		if (n === 0) return p0;
		let p1 = [1, 0];
		for (let k = 1; k < n; k++) {
			const next = polyadd(
				polymul([2 * k + 1, 0], p1),
				p0.map((v) => -k * v)
			).map((v) => v / (k + 1));
			p0 = p1;
			p1 = next;
		}
		return p1;
	};
	let integrand: number[];
	if (N % 2 === 1) {
		const k = (N - 1) / 2;
		let sum: number[] = [0];
		for (let i = 0; i <= k; i++)
			sum = polyadd(
				sum,
				legendre(i).map((v) => v * (2 * i + 1))
			);
		integrand = polymul(sum, sum);
	} else {
		const k = (N - 2) / 2;
		let sum: number[] = [0];
		for (let i = 0; i <= k; i++)
			if (i % 2 === k % 2)
				sum = polyadd(
					sum,
					legendre(i).map((v) => v * (2 * i + 1))
				);
		integrand = polymul([1, 1], polymul(sum, sum));
	}
	const F = polyint(integrand);
	const Lt = polyadd(F, [-polyval(F, -1)]);
	let Lx: number[] = [0];
	for (const coef of Lt) Lx = polyadd(polymul(Lx, [2, -1]), [coef]);
	const L1 = polyval(Lx, 1);
	return Lx.map((v) => v / L1);
}

/** Characteristic function K(x) = 1/|H(j√x)|² − 1 of a monotonic prototype. */
export function characteristic(family: MonotonicFamily, N: number): (x: number) => number {
	switch (family) {
		case 'critical':
			return (x) => Math.expm1(N * Math.log1p(x));
		case 'gaussian':
			return (x) => {
				let term = 1;
				let sum = 0;
				for (let k = 1; k <= N; k++) {
					term *= x / k;
					sum += term;
				}
				return sum;
			};
		case 'legendre': {
			const L = legendreL(N);
			return (x) => polyval(L, x);
		}
		case 'bessel': {
			const a = reverseBesselCoeffs(N);
			const a0 = a[0];
			const b = a.map((v) => v / a0);
			return (x) => {
				const w = Math.sqrt(x);
				// θ(jω) = Σ b_k (jω)^k
				let re = 0;
				let im = 0;
				let pw = 1;
				for (let k = 0; k <= N; k++) {
					const t = b[k] * pw;
					switch (k % 4) {
						case 0:
							re += t;
							break;
						case 1:
							im += t;
							break;
						case 2:
							re -= t;
							break;
						default:
							im -= t;
					}
					pw *= w;
				}
				return re * re + im * im - 1;
			};
		}
	}
}

/** Solve K(x) = target for x > 0 (K increasing from K(0) = 0) by log-bisection. */
export function solveLevel(K: (x: number) => number, target: number): number {
	let lo = Math.log(1e-30);
	let hi = Math.log(1e30);
	for (let i = 0; i < 200; i++) {
		const mid = 0.5 * (lo + hi);
		const v = K(Math.exp(mid));
		if (!(v < target)) hi = mid;
		else lo = mid;
	}
	return Math.exp(0.5 * (lo + hi));
}

export interface MonotonicSpec {
	/** Stopband / passband edge ratio at which order N just meets (rp, rs). */
	threshold: number;
	/** −3 dB frequency in units of the passband edge. */
	f3: number;
}

export function monotonicSpec(
	family: MonotonicFamily,
	N: number,
	rp: number,
	rs: number
): MonotonicSpec {
	const K = characteristic(family, N);
	const xp = solveLevel(K, Math.expm1(0.1 * rp * Math.LN10));
	const xs = solveLevel(K, Math.expm1(0.1 * rs * Math.LN10));
	const x3 = solveLevel(K, 1);
	return { threshold: Math.sqrt(xs / xp), f3: Math.sqrt(x3 / xp) };
}

/** Attenuation (dB) at frequency ratio r = f / f_passband-edge for order N. */
export function monotonicAttenuation(
	family: MonotonicFamily,
	N: number,
	rp: number,
	r: number
): number {
	const K = characteristic(family, N);
	const xp = solveLevel(K, Math.expm1(0.1 * rp * Math.LN10));
	return 10 * Math.log10(1 + K(xp * r * r));
}

export interface MinOrder {
	order: number;
	capped: boolean;
	/** −3 dB cutoff to design with, in units of the passband edge. */
	f3: number;
}

/** Minimum order of a monotonic family for selectivity ws (> 1). */
export function minOrderMonotonic(
	family: MonotonicFamily,
	ws: number,
	rp: number,
	rs: number
): MinOrder {
	const maxN = familyInfo(family).maxOrder;
	let last: MonotonicSpec | null = null;
	for (let N = 1; N <= maxN; N++) {
		last = monotonicSpec(family, N, rp, rs);
		if (ws >= last.threshold) return { order: N, capped: false, f3: last.f3 };
	}
	return { order: maxN, capped: true, f3: last!.f3 };
}

/**
 * Minimum order of an anti-alias low-pass vs oversampling ratio
 * OSR = fs / (2·fb). The stopband starts at fs − fb, so the selectivity is
 * ws/wp = 2·OSR − 1. Closed-form families (Butterworth, Chebyshev, elliptic)
 * are not capped; monotonic families return NaN beyond their maximum order.
 */
export function orderVsOsr(family: AnalogFamily, rp: number, rs: number, osr: number[]): number[] {
	if (!isMonotonicFamily(family)) return osr.map((r) => estimateOrder(family, 2 * r - 1, rp, rs).N);
	const maxN = familyInfo(family).maxOrder;
	const thr = Array.from(
		{ length: maxN },
		(_, i) => monotonicSpec(family, i + 1, rp, rs).threshold
	);
	return osr.map((r) => {
		const i = thr.findIndex((t) => 2 * r - 1 >= t);
		return i < 0 ? NaN : i + 1;
	});
}
