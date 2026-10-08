/**
 * Parks–McClellan optimal equiripple FIR design via the Remez exchange
 * algorithm (after McClellan, Parks & Rabiner 1973 and Janovetz's C port).
 *
 * Bands are given in Hz together with the sampling rate. Each band has a
 * linear desired response (d1 at f1 → d2 at f2) and a weight, so
 * differentiators are expressed as a ramp.
 */

export interface RemezBand {
	f1: number;
	f2: number;
	d1: number;
	d2: number;
	weight: number;
}

export type RemezSymmetry = 'even' | 'odd';

export interface RemezOptions {
	/** 'even' → types I/II (ordinary filters), 'odd' → types III/IV (Hilbert, differentiators). */
	symmetry?: RemezSymmetry;
	gridDensity?: number;
	maxIterations?: number;
	/** Weight error as W/f in bands with a ramp desired response (differentiator mode). */
	relativeWeighting?: boolean;
}

export interface RemezResult {
	h: number[];
	/** Final weighted ripple δ. */
	delta: number;
	iterations: number;
	converged: boolean;
	/** Extremal frequencies of the final iteration (Hz). */
	extremals: number[];
}

export function remez(
	numtaps: number,
	bandsHz: RemezBand[],
	fs: number,
	opts: RemezOptions = {}
): RemezResult {
	const symmetry = opts.symmetry ?? 'even';
	const density = opts.gridDensity ?? 16;
	const maxIter = opts.maxIterations ?? 60;
	const odd = numtaps % 2 === 1;
	// number of cosine (or sine) basis functions
	let r = Math.floor(numtaps / 2);
	if (odd && symmetry === 'even') r++;
	const bands = bandsHz
		.map((b) => ({ ...b, f1: b.f1 / fs, f2: b.f2 / fs }))
		.sort((a, b) => a.f1 - b.f1);

	// ---- dense grid ------------------------------------------------------
	const delf = 0.5 / (density * r);
	// frequencies where the basis factor vanishes must be avoided
	const avoidZero = symmetry === 'odd';
	const avoidNyq = (symmetry === 'even' && !odd) || (symmetry === 'odd' && odd);
	const grid: number[] = [];
	const D: number[] = [];
	const W: number[] = [];
	for (const b of bands) {
		let lo = b.f1;
		let hi = b.f2;
		if (avoidZero && lo < delf) lo = delf;
		if (avoidNyq && hi > 0.5 - delf) hi = 0.5 - delf;
		if (hi < lo) continue;
		const k = Math.max(1, Math.round((hi - lo) / delf));
		for (let i = 0; i <= k; i++) {
			const f = lo + ((hi - lo) * i) / k;
			const t = b.f2 === b.f1 ? 0 : (f - b.f1) / (b.f2 - b.f1);
			const d = b.d1 + t * (b.d2 - b.d1);
			let w = b.weight;
			if (opts.relativeWeighting && Math.abs(b.d2 - b.d1) > 0 && Math.abs(d) > 1e-4)
				w = b.weight / Math.abs(d);
			grid.push(f);
			D.push(d);
			W.push(w);
		}
	}
	const G = grid.length;
	if (G < r + 1) throw new Error('Grid too small: widen the bands or reduce the number of taps.');

	// absorb the basis factor Q(f) into D and W: A(f) = Q(f)·P(f)
	const Q = (f: number) => {
		if (symmetry === 'even') return odd ? 1 : Math.cos(Math.PI * f);
		return odd ? Math.sin(2 * Math.PI * f) : Math.sin(Math.PI * f);
	};
	const Dp = new Float64Array(G);
	const Wp = new Float64Array(G);
	for (let i = 0; i < G; i++) {
		const q = Q(grid[i]);
		Dp[i] = D[i] / q;
		Wp[i] = W[i] * q;
	}

	// initial extremals: evenly spaced
	let ext: number[] = Array.from({ length: r + 1 }, (_, i) => Math.floor((i * (G - 1)) / r));
	const x = new Float64Array(r + 1);
	const ad = new Float64Array(r + 1);
	const y = new Float64Array(r + 1);
	let delta = 0;
	const E = new Float64Array(G);
	const xg = grid.map((f) => Math.cos(2 * Math.PI * f));

	const calcParms = () => {
		for (let i = 0; i <= r; i++) x[i] = xg[ext[i]];
		const ld = Math.floor((r - 1) / 15) + 1;
		for (let i = 0; i <= r; i++) {
			let denom = 1;
			const xi = x[i];
			for (let j = 0; j < ld; j++)
				for (let k = j; k <= r; k += ld) if (k !== i) denom *= 2 * (xi - x[k]);
			if (Math.abs(denom) < 1e-300) denom = 1e-300;
			ad[i] = 1 / denom;
		}
		let numer = 0;
		let den = 0;
		let sign = 1;
		for (let i = 0; i <= r; i++) {
			numer += ad[i] * Dp[ext[i]];
			den += (sign * ad[i]) / Wp[ext[i]];
			sign = -sign;
		}
		delta = numer / den;
		sign = 1;
		for (let i = 0; i <= r; i++) {
			y[i] = Dp[ext[i]] - (sign * delta) / Wp[ext[i]];
			sign = -sign;
		}
	};

	const computeA = (xc: number) => {
		let numer = 0;
		let denom = 0;
		for (let i = 0; i <= r; i++) {
			let cc = xc - x[i];
			if (Math.abs(cc) < 1e-12) return y[i];
			cc = ad[i] / cc;
			denom += cc;
			numer += cc * y[i];
		}
		return numer / denom;
	};

	let iterations = 0;
	let converged = false;
	for (; iterations < maxIter; iterations++) {
		calcParms();
		for (let i = 0; i < G; i++) E[i] = Wp[i] * (Dp[i] - computeA(xg[i]));
		const found = searchExtremals(E, r);
		if (found.length < r + 1) break;
		ext = found;
		let mn = Infinity;
		let mx = 0;
		for (const e of ext) {
			const v = Math.abs(E[e]);
			mn = Math.min(mn, v);
			mx = Math.max(mx, v);
		}
		if (mx > 0 && (mx - mn) / mx < 1e-4) {
			converged = true;
			iterations++;
			break;
		}
	}
	calcParms();

	// frequency-sample A(f) at k/N and invert
	const N = numtaps;
	const A = new Float64Array(Math.floor(N / 2) + 1);
	for (let i = 0; i <= Math.floor(N / 2); i++) {
		const f = i / N;
		A[i] = computeA(Math.cos(2 * Math.PI * f)) * Q(f);
	}
	const h = freqSample(N, A, symmetry);
	if (!h.every(Number.isFinite) || !h.some((v) => v !== 0))
		throw new Error(
			'The Remez exchange collapsed (the optimal ripple is beyond double precision, or the bands are infeasible). Use fewer taps or relax the specification.'
		);
	return {
		h,
		delta: Math.abs(delta),
		iterations,
		converged,
		extremals: ext.map((e) => grid[e] * fs)
	};
}

/** Locate alternating extrema of the error; keep exactly r+1 of them. */
function searchExtremals(E: Float64Array, r: number): number[] {
	const G = E.length;
	let found: number[] = [];
	if ((E[0] > 0 && E[0] > E[1]) || (E[0] < 0 && E[0] < E[1])) found.push(0);
	for (let i = 1; i < G - 1; i++) {
		if (
			(E[i] >= E[i - 1] && E[i] > E[i + 1] && E[i] > 0) ||
			(E[i] <= E[i - 1] && E[i] < E[i + 1] && E[i] < 0)
		)
			found.push(i);
	}
	const j = G - 1;
	if ((E[j] > 0 && E[j] > E[j - 1]) || (E[j] < 0 && E[j] < E[j - 1])) found.push(j);
	// enforce alternation: within each run of same-sign extrema keep the largest
	const alt: number[] = [];
	for (const idx of found) {
		if (alt.length && Math.sign(E[alt[alt.length - 1]]) === Math.sign(E[idx])) {
			if (Math.abs(E[idx]) > Math.abs(E[alt[alt.length - 1]])) alt[alt.length - 1] = idx;
		} else alt.push(idx);
	}
	found = alt;
	// remove surplus from the ends (keeps alternation intact)
	while (found.length > r + 1) {
		if (Math.abs(E[found[0]]) < Math.abs(E[found[found.length - 1]])) found.shift();
		else found.pop();
	}
	return found;
}

function freqSample(N: number, A: Float64Array, symmetry: RemezSymmetry): number[] {
	const M = (N - 1) / 2;
	const h: number[] = new Array(N).fill(0);
	const odd = N % 2 === 1;
	for (let n = 0; n < N; n++) {
		const xx = (2 * Math.PI * (n - M)) / N;
		let val: number;
		if (symmetry === 'even') {
			val = A[0];
			const kmax = odd ? M : N / 2 - 1;
			for (let k = 1; k <= kmax; k++) val += 2 * A[k] * Math.cos(xx * k);
		} else {
			val = odd ? 0 : A[N / 2] * Math.sin(Math.PI * (n - M));
			const kmax = odd ? M : N / 2 - 1;
			for (let k = 1; k <= kmax; k++) val += 2 * A[k] * Math.sin(xx * k);
		}
		h[n] = val / N;
	}
	return h;
}
