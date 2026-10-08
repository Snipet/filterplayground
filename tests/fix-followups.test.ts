/** Follow-ups to the review fixes that live in shared modules. */
import { describe, expect, it } from 'vitest';
import { c, sqrt } from '../src/lib/dsp/complex';
import { designAnalog, designDigital } from '../src/lib/dsp/design';
import { prototype } from '../src/lib/dsp/analog';
import { evaluate, freqsZpk, logspace } from '../src/lib/dsp/response';
import { transformPrototype } from '../src/lib/dsp/transforms';
import { analogTimeResponse, suggestAnalogDuration } from '../src/lib/dsp/time';
import { formatSI } from '../src/lib/dsp/units';
import { dpss, windowParamAt, windowParamRange } from '../src/lib/dsp/windows';
import {
	matlabWindow,
	scipyWindow,
	scipyWindowArray
} from '../src/lib/features/fir-designer/recipes';

describe('complex sqrt', () => {
	it('is accurate next to the negative real axis', () => {
		const r = sqrt(c(-1e8, 1e-3));
		expect(r.im).toBeCloseTo(1e4, 9);
		expect(r.re / 5e-8).toBeCloseTo(1, 12);
		const q = sqrt(c(-1e8, -1e-3));
		expect(q.im).toBeCloseTo(-1e4, 9);
		expect(q.re / 5e-8).toBeCloseTo(1, 12);
	});
	it('squares back for every quadrant', () => {
		for (const [re, im] of [
			[3, 4],
			[-3, 4],
			[-3, -4],
			[3, -4],
			[0, 2],
			[-2, 1e-12]
		]) {
			const r = sqrt(c(re, im));
			expect(r.re * r.re - r.im * r.im).toBeCloseTo(re, 10);
			expect(2 * r.re * r.im).toBeCloseTo(im, 10);
			expect(r.re).toBeGreaterThanOrEqual(0);
		}
	});
	it('keeps very high-Q elliptic band-pass designs inside their passband', () => {
		const zpk = designAnalog({
			family: 'ellip',
			band: 'bandpass',
			order: 9,
			f1: 400,
			f2: 3200,
			rp: 6,
			rs: 10
		});
		const r = evaluate({ kind: 'analog', zpk }, logspace(380, 3400, 6000));
		expect(Math.max(...r.magDb)).toBeLessThan(0.01);
	});
});

describe('overflow-free gains and responses', () => {
	it('bilinear handles 60-pole band-pass designs at audio rates', () => {
		const { zpk } = designDigital({
			family: 'butter',
			band: 'bandpass',
			order: 30,
			f1: 1000,
			f2: 2000,
			fs: 48000
		});
		expect(Number.isFinite(zpk.k)).toBe(true);
		const r = evaluate({ kind: 'digital', fs: 48000, zpk }, [Math.sqrt(1000 * 2000)]);
		expect(r.magDb[0]).toBeCloseTo(0, 6);
	});
	it('freqsZpk evaluates high-order analog band filters far above their poles', () => {
		const zpk = designAnalog({ family: 'butter', band: 'bandpass', order: 20, f1: 1e6, f2: 2e6 });
		const h = freqsZpk(zpk, [2 * Math.PI * 1e9]);
		expect(Number.isFinite(h[0].re) && Number.isFinite(h[0].im)).toBe(true);
	});
});

describe('reversed band edges', () => {
	it('transformPrototype treats (high, low) as the same band', () => {
		const proto = prototype('cheby1', 4, { rp: 1 });
		for (const band of ['bandpass', 'bandstop'] as const) {
			const a = transformPrototype(proto, band, 2000, 8000);
			const b = transformPrototype(proto, band, 8000, 2000);
			const f = [100, 2000, 4000, 8000, 20000].map((x) => x * 2 * Math.PI);
			const ha = freqsZpk(a, f);
			const hb = freqsZpk(b, f);
			ha.forEach((v, i) => {
				expect(hb[i].re).toBeCloseTo(v.re, 9);
				expect(hb[i].im).toBeCloseTo(v.im, 9);
			});
			expect(b.p.every((p) => p.re < 0)).toBe(true);
		}
	});
});

describe('analog time span', () => {
	it('lets a high-Rs Chebyshev II low-pass settle despite far-away zeros', () => {
		const zpk = designAnalog({ family: 'cheby2', band: 'lowpass', order: 8, f1: 1000, rs: 120 });
		const T = suggestAnalogDuration(zpk);
		const st = analogTimeResponse(zpk, 'step', T, 2000);
		const final = Math.abs(evaluate({ kind: 'analog', zpk }, [0]).mag[0]);
		const tail = st.y.slice(-200);
		for (const v of tail) expect(Math.abs(v - final)).toBeLessThan(0.01 * final);
	});
});

describe('SI formatting', () => {
	it('chooses the prefix from the displayed (rounded) value', () => {
		expect(formatSI(999.84, 'Hz', 4)).toBe('999.8 Hz');
		expect(formatSI(999.96, 'Hz', 4)).toBe('1 kHz');
		expect(formatSI(4700, 'Ω')).toBe('4.7 kΩ');
		expect(formatSI(1.5e-9, 'F')).toBe('1.5 nF');
		expect(formatSI(0.9996, 's', 3)).toBe('1 s');
	});
});

describe('DPSS NW < N/2', () => {
	it('clamps an invalid NW to the largest valid step instead of aliasing', () => {
		expect(dpss(8, 5)).toEqual(dpss(8, 3.9));
		expect(dpss(8, 4)).toEqual(dpss(8, 3.9));
		// valid values are left alone
		expect(dpss(10, 4.95)).not.toEqual(dpss(10, 4.9));
		expect(windowParamRange('dpss', 8)!.max).toBe(3.9);
		expect(windowParamAt('dpss', 8, 5)).toBe(3.9);
		expect(windowParamAt('kaiser', 8, 14)).toBe(14);
	});
	it('exports the NW actually used', () => {
		const w = { type: 'dpss' as const, param: 3 };
		expect(scipyWindow(w, 5)).toBe("('dpss', 2.4)");
		expect(matlabWindow(w, 5)).toContain('dpss(5, 2.4, 1)');
	});
	it('writes out even-length DPSS at peak 1 for SciPy, which scales it lower', () => {
		const w = { type: 'dpss' as const, param: 3 };
		expect(scipyWindowArray(w, 'N', 21)).toBeNull();
		expect(scipyWindowArray(w, 'N')).toBeNull();
		expect(scipyWindowArray(w, 'N', 22)).toBe(
			'(signal.windows.dpss(N, 3) / np.max(signal.windows.dpss(N, 3)))'
		);
	});
});
