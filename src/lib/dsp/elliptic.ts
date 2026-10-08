/**
 * Jacobi elliptic functions and elliptic integrals via Landen transformations,
 * following S. J. Orfanidis, "Lecture Notes on Elliptic Filter Design" (2006).
 * These are what make elliptic (Cauer) filter design possible.
 *
 * Moduli close to 0 or 1 are common in practice (k₁ = εp/εs is ~1e-8 at
 * Rp = 0.01 dB / Rs = 140 dB; a high-order design with a wide ripple spec has
 * k within 1e-10 of 1). Forming √(1−k²) there throws away every significant
 * digit of the small quantity, so the functions below accept the complementary
 * modulus k′ = √(1−k²) as an optional extra argument and carry it alongside k.
 */
import { type Complex, acos, add, c, cos, div, mul, sin, sqrt, sub } from './complex';

/** Complementary modulus k′ = √(1−k²), formed as √((1−k)(1+k)) to avoid cancellation. */
export const kprime = (k: number): number => Math.sqrt((1 - k) * (1 + k));

/** Arithmetic–geometric mean (NaN propagates). */
function agm(a: number, b: number): number {
	for (let i = 0; i < 64 && !(Math.abs(a - b) <= 2 * Number.EPSILON * a); i++) {
		const an = (a + b) / 2;
		b = Math.sqrt(a * b);
		a = an;
	}
	return a;
}

/**
 * Descending Landen sequence of moduli for modulus k (0 ≤ k < 1). Pass the
 * complementary modulus kp when k is close to 1 (k may then round to exactly 1).
 */
export function landen(k: number, tol = 1e-15, kp?: number): number[] {
	const v: number[] = [];
	let kc = kp ?? (k >= 1 ? 0 : kprime(k));
	if (k === 0 || kc === 0) return v;
	let kk = k;
	for (let i = 0; i < 64; i++) {
		// k_{n+1} = (k_n/(1+k′_n))²,  k′_{n+1} = 2√k′_n/(1+k′_n) (no cancellation in either)
		kk = Math.pow(kk / (1 + kc), 2);
		kc = (2 * Math.sqrt(kc)) / (1 + kc);
		v.push(kk);
		if (kk < tol) break;
	}
	return v;
}

/** Complete elliptic integral of the first kind K(k) = π/(2·AGM(1, k′)) (modulus k). */
export function ellipk(k: number, kp?: number): number {
	const kc = kp ?? (k >= 1 ? 0 : kprime(k));
	if (kc === 0) return Infinity;
	if (k === 0) return Math.PI / 2;
	return Math.PI / (2 * agm(1, kc));
}

/** K'(k) = K(√(1−k²)) = π/(2·AGM(1, k)), evaluated without forming √(1−k²). */
export function ellipkp(k: number): number {
	if (k === 0) return Infinity;
	if (k > 1) return NaN;
	return Math.PI / (2 * agm(1, k));
}

/** cd(uK, k) for complex u (u normalised by the quarter period K); kp = k′ if known. */
export function cde(u: Complex, k: number, kp?: number): Complex {
	const v = landen(k, undefined, kp);
	let w = cos(mul(u, c(Math.PI / 2)));
	for (let n = v.length - 1; n >= 0; n--) {
		// w = (1 + v_n) w / (1 + v_n w²)
		w = div(mul(c(1 + v[n]), w), add(c(1), mul(c(v[n]), mul(w, w))));
	}
	return w;
}

/** sn(uK, k) for complex u; kp = k′ if known. */
export function sne(u: Complex, k: number, kp?: number): Complex {
	const v = landen(k, undefined, kp);
	let w = sin(mul(u, c(Math.PI / 2)));
	for (let n = v.length - 1; n >= 0; n--) {
		w = div(mul(c(1 + v[n]), w), add(c(1), mul(c(v[n]), mul(w, w))));
	}
	return w;
}

const srem = (x: number, y: number): number => x - y * Math.round(x / y);

/** Inverse of cd: returns u such that cd(uK, k) = w (normalised by K); kp = k′ if known. */
export function acde(wIn: Complex, k: number, kp?: number): Complex {
	const v = landen(k, undefined, kp);
	let w = wIn;
	for (let n = 0; n < v.length; n++) {
		const v1 = n === 0 ? k : v[n - 1];
		// w = w / (1 + sqrt(1 − w² v1²)) · 2/(1 + v_n)
		const s = sqrt(sub(c(1), mul(mul(w, w), c(v1 * v1))));
		w = mul(div(w, add(c(1), s)), c(2 / (1 + v[n])));
	}
	let u = acos(w);
	u = mul(u, c(2 / Math.PI));
	const K = ellipk(k, kp);
	const Kp = ellipkp(k);
	const R = Kp / K;
	return c(srem(u.re, 4), srem(u.im, 2 * R));
}

/** Inverse of sn: returns u such that sn(uK, k) = w; kp = k′ if known. */
export function asne(w: Complex, k: number, kp?: number): Complex {
	return sub(c(1), acde(w, k, kp));
}

/** k = θ₂²(q)/θ₃²(q) and k′ = θ₄²(q)/θ₃²(q) for a nome 0 ≤ q ≤ e^{−π} (fast-converging). */
function thetaModuli(q: number): [number, number] {
	let s2 = 1; // θ₂/(2q^{1/4}) = Σ_{m≥0} q^{m(m+1)}
	let s3 = 1; // θ₃ = 1 + 2Σ q^{m²}
	let s4 = 1; // θ₄ = 1 + 2Σ (−1)^m q^{m²}
	for (let m = 1; m < 20; m++) {
		const t = Math.pow(q, m * m);
		if (t < 1e-18) break;
		s2 += Math.pow(q, m * (m + 1));
		s3 += 2 * t;
		s4 += m % 2 ? -2 * t : 2 * t;
	}
	return [4 * Math.sqrt(q) * Math.pow(s2 / s3, 2), Math.pow(s4 / s3, 2)];
}

/**
 * Solve the degree equation N·K'/K = K'₁/K₁ for the selectivity modulus k given
 * order N and discrimination modulus k1, returning k together with its complement
 * k′ (both to full relative precision, which k alone cannot hold when k ≈ 1).
 * Exact, via the nome q = e^{−πK'/K} = q₁^{1/N} and theta-function series; the
 * complementary nome is used when q > e^{−π} so the series always converge fast.
 * Pass k1p = k′₁ when k1 is close to 1.
 */
export function ellipdegPair(N: number, k1: number, k1p?: number): { k: number; kp: number } {
	// K'/K of the selectivity modulus
	const rho = ellipkp(k1) / (N * ellipk(k1, k1p));
	if (rho >= 1) {
		const [k, kp] = thetaModuli(Math.exp(-Math.PI * rho));
		return { k, kp };
	}
	const [kp, k] = thetaModuli(Math.exp(-Math.PI / rho));
	return { k, kp };
}

/** Selectivity modulus k solving N·K'/K = K'₁/K₁ (see ellipdegPair). */
export function ellipdeg(N: number, k1: number, k1p?: number): number {
	return ellipdegPair(N, k1, k1p).k;
}
