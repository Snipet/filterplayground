import { describe, expect, it } from 'vitest';
import {
	allWindowMetrics,
	makeWindow,
	resolveWeak,
	sliceDecimate,
	sortRows,
	twoTones,
	windowedSpectrum,
	windowLevelAt,
	type ToneSetup
} from '../src/lib/features/windows/analysis';
import { windowMetrics, windowValues, type WindowType } from '../src/lib/dsp/windows';

function verdict(type: WindowType, s: ToneSetup, periodic = false) {
	const w = makeWindow({ type }, s.N, periodic);
	const m = windowMetrics(w);
	return resolveWeak(
		windowedSpectrum(twoTones(s), w, s.pad),
		windowedSpectrum(twoTones(s, false), w, s.pad),
		s,
		m.mainLobeWidth / 2
	);
}

describe('windows: leakage experiment', () => {
	it('reads a bin-centred tone at its amplitude after coherent-gain scaling', () => {
		const N = 64;
		const x = Array.from({ length: N }, (_, n) => 0.5 * Math.cos((2 * Math.PI * 8 * n) / N));
		const sp = windowedSpectrum(x, makeWindow({ type: 'hann' }, N, true), 8);
		const k = sp.bins.findIndex((b) => Math.abs(b - 8) < 1e-9);
		expect(sp.db[k]).toBeCloseTo(20 * Math.log10(0.5), 6);
	});
	it('window level at an offset matches the metrics', () => {
		const w = makeWindow({ type: 'hann' }, 64, true);
		expect(windowLevelAt(w, 0)).toBeCloseTo(0, 12);
		expect(-windowLevelAt(w, 0.5)).toBeCloseTo(windowMetrics(w).scallopLossDb, 6);
		expect(windowLevelAt(w, 3)).toBeLessThan(-200); // periodic Hann: exact nulls at integer bins ≥ 2
	});
	it('default demo: rectangular and Hamming hide the weak tone, Hann and Blackman–Harris show it', () => {
		const s: ToneSetup = { N: 64, f1: 10.3, f2: 17.5, weakDb: -55, pad: 16 };
		expect(verdict('rectangular', s)).toMatchObject({ resolved: false, reason: 'leakage' });
		expect(verdict('hamming', s).resolved).toBe(false);
		expect(verdict('hann', s).resolved).toBe(true);
		expect(verdict('blackmanharris', s).resolved).toBe(true);
	});
	it('close tones fall inside a wide main lobe', () => {
		const s: ToneSetup = { N: 64, f1: 10.3, f2: 12.9, weakDb: -30, pad: 16 };
		expect(verdict('blackmanharris', s)).toMatchObject({ resolved: false, reason: 'mainlobe' });
		expect(verdict('hamming', s).resolved).toBe(true);
	});
	it('coherent sampling: integer-bin tones without padding are resolved by every periodic window', () => {
		const s: ToneSetup = { N: 64, f1: 10, f2: 16, weakDb: -60, pad: 1 };
		for (const t of ['rectangular', 'hann', 'blackmanharris'] as const)
			expect(verdict(t, s, true).resolved, t).toBe(true);
	});
});

describe('windows: fast Chebyshev path', () => {
	it('matches the shared window, symmetric and periodic', () => {
		for (const periodic of [false, true]) {
			const a = makeWindow({ type: 'chebyshev', param: 90 }, 48, periodic);
			const b = windowValues('chebyshev', 48, 90, periodic);
			a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(1e-9));
		}
	});
});

describe('windows: tables and plotting', () => {
	it('sorts the reference table and keeps NaN last', () => {
		const rows = allWindowMetrics(64, false);
		expect(rows).toHaveLength(20);
		const byPsl = sortRows(rows, 'peakSidelobeDb', 1);
		expect(byPsl[0].peakSidelobeDb).toBeLessThanOrEqual(byPsl[1].peakSidelobeDb);
		const byEnbw = sortRows(rows, 'enbw', -1);
		expect(byEnbw[0].type).toBe('flattop');
		const withNaN = sortRows([{ ...rows[0], enbw: NaN }, rows[1]], 'enbw', 1);
		expect(withNaN[1].enbw).toBeNaN();
	});
	it('slices to a range and decimates with extremes kept', () => {
		const x = Array.from({ length: 20000 }, (_, i) => i / 100);
		const y = x.map((v) => Math.sin(v * 7));
		const d = sliceDecimate(x, y, 10, 50, 200);
		expect(d.x[0]).toBeLessThanOrEqual(10);
		expect(d.x[d.x.length - 1]).toBeGreaterThanOrEqual(50);
		expect(d.x.length).toBeLessThanOrEqual(400);
		expect(Math.max(...d.y)).toBeGreaterThan(0.999);
	});
});
