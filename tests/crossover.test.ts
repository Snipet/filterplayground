import { describe, expect, it } from 'vitest';
import { abs, type Complex } from '../src/lib/dsp/complex';
import { freqsZpk, logspace } from '../src/lib/dsp/response';
import {
	buildWays,
	digitalSum,
	digitalWays,
	evaluateCrossover,
	highpass,
	lowpass,
	passiveValues,
	recommendedInvert,
	simulatePassive,
	XO_TYPES,
	type XoConfig,
	type XoType
} from '../src/lib/features/crossover/crossover';

const f = logspace(10, 40000, 1500);
const db = (h: Complex) => 20 * Math.log10(abs(h));

function cfg(type: XoType, ways: 2 | 3, freqs: number[], extra: Partial<XoConfig> = {}): XoConfig {
	return { type, ways, freqs, invert: recommendedInvert(type, ways), highDelay: 0, ...extra };
}

describe('crossover sums', () => {
	it('Linkwitz–Riley and odd-order Butterworth sum to an all-pass with the recommended polarity', () => {
		for (const t of XO_TYPES.filter((x) => x.allPass)) {
			for (const fc of [80, 1000, 3500]) {
				const r = evaluateCrossover(buildWays(cfg(t.id, 2, [fc])), f);
				for (const m of r.sum.magDb) expect(Math.abs(m), `${t.id} @ ${fc}`).toBeLessThan(1e-9);
			}
		}
	});

	it('BW3 sums flat with either polarity; BW1 sums to exactly 1 (zero phase)', () => {
		for (const inv of [false, true]) {
			const r = evaluateCrossover(
				buildWays({ ...cfg('bw3', 2, [1000]), invert: { low: false, mid: false, high: inv } }),
				f
			);
			for (const m of r.sum.magDb) expect(Math.abs(m)).toBeLessThan(1e-9);
		}
		const r1 = evaluateCrossover(buildWays(cfg('bw1', 2, [1000])), f);
		for (const h of r1.sum.H) {
			expect(h.re).toBeCloseTo(1, 12);
			expect(h.im).toBeCloseTo(0, 12);
		}
	});

	it('even-order Butterworth: +3 dB bump with one polarity, a notch with the other', () => {
		const at = (type: XoType, invertHigh: boolean) =>
			db(
				evaluateCrossover(
					buildWays({
						...cfg(type, 2, [1000]),
						invert: { low: false, mid: false, high: invertHigh }
					}),
					[1000]
				).sum.H[0]
			);
		expect(at('bw2', true)).toBeCloseTo(3.0103, 3);
		expect(at('bw2', false)).toBeLessThan(-100);
		expect(at('bw4', false)).toBeCloseTo(3.0103, 3);
		expect(at('bw4', true)).toBeLessThan(-100);
	});

	it('LR crossovers are −6.02 dB per way at fc and in phase (0°) or 180° apart as expected', () => {
		for (const t of ['lr2', 'lr4', 'lr8'] as XoType[]) {
			const r = evaluateCrossover(buildWays(cfg(t, 2, [2000])), [2000]);
			for (const w of r.ways) expect(db(w.H[0])).toBeCloseTo(-6.0206, 3);
			// with the recommended polarity the two outputs are in phase at fc
			const ratio = { re: 0, im: 0 };
			const a = r.ways[0].H[0];
			const b = r.ways[1].H[0];
			ratio.re = (b.re * a.re + b.im * a.im) / (a.re * a.re + a.im * a.im);
			ratio.im = (b.im * a.re - b.re * a.im) / (a.re * a.re + a.im * a.im);
			expect(ratio.re).toBeCloseTo(1, 9);
			expect(ratio.im).toBeCloseTo(0, 9);
		}
	});

	it('3-way LR4 with all-pass compensation sums exactly flat; the simple tree is close but not exact', () => {
		const comp = evaluateCrossover(buildWays(cfg('lr4', 3, [300, 3000], { compensate: true })), f);
		for (const m of comp.sum.magDb) expect(Math.abs(m)).toBeLessThan(1e-8);
		const simple = evaluateCrossover(buildWays(cfg('lr4', 3, [300, 3000])), f);
		const dev = Math.max(...simple.sum.magDb.map(Math.abs));
		expect(dev).toBeGreaterThan(1e-3);
		expect(dev).toBeLessThan(1);
	});

	it('sum group delay matches the numerical derivative of the summed phase (with a delay)', () => {
		const ways = buildWays(cfg('lr4', 2, [1500], { highDelay: 0.12e-3 }));
		const fs = logspace(50, 15000, 40);
		const r = evaluateCrossover(ways, fs);
		for (let i = 0; i < fs.length; i++) {
			const h = fs[i] * 1e-6;
			const pp = evaluateCrossover(ways, [fs[i] - h, fs[i] + h]).sum.H;
			let dphi = Math.atan2(pp[1].im, pp[1].re) - Math.atan2(pp[0].im, pp[0].re);
			if (dphi > Math.PI) dphi -= 2 * Math.PI;
			if (dphi < -Math.PI) dphi += 2 * Math.PI;
			const tau = -dphi / (2 * Math.PI * 2 * h);
			if (Number.isFinite(r.sum.groupDelay[i])) expect(r.sum.groupDelay[i]).toBeCloseTo(tau, 7);
		}
	});

	it('power response of Butterworth crossovers is flat (|LP|² + |HP|² = 1)', () => {
		for (const t of ['bw1', 'bw2', 'bw3', 'bw4'] as XoType[]) {
			const r = evaluateCrossover(buildWays(cfg(t, 2, [1000])), f);
			for (const p of r.powerDb) expect(Math.abs(p)).toBeLessThan(1e-9);
		}
	});
});

describe('digital export', () => {
	it('bilinear (pre-warped) LR4 keeps an all-pass sum and −6 dB at fc', () => {
		const fsamp = 48000;
		const c0 = cfg('lr4', 2, [2500]);
		const dw = digitalWays(c0, fsamp);
		const fg = logspace(10, 23900, 400);
		for (const h of digitalSum(dw, fsamp, fg)) expect(Math.abs(db(h))).toBeLessThan(1e-8);
		const low = digitalSum([dw[0]], fsamp, [2500])[0];
		expect(db(low)).toBeCloseTo(-6.0206, 6);
	});
});

describe('passive networks', () => {
	it('reproduce the Butterworth / Linkwitz–Riley responses for a resistive load', () => {
		for (const t of ['bw1', 'bw2', 'lr2'] as const) {
			for (const [fc, R] of [
				[2500, 8],
				[400, 4]
			]) {
				const v = passiveValues(t, fc, R);
				const sim = simulatePassive(v, R, f);
				const w = f.map((x) => 2 * Math.PI * x);
				const lp = freqsZpk(lowpass(t, 2 * Math.PI * fc), w);
				const hp = freqsZpk(highpass(t, 2 * Math.PI * fc), w);
				for (let i = 0; i < f.length; i++) {
					expect(sim.low[i].re).toBeCloseTo(lp[i].re, 10);
					expect(sim.low[i].im).toBeCloseTo(lp[i].im, 10);
					expect(sim.high[i].re).toBeCloseTo(hp[i].re, 10);
					expect(sim.high[i].im).toBeCloseTo(hp[i].im, 10);
				}
			}
		}
	});

	it('gives the textbook 8 Ω / 2.5 kHz values', () => {
		// 2nd-order Butterworth: L = 0.2251·R/f, C = 0.1125/(R·f)
		const v = passiveValues('bw2', 2500, 8);
		expect(v.lowL).toBeCloseTo((0.2251 * 8) / 2500, 6);
		expect(v.lowC).toBeCloseTo(0.1125 / (8 * 2500), 8);
		// Linkwitz–Riley 2nd order: L = 0.3183·R/f, C = 0.0796/(R·f)
		const l = passiveValues('lr2', 2500, 8);
		expect(l.lowL).toBeCloseTo((0.3183 * 8) / 2500, 6);
		expect(l.lowC).toBeCloseTo(0.0796 / (8 * 2500), 8);
	});
});
