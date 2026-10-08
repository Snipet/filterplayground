import { describe, expect, it } from 'vitest';
import {
	designFor,
	discrimination,
	estimate,
	firResults,
	specEdges,
	firMults,
	iirResults,
	selectivity,
	transitionHz,
	validateSpec,
	type OrderSpec
} from '../src/lib/features/order-calculator/compute';
import { designAnalog, designDigital, estimateFromSpecs } from '../src/lib/dsp/design';
import { FAMILIES } from '../src/lib/dsp/analog';
import { evaluate } from '../src/lib/dsp/response';
import { firwin } from '../src/lib/dsp/fir';
import { remez } from '../src/lib/dsp/remez';
import type { Filter } from '../src/lib/dsp/types';

const lp = (over: Partial<OrderSpec> = {}): OrderSpec => ({
	domain: 'analog',
	fs: 10000,
	band: 'lowpass',
	fp: [1000, 1000],
	fst: [2000, 2000],
	rp: 1,
	rs: 40,
	...over
});

const byFamily = (s: OrderSpec) => Object.fromEntries(iirResults(s).map((r) => [r.family, r]));

describe('IIR minimum orders', () => {
	it('match SciPy buttord / cheb1ord / cheb2ord / ellipord (1 kHz → 2 kHz, 1 dB / 40 dB)', () => {
		const a = byFamily(lp());
		expect(a.butter.order).toBe(8);
		expect(a.cheby1.order).toBe(5);
		expect(a.cheby2.order).toBe(5);
		expect(a.ellip.order).toBe(4);
		expect(a.butter.f1).toBeCloseTo(1088.1194736627367, 6);
		expect(a.cheby2.f1).toBeCloseTo(1802.7913655774848, 6);
		const d = byFamily(lp({ domain: 'digital' }));
		expect(d.butter.order).toBe(7);
		expect(d.butter.f1).toBeCloseTo(1093.8542793270965, 6);
		expect(d.cheby2.f1).toBeCloseTo(1686.676054175177, 6);
		expect(d.ellip.order).toBe(4);
	});

	const specs: OrderSpec[] = [
		lp(),
		lp({ domain: 'digital', fs: 8000 }),
		lp({ band: 'highpass', fp: [2000, 2000], fst: [1000, 1000], rp: 0.5, rs: 60 }),
		lp({ domain: 'digital', fs: 48000, band: 'highpass', fp: [300, 300], fst: [100, 100], rp: 0.5, rs: 60 }),
		lp({ band: 'bandpass', fp: [1000, 2000], fst: [700, 3000], rp: 1, rs: 50 }),
		lp({ domain: 'digital', fs: 16000, band: 'bandpass', fp: [1000, 2000], fst: [700, 3000], rp: 1, rs: 50 }),
		lp({ band: 'bandstop', fp: [700, 3000], fst: [1000, 2000], rp: 1, rs: 40 }),
		lp({ domain: 'digital', fs: 16000, band: 'bandstop', fp: [700, 3000], fst: [1000, 2000], rp: 0.5, rs: 40 })
	];

	it('memoised estimate/design agree exactly with estimateFromSpecs / designAnalog / designDigital', () => {
		for (const s of specs) {
			for (const fam of FAMILIES) {
				const ref = estimateFromSpecs(fam.id, specEdges(s), { besselNorm: 'mag' });
				const mine = estimate(fam.id, s);
				const tag = `${fam.id} ${s.band} ${s.domain}`;
				expect(mine.order, tag).toBe(ref.order);
				expect(mine.capped, tag).toBe(ref.capped);
				if (ref.capped && (fam.id === 'butter' || fam.id === 'cheby2')) continue; // see the capped test below
				expect(mine.f1, tag).toBeCloseTo(ref.f1, 6);
				if (ref.f2 !== undefined) expect(mine.f2!, tag).toBeCloseTo(ref.f2, 6);
				const spec = { family: fam.id, band: s.band, order: ref.order, f1: ref.f1, f2: ref.f2, rp: s.rp, rs: s.rs, besselNorm: 'mag' as const };
				const refFilter: Filter =
					s.domain === 'analog'
						? { kind: 'analog', zpk: designAnalog(spec) }
						: { kind: 'digital', fs: s.fs, sos: designDigital({ ...spec, fs: s.fs }).sos };
				const probe = [100, 650, 900, 1000, 1500, 2500, 3500];
				const a = evaluate(refFilter, probe).magDb;
				const b = evaluate(designFor(fam.id, s, mine), probe).magDb;
				a.forEach((v, i) => expect(b[i], `${tag} @${probe[i]}`).toBeCloseTo(v, 6));
			}
		}
	});

	it('every minimum-order design meets the mask (and reports it)', () => {
		for (const s of specs) {
			for (const r of iirResults(s)) {
				if (r.capped) continue;
				expect(r.passAtt, `${r.family} ${s.band} ${s.domain} pass`).toBeLessThanOrEqual(s.rp + 1e-6);
				expect(r.stopAtt, `${r.family} ${s.band} ${s.domain} stop`).toBeGreaterThanOrEqual(s.rs - 1e-3);
			}
		}
	});

	it('one order less does not meet the mask (closed-form families)', () => {
		for (const s of specs) {
			for (const r of iirResults(s)) {
				if (r.capped || r.order < 2 || !['butter', 'cheby1', 'cheby2', 'ellip'].includes(r.family)) continue;
				// redesign at N−1, keeping each family's own normalisation:
				// passband edges for Cheby I / elliptic, Rp at the passband edge otherwise
				const N = r.order - 1;
				const spec = { family: r.family, band: s.band, order: N, rp: s.rp, rs: s.rs };
				let filter: Filter;
				let ok = true;
				// try a range of cutoffs: no N−1 design may satisfy both bands
				const centre = r.f1;
				for (const scale of [0.9, 0.95, 1, 1.05, 1.1]) {
					const f1 = centre * scale;
					const f2 = r.f2 !== undefined ? r.f2 / scale : undefined;
					filter =
						s.domain === 'analog'
							? { kind: 'analog', zpk: designAnalog({ ...spec, f1, f2 }) }
							: { kind: 'digital', fs: s.fs, sos: designDigital({ ...spec, f1, f2, fs: s.fs }).sos };
					const pass = evaluate(filter, s.band === 'lowpass' ? [s.fp[0]] : s.band === 'highpass' ? [s.fp[0]] : s.fp).magDb;
					const stop = evaluate(filter, s.band === 'lowpass' || s.band === 'highpass' ? [s.fst[0]] : s.fst).magDb;
					if (Math.min(...pass) >= -s.rp - 1e-9 && Math.max(...stop) <= -s.rs) ok = false;
				}
				expect(ok, `${r.family} ${s.band} ${s.domain} N−1 = ${N} should fail`).toBe(true);
			}
		}
	});

	it('elliptic needs the fewest orders, Butterworth more than Chebyshev', () => {
		for (const s of specs) {
			const r = byFamily(s);
			expect(r.ellip.order).toBeLessThanOrEqual(r.cheby1.order);
			expect(r.cheby1.order).toBe(r.cheby2.order);
			expect(r.cheby1.order).toBeLessThanOrEqual(r.butter.order);
		}
	});

	it('section counts and multiplications', () => {
		const a = byFamily(lp());
		expect(a.butter.biquads).toBe(4);
		expect(a.butter.firstOrder).toBe(0);
		expect(a.butter.mults).toBe(20);
		expect(a.cheby1.biquads).toBe(2);
		expect(a.cheby1.firstOrder).toBe(1);
		expect(a.cheby1.mults).toBe(13);
		const bp = byFamily(specs[4]);
		expect(bp.ellip.poles).toBe(2 * bp.ellip.order);
		expect(bp.ellip.biquads).toBe(bp.ellip.order);
	});

	it('reports capped families, still meeting Rp at the maximum order', () => {
		for (const domain of ['analog', 'digital'] as const) {
			const r = byFamily(lp({ domain, fst: [1100, 1100], rs: 80 }));
			expect(r.critical.capped).toBe(true);
			expect(r.critical.order).toBe(r.critical.maxOrder);
			expect(r.butter.capped).toBe(true);
			expect(r.butter.order).toBe(30);
			expect(r.cheby2.capped).toBe(false);
			expect(r.ellip.capped).toBe(false);
			for (const fam of ['butter', 'bessel', 'critical', 'gaussian'] as const) {
				expect(r[fam].passAtt, `${domain} ${fam}`).toBeCloseTo(1, 4);
				expect(r[fam].stopAtt).toBeLessThan(80);
			}
		}
		// Chebyshev II capped: the stopband (Rs) is kept, the passband edge sees exactly Rp
		const c2 = byFamily(lp({ fst: [1010, 1010], rs: 100 })).cheby2;
		expect(c2.capped).toBe(true);
		const at = evaluate(c2.filter, [1000]).magDb[0];
		expect(at).toBeCloseTo(-1, 6);
	});
});

describe('selectivity and discrimination', () => {
	it('low-pass prototype values', () => {
		expect(selectivity(lp())).toBeCloseTo(2, 12);
		// digital: tan(π·2000/8000)/tan(π·1000/8000)
		expect(selectivity(lp({ domain: 'digital', fs: 8000 }))).toBeCloseTo(1 / Math.tan(Math.PI / 8), 10);
		expect(discrimination(1, 40)).toBeCloseTo(Math.sqrt((Math.pow(10, 0.1) - 1) / (Math.pow(10, 4) - 1)), 14);
		expect(transitionHz(lp())).toBe(1000);
		expect(transitionHz(lp({ band: 'bandpass', fp: [1000, 2000], fst: [800, 3000] }))).toBe(200);
	});
	it('validation', () => {
		expect(validateSpec(lp())).toBeNull();
		expect(validateSpec(lp({ fst: [900, 900] }))).toMatch(/above the passband/);
		expect(validateSpec(lp({ domain: 'digital', fs: 3000 }))).toMatch(/Nyquist/);
		expect(validateSpec(lp({ rs: 0.5 }))).toMatch(/exceed/);
		expect(validateSpec(lp({ band: 'bandstop', fp: [700, 3000], fst: [1000, 2000] }))).toBeNull();
		expect(validateSpec(lp({ band: 'bandstop', fp: [1000, 2000], fst: [700, 3000] }))).toMatch(/ordered/);
	});
});

describe('FIR estimates', () => {
	it('Kaiser matches scipy.signal.kaiserord', () => {
		// kaiserord(60, 0.1) with width relative to Nyquist → numtaps 74, β = 5.653
		const r = firResults(lp({ domain: 'digital', fs: 2, fp: [0.4, 0.4], fst: [0.45, 0.45], rp: 0.1, rs: 60 }));
		const k = r.rows.find((x) => x.id === 'kaiser')!;
		expect(r.df).toBeCloseTo(0.025, 12);
		// (60 − 7.95)/(2.285·2π·0.025) + 1 = 146.02 → 147
		expect(k.taps).toBe(147);
		const r2 = firResults(lp({ domain: 'digital', fs: 2, fp: [0.4, 0.4], fst: [0.5, 0.5], rp: 0.1, rs: 60 }));
		expect(r2.rows.find((x) => x.id === 'kaiser')!.taps).toBe(74);
		expect(r2.rows.find((x) => x.id === 'kaiser')!.detail).toContain('β = 5.653');
	});

	it('Kaiser design at the estimated length meets the attenuation (±1 dB)', () => {
		const s = lp({ domain: 'digital', fs: 48000, fp: [4000, 4000], fst: [5000, 5000], rp: 0.1, rs: 60 });
		const r = firResults(s);
		const k = r.rows.find((x) => x.id === 'kaiser')!;
		const beta = Number(k.detail.match(/β = ([\d.]+)/)![1]);
		const h = firwin(k.taps, [4500], { type: 'kaiser', param: beta }, true, 48000);
		const stop = evaluate({ kind: 'digital', fs: 48000, fir: h }, Array.from({ length: 200 }, (_, i) => 5000 + (i * 19000) / 199)).magDb;
		expect(-Math.max(...stop)).toBeGreaterThan(59);
	});

	it('Parks–McClellan estimate is close: remez at that length meets the ripple specs within ~25 %', () => {
		const s = lp({ domain: 'digital', fs: 48000, fp: [4000, 4000], fst: [5000, 5000], rp: 0.5, rs: 60 });
		const r = firResults(s);
		const pm = r.rows.find((x) => x.id === 'remez')!;
		const w = r.dp / r.ds;
		const res = remez(
			pm.taps,
			[
				{ f1: 0, f2: 4000, d1: 1, d2: 1, weight: 1 },
				{ f1: 5000, f2: 24000, d1: 0, d2: 0, weight: w }
			],
			48000
		);
		// achieved passband deviation δ (stopband = δ/w)
		expect(res.delta).toBeLessThan(r.dp * 1.25);
		// and it is far shorter than the Kaiser window design
		expect(pm.taps).toBeLessThan(r.rows.find((x) => x.id === 'kaiser')!.taps);
	});

	it('fixed windows: Δf ≈ C/N and attenuation limits', () => {
		const s = lp({ domain: 'digital', fs: 48000, fp: [1000, 1000], fst: [2000, 2000], rp: 1, rs: 60 });
		const r = firResults(s);
		const get = (id: string) => r.rows.find((x) => x.id === id)!;
		expect(get('hann').taps).toBe(Math.ceil(3.1 / (1000 / 48000)));
		expect(get('hamming').taps).toBe(Math.ceil(3.3 / (1000 / 48000)));
		expect(get('blackman').taps).toBe(Math.ceil(5.5 / (1000 / 48000)));
		expect(get('hann').meets).toBe(false); // 44 dB < 60 dB
		expect(get('hamming').meets).toBe(false); // 53 dB < 60 dB
		expect(get('blackman').meets).toBe(true); // 74 dB
	});

	it('high-pass and band-stop lengths are odd (type I)', () => {
		const s = lp({ domain: 'digital', fs: 48000, band: 'highpass', fp: [2000, 2000], fst: [1000, 1000], rp: 1, rs: 60 });
		for (const row of firResults(s).rows) expect(row.taps % 2).toBe(1);
	});

	it('multiplications', () => {
		expect(firMults(101)).toEqual({ direct: 101, symmetric: 51 });
		expect(firMults(100)).toEqual({ direct: 100, symmetric: 50 });
	});
});
