import { describe, expect, it } from 'vitest';
import { designAnalog, estimateFromSpecs } from '../src/lib/dsp/design';
import { abs } from '../src/lib/dsp/complex';
import { freqsZpk } from '../src/lib/dsp/response';
import {
	adcDynamicRange,
	aliasOf,
	aliasWave,
	foldingCurve,
	minOrderMonotonic,
	monotonicAttenuation,
	orderVsOsr,
	triangle
} from '../src/lib/features/aliasing/aliasing';

describe('folding', () => {
	it('apparent frequency follows |f − fs·round(f/fs)|', () => {
		const fs = 1000;
		expect(aliasOf(100, fs)).toMatchObject({ fa: 100, zone: 1, folds: false, inverted: false });
		expect(aliasOf(900, fs)).toMatchObject({ fa: 100, zone: 2, folds: true, inverted: true });
		expect(aliasOf(1100, fs)).toMatchObject({ fa: 100, zone: 3, folds: true, inverted: false });
		expect(aliasOf(1000, fs).fa).toBe(0);
		expect(aliasOf(2600, fs).fa).toBeCloseTo(400, 9);
	});

	it('the alias sinusoid passes through every sample', () => {
		const fs = 1000;
		for (const f of [37, 480, 500, 730, 1000, 1234.5, 2999]) {
			for (const phi of [0, 0.7, -2.1]) {
				const a = aliasWave(f, fs, phi);
				for (let n = 0; n < 50; n++) {
					const t = n / fs;
					expect(Math.cos(2 * Math.PI * a.fa * t + a.phase)).toBeCloseTo(Math.cos(2 * Math.PI * f * t + phi), 8);
				}
				expect(a.fa).toBeLessThanOrEqual(fs / 2 + 1e-9);
			}
		}
	});

	it('folding curve is a triangle wave between 0 and fs/2', () => {
		const c = foldingCurve(1000, 2700);
		expect(c.x).toEqual([0, 500, 1000, 1500, 2000, 2500, 2700]);
		expect(c.y).toEqual([0, 500, 0, 500, 0, 500, 300]);
	});

	it('triangle spectrum', () => {
		expect(triangle(0, 10)).toBe(1);
		expect(triangle(-5, 10)).toBe(0.5);
		expect(triangle(12, 10)).toBe(0);
	});
});

describe('anti-alias order requirements', () => {
	it('ADC dynamic range', () => {
		expect(adcDynamicRange(16)).toBeCloseTo(98.08, 2);
	});

	it('orderVsOsr agrees with estimateFromSpecs for every plotted family', () => {
		const fb = 20000;
		for (const family of ['butter', 'cheby1', 'ellip', 'bessel'] as const) {
			for (const [rp, rs] of [
				[0.1, 60],
				[0.5, 98],
				[1, 40]
			]) {
				const osr = [1.1, 1.3, 2, 3.7, 8, 16];
				const orders = orderVsOsr(family, rp, rs, osr);
				osr.forEach((r, i) => {
					const est = estimateFromSpecs(family, { band: 'lowpass', fp: fb, fstop: 2 * r * fb - fb, rp, rs }, { besselNorm: 'mag' });
					if (Number.isNaN(orders[i])) expect(est.capped).toBe(true);
					else if (!est.capped) expect(orders[i]).toBe(est.order);
					else expect(orders[i]).toBeGreaterThan(est.order);
				});
				// more oversampling never needs a higher order
				for (let i = 1; i < orders.length; i++) if (!Number.isNaN(orders[i - 1])) expect(orders[i]).toBeLessThanOrEqual(orders[i - 1]);
			}
		}
	});
});

describe('monotonic families via characteristic functions', () => {
	it('match the prototypes and estimateFromSpecs', () => {
		const fb = 1000;
		for (const family of ['bessel', 'legendre', 'gaussian', 'critical'] as const) {
			for (const [rp, rs, ws] of [
				[0.5, 40, 3],
				[0.1, 60, 6],
				[1, 30, 1.8]
			]) {
				const m = minOrderMonotonic(family, ws, rp, rs);
				const est = estimateFromSpecs(family, { band: 'lowpass', fp: fb, fstop: ws * fb, rp, rs }, { besselNorm: 'mag' });
				expect(m.capped).toBe(est.capped);
				expect(m.order).toBe(est.order);
				if (!m.capped) {
					// the estimator's natural frequency is the −3 dB frequency for these families
					expect((m.f3 * fb) / est.f1).toBeCloseTo(1, 6);
					// and the designed filter meets the spec exactly at the passband edge
					const zpk = designAnalog({ family, band: 'lowpass', order: m.order, f1: m.f3 * fb, besselNorm: 'mag' });
					const att = (f: number) => -20 * Math.log10(abs(freqsZpk(zpk, [2 * Math.PI * f])[0]) / abs(freqsZpk(zpk, [0])[0]));
					expect(att(fb)).toBeCloseTo(rp, 6);
					expect(att(ws * fb)).toBeGreaterThanOrEqual(rs - 1e-6);
					expect(monotonicAttenuation(family, m.order, rp, ws)).toBeCloseTo(att(ws * fb), 6);
				}
			}
		}
	});
});
