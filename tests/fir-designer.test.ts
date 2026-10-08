import { describe, expect, it } from 'vitest';
import {
	amplitudeAt,
	bandErrors,
	bandsToPoints,
	decimateMinMax,
	designAt,
	designFir,
	denseResponse,
	linearPhaseType,
	maskRegions,
	measureSpec,
	searchLength,
	specBands,
	typeConflicts,
	validateBands,
	validateSpec,
	type FirConfig,
	type Spec
} from '../src/lib/features/fir-designer/design';
import { scipyRecipe, matlabRecipe } from '../src/lib/features/fir-designer/recipes';
import { chebwinFast, firwinFast } from '../src/lib/features/fir-designer/windowing';
import { windowValues } from '../src/lib/dsp/windows';
import { firwin, firwin2 } from '../src/lib/dsp/fir';
import { evaluate } from '../src/lib/dsp/response';

const fs = 48000;
const lp: Spec = { band: 'lowpass', edges: [6000, 8000], rp: 0.5, rs: 60 };

const cfg = (over: Partial<FirConfig>): FirConfig => ({
	method: 'pm',
	fs,
	shape: 'lowpass',
	spec: lp,
	bands: [],
	numtaps: 51,
	auto: true,
	window: { type: 'hamming' },
	symmetry: 'even',
	relWeight: false,
	...over
});

describe('fir-designer: specs and types', () => {
	it('maps length and symmetry to the four types', () => {
		expect(linearPhaseType(31, 'even')).toBe(1);
		expect(linearPhaseType(32, 'even')).toBe(2);
		expect(linearPhaseType(31, 'odd')).toBe(3);
		expect(linearPhaseType(32, 'odd')).toBe(4);
	});
	it('builds bands for every response type', () => {
		const bp = specBands({ band: 'bandpass', edges: [1000, 2000, 4000, 5000], rp: 1, rs: 40 }, fs);
		expect(bp.kinds).toEqual(['stop', 'pass', 'stop']);
		expect(bp.bands[0]).toMatchObject({ f1: 0, f2: 1000, d1: 0 });
		expect(bp.bands[2].f2).toBe(fs / 2);
		const bs = specBands({ band: 'bandstop', edges: [1000, 2000, 4000, 5000], rp: 1, rs: 40 }, fs);
		expect(bs.kinds).toEqual(['pass', 'stop', 'pass']);
	});
	it('validates specs', () => {
		expect(validateSpec(lp, fs)).toBeNull();
		expect(validateSpec({ ...lp, edges: [8000, 6000] }, fs)).toMatch(/below/);
		expect(validateSpec({ ...lp, edges: [6000, 30000] }, fs)).toMatch(/fs\/2/);
	});
	it('flags forced zeros that conflict with the bands', () => {
		const hp = specBands({ band: 'highpass', edges: [6000, 8000], rp: 1, rs: 40 }, fs).bands;
		expect(typeConflicts(2, hp, fs)).toHaveLength(1);
		expect(typeConflicts(1, hp, fs)).toHaveLength(0);
		const lpb = specBands(lp, fs).bands;
		expect(typeConflicts(4, lpb, fs)).toHaveLength(1); // DC gain wanted
		expect(typeConflicts(3, hp, fs)).toHaveLength(1); // fs/2 gain wanted
	});
	it('validates custom bands', () => {
		const ok = [
			{ f1: 0, f2: 1000, d1: 1, d2: 1, weight: 1 },
			{ f1: 2000, f2: 24000, d1: 0, d2: 0, weight: 10 }
		];
		expect(validateBands(ok, fs, 'pm')).toEqual([]);
		expect(validateBands([ok[1], ok[0]], fs, 'pm').length).toBeGreaterThan(0);
		expect(validateBands([{ ...ok[0], weight: 0 }], fs, 'pm').length).toBe(1);
		expect(validateBands([{ ...ok[0], weight: 0 }], fs, 'fsamp').length).toBe(0);
	});
	it('turns bands into firwin2 break points', () => {
		const p = bandsToPoints([{ f1: 1000, f2: 2000, d1: 1, d2: 1, weight: 1 }], fs);
		expect(p.freq).toEqual([0, 1000, 2000, fs / 2]);
		expect(p.gain).toEqual([1, 1, 1, 1]);
	});
});

describe('fir-designer: evaluation', () => {
	it('amplitude matches |H| for symmetric taps', () => {
		const d = designAt(cfg({ method: 'window', auto: false, numtaps: 41 }), 41);
		for (const f of [0, 3000, 7000, 12000]) {
			const A = amplitudeAt(d.h, 'even', f / fs);
			const H = evaluate({ kind: 'digital', fs, fir: d.h }, [f]).mag[0];
			expect(Math.abs(Math.abs(A) - H)).toBeLessThan(1e-12);
		}
		const dense = denseResponse(d.h, fs, 'even');
		const k = dense.f.findIndex((f) => f >= 3000);
		expect(dense.A[k]).toBeCloseTo(amplitudeAt(d.h, 'even', dense.f[k] / fs), 12);
	});
	it('uses the +j convention for antisymmetric Parks–McClellan designs', () => {
		const c = cfg({
			shape: 'custom',
			auto: false,
			numtaps: 31,
			symmetry: 'odd',
			bands: [{ f1: 1000, f2: 23000, d1: 1, d2: 1, weight: 1 }]
		});
		const d = designAt(c, 31);
		expect(amplitudeAt(d.h, 'odd', 12000 / fs)).toBeGreaterThan(0.85);
		// H = j·A·e^{-jωM}: the phase after removing the delay is +90°
		const r = evaluate({ kind: 'digital', fs, fir: d.h }, [12000]);
		const M = 15;
		const w = (2 * Math.PI * 12000) / fs;
		const re = r.H[0].re * Math.cos(w * M) - r.H[0].im * Math.sin(w * M);
		const im = r.H[0].re * Math.sin(w * M) + r.H[0].im * Math.cos(w * M);
		expect(Math.abs(re)).toBeLessThan(1e-9);
		expect(im).toBeGreaterThan(0.9);
		const errs = bandErrors(d.h, c.bands, fs, 'odd');
		expect(errs[0].maxErr).toBeCloseTo(d.remez!.delta, 2);
	});
	it('measures ripple and attenuation', () => {
		const d = designAt(cfg({ auto: false }), 61);
		const m = measureSpec(d.h, lp, fs);
		// equiripple: passband deviation = δ (weight 1), stopband deviation = δ / W_stop
		const ws = specBands(lp, fs).bands[1].weight;
		expect(m.stopMax).toBeCloseTo(d.remez!.delta / ws, 5);
		expect(Math.max(m.passMax - 1, 1 - m.passMin) / d.remez!.delta).toBeCloseTo(1, 1);
		expect(m.rippleDb).toBeGreaterThan(0);
	});
	it('builds a dB mask', () => {
		const r = maskRegions(lp, fs);
		expect(r).toHaveLength(3);
		expect(r[2].y0).toBe(-60);
		expect(r[0].y0).toBeCloseTo(0.25, 1); // +Rp/2 roughly
	});
	it('decimation keeps the extremes', () => {
		const x = Array.from({ length: 10000 }, (_, i) => i);
		const y = x.map((i) => Math.sin(i / 7) * (i === 5000 ? 10 : 1));
		const d = decimateMinMax(x, y, 300);
		expect(d.x.length).toBeLessThanOrEqual(600);
		expect(Math.max(...d.y)).toBe(Math.max(...y));
		expect(Math.min(...d.y)).toBe(Math.min(...y));
	});
});

describe('fir-designer: automatic length', () => {
	it('search finds the threshold of a monotone test', () => {
		for (const start of [3, 40, 77, 300]) {
			const r = searchLength((N) => N >= 77, start, false, 511);
			expect(r).toMatchObject({ N: 77, met: true });
			const o = searchLength((N) => N >= 77, start, true, 511);
			expect(o.N).toBe(77);
		}
		expect(searchLength(() => false, 50, false, 200).met).toBe(false);
	});
	it('Parks–McClellan auto length is minimal and meets the spec', () => {
		const d = designFir(cfg({}));
		expect(d.auto!.met).toBe(true);
		expect(measureSpec(d.h, lp, fs).met).toBe(true);
		expect(measureSpec(designAt(cfg({}), d.numtaps - 1).h, lp, fs).met).toBe(false);
		// Herrmann's estimate is close
		expect(Math.abs(d.auto!.estimate - d.numtaps)).toBeLessThan(6);
	});
	it('window-method auto length meets the spec when the window can', () => {
		const d = designFir(cfg({ method: 'window', window: { type: 'blackman' } }));
		expect(d.auto!.met).toBe(true);
		expect(measureSpec(d.h, lp, fs).met).toBe(true);
		// a rectangular window cannot reach 60 dB at any length (its sidelobes decay only 6 dB/oct)
		const rect = designFir(cfg({ method: 'window', window: { type: 'rectangular' } }));
		expect(rect.auto!.met).toBe(false);
	});
	it('frequency sampling meets the spec once the desired ramp leaves room for the window', () => {
		const d = designFir(cfg({ method: 'fsamp', fsampFrac: 0.5 }));
		expect(d.auto!.met).toBe(true);
		expect(d.points!.freq).toEqual([0, 6500, 7500, 24000]);
		// a ramp across the whole transition band cannot hit the stopband edge
		expect(designFir(cfg({ method: 'fsamp', fsampFrac: 1 })).auto!.met).toBe(false);
	});
	it('high-pass auto lengths are odd (type I)', () => {
		const hp: Spec = { band: 'highpass', edges: [6000, 8000], rp: 0.5, rs: 60 };
		for (const method of ['pm', 'window', 'kaiser', 'fsamp', 'ls'] as const) {
			const d = designFir(cfg({ method, spec: hp, shape: 'highpass', window: { type: 'blackman' } }));
			expect(d.numtaps % 2, method).toBe(1);
		}
	});
	it('Kaiser formula lands near the spec', () => {
		const d = designFir(cfg({ method: 'kaiser' }));
		expect(d.numtaps).toBeGreaterThan(80);
		const m = measureSpec(d.h, lp, fs);
		expect(m.attenDb).toBeGreaterThan(58);
	});
	it('least squares needs more taps than equiripple', () => {
		const ls = designFir(cfg({ method: 'ls' }));
		const pm = designFir(cfg({ method: 'pm' }));
		expect(ls.auto!.met).toBe(true);
		expect(ls.numtaps).toBeGreaterThan(pm.numtaps);
	});
});

describe('fir-designer: recipes', () => {
	it('emits the matching SciPy and MATLAB calls', () => {
		const c = cfg({ auto: false, numtaps: 61 });
		const d = designFir(c);
		expect(scipyRecipe(c, d)).toContain('signal.remez(numtaps, [0, 6000, 8000, 24000]');
		expect(matlabRecipe(c, d)).toContain('firpm(N-1, f, a, w)');
		const w = cfg({ method: 'window', auto: false, numtaps: 61, window: { type: 'kaiser', param: 6 } });
		expect(scipyRecipe(w, designFir(w))).toContain("window=('kaiser', 6), pass_zero='lowpass'");
		expect(matlabRecipe(w, designFir(w))).toContain("fir1(N-1, 7000 / (fs/2), 'low', kaiser(61, 6))");
	});
});

describe('fir-designer: decimation keeps gaps', () => {
	it('does not bridge NaN gaps', () => {
		const x = Array.from({ length: 5000 }, (_, i) => i);
		const y = x.map((i) => (i >= 2000 && i < 2003 ? NaN : Math.cos(i)));
		const d = decimateMinMax(x, y, 200);
		const k = d.y.findIndex((v) => Number.isNaN(v));
		expect(k).toBeGreaterThan(0);
		expect(d.x[k - 1]).toBeLessThan(2000);
		expect(d.x[k + 1]).toBeGreaterThanOrEqual(2000);
		expect(d.x.filter((v, i) => Number.isFinite(d.y[i]) && v >= 2000 && v < 2003)).toEqual([]);
	});
});

describe('fir-designer: fast windows', () => {
	it('table-driven Chebyshev window matches the shared implementation', () => {
		for (const N of [2, 3, 16, 17, 64, 101, 256]) {
			const a = chebwinFast(N, 80);
			const b = windowValues('chebyshev', N, 80);
			expect(a.length).toBe(N);
			for (let i = 0; i < N; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(1e-9);
		}
	});
	it('firwinFast reproduces firwin', () => {
		const cases: [number, number[], boolean][] = [
			[31, [7000], true],
			[40, [5000, 9000], false],
			[33, [6000], false],
			[41, [4000, 11000], true]
		];
		for (const w of [{ type: 'hamming' as const }, { type: 'chebyshev' as const, param: 70 }, { type: 'kaiser' as const, param: 5 }])
			for (const [N, c, pz] of cases) {
				const a = firwinFast(N, c, w, pz, 48000);
				const b = firwin(N, c, w, pz, 48000);
				for (let i = 0; i < N; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(1e-12);
			}
	});
	it('frequency sampling with a cached window equals firwin2', () => {
		const d = designAt(cfg({ method: 'fsamp', auto: false, window: { type: 'blackman' } }), 51);
		const ref = firwin2(51, d.points!.freq, d.points!.gain, fs, { type: 'blackman' });
		for (let i = 0; i < 51; i++) expect(Math.abs(d.h[i] - ref[i])).toBeLessThan(1e-12);
	});
});
