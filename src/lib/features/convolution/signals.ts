/**
 * Convolution visualiser: input signals, impulse responses, full linear
 * convolution, and helpers for showing the sum term by term.
 */
import { firwin } from '$lib/dsp/fir';
import { windowValues } from '$lib/dsp/windows';

export type XKind =
	'impulse' | 'step' | 'rect' | 'train' | 'ramp' | 'sine' | 'noisyStep' | 'random';
export type HKind =
	'movingAverage' | 'expDecay' | 'difference' | 'hann' | 'lowpass7' | 'echo' | 'custom';

export const X_KINDS: { id: XKind; name: string }[] = [
	{ id: 'impulse', name: 'Unit impulse δ[n]' },
	{ id: 'step', name: 'Unit step u[n]' },
	{ id: 'rect', name: 'Rectangular pulse' },
	{ id: 'train', name: 'Impulse train' },
	{ id: 'ramp', name: 'Ramp' },
	{ id: 'sine', name: 'Sinusoid' },
	{ id: 'noisyStep', name: 'Noisy step' },
	{ id: 'random', name: 'Random' }
];

export const H_KINDS: { id: HKind; name: string }[] = [
	{ id: 'movingAverage', name: 'Moving average' },
	{ id: 'expDecay', name: 'Exponential decay' },
	{ id: 'difference', name: 'First difference' },
	{ id: 'hann', name: 'Hann smoother' },
	{ id: 'lowpass7', name: '7-tap low-pass (windowed sinc)' },
	{ id: 'echo', name: 'Echo' },
	{ id: 'custom', name: 'Custom (drag the stems)' }
];

/** Small deterministic PRNG (mulberry32) returning values in [0, 1). */
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

export interface XParams {
	/** Pulse width (rect) in samples. */
	width: number;
	/** Period (impulse train, sinusoid) in samples. */
	period: number;
	/** Noise standard deviation (noisy step). */
	noise: number;
	seed: number;
}

/** Round to 4 decimals so stems and the term listing show tidy numbers. */
const r4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0;

export function makeX(kind: XKind, N: number, p: XParams): number[] {
	const n = Array.from({ length: N }, (_, i) => i);
	switch (kind) {
		case 'impulse':
			return n.map((i) => (i === 0 ? 1 : 0));
		case 'step':
			return n.map(() => 1);
		case 'rect':
			return n.map((i) => (i < p.width ? 1 : 0));
		case 'train':
			return n.map((i) => (i % Math.max(1, p.period) === 0 ? 1 : 0));
		case 'ramp':
			return n.map((i) => r4(N > 1 ? i / (N - 1) : 1));
		case 'sine':
			return n.map((i) => r4(Math.sin((2 * Math.PI * i) / Math.max(2, p.period))));
		case 'noisyStep': {
			const rnd = mulberry32(p.seed);
			// Box–Muller for Gaussian noise
			return n.map(() => {
				const u = Math.max(rnd(), 1e-12);
				const v = rnd();
				return r4(1 + p.noise * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v));
			});
		}
		case 'random': {
			const rnd = mulberry32(p.seed);
			return n.map(() => r4(2 * rnd() - 1));
		}
	}
}

export interface HParams {
	/** Length for moving average / Hann. */
	taps: number;
	/** Decay factor (exponential). */
	a: number;
	/** Echo delay (samples) and gain. */
	delay: number;
	gain: number;
}

export function makeH(kind: Exclude<HKind, 'custom'>, p: HParams): number[] {
	switch (kind) {
		case 'movingAverage':
			return new Array(p.taps).fill(r4(1 / p.taps));
		case 'expDecay': {
			// (1 − a)·aⁿ: unit DC gain, truncated once it falls below 1 % of its start
			const L = Math.min(
				24,
				Math.max(2, Math.ceil(Math.log(0.01) / Math.log(Math.max(p.a, 1e-6))))
			);
			return Array.from({ length: L }, (_, i) => r4((1 - p.a) * Math.pow(p.a, i)));
		}
		case 'difference':
			return [1, -1];
		case 'hann': {
			// drop the zero end points of the symmetric window, normalise to unit sum
			const w = windowValues('hann', p.taps + 2).slice(1, -1);
			const s = w.reduce((acc, v) => acc + v, 0);
			return w.map((v) => r4(v / s));
		}
		case 'lowpass7':
			return firwin(7, [0.15], { type: 'hamming' }, true, 1).map(r4);
		case 'echo': {
			const h = new Array(p.delay + 1).fill(0);
			h[0] = 1;
			h[p.delay] = p.gain;
			return h;
		}
	}
}

/** Full linear convolution, length N + M − 1. */
export function convolve(x: readonly number[], h: readonly number[]): number[] {
	if (!x.length || !h.length) return [];
	const y = new Array(x.length + h.length - 1).fill(0);
	for (let k = 0; k < x.length; k++) {
		if (x[k] === 0) continue;
		for (let m = 0; m < h.length; m++) y[k + m] += x[k] * h[m];
	}
	return y.map((v) => (Math.abs(v) < 1e-12 ? 0 : v));
}

export interface Term {
	k: number;
	xk: number;
	h: number;
	product: number;
}

/** The terms x[k]·h[n−k] of y[n] with k in the overlap of both supports. */
export function overlapTerms(x: readonly number[], h: readonly number[], n: number): Term[] {
	const out: Term[] = [];
	const k0 = Math.max(0, n - h.length + 1);
	const k1 = Math.min(x.length - 1, n);
	for (let k = k0; k <= k1; k++) out.push({ k, xk: x[k], h: h[n - k], product: x[k] * h[n - k] });
	return out;
}

/** Magnitude of the DTFT of a finite sequence at normalised frequencies (cycles/sample). */
export function dtftMag(seq: readonly number[], freqs: readonly number[]): number[] {
	return freqs.map((f) => {
		let re = 0;
		let im = 0;
		const w = 2 * Math.PI * f;
		for (let n = 0; n < seq.length; n++) {
			re += seq[n] * Math.cos(w * n);
			im -= seq[n] * Math.sin(w * n);
		}
		return Math.hypot(re, im);
	});
}

/** Number formatted for the term listing (TeX), negatives in parentheses. */
export function texVal(v: number, digits = 3): string {
	const s = Math.abs(v) < 1e-12 ? '0' : String(Number(v.toPrecision(digits)));
	return v < 0 ? `(${s})` : s;
}

/**
 * TeX for y[n] = Σ x[k]h[n−k] = (symbolic terms) = (numeric terms) = value,
 * listing only non-zero products and eliding the middle of long sums.
 */
export function sumTex(
	x: readonly number[],
	h: readonly number[],
	n: number,
	maxTerms = 6
): string {
	const terms = overlapTerms(x, h, n).filter((t) => t.product !== 0);
	const value = terms.reduce((s, t) => s + t.product, 0);
	const head = `y[${n}] &= \\sum_k x[k]\\,h[${n}-k]`;
	if (!terms.length) {
		const overlap = overlapTerms(x, h, n).length > 0;
		return `\\begin{aligned}${head} \\\\ &= 0 \\quad\\text{(${overlap ? 'every product is zero' : 'no overlap'})}\\end{aligned}`;
	}
	const pick = terms.length > maxTerms ? [...terms.slice(0, 3), null, ...terms.slice(-2)] : terms;
	const sym = pick.map((t) => (t ? `x[${t.k}]h[${n - t.k}]` : '\\cdots')).join(' + ');
	const num = pick.map((t) => (t ? `${texVal(t.xk)}\\cdot${texVal(t.h)}` : '\\cdots')).join(' + ');
	const count = terms.length > maxTerms ? `\\quad\\text{(${terms.length} non-zero terms)}` : '';
	return `\\begin{aligned}${head} \\\\ &= ${sym} \\\\ &= ${num} \\\\ &= ${texVal(value, 4)}${count}\\end{aligned}`;
}
