import { describe, expect, it } from 'vitest';
import { cicMag, eyeDiagram, halfbandEndZeros } from '../src/lib/features/special-fir/special';
import {
	capabilities,
	demoTaps,
	forcedZeros,
	magnitude,
	typeOf,
	type LpType
} from '../src/lib/features/linear-phase/lp';
import { firwin, gaussianPulse, raisedCosine } from '../src/lib/dsp/fir';
import { WINDOWS, windowInfo, windowValues, type WindowType } from '../src/lib/dsp/windows';

const halfband = (n: number, type: WindowType) =>
	firwin(n, [12000], { type, param: windowInfo(type).param?.default }, true, 48000, false);

describe('#56 half-band: why the end taps are zero', () => {
	it('N = 4K + 1 is blamed on the length, for every window', () => {
		for (const w of WINDOWS) {
			expect(halfbandEndZeros(halfband(29, w.id)), w.id).toBe('length');
			expect(halfbandEndZeros(halfband(9, w.id)), w.id).toBe('length');
		}
	});
	it('N = 4K + 3 is flagged only when the window itself is zero at its ends', () => {
		for (const w of WINDOWS) {
			const h = halfband(31, w.id);
			const w0 = windowValues(w.id, 31, windowInfo(w.id).param?.default)[0];
			const peak = Math.max(...h.map(Math.abs));
			expect(halfbandEndZeros(h), w.id).toBe(Math.abs(w0) < 1e-9 ? 'window' : null);
			if (Math.abs(w0) < 1e-9) {
				// h[0] by the window, h[1] by the sinc (even offset): N − 4 taps do the work
				expect(Math.abs(h[1])).toBeLessThanOrEqual(1e-12 * peak);
				expect(Math.abs(h[2])).toBeGreaterThan(1e-6 * peak);
			}
		}
		// the scenario of the report: Hann at N = 31 = 4·7 + 3 is not a 4K + 1 length
		expect(halfbandEndZeros(halfband(31, 'hann'))).toBe('window');
		expect(halfbandEndZeros(halfband(31, 'kaiser'))).toBeNull();
		expect(halfbandEndZeros(halfband(31, 'hamming'))).toBeNull();
	});
});

describe('#112 CIC nulls and what folds to DC', () => {
	it('with M = 2 the odd nulls k·fs/(2R) fold to fs_out/2, the even ones to DC', () => {
		const R = 8;
		for (let k = 1; k < 2 * R; k++) {
			const f = k / (2 * R); // normalised to fs
			expect(cicMag(f, R, 2, 4)).toBeLessThan(1e-20); // every multiple of fs/(R·M) is a null
			const folded = ((f % (1 / R)) + 1 / R) % (1 / R); // alias after decimating by R
			expect(folded * R).toBeCloseTo(k % 2 ? 0.5 : 0, 12); // in units of fs_out
		}
		// a 3 kHz tone decimated by 8 from 48 kHz alternates in sign: fs_out/2, not DC
		const x = Array.from({ length: 6 }, (_, m) => Math.cos((2 * Math.PI * 3000 * 8 * m) / 48000));
		x.forEach((v, m) => expect(v).toBeCloseTo(m % 2 ? -1 : 1, 12));
	});
});

describe('#110 pulse shapes need span · sps + 1 odd', () => {
	it('an even span centres the pulse on a sample for odd sps', () => {
		for (const sps of [3, 5, 7]) {
			const rc = raisedCosine(sps, 0.35, 6);
			expect(rc.length % 2).toBe(1);
			expect(rc[(rc.length - 1) / 2]).toBeCloseTo(1, 12);
			expect(eyeDiagram(rc, sps, false).peakIsi).toBeLessThan(1e-9);
			const g = gaussianPulse(sps, 0.3, 4);
			const c = (g.length - 1) / 2;
			expect(Number.isInteger(c)).toBe(true);
			expect(Number.isFinite(g[c + sps] / g[c])).toBe(true);
		}
		// the odd span of the report (sps = 5, span = 5) has no centre sample and real ISI
		const odd = raisedCosine(5, 0.35, 5);
		expect(odd.length).toBe(26);
		expect(eyeDiagram(odd, 5, false).peakIsi).toBeGreaterThan(0.1);
	});
});

describe('#111 linear-phase capabilities follow the forced zeros', () => {
	const win = { type: 'hamming' as const };
	it('LP/HP/BP/BS columns depend only on the zeros at z = ±1', () => {
		for (const t of [1, 2, 3, 4] as LpType[]) {
			const f = forcedZeros(t);
			const c = capabilities(t);
			expect(c.lowpass).toBe(!f.plus1);
			expect(c.highpass).toBe(!f.minus1);
			expect(c.bandpass).toBe(true);
			expect(c.bandstop).toBe(!f.plus1 && !f.minus1);
		}
		expect(capabilities(3)).toMatchObject({
			lowpass: false,
			highpass: false,
			bandpass: true,
			bandstop: false
		});
		expect(capabilities(4)).toMatchObject({
			lowpass: false,
			highpass: true,
			bandpass: true,
			bandstop: false
		});
		// symmetric rows unchanged
		expect(capabilities(1)).toMatchObject({ lowpass: true, highpass: true, bandstop: true });
		expect(capabilities(2)).toMatchObject({ lowpass: true, highpass: false, bandstop: false });
	});
	it('type IV high-pass and type III band-pass filters exist', () => {
		// first difference [1, −1]: type IV, |H| = 2|sin(ω/2)| rises to 2 at fs/2
		expect(typeOf([1, -1])).toBe(4);
		expect(magnitude([1, -1], 0)).toBeCloseTo(0, 12);
		expect(magnitude([1, -1], 0.5)).toBeCloseTo(2, 12);
		// [1, 0, −1]: type III, |H| = 2|sin ω| peaks at fs/4
		expect(typeOf([1, 0, -1])).toBe(3);
		expect(magnitude([1, 0, -1], 0.25)).toBeCloseTo(2, 12);
		// selective versions: a type II low-pass modulated by (−1)^n is a type IV high-pass
		const lp2 = demoTaps(2, 32, 'lowpass', win);
		const hp4 = lp2.map((v, n) => (n % 2 ? -v : v));
		expect(typeOf(hp4)).toBe(4);
		expect(magnitude(hp4, 0.05)).toBeLessThan(0.01);
		expect(magnitude(hp4, 0.45)).toBeCloseTo(1, 1);
		// a type I low-pass times 2·sin(π(n − M)/2) is a type III band-pass centred on fs/4
		const lp1 = firwin(33, [0.1], { type: 'kaiser', param: 8 }, true, 1);
		const bp3 = lp1.map((v, n) => 2 * v * Math.sin((Math.PI * (n - 16)) / 2));
		expect(typeOf(bp3)).toBe(3);
		expect(magnitude(bp3, 0.25)).toBeCloseTo(1, 1);
		expect(magnitude(bp3, 0.01)).toBeLessThan(0.01);
		expect(magnitude(bp3, 0.49)).toBeLessThan(0.01);
	});
});
