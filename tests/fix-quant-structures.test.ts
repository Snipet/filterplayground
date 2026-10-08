import { describe, expect, it } from 'vitest';
import { designDigital } from '../src/lib/dsp/design';
import { sos2tf } from '../src/lib/dsp/convert';
import { biquad, BIQUAD_TYPES } from '../src/lib/dsp/biquad';
import { sosfilt } from '../src/lib/dsp/time';
import { evaluate, frequencyGrid } from '../src/lib/dsp/response';
import type { SOS } from '../src/lib/dsp/types';
import {
	limitCycle,
	quantizeDirect,
	quantizeSos,
	zeroInputResponse,
	type RoundMode
} from '../src/lib/features/quantization/quant';
import {
	normalizeTf,
	parallel,
	parallelForm,
	runProcessor
} from '../src/lib/features/structures/realize';
import { buildStructures } from '../src/lib/features/structures/structures';
import { presetFilter } from '../src/lib/features/structures/presets';

/** Coefficients of the limit-cycle demo for a pole pair r·e^{±jθ} (θ in degrees). */
const coeffs = (r: number, thDeg: number) => ({
	a1: -2 * r * Math.cos((thDeg * Math.PI) / 180),
	a2: r * r
});
/** The demo's setting: y[−1] = 0.5, Q0.(B−1) signal word, saturation arithmetic. */
const demo = (r: number, th: number, B: number, mode: RoundMode) => {
	const { a1, a2 } = coeffs(r, th);
	return limitCycle(a1, a2, 0.5, B - 1, mode, { saturate: true });
};
const impulse = (n: number) => Array.from({ length: n }, (_, i) => (i === 0 ? 1 : 0));

describe('#43 limit-cycle amplitude is the exact steady state, not the transient', () => {
	it('r = 0.99, θ = 20°, 8 bits: rounding settles at ±26 LSB, truncation and floor at 0', () => {
		// the old 240-sample window reported ±42, ±17 and ±43 LSB here
		expect(demo(0.99, 20, 8, 'round').amplitude).toBe(26);
		expect(demo(0.99, 20, 8, 'trunc').amplitude).toBe(0);
		expect(demo(0.99, 20, 8, 'floor').amplitude).toBe(0);
	});
	it('agrees with a long simulation: periodic from the onset, with the stated amplitude', () => {
		for (const B of [4, 8, 12, 16])
			for (const r of [0.5, 0.8, 0.95, 0.99])
				for (let th = 1; th < 180; th += 11)
					for (const mode of ['round', 'floor', 'trunc'] as const)
						for (const saturate of [false, true]) {
							const { a1, a2 } = coeffs(r, th);
							const lc = limitCycle(a1, a2, 0.5, B - 1, mode, { saturate });
							expect(lc.capped).toBe(false);
							const n = lc.onset + 3 * lc.period + 5;
							const y = zeroInputResponse(a1, a2, 0.5, B - 1, mode, n, { saturate }).quantized.map(
								(v) => v * 2 ** (B - 1)
							);
							const tail = y.slice(lc.onset);
							for (let k = lc.period; k < tail.length; k++)
								expect(tail[k]).toBe(tail[k - lc.period]);
							expect(Math.max(...tail.map(Math.abs))).toBe(lc.amplitude);
							expect(tail.slice(0, lc.period)).toEqual(lc.samples);
							// the onset is the first periodic sample
							if (lc.onset > 0) expect(y[lc.onset - 1]).not.toBe(y[lc.onset - 1 + lc.period]);
						}
	});
	it('handles slow decays (r = 0.999, 16 bits) quickly', () => {
		const t = performance.now();
		const lc = demo(0.999, 20, 16, 'round');
		expect(lc.capped).toBe(false);
		expect(lc.onset).toBeGreaterThan(3000);
		expect(performance.now() - t).toBeLessThan(200);
	});
});

describe('#42 magnitude truncation does not remove direct-form limit cycles', () => {
	it('r = 0.8, θ = 15°, 8 bits: truncation locks onto −6 LSB, rounding onto 1 LSB', () => {
		const t = demo(0.8, 15, 8, 'trunc');
		expect(t.period).toBe(1);
		expect(t.samples).toEqual([-6]);
		expect(demo(0.8, 15, 8, 'round').amplitude).toBe(1);
		// hand check of the fixed point: trunc(1.5455·(−6)) + trunc(−0.64·(−6)) = −9 + 3
		const { a1, a2 } = coeffs(0.8, 15);
		expect(Math.trunc(-a1 * -6) + Math.trunc(-a2 * -6)).toBe(-6);
	});
	it('once |a₁| ≥ 1, y = ±1 LSB is a constant (θ < 90°) or alternating (θ > 90°) cycle', () => {
		for (const [r, th] of [
			[0.6, 30],
			[0.95, 20],
			[0.99, 55],
			[0.9, 150],
			[0.7, 170]
		]) {
			const { a1, a2 } = coeffs(r, th);
			expect(Math.abs(a1)).toBeGreaterThanOrEqual(1);
			for (const s of [1, -1]) {
				const y = zeroInputResponse(a1, a2, s / 128, 7, 'trunc', 60).quantized.map((v) => v * 128);
				y.forEach((v, n) => expect(v).toBe(th < 90 ? s : s * (n % 2 ? 1 : -1)));
			}
		}
	});
	it('the Try bullet: ±5 → ±26 LSB with rounding, truncation 0 at r = 0.99, −1 LSB at r = 0.95', () => {
		expect(demo(0.95, 20, 8, 'round').amplitude).toBe(5);
		expect(demo(0.99, 20, 8, 'round').amplitude).toBe(26);
		expect(demo(0.99, 20, 8, 'trunc').amplitude).toBe(0);
		const t = demo(0.95, 20, 8, 'trunc');
		expect(t.period).toBe(1);
		expect(t.samples).toEqual([-1]);
	});
	it('normal (coupled) form with magnitude truncation of each state has no zero-input limit cycle', () => {
		// s ← Q_mt(r·R(θ)·s): the Euclidean norm shrinks every step, so the state reaches 0
		for (const r of [0.6, 0.8, 0.95, 0.99])
			for (let th = 1; th < 180; th += 4) {
				const sg = r * Math.cos((th * Math.PI) / 180);
				const om = r * Math.sin((th * Math.PI) / 180);
				let s1 = 64;
				let s2 = 0;
				let n = 0;
				while ((s1 !== 0 || s2 !== 0) && n < 100000) {
					const u = Math.trunc(sg * s1 - om * s2);
					const v = Math.trunc(om * s1 + sg * s2);
					s1 = u;
					s2 = v;
					n++;
				}
				expect(s1 === 0 && s2 === 0).toBe(true);
			}
	});
});

describe('#44 dead band (a₂-type estimate) and DC / fs/2 (a₁-type) bound', () => {
	it('DC and sign-alternating cycles obey (1 − |a₁| + a₂)|y| ≤ 1 LSB (rounding), < 2 LSB (truncation)', () => {
		let dcSeen = 0;
		for (const B of [8, 12])
			for (let ri = 50; ri <= 99; ri += 7)
				for (let th = 1; th < 180; th += 2)
					for (const mode of ['round', 'floor', 'trunc'] as const) {
						const r = ri / 100;
						const { a1, a2 } = coeffs(r, th);
						const lc = demo(r, th, B, mode);
						const s = lc.samples;
						const dcOrAlt = lc.period === 1 || (lc.period === 2 && s[0] === -s[1]);
						if (!dcOrAlt || lc.amplitude === 0) continue;
						dcSeen++;
						const lhs = (1 - Math.abs(a1) + a2) * lc.amplitude;
						if (mode === 'round') expect(lhs).toBeLessThanOrEqual(1 + 1e-12);
						else expect(lhs).toBeLessThan(2);
					}
		expect(dcSeen).toBeGreaterThan(100);
	});
	it('r = 0.9, θ = 5°, 12 bits: a constant −35 LSB, far outside the 2.6 LSB dead band', () => {
		const lc = demo(0.9, 5, 12, 'round');
		const { a1, a2 } = coeffs(0.9, 5);
		expect(lc.samples).toEqual([-35]);
		expect(0.5 / (1 - a2)).toBeCloseTo(2.63, 2);
		expect(lc.amplitude).toBeLessThanOrEqual(1 / (1 - Math.abs(a1) + a2));
	});
	it('the a₂-type dead band is only an estimate: r = 0.95, θ = 30°, 16 bits oscillates at 12 LSB', () => {
		const lc = demo(0.95, 30, 16, 'round');
		expect(lc.period).toBeGreaterThan(2);
		expect(lc.amplitude).toBe(12);
		expect(0.5 / (1 - 0.95 ** 2)).toBeCloseTo(5.13, 2);
	});
});

describe('#102 the limit-cycle demo stays inside the B-bit word', () => {
	it('saturates to [−1, 1 − 2^−frac]; the default without the option is unchanged', () => {
		const { a1, a2 } = coeffs(0.95, 20);
		const free = zeroInputResponse(a1, a2, 0.5, 7, 'round', 240);
		expect(Math.max(...free.quantized.map(Math.abs)) * 128).toBe(158);
		for (const [r, th] of [
			[0.95, 20],
			[0.99, 5],
			[0.999, 1]
		]) {
			const c = coeffs(r, th);
			for (const mode of ['round', 'floor', 'trunc'] as const) {
				const sat = zeroInputResponse(c.a1, c.a2, 0.5, 7, mode, 600, { saturate: true });
				for (const v of sat.quantized) {
					expect(v * 128).toBeLessThanOrEqual(127);
					expect(v * 128).toBeGreaterThanOrEqual(-128);
				}
			}
		}
	});
});

describe('#45 direct form vs cascade for the default elliptic low-pass', () => {
	const design = (order: number) =>
		designDigital({
			family: 'ellip',
			band: 'lowpass',
			order,
			f1: 1000,
			rp: 0.5,
			rs: 60,
			fs: 48000
		}).sos;
	/** The page's passband error: max dB deviation where the original is within 3 dB of its peak. */
	function passbandError(orig: SOS, q: SOS): number {
		const grid = frequencyGrid(24000 / 2000, 24000, 700, 'log');
		const o = evaluate({ kind: 'digital', fs: 48000, sos: orig }, grid).magDb;
		const d = evaluate({ kind: 'digital', fs: 48000, sos: q }, grid).magDb;
		const peak = Math.max(...o);
		let worst = 0;
		o.forEach((v, i) => {
			if (v >= peak - 3) worst = Math.max(worst, Math.abs(d[i] - v));
		});
		return worst;
	}
	it('order 6: the direct form is unstable at every slider word length, even 24 bits', () => {
		const sos = design(6);
		const tf = sos2tf(sos);
		for (let B = 4; B <= 25; B++) expect(quantizeDirect(tf, B, null).stable).toBe(false);
		expect(quantizeDirect(tf, 24, null).maxRadius).toBeCloseTo(1.008, 3);
		expect(quantizeDirect(tf, 26, null).stable).toBe(true);
		const so = quantizeSos(sos, 24, null);
		expect(so.stable).toBe(true);
		expect(passbandError(sos, so.sos)).toBeLessThan(0.001);
	});
	it('order 4: stable at 24 bits, a pole leaves the unit circle at 17 bits; the cascade barely moves', () => {
		const sos = design(4);
		const tf = sos2tf(sos);
		for (let B = 18; B <= 24; B++) expect(quantizeDirect(tf, B, null).stable).toBe(true);
		const d17 = quantizeDirect(tf, 17, null);
		expect(d17.stable).toBe(false);
		expect(d17.maxRadius).toBeGreaterThan(1.005);
		for (const B of [24, 17]) {
			const so = quantizeSos(sos, B, null);
			expect(so.stable).toBe(true);
			expect(passbandError(sos, so.sos)).toBeLessThan(0.05);
		}
	});
});

describe('#46 direct-form export: exact gain and coefficient sets', () => {
	const sos = designDigital({
		family: 'ellip',
		band: 'lowpass',
		order: 6,
		f1: 1000,
		rp: 0.5,
		rs: 60,
		fs: 48000
	}).sos;
	const tf = sos2tf(sos);
	it('a_q holds a₁…a_N only and b = gain·b_q', () => {
		const q = quantizeDirect(tf, 16, null);
		expect(q.aq).toHaveLength(6);
		expect(q.tf.a).toEqual([1, ...q.aq]);
		expect(q.aq[0]).toBe(-5.822265625);
		q.tf.b.forEach((v, i) => expect(v).toBe(q.bq[i] * q.gain));
		const [fb, fa] = q.sets.map((s) => s.format);
		for (const v of q.bq) expect(Number.isInteger(v * 2 ** fb.frac)).toBe(true);
		for (const v of q.aq) expect(Number.isInteger(v * 2 ** fa.frac)).toBe(true);
		// printing with JS's shortest round-trip form keeps the exact grid values
		for (const v of [...q.bq, ...q.aq]) expect(Number(String(v))).toBe(v);
	});
	it('manual Q0.15: the saturated monic b₀ stays on the grid instead of being rescaled to 1', () => {
		const q = quantizeDirect(tf, 16, 0);
		expect(q.bq[0]).toBe(1 - 2 ** -15);
		expect(q.gain).toBe(tf.b[0] / tf.a[0]);
		for (const v of q.bq) expect(Number.isInteger(v * 2 ** 15)).toBe(true);
	});
});

describe('#47 parallel form of biquads at f₀ = fs/4', () => {
	const types = BIQUAD_TYPES.map((t) => t.id);
	it('every structure reproduces sosfilt, with no huge coefficients', () => {
		for (const type of types)
			for (const q of [0.5, 0.707, 2]) {
				const raw = biquad({ type, f0: 12000, fs: 48000, q, gainDb: 6 });
				const ref = Array.from(sosfilt([raw], impulse(64)));
				const f = presetFilter('biquad', { type, f0: 12000, q, gainDb: 6 });
				const list = buildStructures(f.b, f.a, f.sos);
				for (const s of list) {
					if (!s.applicable || !s.make) continue;
					const y = runProcessor(s.make(), impulse(64));
					y.forEach((v, i) => expect(Math.abs(v - ref[i])).toBeLessThan(1e-12));
				}
				// raw coefficients passed straight to parallelForm work too (the shelves at Q = 0.5
				// are critically damped: a genuine double pole, which the parallel form rejects)
				const repeated = (type === 'lowshelf' || type === 'highshelf') && q === 0.5;
				if (repeated) {
					expect(() => parallelForm(raw.slice(0, 3), raw.slice(3, 6))).toThrow(/distinct poles/);
					continue;
				}
				const form = parallelForm(raw.slice(0, 3), raw.slice(3, 6));
				const coefs = [...form.direct, ...form.sections.flatMap((s) => [...s.b, ...s.a])];
				for (const c of coefs) expect(Math.abs(c)).toBeLessThan(1e3);
				const y = runProcessor(parallel(form), impulse(64));
				y.forEach((v, i) => expect(Math.abs(v - ref[i])).toBeLessThan(1e-12));
			}
	});
	it('first-order low-pass at fs/4 is an FIR filter b = [0.5, 0.5]', () => {
		const f = presetFilter('biquad', { type: 'lowpass1', f0: 12000, q: 0.707, gainDb: 0 });
		expect(f.a).toEqual([1]);
		expect(f.sos[0].slice(3)).toEqual([1, 0, 0]);
		const form = parallelForm(f.b, f.a);
		expect(form.sections).toEqual([]);
		expect(runProcessor(parallel(form), impulse(3))[0]).toBeCloseTo(0.5, 15);
	});
	it('normalizeTf only zeroes round-off-level coefficients', () => {
		expect(normalizeTf([1, 1e-17, 0.5], [2, -1.1e-16, 0])).toEqual({ b: [0.5, 0, 0.25], a: [1] });
		expect(normalizeTf([1, 1e-9], [1, 1e-9])).toEqual({ b: [1, 1e-9], a: [1, 1e-9] });
	});
});
