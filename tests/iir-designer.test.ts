import { describe, expect, it } from 'vitest';
import {
	checkSpec,
	float32Sensitivity,
	matlabRecipe,
	scipyRecipe,
	sectionInfo
} from '../src/lib/features/iir-designer/sections';
import { designDigital, estimateFromSpecs } from '../src/lib/dsp/design';
import { biquad } from '../src/lib/dsp/biquad';
import type { AnalogFamily } from '../src/lib/dsp/analog';
import type { BandType } from '../src/lib/dsp/types';

describe('sectionInfo', () => {
	it('reports the pole radius and angle of a resonant biquad', () => {
		const fs = 48000;
		const sec = biquad({ type: 'lowpass', f0: 6000, fs, q: 5 });
		const info = sectionInfo(sec);
		// complex poles: r² = a2
		expect(info.poleR).toBeCloseTo(Math.sqrt(sec[5]), 12);
		// pole angle ≈ ω0 for a high-Q section
		expect(info.poleAngle).toBeCloseTo((2 * Math.PI * 6000) / fs, 1);
		// low-pass zeros: double zero at z = −1
		expect(info.zeros).toHaveLength(2);
		for (const z of info.zeros) expect(z.re).toBeCloseTo(-1, 6);
	});
});

describe('float32Sensitivity', () => {
	it('leaves a benign low-order design essentially unchanged', () => {
		const { sos } = designDigital({
			family: 'butter',
			band: 'lowpass',
			order: 2,
			f1: 5000,
			fs: 48000
		});
		const s = float32Sensitivity(sos);
		expect(s.order).toBe(2);
		expect(Math.abs(s.tfRadius - s.exactRadius)).toBeLessThan(1e-6);
		expect(s.sosRadius).toBeLessThan(1);
	});

	it('shows that a narrow high-order band-pass breaks as one b/a but not as SOS', () => {
		const { sos } = designDigital({
			family: 'ellip',
			band: 'bandpass',
			order: 8,
			f1: 100,
			f2: 200,
			rp: 1,
			rs: 60,
			fs: 48000
		});
		const s = float32Sensitivity(sos);
		expect(s.order).toBe(16);
		expect(s.exactRadius).toBeLessThan(1);
		expect(s.sosRadius).toBeLessThan(1);
		expect(s.tfRadius).toBeGreaterThanOrEqual(1);
	});
});

describe('checkSpec', () => {
	const fs = 48000;
	const cases: {
		family: AnalogFamily;
		band: BandType;
		fp: [number, number];
		fst: [number, number];
	}[] = [
		{ family: 'butter', band: 'lowpass', fp: [8000, 8000], fst: [12000, 12000] },
		{ family: 'cheby1', band: 'highpass', fp: [4000, 4000], fst: [3000, 3000] },
		{ family: 'cheby2', band: 'bandpass', fp: [4000, 8000], fst: [3000, 10000] },
		{ family: 'ellip', band: 'bandstop', fp: [3000, 10000], fst: [4000, 8000] },
		{ family: 'ellip', band: 'lowpass', fp: [20000, 20000], fst: [21000, 21000] }
	];
	for (const c of cases) {
		it(`a ${c.family} ${c.band} designed from specs meets its own mask`, () => {
			const isBand = c.band === 'bandpass' || c.band === 'bandstop';
			const rp = 1;
			const rs = 50;
			const est = estimateFromSpecs(c.family, {
				band: c.band,
				fp: isBand ? c.fp : c.fp[0],
				fstop: isBand ? c.fst : c.fst[0],
				rp,
				rs,
				fs
			});
			expect(est.error).toBeUndefined();
			const { sos } = designDigital({
				family: c.family,
				band: c.band,
				order: est.order,
				f1: est.f1,
				f2: est.f2,
				rp,
				rs,
				fs
			});
			const chk = checkSpec({ kind: 'digital', fs, sos }, c.band, c.fp, c.fst, 2000);
			expect(chk.passMinDb).toBeGreaterThanOrEqual(-rp - 1e-6);
			expect(chk.stopMaxDb).toBeLessThanOrEqual(-rs + 1e-6);
		});
	}

	it('flags a design whose prewarping was switched off', () => {
		const est = estimateFromSpecs('butter', {
			band: 'lowpass',
			fp: 18000,
			fstop: 21000,
			rp: 1,
			rs: 40,
			fs
		});
		const { sos } = designDigital({
			family: 'butter',
			band: 'lowpass',
			order: est.order,
			f1: est.f1,
			fs,
			prewarp: false
		});
		const chk = checkSpec({ kind: 'digital', fs, sos }, 'lowpass', [18000, 18000], [21000, 21000]);
		expect(chk.passMinDb).toBeLessThan(-1);
	});
});

describe('recipes', () => {
	const base = {
		family: 'ellip' as AnalogFamily,
		band: 'lowpass' as BandType,
		order: 6,
		f1: 8000,
		rp: 1,
		rs: 60,
		fs: 48000,
		besselNorm: 'mag' as const
	};
	it('builds an exact SciPy call', () => {
		const py = scipyRecipe(base)!;
		expect(py).toContain(
			"sos = signal.ellip(6, 1, 60, 8000, btype='lowpass', fs=fs, output='sos')"
		);
		expect(py).toContain('fs = 48000');
	});
	it('builds band-pass and Bessel calls', () => {
		expect(
			scipyRecipe({ ...base, family: 'butter', band: 'bandpass', f2: 2000, f1: 1000 })
		).toContain("signal.butter(6, [1000, 2000], btype='bandpass', fs=fs, output='sos')");
		expect(scipyRecipe({ ...base, family: 'bessel' })).toContain(
			"signal.bessel(6, 8000, btype='lowpass', fs=fs, output='sos', norm='mag')"
		);
		expect(scipyRecipe({ ...base, family: 'legendre' })).toBeNull();
	});
	it('builds an exact MATLAB call', () => {
		const m = matlabRecipe({ ...base, family: 'cheby2', band: 'bandstop', f1: 1000, f2: 2000 })!;
		expect(m).toContain("[z, p, k] = cheby2(6, 60, [1000 2000]/(fs/2), 'stop');");
		expect(m).toContain('sos = zp2sos(z, p, k);');
		expect(matlabRecipe({ ...base, family: 'bessel' })).toBeNull();
	});
});
