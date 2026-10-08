import { describe, expect, it } from 'vitest';
import {
	H_KINDS,
	X_KINDS,
	convolve,
	dtftMag,
	makeH,
	makeX,
	mulberry32,
	overlapTerms,
	sumTex,
	type HKind
} from '../src/lib/features/convolution/signals';
import { firfilt } from '../src/lib/dsp/time';

const xp = { width: 5, period: 4, noise: 0.3, seed: 42 };
const hp = { taps: 5, a: 0.6, delay: 4, gain: 0.5 };

describe('convolution: signals', () => {
	it('builds every input preset at the requested length', () => {
		for (const k of X_KINDS) {
			const x = makeX(k.id, 17, xp);
			expect(x).toHaveLength(17);
			expect(x.every(Number.isFinite)).toBe(true);
		}
		expect(makeX('impulse', 5, xp)).toEqual([1, 0, 0, 0, 0]);
		expect(makeX('train', 9, xp)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
		expect(makeX('rect', 7, xp)).toEqual([1, 1, 1, 1, 1, 0, 0]);
	});

	it('random inputs are reproducible from the seed', () => {
		expect(makeX('random', 10, xp)).toEqual(makeX('random', 10, xp));
		expect(makeX('random', 10, xp)).not.toEqual(makeX('random', 10, { ...xp, seed: 43 }));
		const r = mulberry32(1);
		for (let i = 0; i < 100; i++) {
			const v = r();
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThan(1);
		}
	});

	it('kernels have the documented shape', () => {
		for (const k of H_KINDS.filter((k) => k.id !== 'custom')) {
			const h = makeH(k.id as Exclude<HKind, 'custom'>, hp);
			expect(h.length).toBeGreaterThan(0);
			expect(h.length).toBeLessThanOrEqual(24);
		}
		const ma = makeH('movingAverage', hp);
		expect(ma).toHaveLength(5);
		expect(ma.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 3);
		const hann = makeH('hann', hp);
		expect(hann).toHaveLength(5);
		expect(hann.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 3);
		expect(hann[0]).toBeGreaterThan(0);
		expect(makeH('echo', hp)).toEqual([1, 0, 0, 0, 0.5]);
		expect(makeH('difference', hp)).toEqual([1, -1]);
		const lp = makeH('lowpass7', hp);
		expect(lp).toHaveLength(7);
		expect(lp.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 3);
		const ex = makeH('expDecay', hp);
		expect(ex[0]).toBeCloseTo(0.4, 4);
		expect(ex[1] / ex[0]).toBeCloseTo(0.6, 3);
	});
});

describe('convolution: the sum', () => {
	const x = makeX('noisyStep', 13, xp);
	const h = makeH('hann', hp);

	it('has length N + M − 1 and matches FIR filtering', () => {
		const y = convolve(x, h);
		expect(y).toHaveLength(x.length + h.length - 1);
		const padded = [...x, ...new Array(h.length - 1).fill(0)];
		const ref = firfilt(h, padded);
		y.forEach((v, i) => expect(v).toBeCloseTo(ref[i], 12));
	});

	it('is commutative and the sums multiply', () => {
		const a = convolve(x, h);
		const b = convolve(h, x);
		a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 12));
		const sum = (s: number[]) => s.reduce((acc, v) => acc + v, 0);
		expect(sum(a)).toBeCloseTo(sum(x) * sum(h), 10);
	});

	it('impulse input returns the kernel', () => {
		expect(convolve([1, 0, 0], h).slice(0, h.length)).toEqual(h);
	});

	it('overlap terms add up to y[n] and respect the supports', () => {
		const y = convolve(x, h);
		for (let n = -2; n < y.length + 2; n++) {
			const t = overlapTerms(x, h, n);
			const s = t.reduce((acc, v) => acc + v.product, 0);
			expect(s).toBeCloseTo(n >= 0 && n < y.length ? y[n] : 0, 12);
			for (const term of t) {
				expect(term.k).toBeGreaterThanOrEqual(0);
				expect(term.k).toBeLessThan(x.length);
				expect(n - term.k).toBeGreaterThanOrEqual(0);
				expect(n - term.k).toBeLessThan(h.length);
			}
		}
	});

	it('DTFT of the output is the product of the DTFTs', () => {
		const y = convolve(x, h);
		const f = [0, 0.05, 0.13, 0.31, 0.5];
		const X = dtftMag(x, f);
		const H = dtftMag(h, f);
		const Y = dtftMag(y, f);
		f.forEach((_, i) => expect(Y[i]).toBeCloseTo(X[i] * H[i], 9));
	});

	it('formats the term listing', () => {
		const tex = sumTex([1, 2], [1, -1], 1);
		expect(tex).toContain('x[0]h[1] + x[1]h[0]');
		expect(tex).toContain('1\\cdot(-1) + 2\\cdot1');
		expect(tex).toContain('= 1');
		expect(sumTex([1], [1], 5)).toContain('no overlap');
		expect(sumTex([0, 0], [1], 1)).toContain('every product is zero');
		const long = sumTex(new Array(20).fill(1), new Array(10).fill(1), 12);
		expect(long).toContain('\\cdots');
		expect(long).toContain('(10 non-zero terms)');
	});
});
