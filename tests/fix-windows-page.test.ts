import { describe, expect, it } from 'vitest';
import {
	dftReal,
	effectiveParam,
	lowest,
	makeWindow,
	paramRange,
	resolveWeak,
	twoTones,
	windowedSpectrum,
	type ToneSetup
} from '../src/lib/features/windows/analysis';
import { windowMetrics, type WindowType } from '../src/lib/dsp/windows';

/** Reference DFT bins 0..⌊L/2⌋ of x zero-padded to L, with exact twiddles. */
function directDft(x: readonly number[], L: number) {
	const re: number[] = [];
	const im: number[] = [];
	for (let k = 0; k <= Math.floor(L / 2); k++) {
		let r = 0;
		let i = 0;
		for (let n = 0; n < x.length; n++) {
			const a = (-2 * Math.PI * ((k * n) % L)) / L;
			r += x[n] * Math.cos(a);
			i += x[n] * Math.sin(a);
		}
		re.push(r);
		im.push(i);
	}
	return { re, im };
}

function verdict(type: WindowType, s: ToneSetup, periodic: boolean) {
	const w = makeWindow({ type }, s.N, periodic);
	return resolveWeak(
		windowedSpectrum(twoTones(s), w, s.pad),
		windowedSpectrum(twoTones(s, false), w, s.pad),
		s,
		windowMetrics(w).mainLobeWidth / 2
	);
}

describe('#28 zero padding "None" is a true N-point DFT for any N', () => {
	it('dftReal matches a direct DFT at non-power-of-2 lengths', () => {
		for (const [N, L] of [
			[100, 100],
			[37, 37],
			[1000, 1000],
			[100, 400],
			[9, 144],
			[1000, 16000],
			[64, 64]
		]) {
			const x = Array.from(
				{ length: N },
				(_, n) => Math.cos((2 * Math.PI * 10.3 * n) / N + 0.3) + 1e-3 * Math.sin(0.7 * n)
			);
			const a = dftReal(x, L);
			const b = directDft(x, L);
			expect(a.re.length).toBe(b.re.length);
			const peak = Math.max(...b.re.map((r, k) => Math.hypot(r, b.im[k])));
			for (let k = 0; k < b.re.length; k++)
				expect(Math.hypot(a.re[k] - b.re[k], a.im[k] - b.im[k]) / peak).toBeLessThan(1e-11);
		}
	});

	it('samples exactly N·pad points: integer bins without padding, k/pad with it', () => {
		const x = twoTones({ N: 100, f1: 10, f2: 16, weakDb: -55, pad: 1 });
		const w = makeWindow({ type: 'hann' }, 100, true);
		const s1 = windowedSpectrum(x, w, 1);
		expect(s1.bins).toEqual(Array.from({ length: 51 }, (_, k) => k));
		const s4 = windowedSpectrum(x, w, 4);
		expect(s4.bins).toHaveLength(201);
		s4.bins.forEach((b, k) => expect(b).toBeCloseTo(k / 4, 12));
		// odd N: half spectrum up to ⌊N/2⌋
		const x37 = twoTones({ N: 37, f1: 5, f2: 9, weakDb: -55, pad: 1 });
		expect(windowedSpectrum(x37, makeWindow({ type: 'hann' }, 37, true), 1).bins).toEqual(
			Array.from({ length: 19 }, (_, k) => k)
		);
	});

	it('coherent sampling: integer-bin tones are resolved with leakage at the null floor (N = 100, 37, 200, 1000)', () => {
		// before: N = 100 used a 128-point grid; rectangular leaked −23.7 dB and Hann −55.3 dB at bin 16
		for (const N of [100, 37, 200, 1000]) {
			const s: ToneSetup = { N, f1: 10, f2: 16, weakDb: -55, pad: 1 };
			for (const t of ['rectangular', 'hann', 'blackmanharris'] as const) {
				const r = verdict(t, s, true);
				expect(r.resolved, `${t} N=${N}`).toBe(true);
				expect(r.leakageDb, `${t} N=${N}`).toBeLessThan(-250); // page shows 'none (null)'
				expect(r.peakDb!).toBeCloseTo(-55, 6);
			}
		}
	});

	it('power-of-2 lengths and the padded default demo are unchanged', () => {
		const s: ToneSetup = { N: 64, f1: 10.3, f2: 17.5, weakDb: -55, pad: 16 };
		expect(verdict('rectangular', s, false).resolved).toBe(false);
		expect(verdict('hann', s, false).resolved).toBe(true);
		// same verdicts at a non-power-of-2 length with exact 16× padding
		const s2: ToneSetup = { ...s, N: 100 };
		expect(verdict('rectangular', s2, false).resolved).toBe(false);
		expect(verdict('hann', s2, false).resolved).toBe(true);
	});

	it('reads a bin-centred tone at its amplitude at a non-power-of-2 length', () => {
		const N = 90;
		const x = Array.from({ length: N }, (_, n) => 0.5 * Math.cos((2 * Math.PI * 8 * n) / N));
		const sp = windowedSpectrum(x, makeWindow({ type: 'hann' }, N, true), 1);
		expect(sp.db[8]).toBeCloseTo(20 * Math.log10(0.5), 9);
	});
});

describe('#90 DPSS NW is kept below N/2', () => {
	// scipy.signal.windows.dpss(M, NW, sym), normalised to peak 1
	const SCIPY: [number, number, boolean, number[]][] = [
		[
			8,
			3.9,
			false,
			[
				0.015688495333, 0.120448571504, 0.409425642136, 0.804665528065, 1.0, 0.804665528065,
				0.409425642136, 0.120448571504
			]
		],
		[
			8,
			3.9,
			true,
			[
				0.028652890095, 0.200284875493, 0.600284715783, 1.0, 1.0, 0.600284715783, 0.200284875493,
				0.028652890095
			]
		],
		[
			9,
			4.4,
			true,
			[
				0.014322897897, 0.114452930744, 0.400259992605, 0.800129959758, 1.0, 0.800129959758,
				0.400259992605, 0.114452930744, 0.014322897897
			]
		]
	];

	it('limits the slider range to NW < N/2 and leaves other windows alone', () => {
		expect(paramRange('dpss', 8)!.max).toBe(3.9);
		expect(paramRange('dpss', 9)!.max).toBe(4.4);
		expect(paramRange('dpss', 20)!.max).toBe(9.9);
		expect(paramRange('dpss', 64)!.max).toBe(10);
		expect(paramRange('kaiser', 8)!.max).toBe(paramRange('kaiser', 1024)!.max);
		expect(paramRange('hann', 8)).toBeUndefined();
		expect(effectiveParam({ type: 'dpss', param: 5 }, 8)).toBe(3.9);
		expect(effectiveParam({ type: 'dpss', param: 5 }, 64)).toBe(5);
		expect(effectiveParam({ type: 'dpss' }, 8)).toBe(3);
	});

	it('NW ≥ N/2 no longer aliases to the window for N − NW', () => {
		const w3 = makeWindow({ type: 'dpss', param: 3 }, 8, false);
		const w5 = makeWindow({ type: 'dpss', param: 5 }, 8, false);
		const w10 = makeWindow({ type: 'dpss', param: 10 }, 8, false);
		expect(w5).not.toEqual(w3); // before: identical (W = 5/8 folded to 3/8)
		expect(w10).toEqual(w5); // both use the largest valid NW, 3.9
		// raising NW lowers the sidelobes; before, NW = 10 gave −48 dB, worse than NW = 3
		const psl3 = windowMetrics(w3).peakSidelobeDb;
		const psl10 = windowMetrics(w10).peakSidelobeDb;
		expect(Number.isFinite(psl10)).toBe(true);
		expect(psl10).toBeLessThan(psl3);
	});

	it('the clamped windows match SciPy dpss', () => {
		for (const [M, NW, sym, ref] of SCIPY) {
			const w = makeWindow({ type: 'dpss', param: 10 }, M, !sym);
			expect(effectiveParam({ type: 'dpss', param: 10 }, M)).toBe(NW);
			w.forEach((v, i) => expect(v).toBeCloseTo(ref[i], 8));
		}
	});

	it('no −∞ / NaN metrics at the N/2 boundary any more (N = 8, NW = 4)', () => {
		for (const periodic of [false, true]) {
			const m = windowMetrics(makeWindow({ type: 'dpss', param: 4 }, 8, periodic));
			expect(Number.isFinite(m.peakSidelobeDb)).toBe(true);
			expect(Number.isFinite(m.mainLobeWidth)).toBe(true);
		}
	});

	it('lowest() ranks −∞ first and skips NaN, unlike a subtraction sort', () => {
		const rows = [{ v: -31 }, { v: NaN }, { v: -Infinity }, { v: -13 }];
		expect(lowest(rows, (r) => r.v)!.v).toBe(-Infinity);
		expect(lowest([{ v: NaN }, { v: -13 }, { v: -31 }], (r) => r.v)!.v).toBe(-31);
		expect(lowest([{ v: NaN }], (r) => r.v)).toBeUndefined();
	});
});
