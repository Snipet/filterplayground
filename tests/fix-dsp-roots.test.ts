/**
 * Regression tests for roots() (Aberth–Ehrlich) when |p'(z)| would overflow:
 * FIRs with near-zero end taps (roots near 1e15), long FIRs, and high-order
 * analog polynomials in rad/s. Previously one iterate stalled forever and was
 * returned as a "root" (garbage zeros, SOS DC gain ~1e-16, false "unstable").
 */
import { describe, expect, it } from 'vitest';
import { roots, polyFromRoots } from '../src/lib/dsp/poly';
import { c, abs, type Complex } from '../src/lib/dsp/complex';
import { freqzSos, freqzTf, freqzZpk } from '../src/lib/dsp/response';
import { buildModel, analyze } from '../src/lib/features/tf-analyzer/analyze';

// scipy.signal.firwin(25, 0.5): half-band, end taps ±1.56e-18
const HB25 = [
	-1.5619110814039421e-18, -0.0027732387112906123, 2.765135418524239e-18, 0.00760742113669281,
	-6.052405440440269e-18, -0.019173922242281323, 1.05428997994766e-17, 0.04202795690160927,
	-1.5033394158512933e-17, -0.09196348332459348, 1.832066418042896e-17, 0.31385161437981896,
	0.5008473037200886, 0.313851614379819, 1.832066418042896e-17, -0.09196348332459348,
	-1.5033394158512936e-17, 0.0420279569016093, 1.05428997994766e-17, -0.019173922242281333,
	-6.0524054404402766e-18, 0.00760742113669281, 2.76513541852424e-18, -0.002773238711290614,
	-1.5619110814039421e-18
];
// scipy.signal.firwin(41, 0.1): end taps -3.1e-19
const F41 = [
	-3.106177631319143e-19, -0.00044172230934385497, -0.0010613407019898114, -0.0019635183281894696,
	-0.003163288371235376, -0.004538670923362594, -0.005807027525383741, -0.0065340634349548635,
	-0.006178522510691169, -0.004168676886250628, 2.09666990114042e-18, 0.006661748550302831,
	0.01589031993524871, 0.027439206863984635, 0.040725824949003786, 0.054866423230241566,
	0.0687601802774073, 0.08121248704102824, 0.09108034848723351, 0.0974184588239491,
	0.09960366566600361, 0.0974184588239491, 0.09108034848723351, 0.08121248704102824,
	0.0687601802774073, 0.054866423230241566, 0.040725824949003786, 0.027439206863984635,
	0.01589031993524871, 0.006661748550302831, 2.09666990114042e-18, -0.004168676886250628,
	-0.006178522510691169, -0.0065340634349548635, -0.005807027525383741, -0.004538670923362594,
	-0.003163288371235376, -0.0019635183281894696, -0.0010613407019898114, -0.00044172230934385497,
	-3.106177631319143e-19
];

/** Hamming-windowed sinc low-pass (cutoff fc in cycles/sample), unit DC gain. */
function hammingLowpass(N: number, fc: number): number[] {
	const M = (N - 1) / 2;
	const h = Array.from({ length: N }, (_, i) => {
		const x = i - M;
		const s = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
		return s * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (N - 1)));
	});
	const sum = h.reduce((a, b) => a + b, 0);
	return h.map((v) => v / sum);
}

/**
 * Componentwise backward error |p(z)| / Σ|c_k||z|^(n−k), evaluated on the reversed
 * polynomial at 1/z for |z| > 1 so it cannot overflow.
 */
function backwardError(p: readonly number[], z: Complex): number {
	let x = z;
	let coeffs = p;
	if (abs(z) > 1) {
		const m = abs(z);
		x = c(z.re / m / m, -z.im / m / m);
		coeffs = [...p].reverse();
	}
	const ax = abs(x);
	let vr = 0;
	let vi = 0;
	let s = 0;
	for (const a of coeffs) {
		const nr = vr * x.re - vi * x.im + a;
		vi = vr * x.im + vi * x.re;
		vr = nr;
		s = s * ax + Math.abs(a);
	}
	return Math.hypot(vr, vi) / s;
}

function expectAllRoots(p: readonly number[], rs: readonly Complex[], tol = 1e-13) {
	expect(rs).toHaveLength(p.length - 1);
	for (const z of rs) {
		expect(Number.isFinite(z.re) && Number.isFinite(z.im)).toBe(true);
		expect(backwardError(p, z)).toBeLessThan(tol);
	}
}

const W = Array.from({ length: 256 }, (_, i) => (Math.PI * i) / 255);

/** The FIR's ZPK and SOS realisations reproduce the taps' own response. */
function expectFirModelMatchesTaps(taps: number[]) {
	const model = buildModel('digital', 2, 'fir', { taps });
	const ref = freqzTf({ b: taps, a: [1] }, W);
	const hz = freqzZpk(model.zpk, W);
	const hs = freqzSos(model.sos, W);
	for (let i = 0; i < W.length; i++) {
		expect(abs(c(hz[i].re - ref[i].re, hz[i].im - ref[i].im))).toBeLessThan(1e-11);
		expect(abs(c(hs[i].re - ref[i].re, hs[i].im - ref[i].im))).toBeLessThan(1e-11);
	}
	// unit DC gain, as scipy.signal.tf2sos gives
	expect(abs(freqzSos(model.sos, [0])[0])).toBeCloseTo(1, 12);
}

describe('roots(): no stalled iterate when |p′| overflows', () => {
	it('firwin(25, 0.5): finds the zero near −1.78e15 and its reciprocal', () => {
		const rs = roots(HB25);
		expectAllRoots(HB25, rs);
		const byMag = [...rs].sort((a, b) => abs(a) - abs(b));
		const big = byMag[byMag.length - 1];
		const small = byMag[0];
		// 60-digit Newton-polished roots of the double-precision taps
		expect(big.re / -1775541991031816).toBeCloseTo(1, 12);
		expect(Math.abs(big.im)).toBeLessThan(1e-12 * abs(big));
		expect(small.re / -5.632083076891198e-16).toBeCloseTo(1, 12);
		expect(Math.abs(small.im)).toBeLessThan(1e-12 * abs(small));
		// linear phase: the other 22 zeros are on or reciprocal-paired about |z| = 1
		for (const z of byMag.slice(1, -1)) expect(abs(z)).toBeGreaterThan(0.5);
		for (const z of byMag.slice(1, -1)) expect(abs(z)).toBeLessThan(2);
	});

	it('firwin(25, 0.5) in the TF Analyzer: ZPK and SOS match the taps, SOS DC gain 1', () => {
		expectFirModelMatchesTaps(HB25);
	});

	it('firwin(41, 0.1): zero near −1.42e15', () => {
		const rs = roots(F41);
		expectAllRoots(F41, rs);
		const big = rs.reduce((a, b) => (abs(b) > abs(a) ? b : a));
		expect(big.re / -1422076783021137).toBeCloseTo(1, 12);
		expectFirModelMatchesTaps(F41);
	});

	it('255-tap low-pass (h0 ≈ 1.8e-4, all |z| ≤ 1.1)', () => {
		const taps = hammingLowpass(255, 0.025);
		const rs = roots(taps);
		expectAllRoots(taps, rs);
		for (const z of rs) expect(abs(z)).toBeLessThan(1.1);
		expectFirModelMatchesTaps(taps);
	});

	it('long Hamming low-pass filters up to the 400-tap limit', () => {
		for (const N of [129, 200, 256, 301, 400])
			for (const fc of [0.025, 0.1, 0.25, 0.4]) {
				const taps = hammingLowpass(N, fc);
				expectAllRoots(taps, roots(taps), 1e-12);
			}
	});

	it('analog Butterworth N = 20 at 2π·100 MHz (b/a in rad/s): stable, poles on |s| = ωc', () => {
		const wc = 2 * Math.PI * 1e8;
		const n = 20;
		const poles = Array.from({ length: n }, (_, k) => {
			const t = (Math.PI * (2 * k + n + 1)) / (2 * n);
			return c(wc * Math.cos(t), wc * Math.sin(t));
		});
		const a = polyFromRoots(poles);
		const rs = roots(a);
		expectAllRoots(a, rs);
		for (const p of rs) {
			expect(p.re).toBeLessThan(0);
			expect(abs(p) / wc).toBeCloseTo(1, 6);
		}
		const model = buildModel('analog', 1, 'ba', { b: [a[n]], a });
		const props = analyze(model);
		expect(props.stability).toBe('stable');
		expect(props.worstPole!).toBeLessThan(-0.07 * wc);
	});

	it('wide root spread: roots from 1e-12 to 1e12', () => {
		const want = [1e-12, -3e-6, 0.5, -2, 7e5, -1e12].map((r) => c(r));
		const p = polyFromRoots(want);
		const rs = roots(p).sort((x, y) => abs(x) - abs(y));
		want.forEach((w, i) => expect(rs[i].re / w.re).toBeCloseTo(1, 10));
	});

	it('non-finite coefficients give NaN roots, not plausible-looking values', () => {
		for (const p of [
			[1, NaN, 1, 1],
			[Infinity, 1, 2, 3],
			[1, 2, 3, Infinity]
		]) {
			const rs = roots(p);
			expect(rs).toHaveLength(3);
			for (const z of rs) expect(Number.isNaN(z.re)).toBe(true);
		}
	});
});
