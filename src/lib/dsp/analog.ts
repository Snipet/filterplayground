/**
 * Normalised analog low-pass prototypes and order estimation.
 *
 * Normalisation conventions (cutoff ω = 1 rad/s), matching SciPy:
 *   butter    −3 dB at ω = 1
 *   cheby1    passband edge (ripple Rp) at ω = 1
 *   cheby2    stopband edge (attenuation Rs) at ω = 1
 *   ellip     passband edge (ripple Rp) at ω = 1
 *   bessel    'phase' | 'delay' | 'mag' (see besselap)
 *   legendre  −3 dB at ω = 1 (Papoulis "optimum L")
 *   critical  −3 dB at ω = 1 (N coincident real poles; no overshoot)
 *   gaussian  −3 dB at ω = 1 (Taylor approximation of a Gaussian response)
 */
import { type Complex, abs, c, conj, div, mul, neg, scale } from './complex';
import { asne, cde, ellipdeg, ellipk, ellipkp, sne } from './elliptic';
import { cleanRealRoots, polyadd, polyint, polymul, polyval, roots, sortRoots } from './poly';
import { freqsZpk } from './response';
import type { ZPK } from './types';

export type AnalogFamily =
	| 'butter'
	| 'cheby1'
	| 'cheby2'
	| 'ellip'
	| 'bessel'
	| 'legendre'
	| 'critical'
	| 'gaussian';

export type BesselNorm = 'phase' | 'delay' | 'mag';

export interface FamilyInfo {
	id: AnalogFamily;
	name: string;
	short: string;
	/** What ω = 1 means for the normalised prototype. */
	cutoffMeaning: string;
	usesRp: boolean;
	usesRs: boolean;
	maxOrder: number;
	summary: string;
}

export const FAMILIES: FamilyInfo[] = [
	{
		id: 'butter',
		name: 'Butterworth',
		short: 'Butter',
		cutoffMeaning: '−3 dB frequency',
		usesRp: false,
		usesRs: false,
		maxOrder: 30,
		summary: 'Maximally flat passband, monotonic everywhere. The default all-rounder.'
	},
	{
		id: 'cheby1',
		name: 'Chebyshev Type I',
		short: 'Cheby I',
		cutoffMeaning: 'passband edge (end of the ripple band)',
		usesRp: true,
		usesRs: false,
		maxOrder: 30,
		summary: 'Equiripple passband, monotonic stopband. Steeper than Butterworth for the same order.'
	},
	{
		id: 'cheby2',
		name: 'Chebyshev Type II (inverse)',
		short: 'Cheby II',
		cutoffMeaning: 'stopband edge (where attenuation reaches Rs)',
		usesRp: false,
		usesRs: true,
		maxOrder: 30,
		summary: 'Flat passband, equiripple stopband with transmission zeros.'
	},
	{
		id: 'ellip',
		name: 'Elliptic (Cauer)',
		short: 'Elliptic',
		cutoffMeaning: 'passband edge (end of the ripple band)',
		usesRp: true,
		usesRs: true,
		maxOrder: 20,
		summary: 'Equiripple in both bands — the steepest transition for a given order.'
	},
	{
		id: 'bessel',
		name: 'Bessel (Thomson)',
		short: 'Bessel',
		cutoffMeaning: 'depends on normalisation',
		usesRp: false,
		usesRs: false,
		maxOrder: 20,
		summary: 'Maximally flat group delay: preserves waveshape, minimal overshoot, gentle roll-off.'
	},
	{
		id: 'legendre',
		name: 'Legendre (Optimum-L)',
		short: 'Legendre',
		cutoffMeaning: '−3 dB frequency',
		usesRp: false,
		usesRs: false,
		maxOrder: 20,
		summary: 'Steepest possible roll-off for a monotonic passband.'
	},
	{
		id: 'gaussian',
		name: 'Gaussian',
		short: 'Gaussian',
		cutoffMeaning: '−3 dB frequency',
		usesRp: false,
		usesRs: false,
		maxOrder: 12,
		summary: 'Approximates a Gaussian magnitude: smooth step response without overshoot.'
	},
	{
		id: 'critical',
		name: 'Critically damped (synchronous)',
		short: 'Critical',
		cutoffMeaning: '−3 dB frequency',
		usesRp: false,
		usesRs: false,
		maxOrder: 20,
		summary: 'N identical real poles (cascade of RC stages). No overshoot, very soft knee.'
	}
];

export const familyInfo = (id: AnalogFamily): FamilyInfo =>
	FAMILIES.find((f) => f.id === id) ?? FAMILIES[0];

// ---------------------------------------------------------------------------
// Prototypes
// ---------------------------------------------------------------------------

export function buttap(N: number): ZPK {
	const p: Complex[] = [];
	for (let k = 1; k <= N; k++) {
		const theta = (Math.PI * (2 * k + N - 1)) / (2 * N);
		p.push(c(Math.cos(theta), Math.sin(theta)));
	}
	return { z: [], p: tidy(p), k: 1 };
}

export function cheb1ap(N: number, rp: number): ZPK {
	const eps = Math.sqrt(Math.pow(10, 0.1 * rp) - 1);
	const mu = Math.asinh(1 / eps) / N;
	const p: Complex[] = [];
	for (let k = 1; k <= N; k++) {
		const theta = (Math.PI * (2 * k - 1)) / (2 * N);
		p.push(c(-Math.sinh(mu) * Math.sin(theta), Math.cosh(mu) * Math.cos(theta)));
	}
	let k = prodNeg(p).re;
	if (N % 2 === 0) k /= Math.sqrt(1 + eps * eps);
	return { z: [], p: tidy(p), k };
}

export function cheb2ap(N: number, rs: number): ZPK {
	const de = 1 / Math.sqrt(Math.pow(10, 0.1 * rs) - 1);
	const mu = Math.asinh(1 / de) / N;
	const m: number[] = [];
	if (N % 2) {
		for (let i = -N + 1; i < 0; i += 2) m.push(i);
		for (let i = 2; i < N; i += 2) m.push(i);
	} else {
		for (let i = -N + 1; i < N; i += 2) m.push(i);
	}
	const z = m.map((mi) => conj(neg(c(0, 1 / Math.sin((mi * Math.PI) / (2 * N))))));
	const p: Complex[] = [];
	for (let i = -N + 1; i < N; i += 2) {
		const e = c(Math.cos((Math.PI * i) / (2 * N)), Math.sin((Math.PI * i) / (2 * N)));
		const b = neg(e);
		const w = c(Math.sinh(mu) * b.re, Math.cosh(mu) * b.im);
		p.push(div(c(1), w));
	}
	const k = div(prodNeg(p), prodNeg(z)).re;
	return { z: tidy(z), p: tidy(p), k };
}

/** Elliptic prototype with passband edge at ω = 1 (Orfanidis' method). */
export function ellipap(N: number, rp: number, rs: number): ZPK {
	if (N === 1) {
		// first-order elliptic degenerates to Chebyshev I
		return cheb1ap(1, rp);
	}
	const ep = Math.sqrt(Math.pow(10, 0.1 * rp) - 1);
	const es = Math.sqrt(Math.pow(10, 0.1 * rs) - 1);
	const k1 = ep / es;
	const k = ellipdeg(N, k1);
	const L = Math.floor(N / 2);
	const r = N % 2;
	const z: Complex[] = [];
	const p: Complex[] = [];
	const v0 = scale(mul(c(0, -1), asne(c(0, 1 / ep), k1)), 1 / N);
	for (let i = 1; i <= L; i++) {
		const ui = (2 * i - 1) / N;
		const zeta = cde(c(ui), k).re;
		const zi = c(0, 1 / (k * zeta));
		z.push(zi, conj(zi));
		// p = j·cd((ui − j·v0)K, k)
		const u = c(ui + v0.im, -v0.re); // ui − j·v0
		const pi = mul(c(0, 1), cde(u, k));
		p.push(pi, conj(pi));
	}
	if (r === 1) {
		const p0 = mul(c(0, 1), sne(mul(c(0, 1), v0), k));
		p.push(c(p0.re, 0));
	}
	// gain: H(0) = 1 for odd N, 10^(−Rp/20) for even N
	const H0 = r === 1 ? 1 : Math.pow(10, -rp / 20);
	const kk = H0 * div(prodNeg(p), prodNeg(z)).re;
	// ensure poles are in the left half-plane
	const pl = p.map((q) => (q.re > 0 ? c(-q.re, q.im) : q));
	return { z: tidy(z), p: tidy(pl), k: kk };
}

/** Elliptic selectivity k = ωp/ωs achieved by an order-N design with given ripples. */
export function ellipSelectivity(N: number, rp: number, rs: number): number {
	const ep = Math.sqrt(Math.pow(10, 0.1 * rp) - 1);
	const es = Math.sqrt(Math.pow(10, 0.1 * rs) - 1);
	return ellipdeg(N, ep / es);
}

/** Coefficients (ascending powers) of the reverse Bessel polynomial θ_N(s). */
export function reverseBesselCoeffs(N: number): number[] {
	const a: number[] = [];
	for (let k = 0; k <= N; k++) {
		// (2N−k)! / (2^(N−k) k! (N−k)!)
		let v = 1;
		for (let i = N - k + 1; i <= 2 * N - k; i++) v *= i; // (2N−k)!/(N−k)!
		for (let i = 2; i <= k; i++) v /= i;
		v /= Math.pow(2, N - k);
		a.push(v);
	}
	return a;
}

/**
 * Bessel–Thomson prototype.
 *  'delay': unit group delay at DC.
 *  'phase': phase midpoint at ω = 1 (high-frequency asymptote matches 1/sᴺ) — SciPy default.
 *  'mag':   −3 dB at ω = 1.
 */
export function besselap(N: number, norm: BesselNorm = 'phase'): ZPK {
	const asc = reverseBesselCoeffs(N);
	const desc = [...asc].reverse();
	let p = cleanRealRoots(roots(desc), 1e-7);
	const a0 = asc[0];
	if (norm === 'delay') {
		return { z: [], p: tidy(p), k: a0 };
	}
	// phase normalisation
	const f = Math.pow(a0, 1 / N);
	p = p.map((q) => scale(q, 1 / f));
	if (norm === 'phase') return { z: [], p: tidy(p), k: 1 };
	// mag: find ω where |H| = 1/√2 and rescale
	const proto: ZPK = { z: [], p, k: 1 };
	const w3 = find3dB(proto);
	p = p.map((q) => scale(q, 1 / w3));
	return { z: [], p: tidy(p), k: prodNeg(p).re };
}

/** Legendre (Papoulis optimum-L) prototype with −3 dB at ω = 1. */
export function legendreap(N: number): ZPK {
	if (N === 1) return { z: [], p: [c(-1)], k: 1 };
	// Build the polynomial L_N(x) in x = ω² (ascending integration variable).
	const legendre = (n: number): number[] => {
		// descending coefficients of P_n(t)
		let p0 = [1];
		if (n === 0) return p0;
		let p1 = [1, 0];
		for (let k = 1; k < n; k++) {
			// (k+1)P_{k+1} = (2k+1) t P_k − k P_{k−1}
			const a = polymul([2 * k + 1, 0], p1);
			const b = p0.map((v) => -k * v);
			const next = polyadd(a, b).map((v) => v / (k + 1));
			p0 = p1;
			p1 = next;
		}
		return p1;
	};
	let integrand: number[];
	if (N % 2 === 1) {
		const k = (N - 1) / 2;
		let sum: number[] = [0];
		for (let i = 0; i <= k; i++) sum = polyadd(sum, legendre(i).map((v) => v * (2 * i + 1)));
		integrand = polymul(sum, sum);
	} else {
		const k = (N - 2) / 2;
		let sum: number[] = [0];
		for (let i = 0; i <= k; i++) {
			if ((k % 2 === 0 && i % 2 === 0) || (k % 2 === 1 && i % 2 === 1))
				sum = polyadd(sum, legendre(i).map((v) => v * (2 * i + 1)));
		}
		integrand = polymul([1, 1], polymul(sum, sum));
	}
	// L(t) = ∫_{-1}^{t} integrand, then substitute t = 2x − 1 (x = ω²)
	const F = polyint(integrand);
	const F0 = polyval(F, -1);
	const Lt = polyadd(F, [-F0]);
	// compose with t = 2x − 1
	let Lx: number[] = [0];
	for (const coef of Lt) Lx = polyadd(polymul(Lx, [2, -1]), [coef]);
	// normalise so L(1) = 1 → −3 dB at ω = 1
	const L1 = polyval(Lx, 1);
	Lx = Lx.map((v) => v / L1);
	// D(s) D(−s) = 1 + L(−s²): substitute x = −s²
	const one = polyadd(Lx, [1]);
	let Ds: number[] = [0];
	for (const coef of one) Ds = polyadd(polymul(Ds, [-1, 0, 0]), [coef]);
	const rs = cleanRealRoots(roots(Ds), 1e-7);
	const p = rs.filter((r) => r.re < 0);
	const proto: ZPK = { z: [], p, k: 1 };
	proto.k = 1 / abs(freqsZpk(proto, [0])[0]);
	return { z: [], p: tidy(p), k: proto.k };
}

/** Gaussian approximation (truncated Taylor series of e^{ω²}), −3 dB at ω = 1. */
export function gaussianap(N: number): ZPK {
	// |H|² = 1 / Σ_{k=0}^{N} (a ω²)^k / k!,  substitute ω² = −s²
	const coeffsAsc: number[] = [];
	let fact = 1;
	for (let k = 0; k <= N; k++) {
		if (k > 0) fact *= k;
		coeffsAsc.push((k % 2 === 0 ? 1 : -1) / fact); // (−s²)^k / k!
	}
	// polynomial in s (descending): degree 2N
	const desc: number[] = new Array(2 * N + 1).fill(0);
	for (let k = 0; k <= N; k++) desc[2 * N - 2 * k] = coeffsAsc[k];
	const rs = cleanRealRoots(roots(desc), 1e-7);
	let p = rs.filter((r) => r.re < 0);
	const proto: ZPK = { z: [], p, k: 1 };
	proto.k = 1 / abs(freqsZpk(proto, [0])[0]);
	const w3 = find3dB(proto);
	p = p.map((q) => scale(q, 1 / w3));
	const out: ZPK = { z: [], p, k: 1 };
	out.k = 1 / abs(freqsZpk(out, [0])[0]);
	return { z: [], p: tidy(p), k: out.k };
}

/** N coincident real poles placed so the −3 dB point is ω = 1. */
export function criticalap(N: number): ZPK {
	const a = 1 / Math.sqrt(Math.pow(2, 1 / N) - 1);
	const p = Array.from({ length: N }, () => c(-a));
	return { z: [], p, k: Math.pow(a, N) };
}

export interface PrototypeOptions {
	rp?: number;
	rs?: number;
	besselNorm?: BesselNorm;
}

export function prototype(family: AnalogFamily, N: number, opts: PrototypeOptions = {}): ZPK {
	const rp = opts.rp ?? 1;
	const rs = opts.rs ?? 40;
	switch (family) {
		case 'butter':
			return buttap(N);
		case 'cheby1':
			return cheb1ap(N, rp);
		case 'cheby2':
			return cheb2ap(N, rs);
		case 'ellip':
			return ellipap(N, rp, rs);
		case 'bessel':
			return besselap(N, opts.besselNorm ?? 'phase');
		case 'legendre':
			return legendreap(N);
		case 'gaussian':
			return gaussianap(N);
		case 'critical':
			return criticalap(N);
	}
}

// ---------------------------------------------------------------------------
// Order estimation (normalised low-pass: passband edge 1, stopband edge `ws`)
// ---------------------------------------------------------------------------

export interface OrderResult {
	N: number;
	/**
	 * Prototype cutoff (in units of the passband edge) at which to place the
	 * family's natural frequency so that the passband spec is met exactly.
	 */
	wn: number;
	/** The family's maximum order was reached without meeting the stopband spec. */
	capped?: boolean;
}

/**
 * Minimum order for a normalised low-pass with passband edge 1 rad/s and
 * stopband edge ws (>1), passband attenuation ≤ rp dB and stopband ≥ rs dB.
 */
export function estimateOrder(
	family: AnalogFamily,
	ws: number,
	rp: number,
	rs: number,
	opts: PrototypeOptions = {}
): OrderResult {
	const gp = Math.pow(10, 0.1 * rp) - 1;
	const gs = Math.pow(10, 0.1 * rs) - 1;
	switch (family) {
		case 'butter': {
			const N = Math.max(1, Math.ceil(Math.log10(gs / gp) / (2 * Math.log10(ws))));
			// natural frequency giving exactly rp at the passband edge
			return { N, wn: Math.pow(gp, -1 / (2 * N)) };
		}
		case 'cheby1': {
			const N = Math.max(1, Math.ceil(Math.acosh(Math.sqrt(gs / gp)) / Math.acosh(ws)));
			return { N, wn: 1 };
		}
		case 'cheby2': {
			const N = Math.max(1, Math.ceil(Math.acosh(Math.sqrt(gs / gp)) / Math.acosh(ws)));
			// stopband-edge frequency such that attenuation is exactly rp at ω = 1
			const wn = Math.cosh(Math.acosh(Math.sqrt(gs / gp)) / N);
			return { N, wn };
		}
		case 'ellip': {
			const k = 1 / ws;
			const k1 = Math.sqrt(gp / gs);
			const N = Math.max(1, Math.ceil((ellipk(k) * ellipkp(k1)) / (ellipkp(k) * ellipk(k1)) - 1e-9));
			return { N, wn: 1 };
		}
		default: {
			// Monotonic families: search numerically.
			const info = familyInfo(family);
			let wn = 1;
			for (let N = 1; N <= info.maxOrder; N++) {
				const proto = prototype(family, N, opts);
				// scale so attenuation at ω = 1 equals rp exactly
				const wp = findLevel(proto, -rp);
				wn = 1 / wp;
				// stopband attenuation at ws (in units of the passband edge)
				const att = -20 * Math.log10(abs(freqsZpk(proto, [ws * wp])[0]) / gainAt0(proto));
				if (att >= rs) return { N, wn };
			}
			return { N: info.maxOrder, wn, capped: true };
		}
	}
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function prodNeg(rs: Complex[]): Complex {
	let out = c(1);
	for (const r of rs) out = mul(out, neg(r));
	return out;
}

function tidy(rs: Complex[]): Complex[] {
	return sortRoots(
		rs.map((r) => {
			const re = Math.abs(r.re) < 1e-14 * Math.max(1, abs(r)) ? 0 : r.re;
			const im = Math.abs(r.im) < 1e-12 * Math.max(1, abs(r)) ? 0 : r.im;
			return c(re, im);
		})
	);
}

function gainAt0(zpk: ZPK): number {
	const g = abs(freqsZpk(zpk, [0])[0]);
	return g > 0 ? g : 1;
}

/** Frequency (rad/s) where a monotonic low-pass reaches `levelDb` relative to DC. */
export function findLevel(zpk: ZPK, levelDb: number): number {
	const g0 = gainAt0(zpk);
	const target = Math.pow(10, levelDb / 20);
	let lo = 1e-6;
	let hi = 1;
	while (abs(freqsZpk(zpk, [hi])[0]) / g0 > target && hi < 1e6) hi *= 2;
	for (let i = 0; i < 100; i++) {
		const mid = Math.sqrt(lo * hi);
		if (abs(freqsZpk(zpk, [mid])[0]) / g0 > target) lo = mid;
		else hi = mid;
	}
	return Math.sqrt(lo * hi);
}

export function find3dB(zpk: ZPK): number {
	return findLevel(zpk, -10 * Math.log10(2));
}
