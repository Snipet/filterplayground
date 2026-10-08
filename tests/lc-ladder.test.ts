import { describe, expect, it } from 'vitest';
import { abs } from '../src/lib/dsp/complex';
import type { ZPK } from '../src/lib/dsp/types';
import { freqsZpk, logspace } from '../src/lib/dsp/response';
import {
	butterworthG,
	chebyshevG,
	ladderPrototype,
	scaleLadder,
	simulateLadder,
	synthesizeLadder,
	targetZpk,
	type LadderBand,
	type LadderFamily,
	type LadderForm
} from '../src/lib/features/lc-ladder/ladder';

const relClose = (a: number, b: number, tol: number) =>
	Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

describe('Darlington ladder synthesis', () => {
	it('reproduces the closed-form Butterworth g-values (N = 1…12)', () => {
		for (let n = 1; n <= 12; n++) {
			const syn = synthesizeLadder(ladderPrototype('butter', n));
			const ref = butterworthG(n);
			expect(syn.g.length).toBe(n);
			syn.g.forEach((g, i) =>
				expect(relClose(g, ref[i], 1e-6), `N=${n} g${i + 1}: ${g} vs ${ref[i]}`).toBe(true)
			);
			expect(relClose(syn.gLoad, 1, 1e-6)).toBe(true);
			expect(relClose(syn.rLoadSeries, 1, 1e-6)).toBe(true);
		}
	});

	// Element values are an ill-conditioned function of the response (that is Orchard's
	// low-sensitivity property seen from the other side): for N ≥ 10 at tiny ripple, values
	// differing by ~5e-7 give responses identical to 1e-12 dB. Hence 2e-6 here and a strict
	// response check in the simulation tests below.
	it('reproduces the Chebyshev I recursion (N = 1…12, several ripples)', () => {
		for (const rp of [0.01, 0.1, 0.5, 1, 2, 3]) {
			for (let n = 1; n <= 12; n++) {
				const syn = synthesizeLadder(ladderPrototype('cheby1', n, rp));
				const ref = chebyshevG(n, rp);
				syn.g.forEach((g, i) =>
					expect(relClose(g, ref[i], 2e-6), `Rp=${rp} N=${n} g${i + 1}: ${g} vs ${ref[i]}`).toBe(
						true
					)
				);
				expect(
					relClose(syn.gLoad, ref[n], 2e-6),
					`Rp=${rp} N=${n} g_{n+1}: ${syn.gLoad} vs ${ref[n]}`
				).toBe(true);
			}
		}
	});

	it('matches textbook values (0.5 dB Chebyshev, N = 3 and 4)', () => {
		const g3 = synthesizeLadder(ladderPrototype('cheby1', 3, 0.5)).g;
		expect(g3.map((v) => Number(v.toFixed(4)))).toEqual([1.5963, 1.0967, 1.5963]);
		const s4 = synthesizeLadder(ladderPrototype('cheby1', 4, 0.5));
		expect(s4.g.map((v) => Number(v.toFixed(4)))).toEqual([1.6703, 1.1926, 2.3661, 0.8419]);
		expect(Number(s4.gLoad.toFixed(4))).toBe(1.9841);
		// series-L first: last element is a shunt C, so g5 is the load resistance
		expect(Number(s4.rLoadSeries.toFixed(4))).toBe(1.9841);
		expect(Number(s4.rLoadShunt.toFixed(4))).toBe(Number((1 / 1.9841).toFixed(4)));
	});

	it('even-order Chebyshev needs unequal terminations; odd order does not', () => {
		expect(synthesizeLadder(ladderPrototype('cheby1', 5, 1)).rLoadSeries).toBeCloseTo(1, 6);
		expect(synthesizeLadder(ladderPrototype('cheby1', 6, 1)).rLoadSeries).toBeGreaterThan(2);
	});
});

describe('ABCD simulation of the synthesized ladder', () => {
	const families: LadderFamily[] = [
		'butter',
		'cheby1',
		'bessel',
		'legendre',
		'gaussian',
		'critical'
	];
	const forms: LadderForm[] = ['series', 'shunt'];
	const bands: LadderBand[] = ['lowpass', 'highpass', 'bandpass'];

	it('exact components reproduce the target |S21| for every family, form and band', () => {
		for (const fam of families) {
			for (const n of [1, 2, 3, 4, 5, 7, 8, 10, 12]) {
				const proto = ladderPrototype(fam, n, 1);
				const syn = synthesizeLadder(proto);
				for (const form of forms) {
					for (const band of bands) {
						const opts = { form, band, r0: 50, f0: 1e6, bw: 2e5 };
						const net = scaleLadder(syn, opts);
						const target = targetZpk(proto, opts);
						const f = logspace(1e4, 1e8, 120);
						const sim = simulateLadder(net, f).s21.map(abs);
						const ref = freqsZpk(
							target,
							f.map((v) => 2 * Math.PI * v)
						).map(abs);
						for (let i = 0; i < f.length; i++) {
							const dDb = 20 * Math.log10(sim[i] / ref[i]);
							if (ref[i] > 1e-6)
								expect(Math.abs(dDb), `${fam} N=${n} ${form} ${band} f=${f[i]}`).toBeLessThan(1e-6);
						}
					}
				}
			}
		}
	});

	it('low-pass S21 matches H(jω) in phase too, and S11 is lossless-complementary', () => {
		const proto = ladderPrototype('cheby1', 5, 0.5);
		const syn = synthesizeLadder(proto);
		const net = scaleLadder(syn, { form: 'series', band: 'lowpass', r0: 50, f0: 1000 });
		const f = logspace(10, 1e5, 60);
		const sim = simulateLadder(net, f);
		const ref = freqsZpk(
			lp2lpRef(proto, 2 * Math.PI * 1000),
			f.map((v) => 2 * Math.PI * v)
		);
		for (let i = 0; i < f.length; i++) {
			expect(Math.abs(sim.s21[i].re - ref[i].re)).toBeLessThan(1e-8);
			expect(Math.abs(sim.s21[i].im - ref[i].im)).toBeLessThan(1e-8);
			expect(abs(sim.s21[i]) ** 2 + abs(sim.s11[i]) ** 2).toBeCloseTo(1, 9);
		}
	});

	it('scales a 3rd-order 50 Ω Butterworth at 1 MHz to the textbook values', () => {
		const syn = synthesizeLadder(ladderPrototype('butter', 3));
		const net = scaleLadder(syn, { form: 'shunt', band: 'lowpass', r0: 50, f0: 1e6 });
		// shunt C = 1/(R0·ωc) = 3.183 nF, series L = 2·R0/ωc = 15.92 µH
		expect(net.branches[0].C).toBeCloseTo(3.1831e-9, 12);
		expect(net.branches[1].L).toBeCloseTo(15.915e-6, 9);
		expect(net.branches[2].C).toBeCloseTo(3.1831e-9, 12);
		expect(net.rl).toBeCloseTo(50, 6);
	});
});

function lp2lpRef(z: ZPK, w: number): ZPK {
	return {
		z: [],
		p: z.p.map((p) => ({ re: p.re * w, im: p.im * w })),
		k: z.k * Math.pow(w, z.p.length)
	};
}
