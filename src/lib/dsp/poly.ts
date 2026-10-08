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
	if (n === 1) {
		out.push(div(c(-p[1].re, -p[1].im), p[0]));
		return out;
	}
	if (n === 2) {
		// normalise to monic
		const lead = p[0];
		const qr = quadraticRoots(div(p[1], lead), div(p[2], lead));
		if (qr.every((r) => Number.isFinite(r.re) && Number.isFinite(r.im))) {
			out.push(...qr);
			return out;
		}
	}

	out.push(...aberth(p));
	return out;
}

/**
 * Aberth–Ehrlich iteration on a complex polynomial (flat arrays, no allocation in
 * the inner loop). Each root is frozen once its step is below 1e-14 relative, then
 * all roots get a few Newton polishing steps.
 *
 * Overflow safety: the coefficients are scaled to max |c_k| = 1 and the
 * logarithmic derivative p'/p is evaluated by Horner only for |z| ≤ 1. For |z| > 1
 * it uses the reversed polynomial q(w) = wⁿ·p(1/w) at w = 1/z, where
 * p'/p = w·(n − w·q'(w)/q(w)) (as in MPSolve), so no intermediate exceeds
 * ~n²·max|c_k| whatever |z| is, and every complex division is Smith-scaled.
 * Without this, |p'|² overflows for a root near 1e15 (an FIR with a near-zero end
 * tap), a long FIR, or a high-order analog polynomial in rad/s, and the iterate
 * never moves. An iterate whose step is still non-finite is re-seeded on the
 * initial circle rather than left where it is.
 */
function aberth(p: readonly Complex[], maxIter = 600): Complex[] {
	const n = p.length - 1;
	let m = 0;
	for (const v of p) m = Math.max(m, abs(v));
	// non-finite coefficients have no meaningful roots
	if (!Number.isFinite(m)) return Array.from({ length: n }, () => c(NaN, NaN));
	const cr = Float64Array.from(p, (v) => v.re / m);
	const ci = Float64Array.from(p, (v) => v.im / m);
	const zr = new Float64Array(n);
	const zi = new Float64Array(n);
	const done = new Uint8Array(n);
	// Initial guesses on a circle whose radius is the geometric mean of root magnitudes,
	// |c_n / c_0|^(1/n), with an irrational angular offset to break symmetry.
	let r0 = Math.exp((Math.log(Math.hypot(cr[n], ci[n])) - Math.log(Math.hypot(cr[0], ci[0]))) / n);
	if (!(r0 > 0 && Number.isFinite(r0))) r0 = 1;
	for (let k = 0; k < n; k++) {
		const t = (2 * Math.PI * k) / n + 0.4;
		zr[k] = r0 * Math.cos(t);
		zi[k] = r0 * Math.sin(t);
	}
	// Restart a stalled iterate on the initial circle at a fresh (golden-ratio) angle.
	let reseeds = 0;
	const reseed = (i: number) => {
		const t = 2 * Math.PI * ((++reseeds * 0.6180339887498949) % 1) + 0.4;
		zr[i] = r0 * Math.cos(t);
		zi[i] = r0 * Math.sin(t);
	};
	// Smith division (ar + j·ai) / (br + j·bi) → (qr, qi); never forms |b|².
	let qr = 0;
	let qi = 0;
	const cdiv = (ar: number, ai: number, br: number, bi: number) => {
		if (Math.abs(br) >= Math.abs(bi)) {
			const r = bi / br;
			const d = br + bi * r;
			qr = (ar + ai * r) / d;
			qi = (ai - ar * r) / d;
		} else {
			const r = br / bi;
			const d = br * r + bi;
			qr = (ar * r + ai) / d;
			qi = (ai * r - ar) / d;
		}
	};
	// p'/p at (xr, xi) → ev[0..1]; ev[2] = log|p(x) / m|. Returns false if p(x) = 0.
	const ev = new Float64Array(3);
	const evalP = (xr: number, xi: number): boolean => {
		let pr: number;
		let pi: number;
		let dr = 0;
		let di = 0;
		if (xr * xr + xi * xi <= 1) {
			// Horner for p and p'
			pr = cr[0];
			pi = ci[0];
			for (let k = 1; k <= n; k++) {
				const ndr = dr * xr - di * xi + pr;
				di = dr * xi + di * xr + pi;
				dr = ndr;
				const npr = pr * xr - pi * xi + cr[k];
				pi = pr * xi + pi * xr + ci[k];
				pr = npr;
			}
			if (pr === 0 && pi === 0) return false;
			cdiv(dr, di, pr, pi);
			ev[0] = qr;
			ev[1] = qi;
			ev[2] = Math.log(Math.hypot(pr, pi));
			return true;
		}
		// Horner for q and q' (coefficients in reverse order) at w = 1/x
		cdiv(1, 0, xr, xi);
		const wr = qr;
		const wi = qi;
		pr = cr[n];
		pi = ci[n];
		for (let k = n - 1; k >= 0; k--) {
			const ndr = dr * wr - di * wi + pr;
			di = dr * wi + di * wr + pi;
			dr = ndr;
			const npr = pr * wr - pi * wi + cr[k];
			pi = pr * wi + pi * wr + ci[k];
			pr = npr;
		}
		if (pr === 0 && pi === 0) return false;
		// t = w·q'/q, p'/p = w·(n − t)
		cdiv(dr, di, pr, pi);
		const ur = n - (wr * qr - wi * qi);
		const ui = -(wr * qi + wi * qr);
		ev[0] = wr * ur - wi * ui;
		ev[1] = wr * ui + wi * ur;
		ev[2] = Math.log(Math.hypot(pr, pi)) + n * Math.log(Math.hypot(xr, xi));
		return true;
	};
	let remaining = n;
	for (let it = 0; it < maxIter && remaining > 0; it++) {
		for (let i = 0; i < n; i++) {
			if (done[i]) continue;
			const xr = zr[i];
			const xi = zi[i];
			// p(z_i) = 0, or p'/p overflows (|p/p'| is far below the spacing of doubles)
			if (!evalP(xr, xi) || !Number.isFinite(ev[0]) || !Number.isFinite(ev[1])) {
				done[i] = 1;
				remaining--;
				continue;
			}
			// sum = Σ_{j≠i} 1/(z_i − z_j)
			let sr = 0;
			let si = 0;
			for (let j = 0; j < n; j++) {
				if (j === i) continue;
				const er = xr - zr[j];
				const ei = xi - zi[j];
				if (Math.abs(er) >= Math.abs(ei)) {
					if (er === 0) continue;
					const r = ei / er;
					const inv = 1 / (er + ei * r);
					sr += inv;
					si -= r * inv;
				} else {
					const r = er / ei;
					const inv = 1 / (er * r + ei);
					sr += r * inv;
					si -= inv;
				}
			}
			// Aberth step w = 1 / (p'/p − sum)
			cdiv(1, 0, ev[0] - sr, ev[1] - si);
			const nr = xr - qr;
			const ni = xi - qi;
			if (!Number.isFinite(nr) || !Number.isFinite(ni)) {
				reseed(i);
				continue;
			}
			zr[i] = nr;
			zi[i] = ni;
			if (Math.hypot(qr, qi) <= 1e-14 * Math.max(1e-300, Math.hypot(nr, ni))) {
				done[i] = 1;
				remaining--;
			}
		}
	}
	// Newton polishing (accept only steps that reduce |p|)
	const out: Complex[] = [];
	for (let i = 0; i < n; i++) {
		for (let k = 0; k < 3; k++) {
			if (!evalP(zr[i], zi[i])) break;
			const before = ev[2];
			cdiv(1, 0, ev[0], ev[1]);
			const nr = zr[i] - qr;
			const ni = zi[i] - qi;
			if (!Number.isFinite(nr) || !Number.isFinite(ni)) break;
			if (!evalP(nr, ni) || ev[2] <= before) {
				zr[i] = nr;
				zi[i] = ni;
			} else break;
		}
		out.push(c(zr[i], zi[i]));
	}
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
