import { describe, expect, it } from 'vitest';
import {
	DBU_REF,
	levelToVrms,
	levelsFromVrms,
	parseQuantity,
	rcNearestPart,
	rcOther,
	snapDb,
	SPEED_OF_SOUND
} from '../src/lib/features/calculators/math';
import {
	designFor,
	discrimination,
	estimate,
	iirResults,
	magnitudeDb,
	narrowestTransition,
	orderPassbandHz,
	selectivity,
	transitionHz,
	type OrderSpec
} from '../src/lib/features/order-calculator/compute';
import { evaluate, logspace } from '../src/lib/dsp/response';
import { parseSI } from '../src/lib/dsp/units';

const spec = (over: Partial<OrderSpec> = {}): OrderSpec => ({
	domain: 'analog',
	fs: 48000,
	band: 'lowpass',
	fp: [1000, 1000],
	fst: [2000, 2000],
	rp: 1,
	rs: 60,
	...over
});
const byFamily = (s: OrderSpec) => Object.fromEntries(iirResults(s).map((r) => [r.family, r]));

describe('#6 RC card: nearest E-series part error is in per cent', () => {
	it('C = 10 nF, fc = 1 kHz → 15 kΩ is +6.1 %, 16 kΩ is −0.53 %', () => {
		const R = rcOther(10e-9, 1000); // 15.915 kΩ
		const e12 = rcNearestPart(R, 10e-9, 1000, 'E12');
		expect(e12.part).toBe(15000);
		expect(e12.fc).toBeCloseTo(1061.03, 2);
		expect(e12.errPct).toBeCloseTo(6.1033, 3);
		const e24 = rcNearestPart(R, 10e-9, 1000, 'E24');
		expect(e24.part).toBe(16000);
		expect(e24.errPct).toBeCloseTo(-0.5282, 3);
	});
	it('solving for C uses the same cutoff (symmetric in R and C)', () => {
		const C = rcOther(10e3, 1000); // 15.915 nF
		const e12 = rcNearestPart(C, 10e3, 1000, 'E12');
		expect(e12.part).toBeCloseTo(15e-9, 18);
		expect(e12.errPct).toBeCloseTo(6.1033, 3);
	});
});

describe('#97 signal levels: no rounding residue in the dB fields', () => {
	it('0 dBu and 1 mW into 600 Ω give exactly 0 dBm @ 600 Ω', () => {
		expect(levelsFromVrms(levelToVrms(0, 'dBu')).dBm600).toBe(0);
		expect(levelsFromVrms(Math.sqrt(1e-3 * 600)).dBm600).toBe(0);
		expect(levelsFromVrms(levelToVrms(0, 'dBm600')).dBu).toBe(0);
	});
	it('dBm @ 600 Ω equals dBu (same reference) and still equals 10·log10(P/1 mW)', () => {
		for (const v of [1e-6, 0.01, 0.3, 1, 7.75, 100]) {
			const l = levelsFromVrms(v);
			expect(l.dBm600).toBe(l.dBu);
			expect(l.dBm600).toBeCloseTo(10 * Math.log10((v * v) / 600 / 1e-3), 10);
		}
		expect(levelsFromVrms(1).dBm600).toBeCloseTo(2.2185, 4);
	});
	it('snapDb removes residue but keeps real small values', () => {
		// V peak = √1.2 V (0 dBu) leaves a residue of ~1e-16 dB in dBu
		const residue = levelsFromVrms(levelToVrms(Math.sqrt(1.2), 'Vpk')).dBu;
		expect(Math.abs(residue)).toBeLessThan(1e-12);
		expect(snapDb(residue)).toBe(0);
		expect(snapDb(9.64327466553287e-16)).toBe(0);
		// 0.7746 V rms is a real +3.7e-5 dBu
		const small = levelsFromVrms(0.7746).dBu;
		expect(small).toBeGreaterThan(3e-5);
		expect(snapDb(small)).toBe(small);
		expect(snapDb(-2.2185)).toBe(-2.2185);
	});
});

describe('#34 power fields are in W with SI prefixes', () => {
	it('typing "1 mW" / "500 µW" gives 0 dBm / −3.01 dBm @ 600 Ω', () => {
		// the field passes parseSI(text) (in W) to vrms = √(P·600)
		const lv = (text: string) => levelsFromVrms(Math.sqrt(parseSI(text) * 600));
		expect(snapDb(lv('1 mW').dBm600)).toBe(0);
		expect(lv('1mW').vrms).toBeCloseTo(DBU_REF, 15);
		expect(lv('500 µW').dBm600).toBeCloseTo(-3.0103, 4);
		expect(lv('1 W').dBm600).toBeCloseTo(30, 10);
		expect(lv('1 mW').p600).toBeCloseTo(1e-3, 18);
	});
});

describe("#34 a field's own unit may be typed after the number (NumberInput, Slider)", () => {
	it('wavelength field (unit m): "2 m" is 2 m, so f = 171.5 Hz in air, not 171.5 kHz', () => {
		for (const t of ['2', '2 m', '2m', ' 2 m ']) expect(parseQuantity(t, 'm'), t).toBe(2);
		expect(SPEED_OF_SOUND / parseQuantity('2 m', 'm')).toBe(171.5);
		// before the fix NumberInput used plain parseSI, which reads the m as milli
		expect(parseSI('2 m')).toBe(0.002);
	});
	it('a prefix in front of the unit scales it: mm, cm, km, µm, nm', () => {
		expect(parseQuantity('2 mm', 'm')).toBe(0.002);
		expect(parseQuantity('2mm', 'm')).toBe(0.002);
		expect(parseQuantity('34.3 cm', 'm')).toBe(0.343);
		expect(parseQuantity('2 km', 'm')).toBe(2000);
		expect(parseQuantity('1,000 cm', 'm')).toBe(10);
		expect(parseQuantity('5e1 cm', 'm')).toBe(0.5);
		expect(parseQuantity('500 nm', 'm')).toBeCloseTo(5e-7, 21);
		expect(parseQuantity('3 µm', 'm')).toBeCloseTo(3e-6, 21);
		expect(parseQuantity('1.5e-3 m', 'm')).toBe(0.0015);
	});
	it('the shown text and String(value) round-trip (what NumberInput is handed)', () => {
		for (const v of [2, 0.343, 1.2346e-7, 3.4e12, -5])
			expect(parseSI(String(parseQuantity(String(v), 'm')))).toBe(v);
	});
	it('other units parse as parseSI did', () => {
		const cases: [string, string][] = [
			['10 nF', 'F'],
			['4k7', 'Ω'],
			['4k7Ω', 'Ω'],
			['5 ms', 's'],
			['1 kHz', 'Hz'],
			['1 mW', 'W'],
			['-3 dB', 'dB'],
			['0 dBu', 'dBu'],
			['200 Mm/s', 'm/s'],
			['1 krad/s', 'rad/s'],
			['45°', '°'],
			['1meg', '']
		];
		for (const [t, u] of cases) expect(parseQuantity(t, u), `${t} [${u}]`).toBe(parseSI(t));
		expect(parseQuantity('1 mW', 'W')).toBe(0.001);
	});
	it('a unit starting with a digit (σ in 1/s) needs a space', () => {
		expect(parseQuantity('-5 1/s', '1/s')).toBe(-5);
		expect(parseQuantity('-5', '1/s')).toBe(-5);
		expect(parseQuantity('-51/s', '1/s')).toBeNaN(); // not −5
	});
	it('nonsense stays NaN so the field is flagged invalid', () => {
		for (const t of ['m', 'cm', '', 'abc m', '2 dm']) expect(parseQuantity(t, 'm'), t).toBeNaN();
	});
});

describe('#33 high-order band designs: real attenuation, never ±∞ from overflow', () => {
	it('digital BP 3–16 kHz @ 48 kHz: capped Butterworth N = 30 fails at 44.2 dB (SciPy)', () => {
		const s = spec({
			domain: 'digital',
			band: 'bandpass',
			fp: [3000, 16000],
			fst: [2000, 17000]
		});
		const r = byFamily(s);
		expect(r.butter.capped).toBe(true);
		expect(r.butter.order).toBe(30);
		expect(r.butter.passAtt).toBeCloseTo(1, 6);
		// scipy: butter(30, [2947.9437…, 16118.2494…], 'bandpass', fs=48000, output='sos')
		expect(r.butter.stopAtt).toBeCloseTo(44.19618341573958, 6);
		// the designed sections are finite, and so is the response the plot draws
		const sos = (r.butter.filter as { sos: number[][] }).sos;
		expect(sos.flat().every(Number.isFinite)).toBe(true);
		expect(magnitudeDb(r.butter.filter, [3000, 9000, 16000, 17000])).toEqual([
			expect.closeTo(-1, 9),
			expect.closeTo(0, 9),
			expect.closeTo(-1, 9),
			expect.closeTo(-44.19618341573958, 6)
		]);
		for (const x of Object.values(r)) {
			expect(Number.isFinite(x.passAtt), x.family).toBe(true);
			expect(Number.isFinite(x.stopAtt), x.family).toBe(true);
		}
	});

	it('analog BP 1–2 MHz: Butterworth N = 30 meets 1 dB / 60.67 dB (SciPy, log domain)', () => {
		const s = spec({ band: 'bandpass', fp: [1e6, 2e6], fst: [0.9e6, 2.2e6] });
		const r = byFamily(s);
		expect(r.butter.capped).toBe(false);
		expect(r.butter.order).toBe(30);
		expect(r.butter.passAtt).toBeCloseTo(1, 6);
		expect(r.butter.stopAtt).toBeCloseTo(60.66914601390067, 6);
		for (const x of Object.values(r)) {
			expect(Number.isFinite(x.passAtt), x.family).toBe(true);
			expect(Number.isFinite(x.stopAtt), x.family).toBe(true);
			expect(x.stopAtt, x.family).toBeLessThan(400);
		}
		// the plotted curve is finite too
		const y = magnitudeDb(r.butter.filter, logspace(1e5, 2e7, 200));
		expect(y.every(Number.isFinite)).toBe(true);
	});

	it('magnitudeDb agrees with evaluate() where evaluate does not overflow', () => {
		for (const s of [spec(), spec({ band: 'bandstop', fp: [700, 3000], fst: [1000, 2000] })]) {
			for (const r of iirResults(s)) {
				const f = logspace(10, 1e5, 300);
				const a = magnitudeDb(r.filter, f);
				const b = evaluate(r.filter, f).magDb;
				a.forEach((v, i) => {
					if (b[i] > -250) expect(v, `${r.family} @ ${f[i]}`).toBeCloseTo(b[i], 8);
				});
			}
		}
	});

	it('designFor (normalised rate) matches the direct bilinear design for ordinary specs', () => {
		const s = spec({
			domain: 'digital',
			fs: 16000,
			band: 'bandpass',
			fp: [1000, 2000],
			fst: [700, 3000]
		});
		for (const fam of ['butter', 'cheby1', 'cheby2', 'ellip'] as const) {
			const f = designFor(fam, s, estimate(fam, s));
			const db = evaluate(f, [1000, 1500, 2000, 700, 3000]).magDb;
			expect(db[0], fam).toBeGreaterThanOrEqual(-1 - 1e-6);
			expect(db[2], fam).toBeGreaterThanOrEqual(-1 - 1e-6);
			expect(db[3], fam).toBeLessThanOrEqual(-60 + 1e-2);
			expect(db[4], fam).toBeLessThanOrEqual(-60 + 1e-2);
		}
	});

	it('a realistic sweep of band specs has no non-finite worst-case values', () => {
		for (const fs of [8000, 48000, 96000])
			for (const band of ['bandpass', 'bandstop'] as const)
				for (const c of [0.05, 0.2])
					for (const tr of [0.02, 0.1]) {
						const lo = c * fs;
						const hi = 1.6 * lo;
						const s =
							band === 'bandpass'
								? spec({
										domain: 'digital',
										fs,
										band,
										fp: [lo, hi],
										fst: [lo * (1 - tr), hi * (1 + tr)]
									})
								: spec({
										domain: 'digital',
										fs,
										band,
										fp: [lo * (1 - tr), hi * (1 + tr)],
										fst: [lo, hi]
									});
						for (const r of iirResults(s)) {
							const tag = `${fs} ${band} ${c} ${tr} ${r.family}`;
							expect(Number.isFinite(r.passAtt), tag).toBe(true);
							expect(Number.isFinite(r.stopAtt), tag).toBe(true);
							if (!r.capped) {
								expect(r.passAtt, tag).toBeLessThanOrEqual(1 + 1e-6);
								expect(r.stopAtt, tag).toBeGreaterThanOrEqual(60 - 1e-2);
							}
						}
					}
	}, 30000);
});

describe('#35 band-stop selectivity is the Ωs that sets the order', () => {
	const bsSpecs = [
		spec({ band: 'bandstop', fp: [700, 3000], fst: [1000, 2000] }),
		spec({ domain: 'digital', band: 'bandstop', fp: [700, 3000], fst: [1000, 2000] }),
		spec({ domain: 'digital', fs: 1000, band: 'bandstop', fp: [40, 62], fst: [48, 52], rs: 40 }),
		spec({ band: 'bandstop', fp: [40, 62], fst: [48, 52], rs: 40 })
	];

	it('default BS: Ωs = 2.1571 analog / 2.1535 digital (2.0909 / 2.0799 as entered)', () => {
		expect(selectivity(bsSpecs[0])).toBeCloseTo(2.157142857, 6);
		expect(selectivity(bsSpecs[0], true)).toBeCloseTo(2.090909091, 8);
		expect(selectivity(bsSpecs[1])).toBeCloseTo(2.1535, 4);
		expect(selectivity(bsSpecs[1], true)).toBeCloseTo(2.0799, 4);
	});

	it('the page formulas with the displayed Ωs give the table orders', () => {
		for (const s of bsSpecs) {
			const sel = selectivity(s);
			const k1 = discrimination(s.rp, s.rs);
			const r = byFamily(s);
			const tag = `${s.domain} ${s.fp}`;
			expect(r.butter.order, tag).toBe(Math.ceil(Math.log(1 / k1) / Math.log(sel)));
			const cheb = Math.ceil(Math.acosh(1 / k1) / Math.acosh(sel));
			expect(r.cheby1.order, tag).toBe(cheb);
			expect(r.cheby2.order, tag).toBe(cheb);
		}
	});

	it('slid passband edges match SciPy cheb1ord Wn', () => {
		const a = orderPassbandHz(bsSpecs[0]);
		expect(a[0]).toBeCloseTo(700, 3);
		expect(a[1]).toBeCloseTo(2857.142857, 3);
		const h = orderPassbandHz(bsSpecs[2]);
		expect(h[0]).toBeCloseTo(40.1965, 3);
		expect(h[1]).toBeCloseTo(62, 2);
		expect(byFamily(bsSpecs[0]).cheby1.f2).toBeCloseTo(a[1], 6);
	});

	it('LP, HP and BP selectivity are unchanged (no edge optimisation)', () => {
		expect(selectivity(spec())).toBeCloseTo(2, 12);
		const bp = spec({ band: 'bandpass', fp: [1000, 2000], fst: [700, 3000] });
		expect(selectivity(bp)).toBe(selectivity(bp, true));
		expect(orderPassbandHz(bp)[0]).toBeCloseTo(1000, 9);
		expect(orderPassbandHz(bp)[1]).toBeCloseTo(2000, 9);
	});
});

describe('#95 transition width in octaves is that of the narrowest transition', () => {
	it('analog BP default: 300 Hz, 700 → 1000 Hz = 0.515 oct (not log2 Ωs = 1.11)', () => {
		const t = narrowestTransition(spec({ band: 'bandpass', fp: [1000, 2000], fst: [700, 3000] }));
		expect(t.hz).toBe(300);
		expect(t.edges).toEqual([700, 1000]);
		expect(t.octaves).toBeCloseTo(Math.log2(1000 / 700), 12);
		expect(t.octaves).toBeCloseTo(0.5146, 4);
	});
	it('band-stop and the 50 Hz hum edges', () => {
		const bs = narrowestTransition(spec({ band: 'bandstop', fp: [700, 3000], fst: [1000, 2000] }));
		expect(bs.hz).toBe(300);
		expect(bs.octaves).toBeCloseTo(Math.log2(1000 / 700), 12);
		const hum = narrowestTransition(spec({ band: 'bandstop', fp: [40, 62], fst: [48, 52] }));
		expect(hum.hz).toBe(8);
		expect(hum.edges).toEqual([40, 48]);
		expect(hum.octaves).toBeCloseTo(0.263, 3);
	});
	it('LP / HP: log2 of the edge ratio (= log2 Ωs), transitionHz unchanged', () => {
		expect(narrowestTransition(spec()).octaves).toBeCloseTo(1, 12);
		const hp = spec({ band: 'highpass', fp: [2000, 2000], fst: [500, 500] });
		expect(narrowestTransition(hp).octaves).toBeCloseTo(2, 12);
		expect(transitionHz(hp)).toBe(1500);
		expect(transitionHz(spec({ band: 'bandpass', fp: [1000, 2000], fst: [800, 3000] }))).toBe(200);
	});
});

describe('#96 numbers quoted in the theory text', () => {
	it('arccosh Ωs ≈ √(2(Ωs−1)) near 1, ≈ ln(2Ωs) when wide; ratios to ln Ωs', () => {
		expect(Math.acosh(1.05)).toBeCloseTo(Math.sqrt(2 * 0.05), 2);
		expect(Math.log(1.05)).toBeCloseTo(0.05, 2);
		expect(Math.acosh(1.05) / Math.log(1.05)).toBeCloseTo(6.5, 1);
		expect(Math.acosh(10)).toBeCloseTo(Math.log(20), 2);
		expect(Math.acosh(10) / Math.log(10)).toBeCloseTo(1.3, 1);
		// the numerators: arccosh(1/k₁) ≈ ln(2/k₁) for k₁ ≪ 1
		const k1 = discrimination(1, 40);
		expect(Math.acosh(1 / k1)).toBeCloseTo(Math.log(2 / k1), 4);
	});
});

describe('unit-aware parsing in the shared inputs (#34 follow-up)', () => {
	it('strips the field unit before the SI-prefix parse', async () => {
		const { parseSI } = await import('../src/lib/dsp/units');
		expect(parseSI('2 m', 'm')).toBe(2);
		expect(parseSI('2 mm', 'm')).toBeCloseTo(0.002, 15);
		expect(parseSI('5 ms', 'ms')).toBe(5);
		expect(parseSI('5 ms', 's')).toBeCloseTo(0.005, 15);
		expect(parseSI('1 mW', 'mW')).toBe(1);
		expect(parseSI('4.7 kΩ', 'Ω')).toBe(4700);
		expect(parseSI('34.3 cm', 'm')).toBe(0.343);
		expect(parseSI('2 m')).toBeCloseTo(0.002, 15); // no unit: m is milli, as before
		expect(parseSI('4k7', 'Ω')).toBe(4700);
	});
});
