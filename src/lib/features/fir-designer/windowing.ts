/**
 * Fast, cached windows for the FIR designer's length search.
 *
 * The shared `chebwin` evaluates its DFT with trigonometric calls in the inner
 * loop (O(N²) with ~2N² cos/sin), which makes a length search with a long
 * Dolph–Chebyshev window take hundreds of milliseconds. `chebwinFast` runs the
 * same algorithm with a cosine table (still O(N²) but only multiply-adds) and
 * matches the shared implementation to rounding error. Other windows come from
 * the shared `windowValues`. Results are memoised.
 */
import { windowValues, windowInfo, type WindowType } from '$lib/dsp/windows';
import { sinc, type WindowSpec } from '$lib/dsp/fir';

export function chebwinFast(M: number, at: number): number[] {
	if (M <= 1) return [1];
	const order = M - 1;
	const beta = Math.cosh(Math.acosh(Math.pow(10, Math.abs(at) / 20)) / order);
	const p = new Float64Array(M);
	for (let k = 0; k < M; k++) {
		const x = beta * Math.cos((Math.PI * k) / M);
		if (x > 1) p[k] = Math.cosh(order * Math.acosh(x));
		else if (x < -1) p[k] = (2 * (M % 2) - 1) * Math.cosh(order * Math.acosh(-x));
		else p[k] = Math.cos(order * Math.acos(x));
	}
	let w: number[];
	if (M % 2) {
		// Re Σ p[k] e^{−j2πmk/M}
		const tab = new Float64Array(M);
		for (let i = 0; i < M; i++) tab[i] = Math.cos((2 * Math.PI * i) / M);
		const n = (M + 1) / 2;
		const half = new Array<number>(n);
		for (let m = 0; m < n; m++) {
			let s = 0;
			let idx = 0;
			for (let k = 0; k < M; k++) {
				s += p[k] * tab[idx];
				idx += m;
				if (idx >= M) idx -= M;
			}
			half[m] = s;
		}
		w = [...half.slice(1).reverse(), ...half];
	} else {
		// Re Σ p[k] e^{jπk/M} e^{−j2πmk/M} = Σ p[k] cos(πk(1−2m)/M)
		const L = 2 * M;
		const tab = new Float64Array(L);
		for (let i = 0; i < L; i++) tab[i] = Math.cos((Math.PI * i) / M);
		const n = M / 2 + 1;
		const vals = new Array<number>(n);
		for (let m = 1; m < n; m++) {
			const stepRaw = (((1 - 2 * m) % L) + L) % L;
			let s = 0;
			let idx = 0;
			for (let k = 0; k < M; k++) {
				s += p[k] * tab[idx];
				idx += stepRaw;
				if (idx >= L) idx -= L;
			}
			vals[m] = s;
		}
		const r = vals.slice(1, n);
		w = [...[...r].reverse(), ...r];
	}
	let mx = -Infinity;
	for (const v of w) if (v > mx) mx = v;
	return w.map((v) => v / mx);
}

const cache = new Map<string, number[]>();
const MAX_ENTRIES = 96;

/** Symmetric window values, memoised (Dolph–Chebyshev via the fast path). */
export function cachedWindow(type: WindowType, N: number, param?: number): number[] {
	const p = windowInfo(type).param ? (param ?? windowInfo(type).param!.default) : undefined;
	const key = `${type}|${N}|${p}`;
	const hit = cache.get(key);
	if (hit) {
		cache.delete(key);
		cache.set(key, hit);
		return hit;
	}
	const w = type === 'chebyshev' ? chebwinFast(N, p!) : windowValues(type, N, p);
	cache.set(key, w);
	if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
	return w;
}

/** Same result as firwin(numtaps, cutoffs, window, passZero, fs), using the cached windows. */
export function firwinFast(numtaps: number, cutoffs: number[], window: WindowSpec, passZero: boolean, fs: number): number[] {
	const nyq = fs / 2;
	const c = cutoffs.map((f) => f / nyq);
	const passNyquist = (c.length % 2 === 1) !== passZero;
	const edges = [...(passZero ? [0] : []), ...c, ...(passNyquist ? [1] : [])];
	const alpha = (numtaps - 1) / 2;
	const h = new Array<number>(numtaps).fill(0);
	for (let b = 0; b + 1 < edges.length; b += 2) {
		const left = edges[b];
		const right = edges[b + 1];
		for (let n = 0; n < numtaps; n++) {
			const m = n - alpha;
			h[n] += right * sinc(right * m) - left * sinc(left * m);
		}
	}
	const w = cachedWindow(window.type, numtaps, window.param);
	for (let n = 0; n < numtaps; n++) h[n] *= w[n];
	if (edges.length >= 2) {
		const left = edges[0];
		const right = edges[1];
		const sf = left === 0 ? 0 : right === 1 ? 1 : (left + right) / 2;
		let s = 0;
		for (let n = 0; n < numtaps; n++) s += h[n] * Math.cos(Math.PI * (n - alpha) * sf);
		if (s !== 0) for (let n = 0; n < numtaps; n++) h[n] /= s;
	}
	return h;
}
