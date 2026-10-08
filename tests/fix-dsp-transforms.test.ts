/**
 * Regression tests for the dsp-transforms fixes:
 *  #2  impulse invariance lost the zeros (and the passband) at moderate orders,
 *  #12 matched-Z / Euler matched the gain in the stopband of even-order Chebyshev II /
 *      elliptic HP and BP filters,
 *  #13 impulse invariance returned NaN for repeated poles (critically damped family).
 */
import { describe, expect, it } from 'vitest';
import { type Complex, abs, add, c, div, exp, mul, scale, sub } from '../src/lib/dsp/complex';
import { zpk2sos } from '../src/lib/dsp/convert';
import { type IIRSpec, designAnalog, designDigital } from '../src/lib/dsp/design';
import {
	type Discretization,
	backwardEuler,
	discretize,
	impulseInvariance,
	matchedZ,
	referenceFrequency
} from '../src/lib/dsp/transforms';
import { evaluate, freqsZpk, freqzSos, freqzZpk, linspace } from '../src/lib/dsp/response';
import { analogTimeResponse, sosfilt } from '../src/lib/dsp/time';
import type { ZPK } from '../src/lib/dsp/types';

const db = (v: number) => 20 * Math.log10(v);

/**
 * Exact impulse-invariant response T·Σ r_i/(1 − e^{p_iT}e^{−jω}) for distinct poles, with
 * a bound on its own rounding error (the terms can be much larger than the sum).
 */
function residueSum(a: ZPK, fs: number, w: readonly number[]) {
	const T = 1 / fs;
	const res = a.p.map((pi, i) => {
		let num = c(a.k);
		for (const z of a.z) num = mul(num, sub(pi, z));
		let den = c(1);
		a.p.forEach((pj, j) => {
			if (j !== i) den = mul(den, sub(pi, pj));
		});
		return div(num, den);
	});
	const d = a.p.map((p) => exp(scale(p, T)));
	return w.map((wi) => {
		const zi = c(Math.cos(wi), -Math.sin(wi));
		let h = c(0);
		let terms = 0;
		res.forEach((r, i) => {
			const t = div(scale(r, T), sub(c(1), mul(d[i], zi)));
			h = add(h, t);
			terms += abs(t);
		});
		return { mag: abs(h), noise: 1e-15 * a.p.length * terms };
	});
}

/** Worst |dB error| of `got` against the exact response, within 100 dB of the peak. */
function worstDb(a: ZPK, fs: number, got: (w: number[]) => Complex[]): number {
	const w = linspace(1e-4, Math.PI, 1500);
	const ref = residueSum(a, fs, w);
	const g = got(w).map(abs);
	const peak = Math.max(...ref.map((r) => r.mag));
	let worst = 0;
	ref.forEach((r, i) => {
		if (r.mag < 1e-5 * peak || r.noise > 1e-9 * r.mag) return;
		worst = Math.max(worst, Math.abs(db(g[i] / r.mag)));
	});
	return worst;
}

/** DTFT of a sampled impulse response. */
function dtft(h: readonly number[], w: readonly number[]): number[] {
	return w.map((wi) => {
		let re = 0;
		let im = 0;
		for (let n = 0; n < h.length; n++) {
			re += h[n] * Math.cos(wi * n);
			im -= h[n] * Math.sin(wi * n);
		}
		return Math.hypot(re, im);
	});
}

const fs = 48000;

describe('#2 impulse invariance stays accurate at high order', () => {
	for (const family of ['butter', 'cheby1', 'bessel'] as const)
		for (const order of [12, 16, 20])
			it(`${family} low-pass N = ${order} (fc = 1 kHz, fs = 48 kHz) matches T·Σ r/(1 − e^{pT}z⁻¹)`, () => {
				const a = designAnalog({ family, band: 'lowpass', order, f1: 1000, rp: 1 });
				const r = impulseInvariance(a, fs);
				expect(r.warning).toBeUndefined();
				expect(worstDb(a, fs, (w) => freqzZpk(r.zpk, w))).toBeLessThan(1e-5);
				// the passband sits on the analog one (it was drawn at +75 dB for Butterworth N = 16)
				const dc = abs(freqzZpk(r.zpk, [0])[0]);
				expect(Math.abs(db(dc) - db(abs(freqsZpk(a, [0])[0])))).toBeLessThan(1e-3);
				// relative degree N ≥ 2: h(0⁺) = 0, so N − 1 zeros (one at z = 0) and a sane k
				expect(r.zpk.z).toHaveLength(order - 1);
				expect(r.zpk.z.filter((z) => z.re === 0 && z.im === 0)).toHaveLength(1);
				expect(r.zpk.k).toBeGreaterThan(0);
			});

	for (const family of ['butter', 'cheby1', 'ellip'] as const)
		for (const order of [8, 12, 14])
			it(`${family} band-pass N = ${order} (4–8 kHz) matches the exact response`, () => {
				const spec: IIRSpec = {
					family,
					band: 'bandpass',
					order,
					f1: 4000,
					f2: 8000,
					rp: 1,
					rs: 60
				};
				const a = designAnalog(spec);
				const r = impulseInvariance(a, fs);
				expect(worstDb(a, fs, (w) => freqzZpk(r.zpk, w))).toBeLessThan(1e-5);
				// the SOS the designer exports agree as well
				const d = designDigital({ ...spec, fs, method: 'impulse' });
				expect(worstDb(a, fs, (w) => freqzSos(d.sos, w))).toBeLessThan(1e-5);
			});

	it('low orders keep a readable z-plane: no spurious huge zero, no k ≈ 1e-15', () => {
		// Butterworth LP N = 4: the sampling zeros are those of the Eulerian polynomial
		// 1 + 4q + q² (≈ −3.7 and −0.27, times e^{pT}) plus z = 0
		const r = impulseInvariance(
			designAnalog({ family: 'butter', band: 'lowpass', order: 4, f1: 1000 }),
			fs
		);
		expect(r.zpk.z).toHaveLength(3);
		expect(Math.max(...r.zpk.z.map(abs))).toBeLessThan(10);
		expect(r.zpk.k).toBeGreaterThan(1e-6);
		// Butterworth BP order 8 (16 poles, relative degree 8): 15 zeros, none near 1e8
		const bp = impulseInvariance(
			designAnalog({ family: 'butter', band: 'bandpass', order: 8, f1: 8000, f2: 12000 }),
			fs
		);
		expect(bp.zpk.z).toHaveLength(15);
		expect(Math.max(...bp.zpk.z.map(abs))).toBeLessThan(1e3);
		expect(Math.abs(bp.zpk.k)).toBeGreaterThan(1e-12);
	});

	it('the digital impulse response is T·h(nT) at N = 16', () => {
		const a = designAnalog({ family: 'butter', band: 'lowpass', order: 16, f1: 1000 });
		const { zpk } = impulseInvariance(a, fs);
		const n = 400;
		const x = new Array(n).fill(0);
		x[0] = 1;
		const y = sosfilt(zpk2sos(zpk), x);
		const h = analogTimeResponse(a, 'impulse', (n - 1) / fs, n).y.map((v) => v / fs);
		const peak = Math.max(...h.map(Math.abs));
		for (let i = 0; i < n; i++) expect(Math.abs(y[i] - h[i])).toBeLessThan(1e-9 * peak);
	});

	it('odd elliptic (h(0⁺) ≠ 0) and even elliptic (feed-through dropped) stay accurate at N = 20', () => {
		for (const order of [19, 20]) {
			const a = designAnalog({ family: 'ellip', band: 'lowpass', order, f1: 1000, rp: 1, rs: 60 });
			const r = impulseInvariance(a, fs);
			expect(worstDb(a, fs, (w) => freqzZpk(r.zpk, w))).toBeLessThan(1e-6);
			expect(r.zpk.z).toHaveLength(order);
		}
	});
});

describe('#13 impulse invariance with repeated poles (critically damped)', () => {
	for (const order of [2, 3, 4, 8, 20])
		it(`critical low-pass N = ${order}: h[n] = T·k·(nT)^{N−1}e^{−anT}/(N−1)!`, () => {
			const a = designAnalog({ family: 'critical', band: 'lowpass', order, f1: 1000 });
			const r = impulseInvariance(a, fs);
			expect(r.warning).toBeUndefined();
			expect(Number.isFinite(r.zpk.k)).toBe(true);
			expect(r.zpk.z.every((z) => Number.isFinite(z.re) && Number.isFinite(z.im))).toBe(true);
			const T = 1 / fs;
			const pa = -a.p[0].re;
			let fact = 1;
			for (let i = 2; i < order; i++) fact *= i;
			const n = 600;
			const exact = Array.from(
				{ length: n },
				(_, i) => (T * a.k * Math.pow(i * T, order - 1) * Math.exp(-pa * i * T)) / fact
			);
			const x = new Array(n).fill(0);
			x[0] = 1;
			const y = sosfilt(zpk2sos(r.zpk), x);
			const peak = Math.max(...exact);
			for (let i = 0; i < n; i++) expect(Math.abs(y[i] - exact[i])).toBeLessThan(1e-10 * peak);
		});

	it('critical N = 4: zeros at 0 and e^{−aT}·(−2 ± √3) (Eulerian polynomial 1 + 4q + q²)', () => {
		const a = designAnalog({ family: 'critical', band: 'lowpass', order: 4, f1: 1000 });
		const d = Math.exp(a.p[0].re / fs);
		const zs = impulseInvariance(a, fs)
			.zpk.z.map((z) => z.re)
			.sort((u, v) => u - v);
		expect(zs[0]).toBeCloseTo(d * (-2 - Math.sqrt(3)), 10);
		expect(zs[1]).toBeCloseTo(d * (-2 + Math.sqrt(3)), 10);
		expect(zs[2]).toBe(0);
	});

	for (const band of ['bandpass', 'highpass', 'bandstop'] as const)
		it(`critical ${band} N = 4 (repeated pole pairs) matches the sampled impulse response`, () => {
			const spec: IIRSpec = { family: 'critical', band, order: 4, f1: 1000, f2: 2000 };
			const a = designAnalog(spec);
			const r = impulseInvariance(a, fs);
			const len = 3000;
			const h = analogTimeResponse(a, 'impulse', (len - 1) / fs, len).y.map((v) => v / fs);
			const w = linspace(1e-3, Math.PI, 300);
			const ref = dtft(h, w);
			const got = freqzZpk(r.zpk, w).map(abs);
			const peak = Math.max(...ref);
			ref.forEach((v, i) => {
				if (v > 1e-4 * peak) expect(Math.abs(db(got[i] / v))).toBeLessThan(1e-6);
			});
			// the designer's SOS are finite too (it showed "non-finite coefficients")
			const d = designDigital({ ...spec, fs, method: 'impulse' });
			expect(d.sos.flat().every(Number.isFinite)).toBe(true);
		});
});

describe('#12 matched-Z / Euler match the gain in the passband', () => {
	const peakDb = (spec: IIRSpec, f: number, method: Discretization) => {
		const zpk = discretize(designAnalog(spec), f, method).zpk;
		return Math.max(
			...evaluate({ kind: 'digital', fs: f, zpk }, linspace(1, f / 2 - 1, 6000)).magDb
		);
	};

	const families = [
		'butter',
		'cheby1',
		'cheby2',
		'ellip',
		'bessel',
		'legendre',
		'critical',
		'gaussian'
	] as const;

	it('band-pass filters are matched at the band centre √(ω₁ω₂) for every family and order', () => {
		// not at the −Rs DC floor (even-order Chebyshev II / elliptic), and not at whichever of
		// the N equal ripple peaks happens to be largest after rounding (often a band edge)
		for (const family of families)
			for (let order = 1; order <= 10; order++)
				for (const [f1, f2, f] of [
					[1000, 2000, 16000],
					[300, 600, 16000],
					[1000, 2000, 48000],
					[2500, 3500, 8000],
					[1000, 1010, 8000]
				])
					for (const rs of [40, 60, 80]) {
						const a = designAnalog({ family, band: 'bandpass', order, f1, f2, rp: 1, rs });
						const w0 = 2 * Math.PI * Math.sqrt(f1 * f2);
						expect(Math.abs(referenceFrequency(a, f) / w0 - 1)).toBeLessThan(1e-6);
					}
	});

	it('even-order elliptic band-pass with matched-Z is no longer drawn ≈ 20 dB high', () => {
		// N = 2, 1–2 kHz, fs = 16 kHz: the peak was +19.75 dB (Rs 60) and +20.97 dB (Rs 50);
		// what is left (SciPy: +5.90 / +5.00 dB) is matched-Z's own aliasing of the zeros
		for (const [rs, peak] of [
			[60, 5.9],
			[50, 5.0]
		]) {
			const spec: IIRSpec = {
				family: 'ellip',
				band: 'bandpass',
				order: 2,
				f1: 1000,
				f2: 2000,
				rp: 1,
				rs
			};
			expect(peakDb(spec, 16000, 'matched')).toBeCloseTo(peak, 1);
			const a = designAnalog(spec);
			const d = discretize(a, 16000, 'matched').zpk;
			const w0 = 2 * Math.PI * Math.sqrt(2e6);
			expect(abs(freqzZpk(d, [w0 / 16000])[0])).toBeCloseTo(abs(freqsZpk(a, [w0])[0]), 12);
		}
	});

	it('backward Euler band-pass: even and odd orders all peak within 0.7 dB of 0 dB', () => {
		const cases: [IIRSpec, number][] = [
			// ellip N6 was +16.2 dB (matched at a 1981 Hz ripple peak), the original code −10.3 dB
			[{ family: 'ellip', band: 'bandpass', order: 6, f1: 1000, f2: 2000, rp: 1, rs: 80 }, 48000],
			[{ family: 'ellip', band: 'bandpass', order: 7, f1: 1000, f2: 2000, rp: 1, rs: 80 }, 48000],
			[{ family: 'ellip', band: 'bandpass', order: 8, f1: 300, f2: 600, rp: 1, rs: 60 }, 16000],
			[{ family: 'ellip', band: 'bandpass', order: 9, f1: 300, f2: 600, rp: 1, rs: 60 }, 16000],
			// cheby2 N4 was −9.75 dB
			[{ family: 'cheby2', band: 'bandpass', order: 4, f1: 1000, f2: 2000, rs: 40 }, 48000],
			[{ family: 'cheby2', band: 'bandpass', order: 5, f1: 1000, f2: 2000, rs: 40 }, 48000],
			// cheby1 N4 was +4.42 dB (one of four equal 0 dB ripple peaks)
			[{ family: 'cheby1', band: 'bandpass', order: 4, f1: 1000, f2: 2000, rp: 1 }, 16000]
		];
		for (const [spec, f] of cases)
			expect(Math.abs(peakDb(spec, f, 'backward-euler'))).toBeLessThan(0.7);
	});

	it('high-pass filters are matched an octave above the −3 dB point', () => {
		const butter = designAnalog({ family: 'butter', band: 'highpass', order: 4, f1: 1000 });
		expect(referenceFrequency(butter, fs) / (2 * Math.PI * 2000)).toBeCloseTo(1, 9);
		const cases: [IIRSpec, number][] = [
			// ellip N8 was +12.76 dB (matched at a 319 Hz ripple peak), the original code −4.63 dB
			[{ family: 'ellip', band: 'highpass', order: 8, f1: 300, rp: 1, rs: 50 }, 8000],
			// cheby1 N7 was +7.48 dB
			[{ family: 'cheby1', band: 'highpass', order: 7, f1: 300, rp: 1 }, 8000],
			// cheby2 N4 was −14.1 dB (matched at the −Rs DC floor)
			[{ family: 'cheby2', band: 'highpass', order: 4, f1: 1000, rs: 40 }, 8000]
		];
		for (const [spec, f] of cases)
			expect(Math.abs(peakDb(spec, f, 'backward-euler'))).toBeLessThan(0.6);
		// even-order Chebyshev I with Rp > 3 dB: |H(∞)| = −Rp is still the passband
		const c1 = designAnalog({ family: 'cheby1', band: 'highpass', order: 10, f1: 1000, rp: 6 });
		const w = referenceFrequency(c1, 48000);
		expect(w).toBeGreaterThan(2 * Math.PI * 2000);
		expect(w).toBeLessThan(2 * Math.PI * 2200);
	});

	it('low-pass and band-stop filters are still matched at DC', () => {
		const lp = designAnalog({ family: 'cheby1', band: 'lowpass', order: 4, f1: 1000, rp: 1 });
		expect(referenceFrequency(lp, fs)).toBe(0);
		const d = matchedZ(lp, fs);
		expect(abs(freqzZpk(d, [0])[0])).toBeCloseTo(abs(freqsZpk(lp, [0])[0]), 12);
		const bs = designAnalog({
			family: 'ellip',
			band: 'bandstop',
			order: 4,
			f1: 1000,
			f2: 2000,
			rp: 1,
			rs: 60
		});
		expect(referenceFrequency(bs, fs)).toBe(0);
		// even orders with the largest ripple (DC is a −6 dB ripple trough, still passband)
		for (const band of ['lowpass', 'bandstop'] as const)
			for (const family of ['cheby1', 'ellip'] as const) {
				const a = designAnalog({ family, band, order: 4, f1: 1000, f2: 2000, rp: 6, rs: 10 });
				expect(referenceFrequency(a, fs)).toBe(0);
			}
	});

	it('an explicit reference frequency is honoured', () => {
		const a = designAnalog({ family: 'cheby2', band: 'highpass', order: 4, f1: 1000, rs: 40 });
		const w = 2 * Math.PI * 2000;
		for (const zpk of [
			matchedZ(a, 8000, 'nyquist', w),
			backwardEuler(a, 8000, w),
			discretize(a, 8000, 'forward-euler', w).zpk,
			discretize(a, 8000, 'matched', w).zpk
		])
			expect(abs(freqzZpk(zpk, [w / 8000])[0])).toBeCloseTo(abs(freqsZpk(a, [w])[0]), 12);
	});
});

describe('#12 the reference stays in the passband at high order (no overflow)', () => {
	const digitalPeakDb = (zpk: ZPK, f: number) =>
		Math.max(...evaluate({ kind: 'digital', fs: f, zpk }, linspace(1, f / 2 - 1, 8000)).magDb);

	it('band-pass N = 11–20 is matched at the band centre at 48 / 96 kHz for every family', () => {
		// 2N zeros multiplied out far above the poles used to give |H| = Infinity/NaN, a
		// non-finite peak and the π·fs/2 fallback (often in the stopband)
		for (const family of ['butter', 'cheby1', 'cheby2', 'ellip', 'bessel', 'legendre'] as const)
			for (let order = 11; order <= 20; order++)
				for (const [f1, f2, f] of [
					[14400, 19200, 48000],
					[8000, 12000, 48000],
					[2000, 4000, 96000],
					[20000, 30000, 96000]
				]) {
					const a = designAnalog({ family, band: 'bandpass', order, f1, f2, rp: 1, rs: 60 });
					const w0 = 2 * Math.PI * Math.sqrt(f1 * f2);
					expect(Math.abs(referenceFrequency(a, f) / w0 - 1)).toBeLessThan(1e-6);
				}
	});

	it('Chebyshev II band-pass N = 19 (14.4–19.2 kHz, fs = 48 kHz, matched-Z) peaks within 1 dB', () => {
		// was matched at 12 kHz (|Ha| = −62.3 dB) → +15.25 dB; SciPy at the centre: +0.14 dB
		const spec: IIRSpec = {
			family: 'cheby2',
			band: 'bandpass',
			order: 19,
			f1: 14400,
			f2: 19200,
			rs: 60
		};
		const d = designDigital({ ...spec, fs, method: 'matched' });
		expect(Math.abs(digitalPeakDb(d.zpk, fs))).toBeLessThan(1);
		const w0 = 2 * Math.PI * Math.sqrt(14400 * 19200);
		expect(abs(freqzZpk(d.zpk, [w0 / fs])[0])).toBeCloseTo(abs(freqsZpk(d.analog, [w0])[0]), 9);
	});

	it('elliptic band-pass N = 19 at 96 kHz and Chebyshev II N = 20 at the default edges', () => {
		// ellip: was matched at 24 kHz (|Ha| = −66.65 dB) → +2.09 dB
		const e = designDigital({
			family: 'ellip',
			band: 'bandpass',
			order: 19,
			f1: 2000,
			f2: 4000,
			rp: 1,
			rs: 60,
			fs: 96000,
			method: 'matched'
		});
		expect(Math.abs(digitalPeakDb(e.zpk, 96000))).toBeLessThan(0.1);
		// cheby2 N20, 8–12 kHz: was matched at the 12 kHz stopband edge (|Ha| = −60 dB)
		const spec: IIRSpec = {
			family: 'cheby2',
			band: 'bandpass',
			order: 20,
			f1: 8000,
			f2: 12000,
			rs: 60
		};
		const a = designAnalog(spec);
		expect(referenceFrequency(a, fs) / (2 * Math.PI * Math.sqrt(96e6))).toBeCloseTo(1, 9);
		expect(Math.abs(digitalPeakDb(discretize(a, fs, 'backward-euler').zpk, fs))).toBeLessThan(1);
		expect(Math.abs(digitalPeakDb(discretize(a, 96000, 'matched').zpk, 96000))).toBeLessThan(1);
	});

	it('high-order band-stop filters are matched at DC, not inside the notch', () => {
		for (const family of ['butter', 'bessel', 'cheby2', 'ellip'] as const)
			for (const order of [19, 20]) {
				const a = designAnalog({
					family,
					band: 'bandstop',
					order,
					f1: 11000,
					f2: 13000,
					rp: 1,
					rs: 60
				});
				expect(referenceFrequency(a, fs)).toBe(0);
				const d = discretize(a, fs, 'matched').zpk;
				expect(Number.isFinite(d.k) && d.k > 0).toBe(true);
				expect(abs(freqzZpk(d, [0])[0])).toBeCloseTo(abs(freqsZpk(a, [0])[0]), 9);
			}
	});

	it('the matched gain is finite at high order (computed as a difference of logs)', () => {
		for (const method of ['matched', 'forward-euler', 'backward-euler'] as const) {
			const a = designAnalog({
				family: 'cheby2',
				band: 'bandpass',
				order: 20,
				f1: 80000,
				f2: 90000,
				rs: 80
			});
			const d = discretize(a, 192000, method).zpk;
			const w0 = 2 * Math.PI * Math.sqrt(80000 * 90000);
			expect(Number.isFinite(d.k) && d.k > 0).toBe(true);
			const ha = abs(freqsZpk(a, [w0])[0]);
			expect(abs(freqzZpk(d, [w0 / 192000])[0]) / ha).toBeCloseTo(1, 9);
		}
	});
});
