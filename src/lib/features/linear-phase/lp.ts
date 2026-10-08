/**
 * Linear-phase FIR types, zero symmetry and minimum/maximum-phase conversion.
 * Frequencies normalised to fs (cycles/sample) unless noted.
 */
import { firwin, minimumPhase, sinc, type WindowSpec } from '$lib/dsp/fir';
import { windowValues } from '$lib/dsp/windows';
import { roots } from '$lib/dsp/poly';
import type { Complex } from '$lib/dsp/complex';

export type LpType = 1 | 2 | 3 | 4;
export type SymShape = 'lowpass' | 'highpass' | 'bandpass' | 'bandstop';
export type AntiShape = 'hilbert' | 'differentiator';

export const isAnti = (t: LpType): boolean => t === 3 || t === 4;
export const isOddLength = (t: LpType): boolean => t === 1 || t === 3;
export const TYPE_ROMAN: Record<LpType, string> = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' };

export function typeOf(h: readonly number[], tol = 1e-9): LpType | null {
	const N = h.length;
	const scale = Math.max(1e-300, ...h.map(Math.abs));
	let sym = true;
	let anti = true;
	for (let i = 0; i < N; i++) {
		if (Math.abs(h[i] - h[N - 1 - i]) > tol * scale) sym = false;
		if (Math.abs(h[i] + h[N - 1 - i]) > tol * scale) anti = false;
	}
	if (sym) return N % 2 ? 1 : 2;
	if (anti) return N % 2 ? 3 : 4;
	return null;
}

/** Forced zeros of each type: z = +1 (DC) and/or z = −1 (fs/2). */
export function forcedZeros(t: LpType): { plus1: boolean; minus1: boolean } {
	return { plus1: t === 3 || t === 4, minus1: t === 2 || t === 3 };
}

export interface Capability {
	lowpass: boolean;
	highpass: boolean;
	bandpass: boolean;
	bandstop: boolean;
	hilbert: boolean;
	differentiator: boolean;
}

/** Which classic responses each type can realise (full-band versions for Hilbert/differentiator noted in the UI). */
export function capabilities(t: LpType): Capability {
	const f = forcedZeros(t);
	const anti = isAnti(t);
	return {
		lowpass: !anti && !f.plus1,
		highpass: !anti && !f.minus1,
		bandpass: !anti,
		bandstop: !anti && !f.minus1,
		hilbert: anti,
		differentiator: anti
	};
}

// ---------------------------------------------------------------------------
// Demo taps
// ---------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Random taps with the symmetry of the type: uniform in [−1, 1] under a raised-cosine
 * envelope (which pushes some zeros well off the unit circle, so quadruples show up),
 * normalised to a peak of 1.
 */
export function randomTaps(t: LpType, N: number, seed: number): number[] {
	const r = mulberry32(seed);
	const h = new Array<number>(N).fill(0);
	const anti = isAnti(t);
	for (let i = 0; i < Math.ceil(N / 2); i++) {
		const env = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 1)) / (N + 1));
		const v = (2 * r() - 1) * env;
		h[i] = v;
		h[N - 1 - i] = anti ? -v : v;
	}
	if (anti && N % 2 === 1) h[(N - 1) / 2] = 0;
	const peak = Math.max(...h.map(Math.abs)) || 1;
	return h.map((v) => v / peak);
}

/**
 * Window-method demo filter for a type. Symmetric types get a low/high/band-pass
 * windowed sinc (left unscaled when the band reaches a forced zero, where
 * normalising would divide by ~0); antisymmetric types a windowed Hilbert
 * transformer or differentiator, for either parity.
 */
export function demoTaps(t: LpType, N: number, shape: SymShape | AntiShape, win: WindowSpec): number[] {
	const M = (N - 1) / 2;
	if (!isAnti(t)) {
		const s = shape as SymShape;
		// cutoffs chosen so the ideal response has no zero crossing at the end taps for N ≤ 100
		const cut = s === 'lowpass' ? [0.21] : s === 'highpass' ? [0.29] : [0.145, 0.335];
		const passZero = s === 'lowpass' || s === 'bandstop';
		const reachesNyq = s === 'highpass' || s === 'bandstop';
		return firwin(N, cut, win, passZero, 1, !(reachesNyq && N % 2 === 0));
	}
	const w = windowValues(win.type, N, win.param);
	return Array.from({ length: N }, (_, n) => {
		const m = n - M;
		if (m === 0) return 0;
		if (shape === 'hilbert') return ((1 - Math.cos(Math.PI * m)) / (Math.PI * m)) * w[n]; // −j·sgn(ω)
		return (Math.cos(Math.PI * m) / m - Math.sin(Math.PI * m) / (Math.PI * m * m)) * w[n]; // jω
	});
}

export { sinc };

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/**
 * Real amplitude A(f): H = A·e^{−jωM} (symmetric) or H = j·A·e^{−jωM}
 * (antisymmetric), M = (N−1)/2. Unlike |H| it changes sign.
 */
export function amplitude(h: readonly number[], fNorm: number, anti: boolean): number {
	const M = (h.length - 1) / 2;
	const w = 2 * Math.PI * fNorm;
	let s = 0;
	for (let n = 0; n < h.length; n++) s += h[n] * (anti ? Math.sin((M - n) * w) : Math.cos((M - n) * w));
	return s;
}

export function magnitude(h: readonly number[], fNorm: number): number {
	const w = 2 * Math.PI * fNorm;
	let re = 0;
	let im = 0;
	for (let n = 0; n < h.length; n++) {
		re += h[n] * Math.cos(w * n);
		im -= h[n] * Math.sin(w * n);
	}
	return Math.hypot(re, im);
}

/**
 * Zeros of H(z) = Σ h[n] z^{−n} (roots of h[0] z^{N−1} + … + h[N−1]).
 * Negligible end taps (|h| < 1e-12·max) are dropped first: they are a pure delay,
 * and would otherwise show up as numerical zeros at 0 and ∞.
 */
export function firZeros(h: readonly number[]): Complex[] {
	const peak = Math.max(...h.map(Math.abs));
	let a = 0;
	let b = h.length - 1;
	while (a < b && Math.abs(h[a]) <= 1e-12 * peak) a++;
	while (b > a && Math.abs(h[b]) <= 1e-12 * peak) b--;
	return roots(h.slice(a, b + 1));
}

// ---------------------------------------------------------------------------
// Zero symmetry
// ---------------------------------------------------------------------------

export type ZeroGroupKind = 'quad' | 'unit-pair' | 'real-pair' | 'plus1' | 'minus1' | 'origin' | 'other';

export interface ZeroGroup {
	kind: ZeroGroupKind;
	members: Complex[];
}

const near = (a: Complex, b: Complex, tol: number) => Math.hypot(a.re - b.re, a.im - b.im) <= tol * Math.max(1, Math.hypot(b.re, b.im));

/**
 * Group the zeros of a linear-phase FIR by the symmetry that forces them:
 * quadruples (z, z*, 1/z, 1/z*), conjugate pairs on the unit circle, reciprocal
 * pairs on the real axis, and single zeros at ±1.
 */
export function groupZeros(zs: readonly Complex[], tol = 1e-4): ZeroGroup[] {
	const used = new Array(zs.length).fill(false);
	const groups: ZeroGroup[] = [];
	const take = (target: Complex, from: number): number => {
		let best = -1;
		let bestD = Infinity;
		for (let j = from; j < zs.length; j++) {
			if (used[j]) continue;
			const d = Math.hypot(zs[j].re - target.re, zs[j].im - target.im);
			if (d < bestD) {
				bestD = d;
				best = j;
			}
		}
		if (best >= 0 && near(zs[best], target, tol * 50)) {
			used[best] = true;
			return best;
		}
		return -1;
	};
	for (let i = 0; i < zs.length; i++) {
		if (used[i]) continue;
		used[i] = true;
		const z = zs[i];
		const r = Math.hypot(z.re, z.im);
		const real = Math.abs(z.im) <= tol * Math.max(1, r);
		if (r < 1e-9) {
			groups.push({ kind: 'origin', members: [z] });
			continue;
		}
		if (real && Math.abs(z.re - 1) < tol * 50) {
			groups.push({ kind: 'plus1', members: [z] });
			continue;
		}
		if (real && Math.abs(z.re + 1) < tol * 50) {
			groups.push({ kind: 'minus1', members: [z] });
			continue;
		}
		// tight test: a quadruple just off the circle must not pass as two unit-circle pairs
		const onCircle = Math.abs(r - 1) < 1e-6;
		const inv = { re: z.re / (r * r), im: -z.im / (r * r) }; // 1/z
		if (real) {
			const j = take({ re: 1 / z.re, im: 0 }, 0);
			groups.push({ kind: j >= 0 ? 'real-pair' : 'other', members: j >= 0 ? [z, zs[j]] : [z] });
			continue;
		}
		const conj = { re: z.re, im: -z.im };
		if (onCircle) {
			const j = take(conj, 0);
			groups.push({ kind: j >= 0 ? 'unit-pair' : 'other', members: j >= 0 ? [z, zs[j]] : [z] });
			continue;
		}
		const members = [z];
		for (const target of [conj, inv, { re: inv.re, im: -inv.im }]) {
			const j = take(target, 0);
			if (j >= 0) members.push(zs[j]);
		}
		groups.push({ kind: members.length === 4 ? 'quad' : 'other', members });
	}
	return groups;
}

// ---------------------------------------------------------------------------
// Minimum / maximum phase
// ---------------------------------------------------------------------------

export interface PhaseVersions {
	linear: number[];
	minimum: number[];
	maximum: number[];
}

export function phaseVersions(hLin: readonly number[]): PhaseVersions {
	const minimum = minimumPhase(hLin);
	return { linear: [...hLin], minimum, maximum: [...minimum].reverse() };
}

/** Partial energy Σ_{k≤n} h[k]² / Σ h². */
export function partialEnergy(h: readonly number[]): number[] {
	const total = h.reduce((s, v) => s + v * v, 0) || 1;
	let acc = 0;
	return h.map((v) => (acc += v * v) / total);
}

/** First index where the partial energy reaches `level`. */
export const energyIndex = (pe: readonly number[], level: number): number => {
	const i = pe.findIndex((v) => v >= level - 1e-12);
	return i < 0 ? pe.length - 1 : i;
};

/**
 * Pre-ringing: the deepest dip of the step response below zero before the main
 * peak of the impulse response, relative to the final value of the step.
 */
export function preRinging(h: readonly number[]): number {
	let pk = 0;
	for (let i = 1; i < h.length; i++) if (Math.abs(h[i]) > Math.abs(h[pk])) pk = i;
	const final = h.reduce((a, v) => a + v, 0);
	if (Math.abs(final) < 1e-12) return NaN;
	let s = 0;
	let dip = 0;
	for (let i = 0; i < pk; i++) {
		s += h[i];
		dip = Math.max(dip, -s / final);
	}
	return dip;
}

/** Energy centroid Σ n·h² / Σ h² (samples). */
export function energyCentroid(h: readonly number[]): number {
	let num = 0;
	let den = 0;
	h.forEach((v, n) => {
		num += n * v * v;
		den += v * v;
	});
	return den ? num / den : 0;
}
