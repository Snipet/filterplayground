import { describe, expect, it } from 'vitest';
import { type Complex, abs, c, div, mul } from '../src/lib/dsp/complex';
import { analogStages, sos2tfAnalog, zpk2sosAnalog, zpk2tfAnalog } from '../src/lib/dsp/convert';
import { designAnalog } from '../src/lib/dsp/design';
import { polyFromRoots } from '../src/lib/dsp/poly';
import { evaluate, freqsTf, freqsZpk, groupDelayTf, logspace } from '../src/lib/dsp/response';
import type { SOS, ZPK } from '../src/lib/dsp/types';
import { buildModel } from '../src/lib/features/tf-analyzer/analyze';

// ---------------------------------------------------------------------------
// #15 — TF group delay of narrow-band IIR filters
// ---------------------------------------------------------------------------

// scipy.signal.butter(N, fc, fs=fs) in b/a form (SciPy 1.18.1)
const BUTTER6_100 = {
	fs: 48000,
	b: [
		7.664900722519908e-14, 4.598940433511944e-13, 1.1497351083779863e-12, 1.5329801445039817e-12,
		1.1497351083779863e-12, 4.598940433511944e-13, 7.664900722519908e-14
	],
	a: [
		1.0, -5.949424312827885, 14.748398928245772, -19.4993321608299, 14.501846258617292,
		-5.752170182125906, 0.9506814689255337
	]
};
const BUTTER10_500 = {
	fs: 48000,
	b: [
		1.146739231860801e-15, 1.1467392318608009e-14, 5.160326543373604e-14, 1.376087078232961e-13,
		2.408152386907682e-13, 2.8897828642892184e-13, 2.408152386907682e-13, 1.376087078232961e-13,
		5.160326543373604e-14, 1.1467392318608009e-14, 1.146739231860801e-15
	],
	a: [
		1.0, -9.581619947818618, 41.32179177830746, -105.62414480711357, 177.21608414251193,
		-203.9256041960989, 162.9905208486498, -89.34691980081402, 32.14760341822576, -6.85575574936237,
		0.6580443135136852
	]
};
const BUTTER5_50 = {
	fs: 44100,
	b: [
		5.667737081380022e-13, 2.833868540690011e-12, 5.667737081380022e-12, 5.667737081380022e-12,
		2.833868540690011e-12, 5.667737081380022e-13
	],
	a: [
		1.0, -4.976946936254024, 9.908053243459456, -9.862476225051557, 4.908580473024985,
		-0.9772105551607249
	]
};

/** Group delay in samples of a digital b/a filter, as the app's plots compute it. */
function gdSamples(f: { fs: number; b: number[]; a: number[] }, fHz: number[]): number[] {
	const r = evaluate({ kind: 'digital', fs: f.fs, tf: { b: f.b, a: f.a } }, fHz);
	return r.groupDelay.map((g) => g * f.fs);
}

describe('#15 TF group delay is not rejected for small but accurate values', () => {
	it('butter(6, 100 Hz, fs = 48 kHz) as b/a matches SciPy group_delay', () => {
		const f = [1, 10, 30, 50, 80, 100, 130, 1000, 20000];
		// scipy.signal.group_delay((b, a), w, fs=48000); the exact group delay of these
		// coefficients (60-digit arithmetic) agrees with it to 4e-5.
		const ref = [
			295.20174, 296.27656, 305.60528, 328.96816, 437.17451, 482.31997, 248.41988, 2.9667807,
			0.013551942
		];
		const gd = gdSamples(BUTTER6_100, f);
		gd.forEach((g, i) => {
			expect(Number.isFinite(g)).toBe(true);
			expect(Math.abs(g - ref[i]) / ref[i]).toBeLessThan(1e-3);
		});
	});

	it('the plotted grid shows the whole curve, including the passband peak', () => {
		// ResponseView's default digital log grid: fs/4000 … fs/2, 700 points
		const grid = logspace(12, 24000, 700);
		const gd = gdSamples(BUTTER6_100, grid);
		// only the Nyquist end point (next to the six zeros at z = −1) is undefined
		expect(gd.filter(Number.isFinite).length).toBe(699);
		expect(Number.isNaN(gd[699])).toBe(true);
		// …and agrees with the root-based (SOS) evaluation. (Not near Nyquist: there the
		// computed roots split the six-fold zero at z = −1 and the SOS curve drifts.)
		const m = buildModel('digital', BUTTER6_100.fs, 'ba', BUTTER6_100);
		const ref = evaluate({ kind: 'digital', fs: BUTTER6_100.fs, sos: m.sos }, grid).groupDelay;
		for (let i = 0; i < 699; i++)
			if (grid[i] <= 10000)
				expect(Math.abs(gd[i] - ref[i] * BUTTER6_100.fs)).toBeLessThan(1e-3 * Math.max(1, gd[i]));
			else if (grid[i] >= 20000) expect(Math.abs(gd[i] - 0.013)).toBeLessThan(1e-3); // exact: 0.01264 … 0.01355
		expect(Math.max(...gd.slice(0, 699))).toBeGreaterThan(480);
	});

	it('butter(10, 500 Hz) passband and butter(5, 50 Hz) near Nyquist are finite', () => {
		// exact group delay of the b/a coefficients (60-digit arithmetic); the double
		// evaluation is at the edge of its precision for butter(10) (≈ ±3 % noise)
		const f10 = [10, 100, 300, 500, 1000];
		const ref10 = [99.447745, 99.441707, 112.63008, 184.25917, 26.987693];
		gdSamples(BUTTER10_500, f10).forEach((g, i) => {
			expect(Number.isFinite(g)).toBe(true);
			expect(Math.abs(g - ref10[i]) / ref10[i]).toBeLessThan(0.05);
		});
		const f5 = [1, 10, 50, 20000];
		const ref5 = [454.37774, 461.4766, 697.9493, 0.0058879773];
		gdSamples(BUTTER5_50, f5).forEach((g, i) => {
			expect(Number.isFinite(g)).toBe(true);
			expect(Math.abs(g - ref5[i]) / ref5[i]).toBeLessThan(1e-3);
		});
	});

	it('does not depend on the scale of the numerator', () => {
		const fs = 48000;
		const f = [100, 1000, 10000, 20000];
		const w = f.map((x) => (2 * Math.PI * x) / fs);
		// H(z) = s(1 + z⁻¹)/(1 − 0.5 z⁻¹): τ = 1/2 − Re{−0.5e^{−jω}/(1 − 0.5e^{−jω})}
		const exact = w.map((wi) => 0.5 - (-0.5 * Math.cos(wi) + 0.25) / (1 - Math.cos(wi) + 0.25));
		for (const s of [1, 1e-6, 1e-13, 1e-20, 1e6]) {
			const gd = groupDelayTf({ b: [s, s], a: [1, -0.5] }, w);
			gd.forEach((g, i) => expect(g).toBeCloseTo(exact[i], 10));
		}
	});

	it('still returns NaN at (and right next to) a zero on the unit circle', () => {
		const fs = 48000;
		// the log grid's last point lands a few 1e-15 rad from ω = π
		const top = logspace(12, fs / 2, 700)[699];
		expect(top).not.toBe(fs / 2);
		for (const b of [
			[1, 1],
			[1e-13, 1e-13],
			[0.25, 0.25, 0.25, 0.25],
			[0.5, 0, 0.5]
		]) {
			const fir = evaluate({ kind: 'digital', fs, fir: b }, [1000, fs / 2, top]);
			// away from the zero the FIR's group delay is (L − 1)/2
			expect(fir.groupDelay[0] * fs).toBeCloseTo((b.length - 1) / 2, 9);
			if (b.length === 3) continue; // [0.5, 0, 0.5] has its zeros at ±fs/4, not fs/2
			expect(Number.isNaN(fir.groupDelay[1])).toBe(true);
			expect(Number.isNaN(fir.groupDelay[2])).toBe(true);
		}
		// e^{jω} is only on the unit circle to ~eps: 1e-9 rad from the zero the plain
		// ratio would say 1 sample instead of ½, so it must be NaN, not a wrong number
		const near = groupDelayTf({ b: [1, 1], a: [1] }, [Math.PI - 1e-9, Math.PI - 1e-5]);
		expect(Number.isNaN(near[0])).toBe(true);
		expect(near[1]).toBeCloseTo(0.5, 6);
		const notch = evaluate({ kind: 'digital', fs, fir: [0.5, 0, 0.5] }, [fs / 4, fs / 8]);
		expect(Number.isNaN(notch.groupDelay[0])).toBe(true);
		expect(notch.groupDelay[1] * fs).toBeCloseTo(1, 9);
	});

	it('TF Analyzer b/a input plots the same group delay as SOS input', () => {
		const fsIn = BUTTER6_100.fs;
		const m = buildModel('digital', fsIn, 'ba', { b: BUTTER6_100.b, a: BUTTER6_100.a });
		const f = [5, 50, 100, 150, 1000];
		const viaTf = evaluate(m.filter, f).groupDelay;
		const viaSos = evaluate({ kind: 'digital', fs: fsIn, sos: m.sos }, f).groupDelay;
		viaTf.forEach((g, i) => {
			expect(Number.isFinite(g)).toBe(true);
			expect(Math.abs(g - viaSos[i]) / viaSos[i]).toBeLessThan(1e-3);
		});
	});
});

// ---------------------------------------------------------------------------
// #16 — analog SOS of an improper H(s)
// ---------------------------------------------------------------------------

/** H(jω) of an analog SOS cascade (rows in descending powers of s). */
function freqsSos(sos: SOS, w: number[]): Complex[] {
	return w.map((wi) => {
		let h: Complex = c(1);
		for (const row of sos) {
			const hb = freqsTf({ b: row.slice(0, 3), a: row.slice(3, 6) }, [wi])[0];
			h = mul(h, hb);
		}
		return h;
	});
}

function expectSameResponse(zpk: ZPK, sos: SOS) {
	const w = [0, 0.1, 0.7, 1, 2.5, 10, 100];
	const h = freqsZpk(zpk, w);
	const hs = freqsSos(sos, w);
	h.forEach((hi, i) => {
		const d = abs({ re: hs[i].re - hi.re, im: hs[i].im - hi.im });
		expect(d).toBeLessThanOrEqual(1e-9 * Math.max(1, abs(hi)));
	});
}

const r = (x: number) => c(x);
const pair = (re: number, im: number) => [c(re, im), c(re, -im)];

describe('#16 zpk2sosAnalog keeps every zero of an improper H(s)', () => {
	it('(s² + 2s + 2)/(s + 3) is one row, not 1/(s + 3)', () => {
		const zpk: ZPK = { z: pair(-1, 1), p: [r(-3)], k: 1 };
		const sos = zpk2sosAnalog(zpk);
		expect(sos.length).toBe(1);
		[1, 2, 2, 0, 1, 3].forEach((v, i) => expect(sos[0][i]).toBeCloseTo(v, 12));
		expectSameResponse(zpk, sos);
	});

	it('a polynomial with no poles becomes numerator-only rows', () => {
		expect(zpk2sosAnalog({ z: [r(-1)], p: [], k: 2 })).toEqual([[0, 2, 2, 0, 0, 1]]);
		expect(zpk2sosAnalog({ z: [], p: [], k: 3 })).toEqual([[0, 0, 3, 0, 0, 1]]);
		const cubic: ZPK = { z: [r(-1), r(-2), r(-3)], p: [], k: -0.5 };
		const sos = zpk2sosAnalog(cubic);
		expect(sos.length).toBe(2);
		for (const row of sos) expect(row.slice(3)).toEqual([0, 0, 1]);
		expectSameResponse(cubic, sos);
	});

	it('multiplies back to H(s) for assorted improper filters', () => {
		const cases: ZPK[] = [
			{ z: [r(-1), ...pair(0.5, Math.sqrt(3) / 2)], p: [r(-1)], k: 1 }, // (s³ + 1)/(s + 1)
			{ z: [r(0), r(-2), r(-3)], p: [r(-2)], k: 1 }, // s(s + 2)(s + 3)/(s + 2)
			{ z: [r(0), r(0)], p: [r(-1)], k: 4 }, // 4s²/(s + 1)
			{ z: [...pair(0, 1), ...pair(0, 2)], p: [r(-5)], k: 1 }, // two pairs, one real pole
			{ z: [...pair(0, 1), ...pair(0, 2), r(-5)], p: pair(-0.5, Math.sqrt(3) / 2), k: 2 },
			{ z: [r(-1), r(-2), r(-3), r(-4)], p: [r(-10), r(-20), r(-30)], k: 0.1 },
			{ z: [r(1), r(-1)], p: [], k: 1 } // s² − 1
		];
		for (const zpk of cases) {
			const sos = zpk2sosAnalog(zpk);
			expectSameResponse(zpk, sos);
			// …and its coefficients agree with the direct ZPK → TF conversion
			const tf = sos2tfAnalog(sos);
			const ref = zpk2tfAnalog(zpk);
			expect(tf.b.length).toBe(ref.b.length);
			expect(tf.a.length).toBe(ref.a.length);
			tf.b.forEach((v, i) => expect(v).toBeCloseTo(ref.b[i], 9));
			tf.a.forEach((v, i) => expect(v).toBeCloseTo(ref.a[i], 9));
		}
	});

	it('leaves the SOS of proper filters unchanged (one row per pole stage)', () => {
		const filters: ZPK[] = [
			designAnalog({ family: 'cheby1', band: 'lowpass', order: 7, f1: 1000, rp: 1 }),
			designAnalog({
				family: 'ellip',
				band: 'bandstop',
				order: 4,
				f1: 900,
				f2: 1100,
				rp: 1,
				rs: 40
			}),
			designAnalog({ family: 'butter', band: 'highpass', order: 5, f1: 50 }),
			{ z: [r(-1), r(-2)], p: [r(-3), ...pair(-1, 2)], k: 3 }
		];
		for (const zpk of filters) {
			const st = analogStages(zpk);
			// the previous construction: one row per stage, gain in the first row
			const expected = st.map((s) => {
				const a = polyFromRoots(s.poles);
				const b = polyFromRoots(s.zeros);
				return [...new Array(3 - b.length).fill(0), ...b, ...new Array(3 - a.length).fill(0), ...a];
			});
			for (let i = 0; i < 3; i++) expected[0][i] *= zpk.k;
			expect(zpk2sosAnalog(zpk)).toEqual(expected);
			expectSameResponse(zpk, zpk2sosAnalog(zpk));
		}
	});

	it('TF Analyzer: "Edit as SOS" on an improper b/a keeps the filter', () => {
		const cases = [
			{ b: [1, 2, 2], a: [1, 3] },
			{ b: [1, 1], a: [1] },
			{ b: [1, 0, 0, 1], a: [1, 1] }
		];
		for (const raw of cases) {
			const m = buildModel('analog', 1, 'ba', raw);
			const m2 = buildModel('analog', 1, 'sos', { sos: m.sos });
			const w = [0.3, 1, 10];
			const h1 = freqsZpk(m.zpk, w);
			const h2 = freqsZpk(m2.zpk, w);
			h1.forEach((h, i) => {
				const ratio = div(h2[i], h);
				expect(ratio.re).toBeCloseTo(1, 9);
				expect(ratio.im).toBeCloseTo(0, 9);
			});
			expect(m2.zpk.z.length).toBe(m.zpk.z.length);
			expect(m2.notes.some((n) => n.includes('improper'))).toBe(true);
		}
	});
});
