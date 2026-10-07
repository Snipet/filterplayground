/**
 * Polynomial helpers. Coefficient arrays use *descending* powers, matching the
 * MATLAB / SciPy convention: [a0, a1, a2] ↔ a0·x² + a1·x + a2.
 */
import { type Complex, abs, add, c, div, mul, sub } from './complex';

/** Evaluate a real polynomial at a real point (Horner). */
export function polyval(p: readonly number[], x: number): number {
	let y = 0;
	for (const coef of p) y = y * x + coef;
	return y;
}

/** Evaluate a real polynomial at a complex point (Horner). */
export function polyvalC(p: readonly number[], x: Complex): Complex {
	let re = 0;
	let im = 0;
	for (const coef of p) {
		const nre = re * x.re - im * x.im + coef;
		im = re * x.im + im * x.re;
		re = nre;
	}
	return { re, im };
}

/** Evaluate a complex polynomial at a complex point. */
export function polyvalCC(p: readonly Complex[], x: Complex): Complex {
	let y = c(0);
	for (const coef of p) y = add(mul(y, x), coef);
	return y;
}

export function polymul(a: readonly number[], b: readonly number[]): number[] {
	if (a.length === 0 || b.length === 0) return [];
	const out = new Array<number>(a.length + b.length - 1).fill(0);
	for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
	return out;
}

export function polymulC(a: readonly Complex[], b: readonly Complex[]): Complex[] {
	if (a.length === 0 || b.length === 0) return [];
	const out: Complex[] = Array.from({ length: a.length + b.length - 1 }, () => c(0));
	for (let i = 0; i < a.length; i++)
		for (let j = 0; j < b.length; j++) out[i + j] = add(out[i + j], mul(a[i], b[j]));
	return out;
}

export function polyadd(a: readonly number[], b: readonly number[]): number[] {
	const n = Math.max(a.length, b.length);
	const out = new Array<number>(n).fill(0);
	for (let i = 0; i < a.length; i++) out[n - a.length + i] += a[i];
	for (let i = 0; i < b.length; i++) out[n - b.length + i] += b[i];
	return out;
}

export function polyscale(a: readonly number[], s: number): number[] {
	return a.map((v) => v * s);
}

export function polyder(p: readonly number[]): number[] {
	const n = p.length - 1;
	if (n <= 0) return [0];
	return p.slice(0, n).map((coef, i) => coef * (n - i));
}

/** Integrate a polynomial (constant of integration = 0). */
export function polyint(p: readonly number[]): number[] {
	const n = p.length;
	return [...p.map((coef, i) => coef / (n - i)), 0];
}

/** Remove leading (highest-power) coefficients that are exactly or numerically zero. */
export function trimLeading(p: readonly number[], tol = 0): number[] {
	const max = Math.max(0, ...p.map(Math.abs));
	let i = 0;
	while (i < p.length - 1 && Math.abs(p[i]) <= tol * max) i++;
	return p.slice(i);
}

/** Build a monic polynomial from its roots (complex arithmetic, complex result). */
export function polyFromRootsC(roots: readonly Complex[]): Complex[] {
	let p: Complex[] = [c(1)];
	for (const r of roots) p = polymulC(p, [c(1), c(-r.re, -r.im)]);
	return p;
}

/**
 * Build a monic real polynomial from roots that come in conjugate pairs.
 * Imaginary residue from rounding is discarded.
 */
export function polyFromRoots(roots: readonly Complex[]): number[] {
	return polyFromRootsC(roots).map((v) => v.re);
}

/** Substitute x → a·x + b into p (used for frequency transformations). */
export function polyCompose(p: readonly number[], inner: readonly number[]): number[] {
	let out: number[] = [0];
	for (const coef of p) out = polyadd(polymul(out, inner), [coef]);
	return out;
}

/**
 * Find all roots of a real or complex polynomial using the Aberth–Ehrlich method,
 * followed by Newton polishing. Zero roots are extracted exactly.
 */
export function roots(pIn: readonly number[] | readonly Complex[]): Complex[] {
	let p: Complex[] = (pIn as readonly (number | Complex)[]).map((v) =>
		typeof v === 'number' ? c(v) : v
	);
	// strip leading zeros
	while (p.length > 0 && p[0].re === 0 && p[0].im === 0) p = p.slice(1);
	if (p.length <= 1) return [];
	const out: Complex[] = [];
	// strip trailing zeros → roots at the origin
	while (p.length > 1 && p[p.length - 1].re === 0 && p[p.length - 1].im === 0) {
		out.push(c(0));
		p = p.slice(0, -1);
	}
	const n = p.length - 1;
	if (n === 0) return out;
	// normalise to monic
	const lead = p[0];
	p = p.map((v) => div(v, lead));
	if (n === 1) {
		out.push(c(-p[1].re, -p[1].im));
		return out;
	}
	if (n === 2) {
		out.push(...quadraticRoots(p[1], p[2]));
		return out;
	}

	const dp = p.slice(0, n).map((coef, i) => ({ re: coef.re * (n - i), im: coef.im * (n - i) }));

	// Initial guesses on a circle whose radius is the geometric mean of root magnitudes,
	// with an irrational angular offset to break symmetry.
	const r0 = Math.pow(abs(p[n]), 1 / n) || 1;
	const z: Complex[] = [];
	for (let k = 0; k < n; k++) {
		const theta = (2 * Math.PI * k) / n + 0.4;
		z.push(c(r0 * Math.cos(theta), r0 * Math.sin(theta)));
	}

	const maxIter = 800;
	for (let iter = 0; iter < maxIter; iter++) {
		let maxStep = 0;
		for (let i = 0; i < n; i++) {
			const pv = polyvalCC(p, z[i]);
			if (pv.re === 0 && pv.im === 0) continue;
			const dv = polyvalCC(dp, z[i]);
			const ratio = div(pv, dv);
			let sum = c(0);
			for (let j = 0; j < n; j++) {
				if (j === i) continue;
				const d = sub(z[i], z[j]);
				if (d.re === 0 && d.im === 0) continue;
				sum = add(sum, div(c(1), d));
			}
			const denom = sub(c(1), mul(ratio, sum));
			const w = div(ratio, denom);
			if (!Number.isFinite(w.re) || !Number.isFinite(w.im)) continue;
			z[i] = sub(z[i], w);
			const step = abs(w) / Math.max(1e-300, abs(z[i]));
			if (step > maxStep) maxStep = step;
		}
		if (maxStep < 1e-15) break;
	}

	// Newton polishing
	for (let i = 0; i < n; i++) {
		for (let k = 0; k < 3; k++) {
			const pv = polyvalCC(p, z[i]);
			const dv = polyvalCC(dp, z[i]);
			if (abs(dv) === 0) break;
			const step = div(pv, dv);
			const cand = sub(z[i], step);
			if (abs(polyvalCC(p, cand)) <= abs(pv)) z[i] = cand;
			else break;
		}
	}

	out.push(...z);
	return out;
}

function quadraticRoots(b: Complex, cc: Complex): Complex[] {
	// x² + b·x + c = 0, numerically stable form
	const disc = sub(mul(b, b), mul(c(4), cc));
	const sq = complexSqrt(disc);
	// choose sign to avoid cancellation
	const sgn = b.re * sq.re + b.im * sq.im >= 0 ? 1 : -1;
	const q = mul(c(-0.5), add(b, mul(c(sgn), sq)));
	if (q.re === 0 && q.im === 0) return [c(0), c(0)];
	return [q, div(cc, q)];
}

function complexSqrt(a: Complex): Complex {
	if (a.im === 0) return a.re >= 0 ? c(Math.sqrt(a.re)) : c(0, Math.sqrt(-a.re));
	const m = abs(a);
	return c(Math.sqrt((m + a.re) / 2), Math.sign(a.im) * Math.sqrt((m - a.re) / 2));
}

/**
 * Clean up roots of a real polynomial: snap near-real roots to the real axis and
 * make conjugate pairs exactly symmetric. Returns roots sorted for stable display.
 */
export function cleanRealRoots(rs: readonly Complex[], tol = 1e-8): Complex[] {
	const remaining = rs.map((r) => ({ ...r }));
	const out: Complex[] = [];
	const used = new Array(remaining.length).fill(false);
	for (let i = 0; i < remaining.length; i++) {
		if (used[i]) continue;
		const r = remaining[i];
		const scaleTol = tol * Math.max(1, abs(r));
		if (Math.abs(r.im) <= scaleTol) {
			used[i] = true;
			out.push(c(r.re, 0));
			continue;
		}
		// find best conjugate partner
		let best = -1;
		let bestD = Infinity;
		for (let j = i + 1; j < remaining.length; j++) {
			if (used[j]) continue;
			const d = Math.hypot(remaining[j].re - r.re, remaining[j].im + r.im);
			if (d < bestD) {
				bestD = d;
				best = j;
			}
		}
		used[i] = true;
		if (best >= 0 && bestD <= 1e-5 * Math.max(1, abs(r))) {
			used[best] = true;
			const re = (r.re + remaining[best].re) / 2;
			const im = Math.abs((r.im - remaining[best].im) / 2);
			out.push(c(re, im), c(re, -im));
		} else {
			out.push(c(r.re, r.im));
		}
	}
	return out;
}

/** Sort roots: by imaginary-part magnitude descending, positive imaginary first in each pair. */
export function sortRoots(rs: readonly Complex[]): Complex[] {
	return [...rs].sort((a, b) => {
		const d = Math.abs(a.im) - Math.abs(b.im);
		if (Math.abs(d) > 1e-12) return d;
		if (a.re !== b.re) return a.re - b.re;
		return b.im - a.im;
	});
}
