import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { abs } from '../src/lib/dsp/complex';
import { prototype } from '../src/lib/dsp/analog';
import { freqsZpk, groupDelayAnalogZpk, linspace } from '../src/lib/dsp/response';
import {
	designNormalised,
	edge3dB,
	familyMetrics,
	passbandPeak,
	type CompareSettings
} from '../src/lib/features/family-compare/compare';

const base: CompareSettings = { order: 5, rp: 1, rs: 60, mode: '3db', besselNative: 'phase' };

/** First t ≥ 0 where the decreasing function g crosses zero (bisection). */
function root(g: (t: number) => number, hi: number): number {
	let lo = 0;
	for (let i = 0; i < 200; i++) {
		const mid = (lo + hi) / 2;
		if (g(mid) > 0) lo = mid;
		else hi = mid;
	}
	return (lo + hi) / 2;
}

describe('critically damped step metrics (N repeated poles)', () => {
	// N poles at −a, a = 1/√(2^{1/N} − 1): 1 − y(t) = P(Poisson(at) ≤ N − 1)
	const reference = (N: number) => {
		const a = 1 / Math.sqrt(Math.pow(2, 1 / N) - 1);
		const err = (t: number) => {
			let term = Math.exp(-a * t);
			let sum = term;
			for (let k = 1; k < N; k++) sum += term *= (a * t) / k;
			return sum;
		};
		const t10 = root((t) => err(t) - 0.9, 100);
		const t90 = root((t) => err(t) - 0.1, 100);
		return { rise: t90 - t10, settle: root((t) => err(t) - 0.02, 100) };
	};

	it('finds rise and settling time for every order (window long enough)', () => {
		for (let N = 1; N <= 12; N++) {
			const m = familyMetrics(designNormalised('critical', { ...base, order: N }));
			const ref = reference(N);
			expect(m.settle, `N=${N}`).toBeCloseTo(ref.settle, 4);
			expect(m.rise, `N=${N}`).toBeCloseTo(ref.rise, 4);
		}
		// SciPy / Poisson reference values
		const scipy: Record<number, number> = { 6: 4.20879, 8: 4.457497, 10: 4.690979, 12: 4.909975 };
		for (const [N, ts] of Object.entries(scipy))
			expect(
				familyMetrics(designNormalised('critical', { ...base, order: +N })).settle
			).toBeCloseTo(ts, 4);
	});

	it('critically damped settles fastest of the monotonic families from N = 6', () => {
		for (const N of [6, 8, 10, 12]) {
			const s = { ...base, order: N };
			const crit = familyMetrics(designNormalised('critical', s)).settle;
			for (const f of ['butter', 'bessel', 'legendre', 'gaussian'] as const)
				expect(crit, `${f} N=${N}`).toBeLessThan(familyMetrics(designNormalised(f, s)).settle);
		}
	});
});

describe('group-delay spread resolves narrow high-Q peaks', () => {
	it('matches SciPy for high-order elliptic designs', () => {
		// SciPy ellipap normalised to −3 dB, τ evaluated analytically on 2 000 001 points
		const cases: [number, number, number, number][] = [
			[12, 1, 60, 747.890743],
			[12, 3, 80, 564.910198],
			[10, 3, 60, 488.123947],
			[8, 1, 60, 79.690142],
			[5, 1, 60, 12.778009]
		];
		for (const [N, rp, rs, ref] of cases) {
			const z = designNormalised('ellip', { ...base, order: N, rp, rs });
			const m = familyMetrics(z);
			expect(Math.abs(m.gdVar / ref - 1), `ellip ${N}/${rp}/${rs}`).toBeLessThan(1e-5);
			// never below a dense-grid evaluation
			const gd = groupDelayAnalogZpk(z, linspace(0, m.f3, 100001));
			let mx = -Infinity;
			let mn = Infinity;
			for (const v of gd) {
				mx = Math.max(mx, v);
				mn = Math.min(mn, v);
			}
			expect(m.gdVar).toBeGreaterThanOrEqual((mx - mn) * (1 - 1e-12));
			expect(m.gd0).toBeCloseTo(gd[0], 10);
		}
	});
});

describe('−3 dB edge finds the last, narrow passband lobe', () => {
	it('matches SciPy ellipap for Rp > 3 dB', () => {
		expect(edge3dB(prototype('ellip', 5, { rp: 6, rs: 20 }))).toBeCloseTo(0.99924972, 7);
		expect(edge3dB(prototype('ellip', 4, { rp: 6, rs: 10 }))).toBeCloseTo(0.9998368, 7);
		expect(edge3dB(prototype('ellip', 6, { rp: 5, rs: 10 }))).toBeCloseTo(0.99999809, 7);
		const native = familyMetrics(
			designNormalised('ellip', { ...base, mode: 'native', order: 5, rp: 6, rs: 20 })
		);
		expect(native.f3).toBeCloseTo(0.99924972, 7);
	});

	it("'−3 dB at fc' leaves nothing above −3 dB beyond fc", () => {
		for (const [N, rp, rs] of [
			[5, 6, 20],
			[4, 6, 10],
			[6, 5, 10],
			[8, 4.5, 40]
		]) {
			const z = designNormalised('ellip', { ...base, order: N, rp, rs });
			const target = passbandPeak(z, 1) / Math.SQRT2;
			const above = freqsZpk(z, linspace(1 + 1e-9, 1.2, 400001)).map(abs);
			expect(Math.max(...above.slice(0, 1000)), `${N}/${rp}/${rs}`).toBeLessThan(target);
			let mx = 0;
			for (const v of above) mx = Math.max(mx, v);
			expect(mx, `${N}/${rp}/${rs}`).toBeLessThan(target);
		}
	});
});

describe('rise time when the step starts above 10 %', () => {
	it('counts from t = 0 (SciPy step references)', () => {
		const cases: [CompareSettings, string, number][] = [
			[{ ...base, order: 6, rp: 1, rs: 20 }, 'ellip', 3.409573],
			[{ ...base, order: 6, rs: 10 }, 'cheby2', 2.769702],
			[{ ...base, order: 6, rs: 20 }, 'cheby2', 3.410442],
			[{ ...base, order: 6, rs: 15 }, 'cheby2', 3.084504]
		];
		for (const [s, fam, ref] of cases) {
			const m = familyMetrics(designNormalised(fam as 'ellip' | 'cheby2', s));
			expect(m.rise, `${fam} ${JSON.stringify(s)}`).toBeCloseTo(ref, 3);
		}
		const nat = familyMetrics(
			designNormalised('ellip', { ...base, mode: 'native', order: 6, rp: 1, rs: 20 })
		);
		expect(Number.isFinite(nat.rise)).toBe(true);
	});
});

describe('step metrics of high-order elliptic designs are resolved', () => {
	it('matches a dense SciPy step response', () => {
		// residue-form step response on a 2e-3 grid over [0, 3000]
		const cases: [number, number, number, { os: number; rise: number; settle: number }][] = [
			[12, 1, 60, { os: 27.127704, rise: 3.859357, settle: 61.43949 }],
			[10, 0.1, 40, { os: 19.537329, rise: 3.642354, settle: 54.768857 }],
			[12, 0.1, 40, { os: 19.538756, rise: 3.660067, settle: 55.108034 }],
			[8, 1, 60, { os: 27.053359, rise: 3.68841, settle: 52.947823 }]
		];
		for (const [N, rp, rs, ref] of cases) {
			const m = familyMetrics(designNormalised('ellip', { ...base, order: N, rp, rs }));
			const tag = `ellip ${N}/${rp}/${rs}`;
			expect(Math.abs(m.overshoot - ref.os), tag).toBeLessThan(0.002);
			expect(Math.abs(m.rise / ref.rise - 1), tag).toBeLessThan(2e-4);
			expect(Math.abs(m.settle / ref.settle - 1), tag).toBeLessThan(2e-4);
		}
	});

	it('every family and order the page offers gives finite step metrics', () => {
		for (const fam of ['butter', 'cheby1', 'cheby2', 'ellip', 'bessel', 'critical'] as const)
			for (const N of [1, 2, 6, 9, 12])
				for (const mode of ['3db', 'native'] as const) {
					const m = familyMetrics(designNormalised(fam, { ...base, order: N, mode, rs: 120 }));
					expect(Number.isFinite(m.rise) && Number.isFinite(m.settle), `${fam} ${N} ${mode}`).toBe(
						true
					);
				}
	});
});

describe('family-compare page text', () => {
	const page = readFileSync('src/routes/family-compare/+page.svelte', 'utf8').replace(/\s+/g, ' ');

	it('Chebyshev I ripple tip quotes the overshoot trend the table shows', () => {
		const os = (order: number, rp: number) =>
			Math.round(familyMetrics(designNormalised('cheby1', { ...base, order, rp })).overshoot);
		expect([os(6, 0.1), os(6, 3)]).toEqual([18, 39]);
		expect([os(5, 0.1), os(5, 3)]).toEqual([15, 2]);
		expect(page).toContain('The overshoot only grows at even orders (N = 6: 18 % → 39 %)');
		expect(page).toContain('at odd orders such as the default N = 5 it shrinks (15 % → 2 %)');
		expect(page).not.toContain('group-delay peak and overshoot grow');
	});

	it('native-mode note does not call Bessel −3 dB at fc', () => {
		expect(page).not.toContain('the rest are −3 dB');
		expect(page).toContain('Bessel follows the normalisation chosen below');
		expect(page).toContain('Butterworth, Legendre, Gaussian and critically damped are −3 dB at fc');
		// phase-midpoint Bessel is indeed not −3 dB at fc, the others are
		const f3 = (family: 'bessel' | 'butter' | 'legendre' | 'gaussian' | 'critical') =>
			familyMetrics(designNormalised(family, { ...base, mode: 'native' })).f3;
		expect(f3('bessel')).toBeCloseTo(0.61668, 4);
		for (const f of ['butter', 'legendre', 'gaussian', 'critical'] as const)
			expect(f3(f)).toBeCloseTo(1, 6);
	});
});
