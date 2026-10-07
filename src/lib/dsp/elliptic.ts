/**
 * Jacobi elliptic functions and elliptic integrals via Landen transformations,
 * following S. J. Orfanidis, "Lecture Notes on Elliptic Filter Design" (2006).
 * These are what make elliptic (Cauer) filter design possible.
 */
import { type Complex, acos, add, c, cos, div, mul, sin, sqrt, sub } from './complex';

/** Descending Landen sequence of moduli for modulus k (0 ≤ k < 1). */
export function landen(k: number, tol = 1e-15): number[] {
	const v: number[] = [];
	if (k === 0 || k === 1) return v;
	let kk = k;
	for (let i = 0; i < 64; i++) {
		const kp = Math.sqrt(1 - kk * kk);
		kk = Math.pow(kk / (1 + kp), 2);
		v.push(kk);
		if (kk < tol) break;
	}
	return v;
}

/** Complete elliptic integral of the first kind K(k) (modulus k). */
export function ellipk(k: number): number {
	if (k >= 1) return Infinity;
	if (k === 0) return Math.PI / 2;
	// For k close to 1 Landen can lose precision; use the AGM instead.
	let a = 1;
	let b = Math.sqrt(1 - k * k);
	for (let i = 0; i < 64; i++) {
		const an = (a + b) / 2;
		const bn = Math.sqrt(a * b);
		a = an;
		b = bn;
		if (Math.abs(a - b) < 1e-16 * a) break;
	}
	return Math.PI / (2 * a);
}

/** K'(k) = K(√(1−k²)). Uses the complementary modulus directly for accuracy. */
export function ellipkp(k: number): number {
	return ellipk(Math.sqrt(1 - k * k));
}

/** cd(uK, k) for complex u (u normalised by the quarter period K). */
export function cde(u: Complex, k: number): Complex {
	const v = landen(k);
	let w = cos(mul(u, c(Math.PI / 2)));
	for (let n = v.length - 1; n >= 0; n--) {
		// w = (1 + v_n) w / (1 + v_n w²)
		w = div(mul(c(1 + v[n]), w), add(c(1), mul(c(v[n]), mul(w, w))));
	}
	return w;
}

/** sn(uK, k) for complex u. */
export function sne(u: Complex, k: number): Complex {
	const v = landen(k);
	let w = sin(mul(u, c(Math.PI / 2)));
	for (let n = v.length - 1; n >= 0; n--) {
		w = div(mul(c(1 + v[n]), w), add(c(1), mul(c(v[n]), mul(w, w))));
	}
	return w;
}

const srem = (x: number, y: number): number => x - y * Math.round(x / y);

/** Inverse of cd: returns u such that cd(uK, k) = w (normalised by K). */
export function acde(wIn: Complex, k: number): Complex {
	const v = landen(k);
	let w = wIn;
	for (let n = 0; n < v.length; n++) {
		const v1 = n === 0 ? k : v[n - 1];
		// w = w / (1 + sqrt(1 − w² v1²)) · 2/(1 + v_n)
		const s = sqrt(sub(c(1), mul(mul(w, w), c(v1 * v1))));
		w = mul(div(w, add(c(1), s)), c(2 / (1 + v[n])));
	}
	let u = acos(w);
	u = mul(u, c(2 / Math.PI));
	const K = ellipk(k);
	const Kp = ellipkp(k);
	const R = Kp / K;
	return c(srem(u.re, 4), srem(u.im, 2 * R));
}

/** Inverse of sn: returns u such that sn(uK, k) = w. */
export function asne(w: Complex, k: number): Complex {
	return sub(c(1), acde(w, k));
}

/**
 * Solve the degree equation N·K'/K = K'₁/K₁ for the selectivity modulus k given
 * order N and discrimination modulus k1 (exact, via Jacobi functions).
 */
export function ellipdeg(N: number, k1: number): number {
	const L = Math.floor(N / 2);
	const kc1 = Math.sqrt(1 - k1 * k1);
	let prod = 1;
	for (let i = 1; i <= L; i++) {
		const ui = (2 * i - 1) / N;
		const s = sne(c(ui), kc1).re;
		prod *= Math.pow(s, 4);
	}
	const kp = Math.pow(kc1, N) * prod;
	return Math.sqrt(1 - kp * kp);
}
