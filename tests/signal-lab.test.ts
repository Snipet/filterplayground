import { describe, expect, it } from 'vitest';
import { welchPsd } from '../src/lib/dsp/fft';
import {
	drums,
	impulseTrain,
	logChirp,
	normalizePeak,
	peakOf,
	pinkNoise,
	rmsOf,
	sawtooth,
	square,
	transientIndex,
	whiteNoise,
	windowed
} from '../src/lib/features/signal-lab/signals';

const fs = 48000;

/** Average PSD (dB) in a frequency band. */
function bandDb(x: Float64Array, f0: number, f1: number) {
	const { f, psdDb } = welchPsd(x, 4096);
	let s = 0;
	let n = 0;
	f.forEach((v, i) => {
		const hz = v * fs;
		if (hz >= f0 && hz < f1) {
			s += Math.pow(10, psdDb[i] / 10);
			n++;
		}
	});
	return 10 * Math.log10(s / n);
}

describe('noise', () => {
	it('white noise is flat and deterministic', () => {
		const x = whiteNoise(fs * 2);
		expect(rmsOf(x)).toBeCloseTo(1, 1);
		expect(Math.abs(bandDb(x, 200, 400) - bandDb(x, 8000, 16000))).toBeLessThan(1);
		expect(whiteNoise(10)).toEqual(whiteNoise(10));
	});
	it('pink noise falls by 3 dB per octave', () => {
		const x = pinkNoise(fs * 3);
		const slope = (bandDb(x, 3000, 3300) - bandDb(x, 300, 330)) / Math.log2(10);
		expect(slope).toBeGreaterThan(-3.6);
		expect(slope).toBeLessThan(-2.4);
	});
});

describe('band-limited periodic waves', () => {
	it('square: odd harmonics at 1/k, nothing above Nyquist', () => {
		const n = 48000;
		const x = square(n, fs, 1000);
		// DFT at exact harmonic bins (1 s of signal → 1 Hz resolution)
		const amp = (f: number) => {
			let re = 0;
			let im = 0;
			for (let i = 0; i < n; i++) {
				re += x[i] * Math.cos((2 * Math.PI * f * i) / fs);
				im += x[i] * Math.sin((2 * Math.PI * f * i) / fs);
			}
			return (2 * Math.hypot(re, im)) / n;
		};
		expect(amp(1000)).toBeCloseTo(4 / Math.PI, 3);
		expect(amp(3000)).toBeCloseTo(4 / (3 * Math.PI), 3);
		expect(amp(2000)).toBeLessThan(1e-6);
		// Gibbs overshoot of a band-limited square wave ≈ 9 %
		expect(peakOf(x)).toBeGreaterThan(1.05);
		expect(peakOf(x)).toBeLessThan(1.2);
	});
	it('sawtooth has all harmonics', () => {
		const x = sawtooth(48000, fs, 500);
		expect(rmsOf(x)).toBeCloseTo(1 / Math.sqrt(3), 1);
	});
	it('chirp, impulse train and drums have sensible levels', () => {
		expect(peakOf(logChirp(fs, fs, 20, 20000))).toBeCloseTo(1, 3);
		const imp = impulseTrain(fs, fs, 10);
		expect(imp.reduce((s, v) => s + v, 0)).toBe(10);
		const d = normalizePeak(drums(fs * 3, fs), 0.5);
		expect(peakOf(d)).toBeCloseTo(0.5, 12);
		expect(transientIndex(d, fs)).toBeGreaterThan(0);
	});
});

describe('display helpers', () => {
	it('windowed keeps every sample for short windows and the extremes for long ones', () => {
		const x = Float64Array.from({ length: 10000 }, (_, i) => Math.sin(i / 10));
		x[5000] = 3;
		const short = windowed(x, 100, 200, fs);
		expect(short.y).toHaveLength(200);
		expect(short.t[0]).toBeCloseTo((100 / fs) * 1000, 12);
		const long = windowed(x, 0, 10000, fs, 400);
		expect(long.y.length).toBeLessThanOrEqual(400);
		expect(Math.max(...long.y)).toBe(3);
	});
});
