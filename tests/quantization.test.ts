import { describe, expect, it } from 'vitest';
import { designDigital } from '../src/lib/dsp/design';
import { sos2tf } from '../src/lib/dsp/convert';
import {
	autoFormat,
	coupledGrid,
	directFormGrid,
	makeFormat,
	qName,
	quantize,
	quantizeCoupled,
	quantizeDirect,
	quantizeSos,
	roundTo,
	sosPoles,
	zeroInputResponse
} from '../src/lib/features/quantization/quant';

describe('fixed-point formats', () => {
	it('quantises with rounding and saturation', () => {
		const q15 = makeFormat(16, 0);
		expect(qName(q15)).toBe('Q0.15');
		expect(quantize(0.5, q15)).toEqual({ value: 0.5, saturated: false });
		expect(quantize(1, q15).saturated).toBe(true);
		expect(quantize(1, q15).value).toBeCloseTo(1 - 2 ** -15, 15);
		expect(quantize(-1, q15)).toEqual({ value: -1, saturated: false });
		expect(quantize(0.1, q15).value).toBe(Math.round(0.1 * 32768) / 32768);
	});
	it('chooses just enough integer bits', () => {
		expect(qName(autoFormat([0.3, -0.9], 16))).toBe('Q0.15');
		expect(qName(autoFormat([1, -0.5], 16))).toBe('Q1.14'); // +1 does not fit Q0.15
		expect(qName(autoFormat([-1.98, 0.99], 16))).toBe('Q1.14');
		expect(qName(autoFormat([1, 2, 1], 16))).toBe('Q2.13');
		expect(qName(autoFormat([70, -56], 16))).toBe('Q7.8');
		// a value that would round up past the top of the range needs another bit
		expect(qName(autoFormat([1.99999], 8))).toBe('Q2.5');
	});
});

describe('structures under quantisation', () => {
	const d = designDigital({
		family: 'ellip',
		band: 'lowpass',
		order: 6,
		f1: 1000,
		rp: 0.5,
		rs: 60,
		fs: 48000
	});
	const tf = sos2tf(d.sos);
	it('direct form breaks at 16 bits, cascade and coupled do not', () => {
		const df = quantizeDirect(tf, 16, null);
		const so = quantizeSos(d.sos, 16, null);
		const co = quantizeCoupled(sosPoles(d.sos), so.zpk.z, so.gain, 16, null);
		expect(df.stable).toBe(false);
		expect(so.stable).toBe(true);
		expect(co.stable).toBe(true);
		expect(qName(df.sets[1].format)).toBe('Q5.10');
		expect(qName(so.sets[1].format)).toBe('Q1.14');
	});
	it('converges to the exact filter at long word lengths', () => {
		const so = quantizeSos(d.sos, 32, null);
		const exact = sosPoles(d.sos);
		const q = so.zpk.p;
		for (const p of exact)
			expect(Math.min(...q.map((r) => Math.hypot(r.re - p.re, r.im - p.im)))).toBeLessThan(1e-6);
	});
	it('keeps the gain exact and integer codes consistent', () => {
		const so = quantizeSos(d.sos, 16, null);
		const fa = so.sets[1].format;
		so.sos.forEach((row, i) => {
			expect(row[4]).toBe(so.ints[i][3] / 2 ** fa.frac);
			expect(row[5]).toBe(so.ints[i][4] / 2 ** fa.frac);
		});
		// DC gain close to the original (elliptic even order: −rp at DC)
		const dc = (sos: number[][]) =>
			sos.reduce((g, r) => g * ((r[0] + r[1] + r[2]) / (r[3] + r[4] + r[5])), 1);
		expect(20 * Math.log10(dc(so.sos))).toBeCloseTo(20 * Math.log10(dc(d.sos)), 1);
	});
	it('manual formats saturate', () => {
		const so = quantizeSos(d.sos, 16, 0);
		expect(so.sets[1].saturated).toBeGreaterThan(0);
	});
});

describe('realisable pole grids', () => {
	it('direct-form grid is sparse near z = 1, coupled grid is uniform', () => {
		const df = directFormGrid(6);
		const cp = coupledGrid(6);
		const near = (pts: { re: number; im: number }[]) =>
			pts.filter((p) => Math.hypot(p.re - 1, p.im) < 0.2).length;
		const mid = (pts: { re: number; im: number }[]) =>
			pts.filter((p) => Math.hypot(p.re, p.im - 0.8) < 0.2).length;
		// relative to the uniform coupled grid, the direct-form grid is much thinner near z = 1
		expect(near(df) / near(cp)).toBeLessThan(0.3 * (mid(df) / mid(cp)));
		for (const p of [...df, ...cp]) expect(Math.hypot(p.re, p.im)).toBeLessThan(1);
	});
});

describe('limit cycles', () => {
	it('rounding sustains an oscillation, magnitude truncation does not', () => {
		const r = 0.95;
		const th = (20 * Math.PI) / 180;
		const a1 = -2 * r * Math.cos(th);
		const a2 = r * r;
		const rounded = zeroInputResponse(a1, a2, 0.5, 7, 'round', 400);
		const trunc = zeroInputResponse(a1, a2, 0.5, 7, 'trunc', 400);
		const tail = (v: number[]) => Math.max(...v.slice(-100).map(Math.abs)) * 128;
		expect(Math.abs(rounded.ideal[399]) * 128).toBeLessThan(1e-3);
		expect(tail(rounded.quantized)).toBeGreaterThanOrEqual(1);
		// within Jackson's dead band
		expect(tail(rounded.quantized)).toBeLessThanOrEqual(0.5 / (1 - a2) + 1e-9);
		expect(tail(trunc.quantized)).toBe(0);
	});
	it('roundTo', () => {
		expect(roundTo(0.3, 2, 'round')).toBe(0.25);
		expect(roundTo(-0.3, 2, 'floor')).toBe(-0.5);
		expect(roundTo(-0.3, 2, 'trunc')).toBe(-0.25);
	});
});
