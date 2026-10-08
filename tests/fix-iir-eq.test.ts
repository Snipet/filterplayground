import { describe, expect, it } from 'vitest';
import {
	checkSpec,
	edgeCrossing,
	estimateCapped,
	restoreSpecs,
	scipyRecipe,
	type SpecTable
} from '../src/lib/features/iir-designer/sections';
import { designDigital, estimateFromSpecs, type SpecEdges } from '../src/lib/dsp/design';
import { evaluate, linspace } from '../src/lib/dsp/response';
import type { AnalogFamily } from '../src/lib/dsp/analog';
import type { BandType, DigitalFilter } from '../src/lib/dsp/types';
import {
	PRESETS,
	analogBandDb,
	bandSection,
	bandsFromPreset,
	draggedGain,
	effectiveFreq,
	maxFreq,
	type EqBand
} from '../src/lib/features/parametric-eq/eq';

const FS = 48000;
const digital = (sos: number[][], fs = FS): DigitalFilter => ({ kind: 'digital', fs, sos });

/** Design exactly as the IIR designer's spec mode does (page cap 20). */
function specDesign(family: AnalogFamily, spec: SpecEdges, maxOrder = 20) {
	const est = estimateCapped(family, spec, { maxOrder });
	const r = designDigital({
		family,
		band: spec.band,
		order: est.order,
		f1: est.f1,
		f2: est.f2,
		rp: spec.rp,
		rs: spec.rs,
		fs: FS
	});
	return { est, filter: digital(r.sos) };
}

describe('#30 spec mode above the page order cap keeps the passband exact', () => {
	it('Chebyshev II low-pass 8000/8200 Hz, 1/80 dB: designed at N = 20 with Wn for N = 20', () => {
		const spec: SpecEdges = { band: 'lowpass', fp: 8000, fstop: 8200, rp: 1, rs: 80, fs: FS };
		const { est, filter } = specDesign('cheby2', spec);
		expect(est.order).toBe(20);
		expect(est.capped).toBe(true);
		expect(est.requiredOrder).toBe(43); // scipy.signal.cheb2ord gives 43
		// SciPy: cheby2(20, 80, 8913.5, fs=48000) is −1.000 dB at 8 kHz
		expect(est.f1).toBeCloseTo(8913.5, 0);
		const chk = checkSpec(filter, 'lowpass', [8000, 8000], [8200, 8200]);
		expect(chk.passMinDb).toBeGreaterThan(-1.001);
		expect(evaluate(filter, [8000]).magDb[0]).toBeCloseTo(-1, 6);
	});

	it('Butterworth low-pass (default spec 8000/10000 Hz, 1/60 dB): −1 dB at the passband edge', () => {
		const spec: SpecEdges = { band: 'lowpass', fp: 8000, fstop: 10000, rp: 1, rs: 60, fs: FS };
		// needs 27, which is below the family cap of 30, so estimateFromSpecs alone is not capped
		expect(estimateFromSpecs('butter', spec).capped).toBe(false);
		const { est, filter } = specDesign('butter', spec);
		expect(est.order).toBe(20);
		expect(est.capped).toBe(true);
		expect(est.requiredOrder).toBe(27); // scipy.signal.buttord gives 27
		expect(evaluate(filter, [8000]).magDb[0]).toBeCloseTo(-1, 6);
	});

	const cases: { family: AnalogFamily; spec: SpecEdges; required: number }[] = [
		{
			family: 'butter',
			spec: { band: 'lowpass', fp: 8000, fstop: 9000, rp: 1, rs: 60, fs: FS },
			required: 52
		},
		{
			family: 'butter',
			spec: { band: 'highpass', fp: 4000, fstop: 3000, rp: 1, rs: 120, fs: FS },
			required: 49
		},
		{
			family: 'butter',
			spec: { band: 'bandpass', fp: [4000, 8000], fstop: [3500, 9000], rp: 1, rs: 80, fs: FS },
			required: 30
		},
		{
			family: 'cheby2',
			spec: { band: 'lowpass', fp: 8000, fstop: 8600, rp: 1, rs: 80, fs: FS },
			required: 25
		},
		{
			family: 'cheby1',
			spec: { band: 'lowpass', fp: 8000, fstop: 8200, rp: 1, rs: 80, fs: FS },
			required: 43
		}
	];
	for (const c of cases) {
		it(`${c.family} ${c.spec.band} needing N = ${c.required}: passband edge at exactly −Rp`, () => {
			const { est, filter } = specDesign(c.family, c.spec);
			expect(est.order).toBe(20);
			expect(est.requiredOrder).toBe(c.required); // SciPy's *ord value
			const fp = Array.isArray(c.spec.fp) ? c.spec.fp : [c.spec.fp];
			for (const f of fp) expect(evaluate(filter, [f]).magDb[0]).toBeCloseTo(-c.spec.rp, 5);
		});
	}

	it('band-stop: both passband edges stay within −Rp at the capped order', () => {
		const spec: SpecEdges = {
			band: 'bandstop',
			fp: [3000, 10000],
			fstop: [3400, 9500],
			rp: 1,
			rs: 140,
			fs: FS
		};
		const { est, filter } = specDesign('cheby2', spec);
		expect(est.capped).toBe(true);
		expect(est.order).toBe(20);
		const chk = checkSpec(filter, 'bandstop', [3000, 10000], [3400, 9500]);
		expect(chk.passMinDb).toBeGreaterThan(-1.001);
	});

	it('leaves estimates within the cap unchanged', () => {
		const spec: SpecEdges = {
			band: 'bandstop',
			fp: [3000, 10000],
			fstop: [4000, 8000],
			rp: 1,
			rs: 60,
			fs: FS
		};
		for (const family of ['butter', 'cheby2', 'ellip', 'bessel'] as AnalogFamily[]) {
			const a = estimateFromSpecs(family, spec);
			const b = estimateCapped(family, spec, { maxOrder: 20 });
			expect(b.order).toBe(a.order);
			expect(b.f1).toBe(a.f1);
			expect(b.f2).toBe(a.f2);
			expect(b.capped).toBe(a.capped);
		}
	});

	it('the SciPy recipe states SciPy’s order, not the page’s cap', () => {
		const spec: SpecEdges = { band: 'lowpass', fp: 8000, fstop: 8200, rp: 1, rs: 80, fs: FS };
		const est = estimateCapped('cheby2', spec, { maxOrder: 20 });
		const base = {
			family: 'cheby2' as AnalogFamily,
			band: 'lowpass' as BandType,
			order: est.order,
			f1: est.f1,
			rp: 1,
			rs: 80,
			fs: FS,
			besselNorm: 'mag' as const,
			spec: { fp: 8000, fstop: 8200 }
		};
		const py = scipyRecipe({ ...base, capped: est.capped, requiredOrder: est.requiredOrder })!;
		expect(py).toContain('gives N = 43');
		expect(py).not.toContain('gives N = 20');
		expect(py).toContain('signal.cheb2ord(8000, 8200, 1, 80, fs=fs)');
		expect(py).toContain('signal.cheby2(20, 80, ');
		// uncapped: unchanged wording
		const ok = scipyRecipe({ ...base, order: 7 })!;
		expect(ok).toContain('(gives N = 7;');
	});
});

describe('#31 −3 dB frequency is exact for low cut-offs', () => {
	const cases: { band: 'lowpass' | 'highpass'; N: number; fc: number; fs: number }[] = [
		{ band: 'lowpass', N: 6, fc: 10, fs: 48000 },
		{ band: 'highpass', N: 4, fc: 30, fs: 192000 },
		{ band: 'highpass', N: 4, fc: 20, fs: 48000 },
		{ band: 'lowpass', N: 6, fc: 20, fs: 48000 },
		{ band: 'lowpass', N: 4, fc: 8000, fs: 48000 },
		{ band: 'highpass', N: 8, fc: 23000, fs: 48000 }
	];
	for (const c of cases) {
		it(`Butterworth ${c.band} N=${c.N} at ${c.fc} Hz, fs ${c.fs}`, () => {
			const r = designDigital({ family: 'butter', band: c.band, order: c.N, f1: c.fc, fs: c.fs });
			const f3 = edgeCrossing(digital(r.sos, c.fs), c.band);
			expect(f3).not.toBeNull();
			expect(Math.abs(f3! / c.fc - 1)).toBeLessThan(1e-6);
		});
	}

	it('takes the band-edge crossing when the passband ripple is deeper than 3 dB', () => {
		// Chebyshev I, Rp = 4 dB: the ripple itself crosses −3 dB inside the passband
		const r = designDigital({
			family: 'cheby1',
			band: 'lowpass',
			order: 4,
			f1: 1000,
			rp: 4,
			fs: FS
		});
		const f = digital(r.sos);
		const f3 = edgeCrossing(f, 'lowpass')!;
		expect(f3).toBeGreaterThan(900);
		expect(f3).toBeLessThan(1000);
		const peak = Math.max(...evaluate(f, linspace(0, 1000, 20001)).magDb);
		expect(evaluate(f, [f3]).magDb[0] - peak).toBeCloseTo(-3.0103, 3);
		const hp = designDigital({
			family: 'cheby1',
			band: 'highpass',
			order: 3,
			f1: 1000,
			rp: 6,
			fs: FS
		});
		const h3 = edgeCrossing(digital(hp.sos), 'highpass')!;
		expect(h3).toBeGreaterThan(1000);
		expect(h3).toBeLessThan(1100);
	});
});

describe('#93 bilinear low-pass at fs/2 equals the analog response at infinity', () => {
	const atNyq = (family: AnalogFamily, order: number) => {
		const r = designDigital({ family, band: 'lowpass', order, f1: 8000, rp: 1, rs: 60, fs: FS });
		return evaluate(digital(r.sos), [FS / 2]).magDb[0];
	};
	it('even-order elliptic / Chebyshev II end at −Rs (the page default is −60 dB)', () => {
		expect(atNyq('ellip', 6)).toBeCloseTo(-60, 3);
		expect(atNyq('cheby2', 4)).toBeCloseTo(-60, 3);
	});
	it('all-pole and odd-order designs reach −∞ dB', () => {
		for (const [fam, n] of [
			['ellip', 5],
			['cheby2', 5],
			['butter', 6],
			['cheby1', 4],
			['bessel', 4]
		] as [AnalogFamily, number][])
			expect(atNyq(fam, n)).toBeLessThan(-200);
	});
});

describe('#94 shared spec tables are validated per band', () => {
	const defaults: SpecTable = {
		lowpass: { fp: [8000, 8000], fs: [10000, 10000] },
		highpass: { fp: [4000, 4000], fs: [3000, 3000] },
		bandpass: { fp: [4000, 8000], fs: [3000, 10000] },
		bandstop: { fp: [3000, 10000], fs: [4000, 8000] }
	};
	it('keeps the default for malformed entries', () => {
		for (const raw of [
			{ lowpass: { fp: 'x' } },
			{ lowpass: null },
			{ lowpass: {} },
			{ lowpass: { fp: [1, 2], fs: [3] } },
			{ lowpass: { fp: [1, NaN], fs: [3, 4] } },
			{ lowpass: { fp: [-1, 2], fs: [3, 4] } },
			{ lowpass: { fp: ['1', 2], fs: [3, 4] } },
			'nope',
			null
		]) {
			const out = restoreSpecs(defaults, raw);
			expect(out.lowpass).toEqual(defaults.lowpass);
			expect(out.lowpass.fp[0]).toBe(8000);
		}
	});
	it('accepts valid bands, copies them and ignores unknown keys', () => {
		const raw = {
			highpass: { fp: [5000, 5000], fs: [2000, 2000], extra: 1 },
			bogus: { fp: [1, 2], fs: [3, 4] }
		};
		const out = restoreSpecs(defaults, raw);
		expect(out.highpass).toEqual({ fp: [5000, 5000], fs: [2000, 2000] });
		expect(out.lowpass).toEqual(defaults.lowpass);
		expect(Object.keys(out).sort()).toEqual(['bandpass', 'bandstop', 'highpass', 'lowpass']);
		expect(out.highpass.fp).not.toBe(raw.highpass.fp);
	});
});

describe('#92 bands above 0.49·fs: analog prototype uses the applied frequency', () => {
	const shelf: EqBand = {
		id: 1,
		slot: 4,
		type: 'highshelf',
		f: 12000,
		q: 0.707,
		gain: 3,
		enabled: true
	};
	it('effectiveFreq is the frequency the biquad is designed at', () => {
		expect(effectiveFreq(shelf, 16000)).toBeCloseTo(maxFreq(16000), 12);
		expect(effectiveFreq(shelf, 48000)).toBe(12000);
		expect(bandSection(shelf, 16000)).toEqual(bandSection({ ...shelf, f: 7840 }, 16000));
	});
	it('analogBandDb with fs normalises by the applied frequency', () => {
		for (const f of [100, 1000, 5000, 7840])
			expect(analogBandDb(shelf, f, 16000)).toBeCloseTo(analogBandDb({ ...shelf, f: 7840 }, f), 12);
		// both pass through half the gain at the applied f0
		const dig = evaluate(digital([bandSection(shelf, 16000)], 16000), [7840]).magDb[0];
		expect(dig).toBeCloseTo(1.5, 6);
		expect(analogBandDb(shelf, 7840, 16000)).toBeCloseTo(1.5, 6);
		// without fs: unchanged behaviour
		expect(analogBandDb(shelf, 12000)).toBeCloseTo(1.5, 6);
	});
	it('the cramping figure for Vocal polish at 16 kHz compares like with like', () => {
		const fs = 16000;
		const bands = bandsFromPreset(PRESETS[0], 1);
		const grid = linspace(Math.log10(20), Math.log10(fs / 2), 640).map((v) => 10 ** v);
		const sos = bands.map((b) => bandSection(b, fs));
		const db = evaluate(digital(sos, fs), grid).magDb;
		let worst = 0;
		for (let i = 0; i < grid.length; i++) {
			const a = bands.reduce((s, b) => s + analogBandDb(b, grid[i], fs), 0);
			if (Math.abs(db[i] - a) > Math.abs(worst)) worst = db[i] - a;
		}
		expect(Math.abs(worst)).toBeCloseTo(1.92, 2);
	});
});

describe('#32 RBJ responses at Nyquist', () => {
	const at = (type: EqBand['type'], fs = 48000) => {
		const s = bandSection({ id: 1, slot: 0, type, f: 12000, q: 0.707, gain: 6, enabled: true }, fs);
		return 20 * Math.log10(Math.abs((s[0] - s[1] + s[2]) / (s[3] - s[4] + s[5])));
	};
	it('a high shelf reaches its full gain at Nyquist; bells and low shelves return to 0 dB', () => {
		for (const fs of [44100, 48000, 96000]) {
			expect(at('highshelf', fs)).toBeCloseTo(6, 9);
			expect(at('peaking', fs)).toBeCloseTo(0, 9);
			expect(at('lowshelf', fs)).toBeCloseTo(0, 9);
		}
	});
	it('the digital high shelf is steeper than its analog prototype above f0', () => {
		const b: EqBand = {
			id: 1,
			slot: 0,
			type: 'highshelf',
			f: 12000,
			q: 0.707,
			gain: 6,
			enabled: true
		};
		const f = [14000, 16000, 18000, 20000, 22000];
		const d = evaluate(digital([bandSection(b, FS)]), f).magDb;
		f.forEach((v, i) => expect(d[i]).toBeGreaterThan(analogBandDb(b, v, FS)));
		expect(analogBandDb(b, FS / 2, FS)).toBeLessThan(5.7);
	});
});

describe('#91 dragging a gain handle is relative to the drag start', () => {
	const bell: EqBand = { id: 1, slot: 0, type: 'peaking', f: 1000, q: 1, gain: 18, enabled: true };
	const shelf: EqBand = { ...bell, type: 'lowshelf', gain: 20 };
	it('a sideways drag keeps an off-scale gain', () => {
		expect(draggedGain(bell, 18, 0)).toBe(18);
		expect(draggedGain(shelf, 20, 0)).toBe(20);
		expect(draggedGain({ ...bell, gain: -18 }, -18, 0)).toBe(-18);
	});
	it('vertical movement changes the gain by the same amount of handle level', () => {
		expect(draggedGain(bell, 18, -2)).toBe(16);
		expect(draggedGain(bell, 18, 10)).toBe(24); // clamped to ±MAX_GAIN
		// shelf handles sit at half the gain
		expect(draggedGain(shelf, 20, -1)).toBe(18);
		expect(draggedGain({ ...bell, gain: 3 }, 3, 1.04)).toBe(4);
	});
});
