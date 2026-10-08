import { describe, expect, it } from 'vitest';
import { designAnalog, designDigital, estimateFromSpecs } from '../src/lib/dsp/design';
import { familyInfo, prototype } from '../src/lib/dsp/analog';
import { analogStages } from '../src/lib/dsp/convert';
import { abs, c } from '../src/lib/dsp/complex';
import { evaluate, freqsZpk, logspace } from '../src/lib/dsp/response';
import type { BandType, ZPK } from '../src/lib/dsp/types';
import {
	bandEdge3dB,
	clampOrder,
	formatRoot,
	stepOvershoot
} from '../src/lib/features/analog-designer/analysis';

const maxRe = (z: ZPK) => Math.max(...z.p.map((p) => p.re));
const sortRoots = (r: ZPK['p']) =>
	[...r].sort((a, b) => a.re - b.re || a.im - b.im).map((x) => [x.re, x.im]);

describe('#14/#7 band edges given high → low', () => {
	for (const band of ['bandpass', 'bandstop'] as BandType[]) {
		for (const family of ['butter', 'cheby1', 'ellip', 'bessel'] as const) {
			it(`designAnalog ${family} ${band} f1 > f2 is the same stable band`, () => {
				const spec = { family, band, order: 4, rp: 1, rs: 40 };
				const rev = designAnalog({ ...spec, f1: 4000, f2: 1000 });
				const fwd = designAnalog({ ...spec, f1: 1000, f2: 4000 });
				expect(maxRe(rev)).toBeLessThan(0);
				expect(rev.k).toBeCloseTo(fwd.k, 12);
				const a = sortRoots(rev.p);
				const b = sortRoots(fwd.p);
				a.forEach((r, i) => {
					expect(r[0]).toBeCloseTo(b[i][0], 6);
					expect(r[1]).toBeCloseTo(b[i][1], 6);
				});
			});
		}
		it(`designDigital ${band} f1 > f2 is the same stable band`, () => {
			const spec = { family: 'butter' as const, band, order: 4, fs: 48000 };
			const rev = designDigital({ ...spec, f1: 4000, f2: 1000 });
			const fwd = designDigital({ ...spec, f1: 1000, f2: 4000 });
			expect(Math.max(...rev.zpk.p.map(abs))).toBeLessThan(1);
			const f = [500, 1000, 2000, 4000, 8000];
			const hr = evaluate({ kind: 'digital', fs: 48000, sos: rev.sos }, f).H;
			const hf = evaluate({ kind: 'digital', fs: 48000, sos: fwd.sos }, f).H;
			hr.forEach((h, i) => {
				expect(h.re).toBeCloseTo(hf[i].re, 10);
				expect(h.im).toBeCloseTo(hf[i].im, 10);
			});
		});
	}

	it('the reported order-4 BP (f1 = 6000, f2 = 4000) has only left-half-plane poles', () => {
		const z = designAnalog({ family: 'butter', band: 'bandpass', order: 4, f1: 6000, f2: 4000 });
		expect(maxRe(z)).toBeLessThan(0);
	});

	it('estimateFromSpecs rejects a reversed passband or stopband pair', () => {
		const base = { rp: 1, rs: 40 };
		const bad = [
			{ band: 'bandpass', fp: [2000, 1000], fstop: [700, 3000] },
			{ band: 'bandpass', fp: [1000, 2000], fstop: [3000, 700] },
			{ band: 'bandpass', fp: [1500, 1500], fstop: [700, 3000] },
			{ band: 'bandstop', fp: [3000, 700], fstop: [1000, 2000] },
			{ band: 'bandstop', fp: [700, 3000], fstop: [2000, 1000] }
		] as const;
		for (const s of bad) {
			const est = estimateFromSpecs('butter', {
				...base,
				band: s.band,
				fp: [...s.fp],
				fstop: [...s.fstop]
			});
			expect(est.error).toMatch(/lower band edge must be below the upper band edge/);
			// the fallback edges handed to the designer stay ordered
			expect(est.f1).toBeLessThanOrEqual(est.f2!);
		}
		const ok = estimateFromSpecs('butter', {
			...base,
			band: 'bandpass',
			fp: [1000, 2000],
			fstop: [700, 3000]
		});
		expect(ok.error).toBeUndefined();
		expect(ok.f1).toBeLessThan(ok.f2!);
		const zpk = designAnalog({
			family: 'butter',
			band: 'bandpass',
			order: ok.order,
			f1: ok.f1,
			f2: ok.f2
		});
		expect(maxRe(zpk)).toBeLessThan(0);
	});
});

describe('#36 order is limited to the family maximum', () => {
	it('clampOrder caps at familyInfo().maxOrder and rounds to ≥ 1', () => {
		expect(clampOrder(30, 'legendre')).toBe(20);
		expect(clampOrder(30, 'bessel')).toBe(20);
		expect(clampOrder(30, 'ellip')).toBe(20);
		expect(clampOrder(30, 'gaussian')).toBe(12);
		expect(clampOrder(30, 'butter')).toBe(30);
		expect(clampOrder(45, 'butter')).toBe(familyInfo('butter').maxOrder);
		expect(clampOrder(0, 'butter')).toBe(1);
		expect(clampOrder(3.6, 'cheby1')).toBe(4);
	});

	it('the clamped Legendre design keeps the −3 dB cutoff', () => {
		const z = designAnalog({
			family: 'legendre',
			band: 'lowpass',
			order: clampOrder(30, 'legendre'),
			f1: 1000
		});
		expect(evaluate({ kind: 'analog', zpk: z }, [1000]).magDb[0]).toBeCloseTo(-3.0103, 2);
	});
});

describe('#41 −3 dB frequency is the band-edge crossing', () => {
	const f3 = (zpk: ZPK, band: 'lowpass' | 'highpass') => {
		const grid = logspace(1, 1e6, 4000);
		const r = evaluate({ kind: 'analog', zpk }, grid);
		const peak = Math.max(...r.magDb.filter(Number.isFinite));
		return bandEdge3dB(
			r.f,
			r.magDb.map((v) => v - peak),
			band
		);
	};
	// SciPy freqs_zpk on a dense grid: the crossing next to the transition band
	const cases = [
		{ family: 'cheby1', band: 'lowpass', order: 4, rp: 4, ref: 987.972 },
		{ family: 'cheby1', band: 'highpass', order: 3, rp: 6, ref: 1052.677 },
		{ family: 'ellip', band: 'lowpass', order: 4, rp: 3.5, ref: 995.855 },
		{ family: 'cheby1', band: 'lowpass', order: 4, rp: 1, ref: 1053.002 },
		{ family: 'cheby1', band: 'highpass', order: 4, rp: 1, ref: 949.666 },
		{ family: 'butter', band: 'lowpass', order: 4, rp: 1, ref: 1000 },
		{ family: 'butter', band: 'highpass', order: 4, rp: 1, ref: 1000 }
	] as const;
	for (const s of cases) {
		it(`${s.family} ${s.band} N=${s.order} Rp=${s.rp} → ${s.ref} Hz`, () => {
			const zpk = designAnalog({ ...s, f1: 1000, rs: 40 });
			expect(f3(zpk, s.band)! / s.ref - 1).toBeLessThan(2e-3);
			expect(f3(zpk, s.band)! / s.ref - 1).toBeGreaterThan(-2e-3);
		});
	}
});

describe('#41 the band-edge crossing is exact when the design is passed in', () => {
	// as on the page: a 4000-point log grid over fc/1000 … 1000·fc, relative to its peak
	const pageF3 = (spec: Parameters<typeof designAnalog>[0] & { band: 'lowpass' | 'highpass' }) => {
		const zpk = designAnalog(spec);
		const grid = logspace(spec.f1 / 1000, spec.f1 * 1000, 4000);
		const r = evaluate({ kind: 'analog', zpk }, grid);
		const peak = Math.max(...r.magDb.filter(Number.isFinite));
		return bandEdge3dB(
			r.f,
			r.magDb.map((v) => v - peak),
			spec.band,
			zpk
		)!;
	};
	const relErr = (a: number, b: number) => Math.abs(a / b - 1);

	// Elliptic: last −3 dB crossing below the passband edge w = 1, from the closed
	// form w = cd(u·K, k), u = cd⁻¹(1/ε_p, k₁)/(N·K₁), which agrees to 1e-10 with a
	// dense scan + brentq of SciPy's own signal.ellip(N, Rp, Rs, 1, analog=True).
	// A grid scan stepped over the last ripple here (e.g. 949.6 Hz instead of 999.84 Hz).
	const ellip: [number, number, number, number][] = [
		[4, 3.5, 40, 0.9958548559853],
		[4, 6, 10, 0.999836804817589],
		[5, 6, 15, 0.999814453909311],
		[6, 6, 20, 0.99984488400015],
		[7, 4, 20, 0.999968751388886],
		[8, 6, 30, 0.999897203125056],
		[9, 3.5, 20, 0.99999869703366],
		[9, 6, 40, 0.999822096224298],
		[10, 6, 40, 0.99992811779035],
		[11, 6, 60, 0.999725948778791],
		[12, 6, 40, 0.999988265591858],
		[12, 5, 60, 0.999879275240402],
		[16, 6, 60, 0.999988654292915],
		[18, 5, 40, 0.999999943126659],
		[20, 6, 60, 0.999999112048426],
		[20, 3.1, 40, 0.999999998508202]
	];
	for (const [order, rp, rs, w] of ellip) {
		it(`elliptic N=${order} Rp=${rp} Rs=${rs}: LP fc·${w}, HP fc/${w}`, () => {
			for (const fc of [1000, 37]) {
				const base = { family: 'ellip' as const, order, f1: fc, rp, rs };
				expect(relErr(pageF3({ ...base, band: 'lowpass' }), fc * w)).toBeLessThan(1e-7);
				expect(relErr(pageF3({ ...base, band: 'highpass' }), fc / w)).toBeLessThan(1e-7);
			}
		});
	}

	it('Chebyshev I: |T_N(w)| = 1/ε at the outermost crossing, N = 1 … 30', () => {
		for (const order of [1, 2, 3, 4, 5, 8, 13, 21, 30]) {
			for (const rp of [0.5, 1, 3, 3.02, 4, 6]) {
				const eps = Math.sqrt(10 ** (rp / 10) - 1);
				const w =
					eps > 1 ? Math.cos(Math.acos(1 / eps) / order) : Math.cosh(Math.acosh(1 / eps) / order);
				const base = { family: 'cheby1' as const, order, f1: 1000, rp, rs: 40 };
				expect(relErr(pageF3({ ...base, band: 'lowpass' }), 1000 * w)).toBeLessThan(1e-9);
				expect(relErr(pageF3({ ...base, band: 'highpass' }), 1000 / w)).toBeLessThan(1e-9);
			}
		}
	});

	it('Chebyshev II: T_N(fs/f) = ε_s; N = 1 peaks at DC / infinity, N = 12 has a steep edge', () => {
		for (const [order, rs] of [
			[1, 40],
			[2, 10],
			[5, 40],
			[12, 10],
			[12, 60]
		]) {
			const w = 1 / Math.cosh(Math.acosh(Math.sqrt(10 ** (rs / 10) - 1)) / order);
			const base = { family: 'cheby2' as const, order, f1: 1000, rs };
			expect(relErr(pageF3({ ...base, band: 'lowpass' }), 1000 * w)).toBeLessThan(1e-9);
			expect(relErr(pageF3({ ...base, band: 'highpass' }), 1000 / w)).toBeLessThan(1e-9);
		}
		// 10.0005 Hz, not the 10.1 Hz read against the gain at the grid's first point
		expect(pageF3({ family: 'cheby2', band: 'lowpass', order: 1, f1: 1000, rs: 40 })).toBeCloseTo(
			1000 / Math.sqrt(9999),
			6
		);
	});

	it('Butterworth: exactly fc', () => {
		for (const order of [1, 2, 5, 10, 30]) {
			for (const band of ['lowpass', 'highpass'] as const) {
				const f3 = pageF3({ family: 'butter', band, order, f1: 1000 });
				expect(relErr(f3, 1000)).toBeLessThan(1e-9);
			}
		}
	});
});

describe('#98 step overshoot is measured against the DC gain', () => {
	// SciPy signal.step over a long, dense window
	const cases = [
		{ rp: 1, ref: 14.568 },
		{ rp: 3, ref: 27.159 }
	];
	for (const s of cases) {
		it(`elliptic N=2 Rp=${s.rp} Rs=140 → ${s.ref} %`, () => {
			const zpk = designAnalog({
				family: 'ellip',
				band: 'lowpass',
				order: 2,
				f1: 1000,
				rp: s.rp,
				rs: 140
			});
			expect(stepOvershoot(zpk)).toBeCloseTo(s.ref, 1);
		});
	}
	it('Butterworth N=2 overshoot is 4.32 % and N=1 has none', () => {
		const b2 = designAnalog({ family: 'butter', band: 'lowpass', order: 2, f1: 1000 });
		expect(stepOvershoot(b2)).toBeCloseTo(100 * Math.exp(-Math.PI), 2);
		const b1 = designAnalog({ family: 'butter', band: 'lowpass', order: 1, f1: 1000 });
		expect(stepOvershoot(b1)).toBeCloseTo(0, 6);
	});
});

describe('#99 conjugate pairs in the stage table', () => {
	it('a jω-axis pair reads ±bj; a complex pair a ± bj; a real root stays real', () => {
		expect(formatRoot(c(0, 6800.9))).toBe('±6800.9j');
		expect(formatRoot(c(1e-13, 16419.2))).toBe('±16419j');
		expect(formatRoot(c(-3170.1, 1512.9))).toBe('-3170.1 ± 1512.9j');
		expect(formatRoot(c(-34025, 0))).toBe('-34025');
		expect(formatRoot(c(0, 0))).toBe('0');
	});
	it('every Chebyshev II notch stage lists its zeros as a ± pair', () => {
		const zpk = designAnalog({ family: 'cheby2', band: 'lowpass', order: 4, f1: 1000, rs: 40 });
		const cells = analogStages(zpk).map((st) =>
			st.zeros
				.filter((z) => z.im >= 0)
				.map((z) => formatRoot(z))
				.join(', ')
		);
		expect(cells).toHaveLength(2);
		for (const cell of cells) expect(cell).toMatch(/^±\d+(\.\d+)?j$/);
	});
});

describe('#100 Chebyshev II theory formula uses ε_s from Rs', () => {
	// |H|² = 1 / (1 + ε_s² / T_N²(1/ω)),  ε_s² = 10^(Rs/10) − 1, stopband edge at ω = 1
	const T = (N: number, x: number) =>
		Math.abs(x) <= 1 ? Math.cos(N * Math.acos(x)) : Math.cosh(N * Math.acosh(Math.abs(x)));
	for (const [N, rs] of [
		[4, 40],
		[5, 60],
		[3, 20]
	]) {
		it(`N=${N}, Rs=${rs}`, () => {
			const proto = prototype('cheby2', N, { rs });
			const es2 = 10 ** (rs / 10) - 1;
			for (const w of [0.1, 0.5, 0.9, 1, 1.3, 2, 5]) {
				const h2 = abs(freqsZpk(proto, [w])[0]) ** 2;
				const formula = 1 / (1 + es2 / T(N, 1 / w) ** 2);
				expect(10 * Math.log10(h2)).toBeCloseTo(10 * Math.log10(formula), 6);
			}
			expect(10 * Math.log10(abs(freqsZpk(proto, [1])[0]) ** 2)).toBeCloseTo(-rs, 6);
		});
	}
});
