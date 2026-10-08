import { describe, expect, it } from 'vitest';
import { SIMPLE_FILTERS, alphaExact3dB, cutoff3dB, defaults, gainDbAt, type Built, type ParamValues } from '../src/lib/features/simple-filters/catalog';
import { evaluate, linspace } from '../src/lib/dsp/response';
import { digitalTf } from '../src/lib/dsp/convert';
import type { TF } from '../src/lib/dsp/types';

const byId = (id: string) => SIMPLE_FILTERS.find((f) => f.id === id)!;
const build = (id: string, over: ParamValues = {}, fs = 48000): Built => {
	const f = byId(id);
	return f.build({ ...defaults(f), ...over }, fs);
};
const tfOf = (b: Built): TF => digitalTf(b.filter);

describe('catalogue integrity', () => {
	for (const f of SIMPLE_FILTERS) {
		for (const fs of [1000, 48000]) {
			it(`${f.id} builds finite coefficients at fs = ${fs}, and its diagram matches b/a`, () => {
				const b = f.build(defaults(f), fs);
				const tf = tfOf(b);
				expect([...tf.b, ...tf.a].every(Number.isFinite)).toBe(true);
				expect(b.equation.length).toBeGreaterThan(0);
				expect(b.code.length).toBeGreaterThan(0);
				if (b.diagram.ffNote) return; // abbreviated diagram
				const bb = new Array(tf.b.length).fill(0);
				for (const t of b.diagram.ff) bb[t.delay] += t.coef;
				const aa = new Array(tf.a.length).fill(0);
				aa[0] = 1;
				for (const t of b.diagram.fb) aa[t.delay] -= t.coef;
				bb.forEach((v, i) => expect(v).toBeCloseTo(tf.b[i] / tf.a[0], 12));
				aa.forEach((v, i) => expect(v).toBeCloseTo(tf.a[i] / tf.a[0], 12));
			});
		}
	}
});

it('short direct moving averages draw every tap', () => {
	for (const N of [2, 3, 4]) {
		const b = build('ma', { N, impl: 'direct' });
		expect(b.diagram.ff.map((t) => t.delay)).toEqual(Array.from({ length: N }, (_, k) => k));
		expect(b.diagram.ffNote).toBeUndefined();
	}
});

describe('one-pole low-pass', () => {
	it('exact −3 dB formula puts the half-power point on fc', () => {
		for (const fc of [100, 2000, 10000, 20000]) {
			const b = build('ema', { mode: 'fc', fc, fcMethod: 'exact' });
			expect(cutoff3dB(tfOf(b), 48000, 'lp')! / fc).toBeCloseTo(1, 3);
		}
		expect(alphaExact3dB(24000 - 1e-9, 48000)).toBeCloseTo(2 * Math.SQRT2 - 2, 6);
	});
	it('the exponential approximation is good at low fc and drifts high', () => {
		const lo = cutoff3dB(tfOf(build('ema', { mode: 'fc', fc: 100, fcMethod: 'approx' })), 48000, 'lp')!;
		expect(lo / 100).toBeCloseTo(1, 2);
		const hi = cutoff3dB(tfOf(build('ema', { mode: 'fc', fc: 10000, fcMethod: 'approx' })), 48000, 'lp')!;
		expect(hi).toBeGreaterThan(10000 * 1.1);
	});
	it('time constant mode: step reaches 63 % after τ', () => {
		const fs = 48000;
		const tau = 0.001;
		const tf = tfOf(build('ema', { mode: 'tau', tau }, fs));
		expect(tf.b[0]).toBeCloseTo(1 - Math.exp(-1 / (fs * tau)), 12);
	});
	it('unity DC gain', () => {
		expect(gainDbAt(tfOf(build('ema', { mode: 'alpha', alpha: 0.3 })), 48000, 0)).toBeCloseTo(0, 10);
	});
});

describe('high-pass, DC blocker, leaky integrator', () => {
	it('bilinear one-pole high-pass: exact −3 dB at fc, 0 dB at Nyquist', () => {
		const tf = tfOf(build('hp1', { variant: 'bilinear', fc: 3000 }));
		expect(gainDbAt(tf, 48000, 3000)).toBeCloseTo(-3.0103, 3);
		expect(gainDbAt(tf, 48000, 24000)).toBeCloseTo(0, 9);
	});
	it('x − EMA equals one minus the EMA', () => {
		const fs = 48000;
		const hp = build('hp1', { variant: 'ema', fc: 500 }, fs);
		const lp = build('ema', { mode: 'fc', fc: 500, fcMethod: 'approx' }, fs);
		const f = [10, 300, 5000];
		const H = evaluate(hp.filter, f).H;
		const L = evaluate(lp.filter, f).H;
		H.forEach((h, i) => {
			expect(h.re).toBeCloseTo(1 - L[i].re, 12);
			expect(h.im).toBeCloseTo(-L[i].im, 12);
		});
	});
	it('DC blocker: zero at DC and 2/(1+R) at Nyquist', () => {
		const R = 0.99;
		const tf = tfOf(build('dcblock', { mode: 'R', R }));
		expect(gainDbAt(tf, 48000, 0)).toBeLessThan(-200);
		expect(gainDbAt(tf, 48000, 24000)).toBeCloseTo(20 * Math.log10(2 / (1 + R)), 9);
	});
	it('leaky integrator DC gain 1/(1 − R); accumulator is marginally stable', () => {
		expect(gainDbAt(tfOf(build('leaky', { kind: 'leaky', leak: 0.1 })), 48000, 0)).toBeCloseTo(20, 9);
		const acc = build('leaky', { kind: 'acc' });
		expect(tfOf(acc).a).toEqual([1, -1]);
		expect(acc.stats.find((s) => s.label === 'Stability')?.status).toBe('warning');
	});
});

describe('moving average and combs', () => {
	it('recursive and direct moving averages have the same response with nulls at k·fs/N', () => {
		const fs = 1000;
		const N = 20;
		const rec = build('ma', { N, impl: 'recursive' }, fs);
		const dir = build('ma', { N, impl: 'direct' }, fs);
		const f = linspace(1, 499, 50);
		const a = evaluate(rec.filter, f).magDb;
		const b = evaluate(dir.filter, f).magDb;
		a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));
		for (const null_ of [50, 100, 150]) expect(evaluate(dir.filter, [null_]).mag[0]).toBeLessThan(1e-12);
	});
	it('feed-forward comb: peaks 1+|g|, dips 1−|g| at the right frequencies', () => {
		const fs = 48000;
		const D = 8;
		const g = 0.5;
		const tf = tfOf(build('comb', { kind: 'ff', D, g }, fs));
		expect(gainDbAt(tf, fs, fs / D)).toBeCloseTo(20 * Math.log10(1.5), 9);
		expect(gainDbAt(tf, fs, fs / D / 2)).toBeCloseTo(20 * Math.log10(0.5), 9);
	});
	it('feedback comb: peaks 1/(1−g)', () => {
		const fs = 48000;
		const tf = tfOf(build('comb', { kind: 'fb', D: 10, gfb: 0.8 }, fs));
		expect(gainDbAt(tf, fs, fs / 10)).toBeCloseTo(20 * Math.log10(5), 9);
	});
});

describe('resonator and notch', () => {
	it('resonator: unity gain at f0 and the requested bandwidth for narrow peaks', () => {
		const fs = 48000;
		const b = build('reson', { f0: 6000, B: 100, zeros: 'none', gain: 'unity' }, fs);
		expect(gainDbAt(tfOf(b), fs, 6000)).toBeCloseTo(0, 9);
		const bw = b.stats.find((s) => s.label === 'Measured −3 dB width')!.value;
		expect(parseFloat(bw)).toBeGreaterThan(95);
		expect(parseFloat(bw)).toBeLessThan(105);
	});
	it('zeros at ±1 keep the peak gain almost constant with fixed scaling', () => {
		const fs = 48000;
		const peak = (zeros: string, f0: number) => {
			const tf = tfOf(build('reson', { f0, B: 200, zeros, gain: 'fixed' }, fs));
			return Math.max(...evaluate({ kind: 'digital', fs, tf }, linspace(0, fs / 2, 20001)).magDb);
		};
		const f0s = [300, 2000, 8000, 16000, 23000];
		const withZ = f0s.map((f) => peak('pm1', f));
		const without = f0s.map((f) => peak('none', f));
		expect(Math.max(...withZ) - Math.min(...withZ)).toBeLessThan(0.5);
		expect(Math.max(...without) - Math.min(...without)).toBeGreaterThan(10);
	});
	it('notch: infinite rejection at f0, unity far away', () => {
		const fs = 48000;
		const tf = tfOf(build('notch', { f0: 1000, B: 50 }, fs));
		expect(gainDbAt(tf, fs, 1000)).toBeLessThan(-150);
		expect(gainDbAt(tf, fs, 24000)).toBeCloseTo(0, 9);
		expect(Math.abs(gainDbAt(tf, fs, 0))).toBeLessThan(0.01);
	});
});

describe('all-pass and differentiator', () => {
	it('all-pass: flat magnitude, −90° at the break frequency', () => {
		const fs = 48000;
		const b = build('allpass1', { mode: 'phase', fc: 3000 }, fs);
		const r = evaluate(b.filter, [10, 3000, 20000]);
		r.magDb.forEach((v) => expect(v).toBeCloseTo(0, 9));
		expect(r.phaseDeg[1]).toBeCloseTo(-90, 6);
	});
	it('all-pass fractional delay: group delay at DC equals d', () => {
		const fs = 48000;
		const b = build('allpass1', { mode: 'delay', d: 0.37 }, fs);
		expect(evaluate(b.filter, [0]).groupDelay[0] * fs).toBeCloseTo(0.37, 9);
	});
	it('first difference: +6.02 dB at Nyquist; central difference has a zero there', () => {
		const fs = 48000;
		expect(gainDbAt(tfOf(build('diff', { variant: 'backward' })), fs, fs / 2)).toBeCloseTo(6.0206, 3);
		expect(gainDbAt(tfOf(build('diff', { variant: 'central' })), fs, fs / 2)).toBeLessThan(-200);
	});
});
