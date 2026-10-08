import { describe, expect, it } from 'vitest';
import { abs } from '../src/lib/dsp/complex';
import { buttap, FAMILIES } from '../src/lib/dsp/analog';
import { freqsZpk } from '../src/lib/dsp/response';
import { designNormalised, edge3dB, familyMetrics, FAMILY_COLOR, passbandPeak, type CompareSettings } from '../src/lib/features/family-compare/compare';

const base: CompareSettings = { order: 4, rp: 1, rs: 40, mode: '3db', besselNative: 'phase' };

describe('family comparison helpers', () => {
	it('assigns each family a fixed, distinct colour slot', () => {
		const slots = FAMILIES.map((f) => FAMILY_COLOR[f.id]);
		expect(new Set(slots).size).toBe(FAMILIES.length);
		expect(FAMILY_COLOR.butter).toBe('var(--s1)');
		expect(FAMILY_COLOR.critical).toBe('var(--s8)');
	});

	it('finds the −3 dB edge, also for rippled responses', () => {
		expect(edge3dB(buttap(5))).toBeCloseTo(1, 10);
		for (const f of FAMILIES) {
			for (const N of [1, 2, 5, 8]) {
				for (const rp of [0.5, 3, 5]) {
					const z = designNormalised(f.id, { ...base, order: N, rp });
					const peak = passbandPeak(z, 1);
					const at1 = abs(freqsZpk(z, [1])[0]) / peak;
					expect(20 * Math.log10(at1), `${f.id} N=${N} Rp=${rp}`).toBeCloseTo(-10 * Math.log10(2), 8);
				}
			}
		}
	});

	it('native mode keeps each family’s own cutoff meaning', () => {
		const c1 = designNormalised('cheby1', { ...base, mode: 'native', rp: 0.5 });
		expect(20 * Math.log10(abs(freqsZpk(c1, [1])[0]))).toBeCloseTo(-0.5, 6);
		const c2 = designNormalised('cheby2', { ...base, mode: 'native', rs: 40 });
		expect(20 * Math.log10(abs(freqsZpk(c2, [1])[0]))).toBeCloseTo(-40, 6);
	});

	it('reproduces known step-response and selectivity figures', () => {
		const m1 = familyMetrics(designNormalised('butter', { ...base, order: 1 }));
		expect(m1.rise).toBeCloseTo(Math.log(9), 3); // 10–90 % of e^{−t}
		expect(m1.settle).toBeCloseTo(Math.log(50), 3); // 2 % band
		expect(m1.overshoot).toBeCloseTo(0, 6);
		const b2 = familyMetrics(designNormalised('butter', { ...base, order: 2 }));
		expect(b2.overshoot).toBeCloseTo(4.321, 2);
		const b4 = familyMetrics(designNormalised('butter', { ...base, order: 4 }));
		expect(b4.overshoot).toBeCloseTo(10.84, 1);
		expect(b4.att2).toBeCloseTo(10 * Math.log10(1 + Math.pow(2, 8)), 6);
		expect(b4.ripple).toBe(0);
		expect(familyMetrics(designNormalised('bessel', { ...base, order: 2 })).overshoot).toBeCloseTo(0.43, 2);
		expect(familyMetrics(designNormalised('critical', { ...base, order: 6 })).overshoot).toBeLessThan(1e-6);
	});

	it('measures the passband ripple of equiripple families as Rp', () => {
		for (const N of [3, 4, 7]) {
			expect(familyMetrics(designNormalised('cheby1', { ...base, order: N, rp: 0.5 })).ripple).toBeCloseTo(0.5, 3);
			expect(familyMetrics(designNormalised('ellip', { ...base, order: N, rp: 1 })).ripple).toBeCloseTo(1, 3);
			expect(familyMetrics(designNormalised('cheby2', { ...base, order: N })).ripple).toBe(0);
		}
	});

	it('group-delay spread is tiny for Bessel compared with Chebyshev', () => {
		const be = familyMetrics(designNormalised('bessel', { ...base, order: 6 }));
		const ch = familyMetrics(designNormalised('cheby1', { ...base, order: 6 }));
		expect(be.gdVar / be.gd0).toBeLessThan(0.15);
		expect(ch.gdVar / ch.gd0).toBeGreaterThan(1);
	});
});
