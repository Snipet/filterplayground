import { describe, expect, it } from 'vitest';
import {
	PRESETS,
	asymptote,
	autoRange,
	exact,
	freeSlot,
	makeFactor,
	margins,
	slopes,
	totalExact,
	transferTex,
	wrap180
} from '../src/lib/features/bode/factors';
import { freqsZpk } from '../src/lib/dsp/response';

const W = (f: number) => 2 * Math.PI * f;

describe('bode factors: exact values', () => {
	it('real pole: −3.01 dB and −45° at the corner', () => {
		const p = makeFactor('realPole', 0, { f: 100 });
		expect(exact(p, 100).db).toBeCloseTo(-3.0103, 4);
		expect(exact(p, 100).deg).toBeCloseTo(-45, 9);
		expect(asymptote(p, 100, 'decade').db).toBe(0);
		// 5.71° phase error a decade away
		expect(exact(p, 10).deg - asymptote(p, 10, 'decade').deg).toBeCloseTo(-5.711, 3);
	});

	it('RHP zero has the magnitude of a zero and the phase of a pole', () => {
		const z = makeFactor('realZero', 0, { f: 50, rhp: true });
		const p = makeFactor('realPole', 0, { f: 50 });
		expect(exact(z, 200).db).toBeCloseTo(-exact(p, 200).db, 12);
		expect(exact(z, 200).deg).toBeCloseTo(exact(p, 200).deg, 12);
	});

	it('complex pole pair: −20·log10(2ζ) at f_n and resonant peak', () => {
		const zeta = 0.1;
		const c = makeFactor('complexPole', 0, { f: 1000, zeta });
		expect(exact(c, 1000).db).toBeCloseTo(-20 * Math.log10(2 * zeta), 9);
		expect(exact(c, 1000).deg).toBeCloseTo(-90, 9);
		const fr = 1000 * Math.sqrt(1 - 2 * zeta * zeta);
		const Mr = 1 / (2 * zeta * Math.sqrt(1 - zeta * zeta));
		expect(exact(c, fr).db).toBeCloseTo(20 * Math.log10(Mr), 9);
		// phase is continuous through −180°
		expect(exact(c, 1e6).deg).toBeLessThan(-179);
	});

	it('product of factors matches a ZPK evaluation', () => {
		const fs = [
			makeFactor('gain', 0, { gainDb: 6, sign: -1 }),
			makeFactor('power', 1, { n: -1, f: 10 }),
			makeFactor('realPole', 2, { f: 300 }),
			makeFactor('realZero', 3, { f: 30 }),
			makeFactor('complexPole', 4, { f: 2000, zeta: 0.3 })
		];
		// H(s) = K (w_u/s) (1/(1+s/wp)) (1+s/wz) wn²/(s²+2ζwn s+wn²)
		const K = -Math.pow(10, 6 / 20);
		const wu = W(10);
		const wp = W(300);
		const wz = W(30);
		const wn = W(2000);
		const zeta = 0.3;
		const zpk = {
			z: [{ re: -wz, im: 0 }],
			p: [
				{ re: 0, im: 0 },
				{ re: -wp, im: 0 },
				{ re: -zeta * wn, im: wn * Math.sqrt(1 - zeta * zeta) },
				{ re: -zeta * wn, im: -wn * Math.sqrt(1 - zeta * zeta) }
			],
			k: K * wu * (wp / wz) * wn * wn
		};
		for (const f of [1, 47, 300, 2500, 1e5]) {
			const h = freqsZpk(zpk, [W(f)])[0];
			const t = totalExact(fs, f);
			expect(t.db).toBeCloseTo(20 * Math.log10(Math.hypot(h.re, h.im)), 8);
			expect(wrap180(t.deg - (Math.atan2(h.im, h.re) * 180) / Math.PI)).toBeCloseTo(0, 6);
		}
	});

	it('second-order phase approximations', () => {
		const c = makeFactor('complexPole', 0, { f: 100, zeta: 0.5 });
		expect(asymptote(c, 10, 'decade').deg).toBeCloseTo(0, 12);
		expect(asymptote(c, 1000, 'decade').deg).toBeCloseTo(-180, 12);
		expect(asymptote(c, 100, 'decade').deg).toBeCloseTo(-90, 12);
		expect(asymptote(c, 100 / Math.pow(10, 0.5), 'zeta').deg).toBeCloseTo(0, 9);
		expect(asymptote(c, 100 * Math.pow(10, 0.25), 'zeta').deg).toBeCloseTo(-135, 9);
		expect(asymptote(c, 99, 'step').deg).toBe(0);
		expect(asymptote(c, 101, 'step').deg).toBe(-180);
		expect(asymptote(c, 1000, 'decade').db).toBeCloseTo(-40, 9);
	});
});

describe('bode: slopes, slots, range, TeX', () => {
	it('slopes count powers and orders', () => {
		const fs = [
			makeFactor('power', 0, { n: -2 }),
			makeFactor('realZero', 1),
			makeFactor('complexPole', 2)
		];
		expect(slopes(fs)).toEqual({ low: -40, high: -60 });
	});

	it('freeSlot reuses the lowest free slot', () => {
		const fs = [makeFactor('gain', 0), makeFactor('gain', 2)];
		expect(freeSlot(fs)).toBe(1);
		expect(freeSlot(Array.from({ length: 8 }, (_, i) => makeFactor('gain', i)))).toBe(-1);
	});

	it('autoRange spans at least three decades around the corners', () => {
		const [lo, hi] = autoRange([makeFactor('realPole', 0, { f: 150 })]);
		expect(lo).toBeLessThanOrEqual(15);
		expect(hi).toBeGreaterThanOrEqual(1500);
		expect(hi / lo).toBeGreaterThanOrEqual(999);
	});

	it('builds TeX for every preset', () => {
		for (const p of PRESETS) expect(transferTex(p.build())).toMatch(/^H\(s\) = /);
	});
});

describe('bode: margins', () => {
	it('type-1 loop with two poles matches the analytic margins', () => {
		const fs = [
			makeFactor('power', 0, { n: -1, f: 100 }),
			makeFactor('realPole', 1, { f: 200 }),
			makeFactor('realPole', 2, { f: 2000 })
		];
		const m = margins(fs, 0.1, 1e6);
		// phase crossover where atan(f/200)+atan(f/2000) = 90° → f = sqrt(200·2000)
		expect(m.gm!.f).toBeCloseTo(Math.sqrt(200 * 2000), 4);
		const f = m.gm!.f;
		const magDb =
			20 * Math.log10(100 / f / Math.sqrt(1 + (f / 200) ** 2) / Math.sqrt(1 + (f / 2000) ** 2));
		expect(m.gm!.margin).toBeCloseTo(-magDb, 6);
		// at the gain crossover |L| = 1 and PM = 90° − atan(f/200) − atan(f/2000)
		const g = m.pm!.f;
		expect(totalExact(fs, g).db).toBeCloseTo(0, 8);
		const pm = 90 - (Math.atan(g / 200) + Math.atan(g / 2000)) * (180 / Math.PI);
		expect(m.pm!.margin).toBeCloseTo(pm, 6);
	});

	it('three identical poles: GM = 20·log10(8/K)', () => {
		const fs = [
			makeFactor('gain', 0, { gainDb: 20 * Math.log10(2) }),
			...[1, 2, 3].map((i) => makeFactor('realPole', i, { f: 100 }))
		];
		const m = margins(fs, 1, 1e5);
		expect(m.gm!.f).toBeCloseTo(100 * Math.sqrt(3), 4);
		expect(m.gm!.margin).toBeCloseTo(20 * Math.log10(8 / 2), 6);
	});

	it('a delay reduces the phase margin by 360·f_gc·T', () => {
		const base = [makeFactor('power', 0, { n: -1, f: 100 })];
		const withDelay = [...base, makeFactor('delay', 1, { T: 1e-3 })];
		const a = margins(base, 1, 1e5);
		const b = margins(withDelay, 1, 1e5);
		expect(a.pm!.margin).toBeCloseTo(90, 6);
		expect(b.pm!.f).toBeCloseTo(100, 6);
		expect(b.pm!.margin).toBeCloseTo(90 - 36, 6);
		// phase crossover of (ω_u/s)e^{-sT}: 90° + 360 f T = 180° → f = 250 Hz
		expect(b.gm!.f).toBeCloseTo(250, 4);
		expect(b.gm!.margin).toBeCloseTo(20 * Math.log10(2.5), 6);
	});
});
