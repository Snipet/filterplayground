import { describe, expect, it } from 'vitest';
import {
	METHODS,
	digitalFrequency,
	discretizeWith,
	mapLine,
	mapS,
	maxDbError,
	passbandGrid,
	sPlaneGrid,
	warpedHz
} from '../src/lib/features/discretization/mapping';
import { designAnalog } from '../src/lib/dsp/design';
import { evaluate, findCrossing, linspace } from '../src/lib/dsp/response';
import { abs, c } from '../src/lib/dsp/complex';
import { analogTimeResponse, digitalImpulseResponse } from '../src/lib/dsp/time';
import type { ZPK } from '../src/lib/dsp/types';

const fs = 8000;
const spec = { family: 'butter' as const, band: 'lowpass' as const, order: 4, f1: 2000 };
const f3 = (zpk: ZPK) => {
	const f = linspace(0, fs / 2, 20001);
	const db = evaluate({ kind: 'digital', fs, zpk }, f).magDb;
	return findCrossing(
		f,
		db.map((v) => v - db[0]),
		-3.0103
	)!;
};

describe('discretizeWith', () => {
	it('prewarped bilinear puts the −3 dB point exactly on fc', () => {
		const r = discretizeWith('bilinear-prewarp', spec, fs);
		expect(f3(r.zpk)).toBeCloseTo(2000, 1);
		expect(r.stable).toBe(true);
		// the analog prototype was moved up to the warped frequency
		expect(warpedHz(2000, fs)).toBeCloseTo((fs / Math.PI) * Math.tan(Math.PI / 4), 9);
	});
	it('plain bilinear lands the cutoff at (fs/π)·atan(π fc/fs)', () => {
		const r = discretizeWith('bilinear', spec, fs);
		expect(f3(r.zpk)).toBeCloseTo((fs / Math.PI) * Math.atan((Math.PI * 2000) / fs), 1);
		expect(digitalFrequency('bilinear', 2000, fs, 2000)).toBeCloseTo(f3(r.zpk), 1);
	});
	it('bilinear frequency map: digital response at f_d equals the analog response at f_a', () => {
		const analog = designAnalog(spec);
		const r = discretizeWith('bilinear', spec, fs);
		for (const fa of [300, 1500, 2500, 9000]) {
			const fd = digitalFrequency('bilinear', fa, fs, 2000);
			const a = evaluate({ kind: 'analog', zpk: analog }, [fa]).magDb[0];
			const d = evaluate({ kind: 'digital', fs, zpk: r.zpk }, [fd]).magDb[0];
			expect(d).toBeCloseTo(a, 6);
		}
		expect(digitalFrequency('bilinear-prewarp', 2000, fs, 2000)).toBeCloseTo(2000, 9);
	});
	it('impulse invariance samples the analog impulse response: h[n] = T·h(nT)', () => {
		const r = discretizeWith('impulse', spec, fs);
		const n = 40;
		const hd = digitalImpulseResponse({ kind: 'digital', fs, zpk: r.zpk }, n);
		const ha = analogTimeResponse(r.analog, 'impulse', (n - 1) / fs, n).y;
		for (let i = 0; i < n; i++) expect(hd[i]).toBeCloseTo(ha[i] / fs, 9);
	});
	it('forward Euler turns a stable filter unstable at low fs; more oversampling fixes it', () => {
		expect(discretizeWith('forward-euler', spec, fs).stable).toBe(false);
		expect(discretizeWith('forward-euler', spec, 20 * fs).stable).toBe(true);
	});
	it('every other method keeps stability', () => {
		for (const m of METHODS.filter((x) => x.id !== 'forward-euler'))
			for (const band of ['lowpass', 'highpass', 'bandpass', 'bandstop'] as const)
				expect(
					discretizeWith(
						m.id,
						{ family: 'ellip', band, order: 4, f1: 1000, f2: 2500, rp: 1, rs: 50 },
						fs
					).stable
				).toBe(true);
	});
	it('prewarping is exact at the cutoff only; the passband shape stays warped', () => {
		const analog = designAnalog(spec);
		const pre = discretizeWith('bilinear-prewarp', spec, fs).zpk;
		const plain = discretizeWith('bilinear', spec, fs).zpk;
		expect(maxDbError(analog, pre, fs, [2000])).toBeLessThan(1e-9);
		expect(maxDbError(analog, plain, fs, [2000])).toBeGreaterThan(1);
		const grid = passbandGrid('lowpass', 2000, 0, fs);
		const ePre = maxDbError(analog, pre, fs, grid);
		expect(ePre).toBeGreaterThan(0.1);
		expect(ePre).toBeLessThan(maxDbError(analog, plain, fs, grid));
	});
});

describe('s → z mappings', () => {
	const T = 1 / fs;
	it('bilinear: jω axis → unit circle, left half-plane → inside', () => {
		for (const w of [0, 1000, 1e5, -3e4])
			expect(abs(mapS('bilinear', c(0, w), fs))).toBeCloseTo(1, 12);
		expect(abs(mapS('bilinear', c(-500, 2e4), fs))).toBeLessThan(1);
	});
	it('forward Euler: jω axis → Re z = 1; backward Euler: jω axis → circle |z − ½| = ½', () => {
		for (const w of [0, 3000, -9e4]) {
			expect(mapS('forward-euler', c(0, w), fs).re).toBeCloseTo(1, 12);
			const z = mapS('backward-euler', c(0, w), fs);
			expect(Math.hypot(z.re - 0.5, z.im)).toBeCloseTo(0.5, 12);
		}
		expect(mapS('forward-euler', c(-1 / T, 0), fs).re).toBeCloseTo(0, 12);
	});
	it('z = e^{sT}: frequencies fs apart land on the same point (aliasing)', () => {
		const a = mapS('impulse', c(-300, 2 * Math.PI * 1000), fs);
		const b = mapS('impulse', c(-300, 2 * Math.PI * (1000 + fs)), fs);
		expect(a.re).toBeCloseTo(b.re, 9);
		expect(a.im).toBeCloseTo(b.im, 9);
		expect(digitalFrequency('matched', 0.75 * fs, fs, 0)).toBeCloseTo(0.25 * fs, 9);
	});
	it('the s-plane grid marks lines beyond ±fs/2 as aliased for e^{sT}', () => {
		const g = sPlaneGrid(fs, 0.75 * fs, 'impulse');
		expect(g.some((l) => l.kind === 'omega' && l.aliased)).toBe(true);
		expect(g.some((l) => l.kind === 'jw' && l.aliased)).toBe(true);
		// image of the jω axis lies on the unit circle for bilinear
		const jw = sPlaneGrid(fs, 0.75 * fs, 'bilinear').filter((l) => l.kind === 'jw');
		for (const l of jw)
			for (const z of mapLine('bilinear', l.pts, fs)) expect(abs(z)).toBeCloseTo(1, 9);
	});
});
