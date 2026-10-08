import { describe, expect, it } from 'vitest';
import {
	amEnvelope,
	amplitude,
	centredFilter,
	cicMag,
	cicStats,
	conv,
	denseMag,
	differentiate,
	eyeDiagram,
	foldedMultiplies,
	smoothingDemo
} from '../src/lib/features/special-fir/special';
import { cicFir, differentiatorFir, firwin, gaussianPulse, hilbertFir, movingAverage, raisedCosine, rootRaisedCosine, savitzkyGolay } from '../src/lib/dsp/fir';
import { remez } from '../src/lib/dsp/remez';

/** Max difference between the FFT magnitude of CIC taps and the closed form. */
function cicFirCheck(h: number[], R: number, M: number, N: number): number {
	const d = denseMag(h);
	let worst = 0;
	d.f.forEach((f, i) => (worst = Math.max(worst, Math.abs(d.mag[i] - cicMag(f, R, M, N)))));
	return worst;
}

describe('special-fir: Hilbert', () => {
	const hw = hilbertFir(31, { type: 'hamming' });
	const he = remez(31, [{ f1: 0.025, f2: 0.475, d1: 1, d2: 1, weight: 1 }], 1, { symmetry: 'odd' }).h;
	it('window and equiripple designs share the −j·sgn convention', () => {
		expect(amplitude(hw, 0.25, true)).toBeCloseTo(1, 1);
		expect(amplitude(he, 0.25, true)).toBeCloseTo(1, 1);
	});
	it('recovers the envelope of an AM tone only with the delay compensated', () => {
		const ok = amEnvelope(he, 1 / 8, 1 / 160, 0.6, 400, true);
		const bad = amEnvelope(he, 1 / 8, 1 / 160, 0.6, 400, false);
		expect(ok.maxErr).toBeLessThan(0.1);
		expect(bad.maxErr).toBeGreaterThan(0.5);
	});
});

describe('special-fir: differentiator', () => {
	it('types III and IV track the derivative of a low-frequency sine', () => {
		for (const N of [21, 22]) {
			const h = differentiatorFir(N, { type: 'hann' });
			const d = differentiate(h, 0.02, 1000, 0, 300);
			expect(d.rmsErr / d.truthRms, `N=${N}`).toBeLessThan(0.01);
		}
	});
	it('type III has a zero at fs/2, type IV does not', () => {
		const m3 = denseMag(differentiatorFir(21, { type: 'hann' }));
		const m4 = denseMag(differentiatorFir(22, { type: 'hann' }));
		expect(m3.mag[m3.mag.length - 1]).toBeLessThan(1e-9);
		expect(m4.mag[m4.mag.length - 1]).toBeGreaterThan(2);
	});
});

describe('special-fir: pulse shaping', () => {
	it('a raised cosine has zero ISI at the symbol instants even when truncated', () => {
		const e = eyeDiagram(raisedCosine(8, 0.35, 6), 8, false);
		expect(e.peakIsi).toBeLessThan(1e-12);
		expect(e.opening).toBeCloseTo(1, 9);
	});
	it('RRC → RRC is (approximately) Nyquist and improves with span', () => {
		const isi = (span: number) => {
			const r = rootRaisedCosine(8, 0.35, span);
			return eyeDiagram(conv(r, r), 8, false).peakIsi;
		};
		expect(isi(16)).toBeLessThan(isi(4));
		expect(isi(16)).toBeLessThan(0.02);
	});
	it('Gaussian pulse has its −3 dB point at BT × symbol rate', () => {
		const sps = 16;
		const h = gaussianPulse(sps, 0.3, 8);
		const m = denseMag(h, 1 << 15);
		const k = m.mag.findIndex((v) => v < Math.SQRT1_2);
		expect(m.f[k] * sps).toBeCloseTo(0.3, 2);
		// Gaussian-filtered NRZ has ISI but the eye stays open at BT = 0.3
		const e = eyeDiagram(h, sps, true);
		expect(e.opening).toBeGreaterThan(0.5);
		expect(e.opening).toBeLessThan(1);
	});
});

describe('special-fir: smoothing', () => {
	it('Savitzky–Golay derivative of a ramp is its slope', () => {
		const h = savitzkyGolay(7, 3, 1);
		const y = centredFilter(h, Array.from({ length: 20 }, (_, n) => 2 * n + 1));
		expect(y[10]).toBeCloseTo(2, 10);
		expect(Number.isNaN(y[0])).toBe(true);
	});
	it('Savitzky–Golay keeps a narrow peak better than a moving average of the same length', () => {
		const d = smoothingDemo([savitzkyGolay(15, 4), movingAverage(15)], 0, 0.05);
		expect(Math.abs(d.outputs[0].peakErr)).toBeLessThan(Math.abs(d.outputs[1].peakErr));
		expect(d.outputs[0].rmsErr).toBeLessThan(d.outputs[1].rmsErr);
	});
});

describe('special-fir: half-band and CIC', () => {
	it('half-band: every other tap is zero except the centre', () => {
		const h = firwin(23, [0.25], { type: 'hamming' }, true, 1, false); // unscaled: centre tap exactly 1/2
		const M = 11;
		for (let k = 2; k <= M; k += 2) {
			expect(Math.abs(h[M + k])).toBeLessThan(1e-15);
			expect(Math.abs(h[M - k])).toBeLessThan(1e-15);
		}
		expect(h[M]).toBeCloseTo(0.5, 10);
		expect(amplitude(h, 0.1, false) + amplitude(h, 0.4, false)).toBeCloseTo(1, 10);
		const f = foldedMultiplies(h);
		expect(f.nonzero).toBe(13);
		expect(f.folded).toBe(7);
	});
	it('CIC: analytic response matches the taps, with the expected gain and bit growth', () => {
		const h = cicFir(8, 1, 4);
		expect(cicFirCheck(h, 8, 1, 4)).toBeLessThan(1e-9);
		const s = cicStats(8, 1, 4, 0.02, 16);
		expect(s.dcGain).toBe(4096);
		expect(s.bitGrowth).toBe(12);
		expect(s.outBits).toBe(28);
		expect(s.droopDb).toBeLessThan(0);
		expect(cicMag(1 / 8, 8, 1, 4)).toBeLessThan(1e-12); // null at fs/(RM)
		expect(s.aliasBands[0][0]).toBeCloseTo(1 / 8 - 0.02, 12);
	});
});
