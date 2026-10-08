import { describe, expect, it } from 'vitest';
import ref from './fixtures/scipy_reference.json';
import { type Complex, abs, c } from '../src/lib/dsp/complex';
import { besselap, buttap, cheb1ap, cheb2ap, ellipap, legendreap, prototype, find3dB, gaussianap, criticalap } from '../src/lib/dsp/analog';
import { designAnalog, designDigital, estimateFromSpecs } from '../src/lib/dsp/design';
import { evaluate, freqsZpk, groupDelayTf, toDb } from '../src/lib/dsp/response';
import { zpk2sos, sos2tf, tf2zpk, zpk2tf, analogStages, sos2zpk } from '../src/lib/dsp/convert';
import { analogTimeResponse, lfilter, sosfilt } from '../src/lib/dsp/time';
import { windowValues, windowMetrics, type WindowType } from '../src/lib/dsp/windows';
import { firwin, firls, firwin2, savitzkyGolay, hilbertFir, minimumPhase, differentiatorFir } from '../src/lib/dsp/fir';
import { remez } from '../src/lib/dsp/remez';
import { roots, polyFromRoots } from '../src/lib/dsp/poly';
import { biquad } from '../src/lib/dsp/biquad';
import { bilinear, impulseInvariance, matchedZ } from '../src/lib/dsp/transforms';
import { expm } from '../src/lib/dsp/linalg';
import { parseSI, formatSI, toESeries } from '../src/lib/dsp/units';
import type { ZPK } from '../src/lib/dsp/types';
import type { AnalogFamily } from '../src/lib/dsp/analog';

const toC = (arr: number[][]): Complex[] => arr.map(([re, im]) => c(re, im));

/** Every root in `a` has a match in `b` within tolerance (multiset match). */
function expectRootsClose(a: Complex[], b: Complex[], tol = 1e-6) {
	expect(a.length).toBe(b.length);
	const used = new Array(b.length).fill(false);
	for (const r of a) {
		let best = -1;
		let bestD = Infinity;
		b.forEach((s, i) => {
			if (used[i]) return;
			const d = Math.hypot(r.re - s.re, r.im - s.im);
			if (d < bestD) {
				bestD = d;
				best = i;
			}
		});
		used[best] = true;
		expect(bestD / Math.max(1, abs(r))).toBeLessThan(tol);
	}
}

function expectArrayClose(a: ArrayLike<number>, b: ArrayLike<number>, tol = 1e-8) {
	expect(a.length).toBe(b.length);
	for (let i = 0; i < a.length; i++) {
		const scale = Math.max(1, Math.abs(b[i]));
		expect(Math.abs(a[i] - b[i]) / scale, `index ${i}: ${a[i]} vs ${b[i]}`).toBeLessThan(tol);
	}
}

describe('polynomials', () => {
	it('finds roots of a known polynomial', () => {
		const rs = [c(-1), c(2), c(0.5, 3), c(0.5, -3), c(-4, 0.1), c(-4, -0.1)];
		const p = polyFromRoots(rs);
		expectRootsClose(roots(p), rs, 1e-9);
	});
	it('handles roots at the origin and high degree', () => {
		const rs = Array.from({ length: 40 }, (_, k) => c(Math.cos((2 * Math.PI * k) / 40) * 0.9, Math.sin((2 * Math.PI * k) / 40) * 0.9));
		rs.push(c(0), c(0));
		expectRootsClose(roots(polyFromRoots(rs)), rs, 1e-6);
	});
});

describe('analog prototypes match SciPy', () => {
	for (const pr of ref.prototypes as any[]) {
		const label = `${pr.family} N=${pr.N}${pr.norm ? ' ' + pr.norm : ''}${pr.rp ? ' rp=' + pr.rp : ''}${pr.rs ? ' rs=' + pr.rs : ''}`;
		it(label, () => {
			let zpk: ZPK;
			switch (pr.family) {
				case 'butter': zpk = buttap(pr.N); break;
				case 'cheby1': zpk = cheb1ap(pr.N, pr.rp); break;
				case 'cheby2': zpk = cheb2ap(pr.N, pr.rs); break;
				case 'ellip': zpk = ellipap(pr.N, pr.rp, pr.rs); break;
				default: zpk = besselap(pr.N, pr.norm);
			}
			const tol = pr.family === 'bessel' && pr.N >= 12 ? 1e-5 : 1e-7;
			expectRootsClose(zpk.p, toC(pr.p), tol);
			expectRootsClose(zpk.z, toC(pr.z), tol);
			expect(Math.abs(zpk.k - pr.k) / Math.abs(pr.k)).toBeLessThan(tol * 10);
		});
	}
});

describe('other prototypes', () => {
	it('Legendre N=3 matches published poles and is −3 dB at ω=1', () => {
		const zpk = legendreap(3);
		expectRootsClose(zpk.p, [c(-0.6203, 0), c(-0.3451, 0.9008), c(-0.3451, -0.9008)], 2e-3);
		expect(toDb(abs(freqsZpk(zpk, [1])[0]))).toBeCloseTo(-3.0103, 3);
		expect(abs(freqsZpk(zpk, [0])[0])).toBeCloseTo(1, 9);
	});
	it('Legendre is monotonic and steeper than Butterworth', () => {
		for (const N of [2, 3, 4, 5, 8]) {
			const L = legendreap(N);
			const B = buttap(N);
			const w = Array.from({ length: 200 }, (_, i) => 0.01 + i * 0.02);
			const mags = freqsZpk(L, w).map(abs);
			for (let i = 1; i < mags.length; i++) expect(mags[i]).toBeLessThanOrEqual(mags[i - 1] + 1e-12);
			// N = 2 Legendre is identical to Butterworth
			if (N > 2) expect(abs(freqsZpk(L, [2])[0])).toBeLessThan(abs(freqsZpk(B, [2])[0]));
			expect(toDb(abs(freqsZpk(L, [1])[0]))).toBeCloseTo(-3.0103, 3);
		}
	});
	it('Gaussian and critically damped prototypes are −3 dB at ω=1 with unity DC gain', () => {
		for (const N of [1, 2, 3, 5, 8]) {
			for (const zpk of [gaussianap(N), criticalap(N)]) {
				expect(abs(freqsZpk(zpk, [0])[0])).toBeCloseTo(1, 8);
				expect(find3dB(zpk)).toBeCloseTo(1, 6);
			}
		}
	});
	it('every family supports all orders up to its maximum', () => {
		const fams: AnalogFamily[] = ['butter', 'cheby1', 'cheby2', 'ellip', 'bessel', 'legendre', 'gaussian', 'critical'];
		for (const f of fams) {
			for (const N of [1, 2, 7, 10]) {
				const zpk = prototype(f, N, { rp: 1, rs: 50 });
				expect(zpk.p.length).toBe(N);
				expect(zpk.p.every((p) => p.re < 0)).toBe(true);
				expect(Number.isFinite(zpk.k)).toBe(true);
			}
		}
	});
});

describe('order estimation matches SciPy', () => {
	for (const o of ref.orders as any[]) {
		const label = `${o.family} ${o.band} ${o.fs ? 'digital' : 'analog'}`;
		it(label, () => {
			const est = estimateFromSpecs(o.family, {
				band: o.band,
				fp: o.wp,
				fstop: o.ws,
				rp: o.gpass,
				rs: o.gstop,
				fs: o.fs ?? undefined
			});
			expect(est.order).toBe(o.N);
			// natural frequencies: SciPy's band-stop optimisation differs, and its
			// Chebyshev II band-pass/stop "Wn" uses a different convention.
			if (o.family !== 'cheby2' || o.band === 'lowpass' || o.band === 'highpass') {
				// SciPy's band-stop edge optimiser stops at a loose tolerance
				const tol = o.band === 'bandstop' ? 5e-5 : 1e-6;
				expect(Math.abs(est.f1 - o.Wn[0]) / o.Wn[0]).toBeLessThan(tol);
				if (o.Wn.length > 1) expect(Math.abs(est.f2! - o.Wn[1]) / o.Wn[1]).toBeLessThan(tol);
			}
		});
	}
	it('designs from estimated specs meet the specification (analog band-stop)', () => {
		const bessel = estimateFromSpecs('bessel', { band: 'lowpass', fp: 1000, fstop: 1500, rp: 1, rs: 40 });
		expect(bessel.capped).toBe(true);
		for (const family of ['butter', 'cheby1', 'cheby2', 'ellip', 'legendre', 'critical'] as AnalogFamily[]) {
			const spec = { band: 'bandstop' as const, fp: [700, 3000] as [number, number], fstop: [1000, 2000] as [number, number], rp: 1, rs: 40 };
			const est = estimateFromSpecs(family, spec);
			if (est.capped) continue;
			const zpk = designAnalog({ family, band: 'bandstop', order: est.order, f1: est.f1, f2: est.f2, rp: 1, rs: 40 });
			const r = evaluate({ kind: 'analog', zpk }, [10, 700, 3000, 1000, 1500, 2000, 20000]);
			// all families have a 0 dB passband maximum (even-order Chebyshev I / elliptic start at −Rp)
			expect(r.magDb[1]).toBeGreaterThan(-1 - 1e-3);
			expect(r.magDb[2]).toBeGreaterThan(-1 - 1e-3);
			for (const i of [3, 4, 5]) expect(r.magDb[i]).toBeLessThan(-40 + 1e-3);
		}
	});
});

describe('digital IIR designs match SciPy frequency responses', () => {
	for (const d of ref.digital as any[]) {
		it(`${d.family} ${d.band} N=${d.N}`, () => {
			const res = designDigital({
				family: d.family,
				band: d.band,
				order: d.N,
				f1: d.f1,
				f2: d.f2,
				rp: d.rp,
				rs: d.rs,
				besselNorm: d.norm,
				fs: d.fs
			});
			const r = evaluate({ kind: 'digital', fs: d.fs, sos: res.sos }, d.f);
			const rz = evaluate({ kind: 'digital', fs: d.fs, zpk: res.zpk }, d.f);
			for (let i = 0; i < d.f.length; i++) {
				if (d.magDb[i] < -150) continue;
				expect(Math.abs(r.magDb[i] - d.magDb[i])).toBeLessThan(1e-5);
				expect(Math.abs(rz.magDb[i] - d.magDb[i])).toBeLessThan(1e-5);
			}
		});
	}
});

describe('analog designs match SciPy', () => {
	for (const d of ref.analog as any[]) {
		it(`${d.family} ${d.band}`, () => {
			const zpk = designAnalog({ family: d.family, band: d.band, order: d.N, f1: d.f1, f2: d.f2, rp: d.rp, rs: d.rs });
			const r = evaluate({ kind: 'analog', zpk }, d.f);
			for (let i = 0; i < d.f.length; i++) {
				if (d.magDb[i] < -150) continue;
				expect(Math.abs(r.magDb[i] - d.magDb[i])).toBeLessThan(1e-6);
			}
		});
	}
});

describe('conversions', () => {
	it('zpk ↔ tf ↔ sos round trip preserves the response', () => {
		const { zpk } = designDigital({ family: 'ellip', band: 'bandpass', order: 5, f1: 1000, f2: 3000, rp: 0.5, rs: 50, fs: 16000 });
		const sos = zpk2sos(zpk);
		const tf = zpk2tf(zpk);
		const f = [50, 500, 1000, 2000, 3000, 6000];
		const a = evaluate({ kind: 'digital', fs: 16000, zpk }, f).magDb;
		const b = evaluate({ kind: 'digital', fs: 16000, sos }, f).magDb;
		const t = evaluate({ kind: 'digital', fs: 16000, tf }, f).magDb;
		const t2 = evaluate({ kind: 'digital', fs: 16000, tf: sos2tf(sos) }, f).magDb;
		const z2 = evaluate({ kind: 'digital', fs: 16000, zpk: tf2zpk(tf) }, f).magDb;
		const z3 = evaluate({ kind: 'digital', fs: 16000, zpk: sos2zpk(sos) }, f).magDb;
		expectArrayClose(b, a, 1e-7);
		expectArrayClose(t, a, 1e-5);
		expectArrayClose(t2, a, 1e-5);
		expectArrayClose(z2, a, 1e-4);
		expectArrayClose(z3, a, 1e-6);
	});
	it('handles fewer zeros than poles (delay) exactly', () => {
		const zpk: ZPK = { z: [c(0.5)], p: [c(0.3, 0.4), c(0.3, -0.4), c(-0.2)], k: 2 };
		const f = [0, 0.05, 0.1, 0.3, 0.45];
		const ref1 = evaluate({ kind: 'digital', fs: 1, zpk }, f);
		const viaSos = evaluate({ kind: 'digital', fs: 1, sos: zpk2sos(zpk) }, f);
		const viaTf = evaluate({ kind: 'digital', fs: 1, tf: zpk2tf(zpk) }, f);
		for (let i = 0; i < f.length; i++) {
			expect(abs({ re: viaSos.H[i].re - ref1.H[i].re, im: viaSos.H[i].im - ref1.H[i].im })).toBeLessThan(1e-10);
			expect(abs({ re: viaTf.H[i].re - ref1.H[i].re, im: viaTf.H[i].im - ref1.H[i].im })).toBeLessThan(1e-10);
		}
	});
	it('analog stages are ordered by Q and multiply back to the filter', () => {
		const zpk = designAnalog({ family: 'cheby1', band: 'lowpass', order: 7, f1: 1000, rp: 1 });
		const st = analogStages(zpk);
		expect(st.length).toBe(4);
		expect(st[0].order).toBe(1);
		for (let i = 2; i < st.length; i++) expect(st[i].q).toBeGreaterThanOrEqual(st[i - 1].q);
	});
});

describe('frequency response details', () => {
	it('group delay matches SciPy', () => {
		const g = ref.groupDelay;
		expectArrayClose(groupDelayTf({ b: g.b, a: g.a }, g.w), g.gd, 1e-7);
	});
	it('digital group delay is consistent across representations', () => {
		const { zpk, sos } = designDigital({ family: 'butter', band: 'lowpass', order: 6, f1: 3000, fs: 48000 });
		const f = [100, 1000, 3000, 6000];
		const a = evaluate({ kind: 'digital', fs: 48000, zpk }, f).groupDelay;
		const b = evaluate({ kind: 'digital', fs: 48000, sos }, f).groupDelay;
		expectArrayClose(a, b, 1e-6);
	});
});

describe('time responses', () => {
	it('analog step & impulse match SciPy', () => {
		const s = ref.analogStep;
		const zpk = buttap(4);
		const st = analogTimeResponse(zpk, 'step', 15, 31);
		const im = analogTimeResponse(zpk, 'impulse', 15, 31);
		expectArrayClose(st.y, s.step, 1e-7);
		expectArrayClose(im.y, s.impulse, 1e-7);
		const hp = s.hp;
		const hpZpk = { z: toC(hp.z), p: toC(hp.p), k: hp.k };
		const hpStep = analogTimeResponse(hpZpk, 'step', 0.05, 26);
		expectArrayClose(hpStep.y, hp.step, 1e-6);
	});
	it('sosfilt and lfilter agree', () => {
		const { sos } = designDigital({ family: 'cheby1', band: 'lowpass', order: 4, f1: 1000, rp: 1, fs: 8000 });
		const tf = sos2tf(sos);
		const x = Array.from({ length: 200 }, (_, i) => Math.sin(i * 0.3) + (i % 7 === 0 ? 1 : 0));
		expectArrayClose(sosfilt(sos, x), lfilter(tf.b, tf.a, x), 1e-9);
	});
	it('expm of a rotation generator', () => {
		const E = expm([[0, -1], [1, 0]]);
		expect(E[0][0]).toBeCloseTo(Math.cos(1), 12);
		expect(E[1][0]).toBeCloseTo(Math.sin(1), 12);
	});
});

describe('windows match SciPy', () => {
	const wins = ref.windows as Record<string, number[]>;
	for (const key of Object.keys(wins)) {
		it(key, () => {
			const parts = key.split('-');
			const N = Number(parts[parts.length - 1]);
			const periodic = parts.includes('periodic');
			const type = parts[0] as WindowType;
			const param = { kaiser: 6, tukey: 0.4, chebyshev: 80, dpss: 3 }[type as string];
			expectArrayClose(windowValues(type, N, param, periodic), wins[key], type === 'dpss' ? 1e-6 : 1e-9);
		});
	}
	it('metrics are sensible', () => {
		const m = windowMetrics(windowValues('hann', 64));
		expect(m.peakSidelobeDb).toBeGreaterThan(-32.5);
		expect(m.peakSidelobeDb).toBeLessThan(-31);
		expect(m.enbw).toBeCloseTo(1.5, 1);
		expect(m.mainLobeWidth).toBeCloseTo(4, 0);
	});
});

describe('FIR designs match SciPy', () => {
	const f = ref.fir as Record<string, number[]>;
	it('firwin variants', () => {
		expectArrayClose(firwin(31, [100], { type: 'hamming' }, true, 1000), f.firwin_lp, 1e-10);
		expectArrayClose(firwin(31, [200], { type: 'kaiser', param: 5 }, false, 1000), f.firwin_hp, 1e-10);
		expectArrayClose(firwin(41, [100, 250], { type: 'blackman' }, false, 1000), f.firwin_bp, 1e-10);
		expectArrayClose(firwin(41, [100, 250], { type: 'hann' }, true, 1000), f.firwin_bs, 1e-10);
	});
	it('firls', () => {
		expectArrayClose(
			firls(41, [{ f1: 0, f2: 100, d1: 1, d2: 1, weight: 1 }, { f1: 150, f2: 500, d1: 0, d2: 0, weight: 10 }], 1000),
			f.firls,
			1e-8
		);
		expectArrayClose(
			firls(31, [{ f1: 0, f2: 200, d1: 0, d2: 1, weight: 1 }, { f1: 250, f2: 500, d1: 0, d2: 0, weight: 1 }], 1000),
			f.firls_ramp,
			1e-8
		);
	});
	it('firwin2', () => {
		expectArrayClose(firwin2(51, [0, 100, 150, 300, 350, 500], [1, 1, 0.2, 0.2, 1, 1], 1000), f.firwin2, 1e-9);
	});
	it('remez low-pass', () => {
		const r = remez(41, [{ f1: 0, f2: 100, d1: 1, d2: 1, weight: 1 }, { f1: 150, f2: 500, d1: 0, d2: 0, weight: 10 }], 1000);
		expect(r.converged).toBe(true);
		expectArrayClose(r.h, f.remez_lp, 2e-4);
	});
	it('remez even-length band-pass', () => {
		const r = remez(52, [
			{ f1: 0, f2: 80, d1: 0, d2: 0, weight: 1 },
			{ f1: 120, f2: 250, d1: 1, d2: 1, weight: 1 },
			{ f1: 300, f2: 500, d1: 0, d2: 0, weight: 1 }
		], 1000);
		expectArrayClose(r.h, f.remez_bp, 2e-4);
	});
	it('remez Hilbert', () => {
		const r = remez(31, [{ f1: 20, f2: 480, d1: 1, d2: 1, weight: 1 }], 1000, { symmetry: 'odd' });
		// SciPy's remez returns the +j·sgn(ω) convention; we use the standard −j·sgn(ω).
		expectArrayClose(r.h, f.remez_hilbert.map((v) => -v), 2e-4);
	});
	it('Savitzky–Golay', () => {
		expectArrayClose(savitzkyGolay(5, 2), f.savgol_5_2, 1e-10);
		expectArrayClose(savitzkyGolay(7, 3, 1), f.savgol_7_3_d1, 1e-10);
	});
	it('Hilbert and differentiator have the right shape', () => {
		const h = hilbertFir(31, { type: 'hann' });
		const r = evaluate({ kind: 'digital', fs: 1, fir: h }, [0.25]);
		expect(r.mag[0]).toBeCloseTo(1, 1);
		const d = differentiatorFir(32, { type: 'hann' });
		const rd = evaluate({ kind: 'digital', fs: 1, fir: d }, [0.1]);
		expect(rd.mag[0]).toBeCloseTo(2 * Math.PI * 0.1, 2);
	});
	it('minimum phase keeps the magnitude', () => {
		const h = firwin(41, [100], { type: 'hamming' }, true, 1000);
		const m = minimumPhase(h);
		const f = [0, 50, 90];
		const a = evaluate({ kind: 'digital', fs: 1000, fir: h }, f).magDb;
		const b = evaluate({ kind: 'digital', fs: 1000, fir: m }, f).magDb;
		expectArrayClose(b, a, 2e-2);
	});
});

describe('discretisation', () => {
	it('bilinear maps a stable analog filter inside the unit circle', () => {
		const z = bilinear(designAnalog({ family: 'butter', band: 'lowpass', order: 5, f1: 1000 }), 8000);
		expect(z.p.every((p) => abs(p) < 1)).toBe(true);
	});
	it('impulse invariance samples the impulse response', () => {
		const analog = designAnalog({ family: 'butter', band: 'lowpass', order: 3, f1: 100 });
		const fs = 4000;
		const { zpk } = impulseInvariance(analog, fs);
		const n = 40;
		const x = new Array(n).fill(0);
		x[0] = 1;
		const y = sosfilt(zpk2sos(zpk), x);
		const h = analogTimeResponse(analog, 'impulse', (n - 1) / fs, n).y;
		for (let i = 0; i < n; i++) expect(y[i]).toBeCloseTo(h[i] / fs, 8);
	});
	it('matched-Z matches DC gain', () => {
		const analog = designAnalog({ family: 'cheby1', band: 'lowpass', order: 3, f1: 500, rp: 1 });
		const d = matchedZ(analog, 8000);
		const g = evaluate({ kind: 'digital', fs: 8000, zpk: d }, [0]).mag[0];
		expect(g).toBeCloseTo(abs(freqsZpk(analog, [0])[0]), 9);
	});
});

describe('biquads', () => {
	const fs = 48000;
	it('low-pass has unity DC gain and Q gain at f0', () => {
		const s = biquad({ type: 'lowpass', f0: 1000, fs, q: 2 });
		const r = evaluate({ kind: 'digital', fs, sos: [s] }, [0, 1000]);
		expect(r.mag[0]).toBeCloseTo(1, 10);
		expect(r.mag[1]).toBeCloseTo(2, 2);
	});
	it('peaking EQ reaches its gain at f0', () => {
		const s = biquad({ type: 'peaking', f0: 2000, fs, q: 1, gainDb: 6 });
		const r = evaluate({ kind: 'digital', fs, sos: [s] }, [2000]);
		expect(r.magDb[0]).toBeCloseTo(6, 6);
	});
	it('notch is a zero at f0', () => {
		const s = biquad({ type: 'notch', f0: 60, fs, q: 10 });
		expect(evaluate({ kind: 'digital', fs, sos: [s] }, [60]).mag[0]).toBeLessThan(1e-9);
	});
	it('shelves reach their gain and half-gain at f0', () => {
		for (const type of ['lowshelf', 'highshelf', 'lowshelf1', 'highshelf1'] as const) {
			const s = biquad({ type, f0: 1000, fs, q: Math.SQRT1_2, gainDb: 12 });
			const r = evaluate({ kind: 'digital', fs, sos: [s] }, [1, 1000, 23999]);
			const low = r.magDb[0];
			const high = r.magDb[2];
			expect(Math.max(low, high)).toBeCloseTo(12, 1);
			expect(r.magDb[1]).toBeCloseTo(6, 1);
		}
	});
	it('first-order all-pass is flat', () => {
		const s = biquad({ type: 'allpass1', f0: 1000, fs });
		const r = evaluate({ kind: 'digital', fs, sos: [s] }, [10, 1000, 10000]);
		expectArrayClose(r.mag, [1, 1, 1], 1e-10);
		expect(r.phaseDeg[1]).toBeCloseTo(-90, 6);
	});
});

describe('units', () => {
	it('parses engineering notation', () => {
		expect(parseSI('4.7k')).toBeCloseTo(4700);
		expect(parseSI('10n')).toBeCloseTo(1e-8);
		expect(parseSI('2.2 µF')).toBeCloseTo(2.2e-6);
		expect(parseSI('4k7')).toBeCloseTo(4700);
		expect(parseSI('1e3 Hz')).toBe(1000);
		expect(parseSI('1meg')).toBe(1e6);
		expect(Number.isNaN(parseSI('abc'))).toBe(true);
	});
	it('formats engineering notation', () => {
		expect(formatSI(4700, 'Ω')).toBe('4.7 kΩ');
		expect(formatSI(1.5e-9, 'F')).toBe('1.5 nF');
	});
	it('rounds to E-series', () => {
		expect(toESeries(4800, 'E12')).toBe(4700);
		expect(toESeries(9.5e-9, 'E6')).toBeCloseTo(1e-8, 15);
	});
});

describe('capped order estimation', () => {
	it('keeps the passband spec exact at the maximum order', () => {
		// needs N > 30 for both families: design at 30 but with exactly 1 dB loss at the passband edge
		for (const family of ['butter', 'cheby2'] as AnalogFamily[]) {
			const est = estimateFromSpecs(family, { band: 'lowpass', fp: 1000, fstop: 1050, rp: 1, rs: 98 });
			expect(est.capped).toBe(true);
			const zpk = designAnalog({ family, band: 'lowpass', order: est.order, f1: est.f1, rp: 1, rs: 98 });
			const r = evaluate({ kind: 'analog', zpk }, [1000]);
			expect(r.magDb[0]).toBeCloseTo(-1, 3);
		}
	});
});
