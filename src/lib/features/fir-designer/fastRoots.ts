/**
 * Fast polynomial roots for FIR zero plots (local workaround).
 *
 * The shared `roots()` (Aberth–Ehrlich) allocates a complex object per
 * operation and only stops when every root moves less than 1e-15 relative,
 * which equiripple/windowed FIR polynomials rarely satisfy — so it runs its full
 * 800 iterations (≈ 0.3 s at degree 57, > 1 s at degree 127). This version uses
 * flat arrays, freezes each root once it has converged (relative step < 1e-13)
 * and polishes with Newton steps; results agree with `roots()` to ~1e-9.
 */
import type { Complex } from '$lib/dsp/complex';
import { cleanRealRoots } from '$lib/dsp/poly';

export function fastRoots(coeffs: readonly number[], maxIter = 500): Complex[] {
	let a = 0;
	let b = coeffs.length - 1;
	while (a <= b && coeffs[a] === 0) a++;
	const out: Complex[] = [];
	while (b > a && coeffs[b] === 0) {
		out.push({ re: 0, im: 0 });
		b--;
	}
	const p = coeffs.slice(a, b + 1);
	const n = p.length - 1;
	if (n < 1) return out;
	const lead = p[0];
	const c = p.map((v) => v / lead); // monic, real
	if (n === 1) {
		out.push({ re: -c[1], im: 0 });
		return out;
	}
	const zr = new Float64Array(n);
	const zi = new Float64Array(n);
	const done = new Uint8Array(n);
	const r0 = Math.pow(Math.abs(c[n]), 1 / n) || 1;
	for (let k = 0; k < n; k++) {
		const t = (2 * Math.PI * k) / n + 0.4;
		zr[k] = r0 * Math.cos(t);
		zi[k] = r0 * Math.sin(t);
	}
	// p(z) and p'(z) by Horner
	const evalP = (xr: number, xi: number): [number, number, number, number] => {
		let pr = 1;
		let pi = 0;
		let dr = 0;
		let di = 0;
		for (let k = 1; k <= n; k++) {
			// d = d·x + p
			const ndr = dr * xr - di * xi + pr;
			const ndi = dr * xi + di * xr + pi;
			dr = ndr;
			di = ndi;
			// p = p·x + c[k]
			const npr = pr * xr - pi * xi + c[k];
			const npi = pr * xi + pi * xr;
			pr = npr;
			pi = npi;
		}
		return [pr, pi, dr, di];
	};
	let remaining = n;
	for (let it = 0; it < maxIter && remaining > 0; it++) {
		for (let i = 0; i < n; i++) {
			if (done[i]) continue;
			const [pr, pi, dr, di] = evalP(zr[i], zi[i]);
			if (pr === 0 && pi === 0) {
				done[i] = 1;
				remaining--;
				continue;
			}
			// ratio = p / p'
			const dd = dr * dr + di * di;
			if (dd === 0) continue;
			const rr = (pr * dr + pi * di) / dd;
			const ri = (pi * dr - pr * di) / dd;
			// sum = Σ 1/(z_i − z_j)
			let sr = 0;
			let si = 0;
			for (let j = 0; j < n; j++) {
				if (j === i) continue;
				const er = zr[i] - zr[j];
				const ei = zi[i] - zi[j];
				const e2 = er * er + ei * ei;
				if (e2 === 0) continue;
				sr += er / e2;
				si -= ei / e2;
			}
			// w = ratio / (1 − ratio·sum)
			const den_r = 1 - (rr * sr - ri * si);
			const den_i = -(rr * si + ri * sr);
			const d2 = den_r * den_r + den_i * den_i;
			if (d2 === 0) continue;
			const wr = (rr * den_r + ri * den_i) / d2;
			const wi = (ri * den_r - rr * den_i) / d2;
			if (!Number.isFinite(wr) || !Number.isFinite(wi)) continue;
			zr[i] -= wr;
			zi[i] -= wi;
			if (Math.hypot(wr, wi) <= 1e-13 * Math.max(1, Math.hypot(zr[i], zi[i]))) {
				done[i] = 1;
				remaining--;
			}
		}
	}
	// Newton polish (accept only improving steps)
	for (let i = 0; i < n; i++) {
		for (let k = 0; k < 2; k++) {
			const [pr, pi, dr, di] = evalP(zr[i], zi[i]);
			const dd = dr * dr + di * di;
			if (dd === 0) break;
			const sr = (pr * dr + pi * di) / dd;
			const si = (pi * dr - pr * di) / dd;
			const [qr, qi] = evalP(zr[i] - sr, zi[i] - si);
			if (Math.hypot(qr, qi) <= Math.hypot(pr, pi)) {
				zr[i] -= sr;
				zi[i] -= si;
			} else break;
		}
		if (Number.isFinite(zr[i]) && Number.isFinite(zi[i])) out.push({ re: zr[i], im: zi[i] });
	}
	return cleanRealRoots(out);
}

/** Zeros of an FIR H(z) = Σ h[n] z^{−n}, ignoring negligible end taps (a pure delay). */
export function firZerosFast(h: readonly number[]): Complex[] {
	const peak = Math.max(...h.map(Math.abs));
	let a = 0;
	let b = h.length - 1;
	while (a < b && Math.abs(h[a]) <= 1e-12 * peak) a++;
	while (b > a && Math.abs(h[b]) <= 1e-12 * peak) b--;
	return fastRoots(h.slice(a, b + 1));
}
