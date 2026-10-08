import { describe, expect, it } from 'vitest';
import {
	S_PRESETS,
	Z_PRESETS,
	dbAt,
	findPeak,
	freqPoint,
	geometric,
	makeItem,
	minimumPhase,
	normalizeGain,
	planeGain,
	planeRoots,
	stability,
	texNum,
	toZpk,
	transferTex,
	zpkGain,
	type PzItem
} from '../src/lib/features/pole-zero/model';
import { evaluate } from '../src/lib/dsp/response';
import { zpk2tf } from '../src/lib/dsp/convert';
import { digitalImpulseResponse } from '../src/lib/dsp/time';

const fs = 48000;
const wrapDeg = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

describe('pole-zero model: roots', () => {
	it('expands pairs into conjugates and adds causal poles at z = 0', () => {
		const items: PzItem[] = [makeItem('zero', 0.5, 0.5), makeItem('zero', -1, 0, false), makeItem('pole', 0.3, 0, false)];
		const r = planeRoots(items, 'z');
		expect(r.zeros).toHaveLength(3);
		expect(r.poles).toHaveLength(3);
		expect(r.implied).toBe(2);
		expect(r.zeros.filter((z) => z.im < 0)).toHaveLength(1);
		// s-plane: no implied poles
		expect(planeRoots(items, 's').implied).toBe(0);
	});
});

describe('pole-zero model: geometric evaluation matches evaluate()', () => {
	it('z-plane, all presets, several frequencies', () => {
		for (const p of Z_PRESETS) {
			const roots = planeRoots(p.build(fs), 'z');
			const { K } = normalizeGain(roots, 'z', 'peak', fs);
			const filter = { kind: 'digital' as const, fs, zpk: toZpk(roots, K, 'z') };
			const freqs = [0, 1234, 6000, 15000, 23999];
			const ref = evaluate(filter, freqs);
			freqs.forEach((f, i) => {
				const g = geometric(roots, K, freqPoint('z', f, fs));
				if (ref.mag[i] < 1e-9) expect(g.mag).toBeLessThan(1e-6);
				else {
					expect(g.mag).toBeCloseTo(ref.mag[i], 9);
					const ph = (Math.atan2(ref.H[i].im, ref.H[i].re) * 180) / Math.PI;
					expect(Math.abs(wrapDeg((g.phase * 180) / Math.PI - ph))).toBeLessThan(1e-6);
				}
			});
		}
	});

	it('s-plane in Hz units with the plane gain K', () => {
		for (const p of S_PRESETS) {
			const roots = planeRoots(p.build(fs), 's');
			const { K } = normalizeGain(roots, 's', 'peak', fs);
			const zpk = toZpk(roots, K, 's');
			const freqs = [10, 400, 980, 1000, 5000];
			const ref = evaluate({ kind: 'analog', zpk }, freqs);
			freqs.forEach((f, i) => {
				const g = geometric(roots, K, freqPoint('s', f, fs));
				if (ref.mag[i] < 1e-9) expect(g.mag).toBeLessThan(1e-6);
				else expect(g.mag / ref.mag[i]).toBeCloseTo(1, 9);
			});
		}
	});

	it('dbAt agrees with the geometric magnitude', () => {
		const roots = planeRoots(Z_PRESETS[0].build(fs), 'z');
		const x = freqPoint('z', 3000, fs);
		expect(dbAt(roots.zeros, roots.poles, 0.3, x)).toBeCloseTo(20 * Math.log10(geometric(roots, 0.3, x).mag), 9);
	});
});

describe('pole-zero model: gain normalisation', () => {
	it('peak normalisation gives 0 dB at the refined peak (2nd-order s-plane LP)', () => {
		const zeta = 0.2;
		const roots = planeRoots(S_PRESETS[0].build(fs), 's');
		const peak = findPeak(roots, 's', fs);
		// analytic resonant peak of a 2nd-order low-pass
		expect(peak.f).toBeCloseTo(1000 * Math.sqrt(1 - 2 * zeta * zeta), 3);
		const { K } = normalizeGain(roots, 's', 'peak', fs);
		expect(K * peak.mag).toBeCloseTo(1, 12);
	});

	it('DC normalisation chooses the sign so that H(DC) = +1', () => {
		// first-order all-pass (a − s)/(s + a)
		const roots = planeRoots([makeItem('zero', 1000, 0, false), makeItem('pole', -1000, 0, false)], 's');
		const { K } = normalizeGain(roots, 's', 'dc', fs);
		expect(K).toBeCloseTo(-1, 12);
		const zpk = toZpk(roots, K, 's');
		expect(evaluate({ kind: 'analog', zpk }, [1e-6]).H[0].re).toBeCloseTo(1, 6);
	});

	it('falls back to peak when DC has a zero', () => {
		const roots = planeRoots([makeItem('zero', 1, 0, false), makeItem('pole', 0.5, 0, false)], 'z');
		const g = normalizeGain(roots, 'z', 'dc', fs);
		expect(g.note).toBeTruthy();
		expect(g.K).toBeCloseTo(normalizeGain(roots, 'z', 'peak', fs).K, 12);
	});

	it('plane gain ↔ rad/s gain', () => {
		expect(zpkGain(planeGain(5, 's', 1, 3), 's', 1, 3)).toBeCloseTo(5, 12);
		expect(zpkGain(2, 's', 0, 2)).toBeCloseTo(2 * (2 * Math.PI) ** 2, 9);
		expect(zpkGain(2, 'z', 0, 2)).toBe(2);
	});
});

describe('pole-zero model: presets', () => {
	it('moving-average preset is exactly the 8-tap moving average', () => {
		const p = Z_PRESETS.find((x) => x.id === 'moving-average')!;
		const roots = planeRoots(p.build(fs), 'z');
		expect(roots.zeros).toHaveLength(7);
		expect(roots.implied).toBe(7);
		const { K } = normalizeGain(roots, 'z', 'dc', fs);
		expect(K).toBeCloseTo(1 / 8, 12);
		const tf = zpk2tf(toZpk(roots, K, 'z'));
		tf.b.forEach((b) => expect(b).toBeCloseTo(1 / 8, 9));
		const h = digitalImpulseResponse({ kind: 'digital', fs, zpk: toZpk(roots, K, 'z') }, 12);
		for (let n = 0; n < 12; n++) expect(h[n]).toBeCloseTo(n < 8 ? 1 / 8 : 0, 9);
	});

	it('all-pass presets have flat magnitude', () => {
		for (const [list, domain] of [
			[Z_PRESETS, 'z'],
			[S_PRESETS, 's']
		] as const) {
			const p = list.find((x) => x.id === 'allpass')!;
			const roots = planeRoots(p.build(fs), domain);
			const { K } = normalizeGain(roots, domain, 'peak', fs);
			for (const f of [5, 500, 1000, 3000, 20000]) {
				expect(geometric(roots, K, freqPoint(domain, f, fs)).mag).toBeCloseTo(1, 9);
			}
		}
	});

	it('notch presets null their centre frequency', () => {
		const z = planeRoots(Z_PRESETS.find((x) => x.id === 'notch')!.build(fs), 'z');
		expect(geometric(z, 1, freqPoint('z', fs / 8, fs)).mag).toBeLessThan(1e-9);
		const s = planeRoots(S_PRESETS.find((x) => x.id === 'notch')!.build(fs), 's');
		expect(geometric(s, 1, freqPoint('s', 1000, fs)).mag).toBeLessThan(1e-9);
	});

	it('Butterworth presets match the designer', () => {
		const z = planeRoots(Z_PRESETS.find((x) => x.id === 'butter4')!.build(fs), 'z');
		expect(z.poles).toHaveLength(4);
		expect(z.zeros.every((q) => Math.abs(q.re + 1) < 1e-9 && Math.abs(q.im) < 1e-9)).toBe(true);
		const s = planeRoots(S_PRESETS.find((x) => x.id === 'butter3')!.build(fs), 's');
		s.poles.forEach((p) => expect(Math.hypot(p.re, p.im)).toBeCloseTo(1000, 6));
	});
});

describe('pole-zero model: classification', () => {
	it('stability', () => {
		expect(stability([{ re: 0.5, im: 0.5 }], 'z')).toBe('stable');
		expect(stability([{ re: 0, im: 1 }], 'z')).toBe('marginal');
		expect(stability([{ re: 1.01, im: 0 }], 'z')).toBe('unstable');
		expect(stability([{ re: -1, im: 3 }], 's')).toBe('stable');
		expect(stability([{ re: 0, im: 3 }], 's')).toBe('marginal');
		expect(stability([{ re: 0.1, im: 3 }], 's')).toBe('unstable');
	});

	it('minimum phase', () => {
		expect(minimumPhase([{ re: 0.5, im: 0 }], 'z').status).toBe('yes');
		expect(minimumPhase([{ re: -1, im: 0 }], 'z').status).toBe('boundary');
		expect(minimumPhase([{ re: 2, im: 0 }], 'z')).toEqual({ status: 'no', outside: 1, on: 0 });
		expect(minimumPhase([{ re: 1, im: 2 }], 's').status).toBe('no');
	});
});

describe('pole-zero model: TeX', () => {
	it('formats numbers', () => {
		expect(texNum(1234.5678)).toBe('1235');
		expect(texNum(3.948e7)).toBe('3.948\\times10^{7}');
		expect(texNum(-2.5e-4)).toBe('-2.5\\times10^{-4}');
	});

	it('collects repeated factors', () => {
		const tex = transferTex(
			'z',
			[
				{ re: -1, im: 0, pair: false },
				{ re: -1, im: 0, pair: false }
			],
			[{ re: 0.5, im: 0.5, pair: true }],
			0.25
		);
		expect(tex).toBe('H(z) = 0.25\\,\\dfrac{\\left(z + 1\\right)^{2}}{\\left(z^2 - z + 0.5\\right)}');
	});
});
