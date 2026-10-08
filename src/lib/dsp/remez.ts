/**
 * Parks–McClellan optimal equiripple FIR design via the Remez exchange
 * algorithm (after McClellan, Parks & Rabiner 1973 and Janovetz's C port).
 * The exchange keeps the levelled ripple |δ| growing from one iteration to the
 * next, and the final taps are measured against it, so a failed design throws
 * instead of returning taps whose real error is far above δ.
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
	/**
	 * Final weighted ripple δ: the equiripple level when converged. When the exchange
	 * stopped early this is the measured peak weighted error of the returned taps (on the
	 * grid), so it does not understate their error.
	 */
	delta: number;
	/** Peak weighted error |W·(D − A)| of the returned taps on the dense grid. */
	maxError?: number;
	/**
	 * Levelled ripple of the final reference: a lower bound on the optimal weighted ripple
	 * (de la Vallée Poussin). Equal to δ when converged.
	 */
	deltaBound?: number;
	iterations: number;
	converged: boolean;
	/** Extremal frequencies of the final iteration (Hz). */
	extremals: number[];
}

/**
 * A design that did not converge is still returned when its peak error is within this
 * factor of the levelled δ (a lower bound on the optimum, by de la Vallée Poussin's
 * theorem), i.e. provably within 6 dB of optimal, or when its deviation from the desired
 * response is below PRECISION_FLOOR (−160 dB: beyond what the exchange resolves in double
 * precision, but harmless). Anything else is a failed exchange and throws rather than
 * return misleading taps.
 */
const USABLE_RATIO = 2;
const PRECISION_FLOOR = 1e-8;
const EPS = 1.1e-16;
const TWO_500 = Math.pow(2, 500);
const TWO_M500 = Math.pow(2, -500);

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
	// band index of every grid point: extrema are searched within a band, so each band
	// edge is a candidate in its own right
	const bandOf: number[] = [];
	bands.forEach((b, bi) => {
		let lo = b.f1;
		let hi = b.f2;
		if (avoidZero && lo < delf) lo = delf;
		if (avoidNyq && hi > 0.5 - delf) hi = 0.5 - delf;
		if (hi < lo) return;
		const k = Math.max(1, Math.round((hi - lo) / delf));
		for (let i = 0; i <= k; i++) {
			const f = lo + ((hi - lo) * i) / k;
			// a band starting where the previous one ends must not repeat that frequency
			if (grid.length && f <= grid[grid.length - 1]) continue;
			const t = b.f2 === b.f1 ? 0 : (f - b.f1) / (b.f2 - b.f1);
			const d = b.d1 + t * (b.d2 - b.d1);
			let w = b.weight;
			if (opts.relativeWeighting && Math.abs(b.d2 - b.d1) > 0 && Math.abs(d) > 1e-4)
				w = b.weight / Math.abs(d);
			grid.push(f);
			D.push(d);
			W.push(w);
			bandOf.push(bi);
		}
	});
	const G = grid.length;
	if (G < r + 1) throw new Error('Grid too small: widen the bands or reduce the number of taps.');

	// absorb the basis factor Q(f) into D and W: A(f) = Q(f)·P(f)
	const Q = (f: number) => {
		if (symmetry === 'even') return odd ? 1 : Math.cos(Math.PI * f);
		return odd ? Math.sin(2 * Math.PI * f) : Math.sin(Math.PI * f);
	};
	const Dp = new Float64Array(G);
	const Wp = new Float64Array(G);
	let scale = 0;
	for (let i = 0; i < G; i++) {
		const q = Q(grid[i]);
		Dp[i] = D[i] / q;
		Wp[i] = W[i] * q;
		scale = Math.max(scale, Math.abs(W[i] * D[i]));
	}
	// weighted errors below this are rounding noise of the barycentric evaluation
	const noise = 1e-15 * (scale || 1);

	let ext = initialReference(bandOf, r);
	const x = new Float64Array(r + 1);
	const ad = new Float64Array(r + 1);
	const adExp = new Float64Array(r + 1);
	const y = new Float64Array(r + 1);
	let delta = 0;
	const E = new Float64Array(G);
	const xg = grid.map((f) => Math.cos(2 * Math.PI * f));

	// Π 2(xc − x_k) over k ≠ skip, returned as a mantissa with its power of two in `pe`
	// (renormalised as it goes, so long products neither overflow nor underflow)
	let pe = 0;
	const product = (xc: number, skip: number) => {
		let m = 1;
		let e = 0;
		for (let k = 0; k <= r; k++) {
			if (k === skip) continue;
			m *= 2 * (xc - x[k]);
			if ((k & 15) === 15) {
				const am = Math.abs(m);
				if (am > 1e150) {
					m *= TWO_M500;
					e += 500;
				} else if (am < 1e-150) {
					m *= TWO_500;
					e -= 500;
				}
			}
		}
		const t = Math.floor(Math.log2(Math.abs(m)));
		pe = e + t;
		return m * Math.pow(2, -t);
	};

	// barycentric weights ad_i = 1/Π 2(x_i − x_k), all scaled by the same 2^−emin
	let emin = 0;
	const calcParms = () => {
		for (let i = 0; i <= r; i++) x[i] = xg[ext[i]];
		emin = Infinity;
		for (let i = 0; i <= r; i++) {
			ad[i] = 1 / product(x[i], i);
			adExp[i] = pe;
			emin = Math.min(emin, pe);
		}
		for (let i = 0; i <= r; i++) ad[i] *= Math.pow(2, emin - adExp[i]);
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

	// Interpolant P(xc) through the reference. The usual (second) barycentric form divides
	// by Σ ad_i/(xc − x_i), which cancels where the reference leaves xc unconstrained (wide
	// transition bands); there the product (first) form P = Π 2(xc − x_k)/2 · Σ ad_i·y_i/(xc − x_i)
	// is used instead. With `estimate`, `rounding` receives a bound on its rounding error.
	let rounding = 0;
	const computeA = (xc: number, estimate = false) => {
		let numer = 0;
		let denom = 0;
		let sb = 0;
		let sa = 0;
		for (let i = 0; i <= r; i++) {
			const d = xc - x[i];
			if (Math.abs(d) < 1e-12) {
				rounding = 0;
				return y[i];
			}
			const cc = ad[i] / d;
			denom += cc;
			numer += cc * y[i];
			sb += Math.abs(cc);
		}
		if (estimate) for (let i = 0; i <= r; i++) sa += Math.abs((ad[i] / (xc - x[i])) * y[i]);
		if (sb < 1e6 * Math.abs(denom)) {
			const a = numer / denom;
			rounding = (EPS * (sa + Math.abs(a) * sb)) / Math.abs(denom);
			return a;
		}
		const f = product(xc, -1) * Math.pow(2, pe - 1 - emin);
		rounding = EPS * sa * Math.abs(f);
		return numer * f;
	};
	// rounding error of E at grid point i (only needed for candidate extrema)
	const noiseAt = (i: number) => {
		computeA(xg[i], true);
		return Math.abs(Wp[i]) * rounding;
	};

	let iterations = 0;
	let converged = false;
	// the reference whose interpolant had the smallest peak error so far
	let best = { err: Infinity, ext };
	// previous reference, its δ and the location of its peak error
	let prev: { ext: number[]; delta: number; at: number; e: number } | null = null;
	for (; iterations < maxIter; iterations++) {
		calcParms();
		// |δ| grows with every exchange (de la Vallée Poussin). If it fell, the error curve
		// the exchange was based on was dominated by rounding: go back and only swap the
		// worst point into the previous reference.
		if (prev && Math.abs(delta) < Math.abs(prev.delta) * (1 - 1e-9)) {
			ext = singleExchange(prev.ext, prev.delta, prev.at, prev.e);
			calcParms();
		}
		let peak = 0;
		let at = 0;
		// an overflowing interpolant: this reference can be neither the best nor converged
		let broken = false;
		for (let i = 0; i < G; i++) {
			const e = Wp[i] * (Dp[i] - computeA(xg[i]));
			if (!Number.isFinite(e)) broken = true;
			// 0/0 carries no information
			E[i] = Number.isNaN(e) ? 0 : e;
			if (Math.abs(E[i]) > peak) {
				peak = Math.abs(E[i]);
				at = i;
			}
		}
		// on the reference E = ±δ exactly; keep the alternating sign even when rounding loses it
		for (let i = 0; i <= r; i++) E[ext[i]] = (i % 2 ? -1 : 1) * (delta || Number.MIN_VALUE);
		if (!broken && peak < best.err) best = { err: peak, ext };
		prev = { ext, delta, at, e: E[at] };
		ext = searchExtremals(E, noiseAt, r, bandOf, Math.max(Math.abs(delta), noise), ext);
		let mn = Infinity;
		let mx = 0;
		for (const e of ext) {
			const v = Math.abs(E[e]);
			mn = Math.min(mn, v);
			mx = Math.max(mx, v);
		}
		if (!broken && mx > 0 && (mx - mn) / mx < 1e-4) {
			converged = true;
			iterations++;
			break;
		}
	}
	// a cycling or stalled exchange: fall back to its best reference
	if (!converged) ext = best.ext;
	calcParms();

	// frequency-sample A(f) at k/N and invert
	const N = numtaps;
	const A = new Float64Array(Math.floor(N / 2) + 1);
	for (let i = 0; i <= Math.floor(N / 2); i++) {
		const f = i / N;
		const q = Q(f);
		A[i] = q === 0 ? 0 : computeA(Math.cos(2 * Math.PI * f)) * q;
	}
	const h = freqSample(N, A, symmetry);
	const collapsed =
		'The Remez exchange collapsed: at this length it runs out of double precision (the optimal ripple is tiny, or a transition band is very wide). Use fewer taps or relax the specification.';
	if (!h.every(Number.isFinite) || !h.some((v) => v !== 0)) throw new Error(collapsed);

	// measure the taps themselves: the levelled δ is only a lower bound on the optimum
	const { maxError, maxDev } = tapError(h, symmetry, grid, D, W);
	const level = Math.abs(delta);
	if (!(maxError <= level * (1 + 1e-3) + noise)) converged = false;
	const dScale = D.reduce((m, d) => Math.max(m, Math.abs(d)), 0) || 1;
	const usable = maxError <= level * USABLE_RATIO || maxDev <= PRECISION_FLOOR * dScale;
	if (!converged && !usable)
		throw new Error(
			level < PRECISION_FLOOR * (scale || 1)
				? collapsed
				: `The Remez exchange did not converge: after ${iterations} iterations the peak weighted error of the taps (${maxError.toPrecision(3)}) is far above the equiripple level δ = ${level.toPrecision(3)}. Use fewer taps or wider transition bands.`
		);
	return {
		h,
		delta: converged ? level : Math.max(level, maxError),
		maxError,
		deltaBound: level,
		iterations,
		converged,
		extremals: ext.map((e) => grid[e] * fs)
	};
}

/**
 * Initial reference: r+1 grid points shared among the bands in proportion to their
 * size and spread evenly within each band, edges included. Plain even spacing over the
 * whole grid can leave a band edge next to a transition band without a point; the
 * first interpolant is then unconstrained there and its error is mostly rounding.
 */
function initialReference(bandOf: number[], r: number): number[] {
	const G = bandOf.length;
	const n = r + 1;
	const spans: [number, number][] = [];
	for (let i = 0; i < G; i++) {
		if (i === 0 || bandOf[i] !== bandOf[i - 1]) spans.push([i, i]);
		else spans[spans.length - 1][1] = i;
	}
	if (spans.length > n) return Array.from({ length: n }, (_, i) => Math.floor((i * (G - 1)) / r));
	const size = spans.map(([a, b]) => b - a + 1);
	const quota = size.map((s) => (n * s) / G);
	const cnt = quota.map((q, b) => Math.min(size[b], Math.max(1, Math.floor(q))));
	let total = cnt.reduce((a, c) => a + c, 0);
	// largest remainder: add (or remove) points where the quota is least (most) met
	while (total !== n) {
		const step = total < n ? 1 : -1;
		let pick = -1;
		for (let b = 0; b < cnt.length; b++) {
			if (step > 0 ? cnt[b] >= size[b] : cnt[b] <= 1) continue;
			if (pick < 0 || (quota[b] - cnt[b]) * step > (quota[pick] - cnt[pick]) * step) pick = b;
		}
		cnt[pick] += step;
		total += step;
	}
	const ext: number[] = [];
	spans.forEach(([a, b], k) => {
		const c = cnt[k];
		if (c === 1) ext.push(a + Math.floor((b - a) / 2));
		else for (let j = 0; j < c; j++) ext.push(a + Math.round((j * (b - a)) / (c - 1)));
	});
	return ext;
}

/**
 * Pick the next reference: r+1 alternating extrema of the weighted error E.
 *
 * Candidates are the local extrema of E within each band (band edges included) whose
 * |E| reaches the current level δ and its own rounding error, plus the current reference
 * points (|E| = δ there, so at least r+1 alternating candidates always exist). Of each run of same-sign candidates
 * the largest is kept. Surplus extrema are then removed smallest first: deleting an
 * interior one leaves two same-sign neighbours, of which the smaller goes too, so
 * alternation holds and the global maximum is never dropped. A single surplus is
 * removed from whichever end is smaller. With every new point at |E| ≥ δ, the levelled
 * ripple grows monotonically (de la Vallée Poussin), which is what makes the exchange
 * converge.
 */
function searchExtremals(
	E: Float64Array,
	noiseAt: (i: number) => number,
	r: number,
	bandOf: number[],
	level: number,
	prev: number[]
): number[] {
	const G = E.length;
	const cand: number[] = [];
	let p = 0;
	for (let i = 0; i < G; i++) {
		const e = E[i];
		const left = i > 0 && bandOf[i - 1] === bandOf[i] ? E[i - 1] : NaN;
		const right = i < G - 1 && bandOf[i + 1] === bandOf[i] ? E[i + 1] : NaN;
		// on a plateau the last point counts (NaN comparisons are false: no neighbour)
		const isExt =
			e > 0 ? !(left > e) && !(right >= e) : e < 0 ? !(left < e) && !(right <= e) : false;
		const isPrev = p < prev.length && prev[p] === i;
		if (isPrev) p++;
		if (isPrev || (isExt && Math.abs(e) >= level && !(Math.abs(e) < noiseAt(i)))) cand.push(i);
	}
	// enforce alternation: within each run of same-sign candidates keep the largest
	const alt: number[] = [];
	const pos = (i: number) => E[i] > 0;
	for (const idx of cand) {
		const last = alt[alt.length - 1];
		if (alt.length && pos(last) === pos(idx)) {
			if (Math.abs(E[idx]) > Math.abs(E[last])) alt[alt.length - 1] = idx;
		} else alt.push(idx);
	}
	while (alt.length > r + 1) {
		if (alt.length === r + 2) {
			if (Math.abs(E[alt[0]]) < Math.abs(E[alt[alt.length - 1]])) alt.shift();
			else alt.pop();
			break;
		}
		let k = 0;
		for (let i = 1; i < alt.length; i++) if (Math.abs(E[alt[i]]) < Math.abs(E[alt[k]])) k = i;
		if (k === 0 || k === alt.length - 1) alt.splice(k, 1);
		else alt.splice(Math.abs(E[alt[k - 1]]) < Math.abs(E[alt[k + 1]]) ? k - 1 : k, 2);
	}
	return alt;
}

/**
 * Remez's single exchange: swap grid point j (error e) into the reference in place of the
 * neighbour whose error has the same sign, or shift the reference when j lies beyond an end
 * with the opposite sign. Alternation is kept and |δ| cannot decrease.
 */
function singleExchange(ref: number[], delta: number, j: number, e: number): number[] {
	const out = ref.slice();
	if (out.includes(j)) return out;
	// sign of the error at reference point i: E = ±δ alternating
	const sg = (i: number) => (i % 2 ? -1 : 1) * (delta < 0 ? -1 : 1);
	const s = e < 0 ? -1 : 1;
	let p = 0;
	while (p < out.length && out[p] < j) p++;
	if (p === 0) {
		if (sg(0) === s) out[0] = j;
		else {
			out.pop();
			out.unshift(j);
		}
	} else if (p === out.length) {
		if (sg(p - 1) === s) out[p - 1] = j;
		else {
			out.shift();
			out.push(j);
		}
	} else if (sg(p - 1) === s) out[p - 1] = j;
	else out[p] = j;
	return out;
}

/** Peak weighted error max |W·(D − A)| and peak deviation max |D − A| of taps h on the grid. */
function tapError(
	h: number[],
	symmetry: RemezSymmetry,
	grid: number[],
	D: number[],
	W: number[]
): { maxError: number; maxDev: number } {
	const N = h.length;
	const M = (N - 1) / 2;
	const half = Math.floor(N / 2);
	let maxError = 0;
	let maxDev = 0;
	// offsets M − n of the folded pairs run t0, t0 + 1, … for n = half − 1 … 0
	const t0 = M - (half - 1);
	for (let g = 0; g < grid.length; g++) {
		const w = 2 * Math.PI * grid[g];
		const cw = Math.cos(w);
		const sw = Math.sin(w);
		let c = Math.cos(w * t0);
		let sn = Math.sin(w * t0);
		let a = symmetry === 'even' && N % 2 === 1 ? h[half] : 0;
		// fold the (anti)symmetric pairs: A = Σ 2·h[n]·cos(ω(M−n)) or Σ 2·h[n]·sin(ω(n−M)),
		// stepping cos/sin of ω(M−n) by angle addition
		for (let n = half - 1; n >= 0; n--) {
			a += 2 * h[n] * (symmetry === 'even' ? c : -sn);
			const c2 = c * cw - sn * sw;
			sn = sn * cw + c * sw;
			c = c2;
		}
		const dev = Math.abs(D[g] - a);
		maxDev = Math.max(maxDev, dev);
		maxError = Math.max(maxError, W[g] * dev);
	}
	return { maxError, maxDev };
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
