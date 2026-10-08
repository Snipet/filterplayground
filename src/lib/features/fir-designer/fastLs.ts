/**
 * Least-squares designs for the FIR designer's length search.
 *
 * The auto search tries every odd length in turn, and the shared `firls` solves its
 * normal equations from scratch each time (O(M³) per length). Those equations are nested:
 * for M + 1 cosine terms, Q[i][j] = q[|i−j|] + q[i+j] and the right-hand side b[i] do not
 * depend on the length, so the system for M + 1 terms borders the one for M. `firlsSweep`
 * therefore extends a Cholesky factor of Q one row per term and solves each length in
 * O(M²). It builds q and b exactly as `firls` does and matches it to rounding error.
 */
import { sinc, type LsBand } from '$lib/dsp/fir';

/**
 * Returns a function giving the firls taps for odd lengths N ≤ maxN, to be called with
 * non-decreasing N. It returns null if the factorisation breaks down (Q numerically singular).
 */
export function firlsSweep(
	bands: LsBand[],
	fs: number,
	maxN: number
): (N: number) => number[] | null {
	const nyq = fs / 2;
	const B = bands.map((b) => ({ ...b, f1: b.f1 / nyq, f2: b.f2 / nyq }));
	const Mmax = Math.max(0, Math.floor((maxN - 1) / 2));
	const q = new Float64Array(2 * Mmax + 1);
	for (let n = 0; n <= 2 * Mmax; n++)
		for (const b of B) q[n] += b.weight * (b.f2 * sinc(b.f2 * n) - b.f1 * sinc(b.f1 * n));
	const rhs = new Float64Array(Mmax + 1);
	for (const b of B) {
		const m = b.f2 === b.f1 ? 0 : (b.d2 - b.d1) / (b.f2 - b.f1);
		const cc = b.d1 - b.f1 * m;
		const term = (f: number, n: number) => {
			let v = f * (m * f + cc) * sinc(f * n);
			if (n === 0) v -= (m * f * f) / 2;
			else v += (m * Math.cos(n * Math.PI * f)) / Math.pow(Math.PI * n, 2);
			return v;
		};
		for (let n = 0; n <= Mmax; n++) rhs[n] += b.weight * (term(b.f2, n) - term(b.f1, n));
	}
	// Q = L·Lᵀ, row by row; y = L⁻¹·b
	const L: Float64Array[] = [];
	const y: number[] = [];
	let broken = false;
	const extend = () => {
		const i = L.length;
		const row = new Float64Array(i + 1);
		for (let j = 0; j < i; j++) {
			const Lj = L[j];
			let s = q[i - j] + q[i + j];
			for (let k = 0; k < j; k++) s -= row[k] * Lj[k];
			row[j] = s / Lj[j];
		}
		let d = q[0] + q[2 * i];
		for (let k = 0; k < i; k++) d -= row[k] * row[k];
		if (!(d > 0)) {
			broken = true;
			return;
		}
		row[i] = Math.sqrt(d);
		let s = rhs[i];
		for (let k = 0; k < i; k++) s -= row[k] * y[k];
		y.push(s / row[i]);
		L.push(row);
	};
	return (N: number) => {
		const M = (N - 1) / 2;
		if (!Number.isInteger(M) || M > Mmax) return null;
		while (!broken && L.length < M + 1) extend();
		if (broken) return null;
		// Lᵀ·a = y on the leading (M + 1) × (M + 1) block
		const a = new Float64Array(M + 1);
		for (let i = M; i >= 0; i--) {
			let s = y[i];
			for (let k = i + 1; k <= M; k++) s -= L[k][i] * a[k];
			a[i] = s / L[i][i];
		}
		const h: number[] = [];
		for (let k = M; k >= 1; k--) h.push(a[k]);
		h.push(2 * a[0]);
		for (let k = 1; k <= M; k++) h.push(a[k]);
		return h;
	};
}
