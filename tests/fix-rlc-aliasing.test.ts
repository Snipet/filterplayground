import { describe, expect, it } from 'vitest';
import { abs } from '../src/lib/dsp/complex';
import { freqsZpk } from '../src/lib/dsp/response';
import { analogTimeResponse } from '../src/lib/dsp/time';
import { foldStart, toneImages, triangle } from '../src/lib/features/aliasing/aliasing';
import {
	circuitZpk,
	fastTimeConstant,
	resonancePeak,
	secondOrder,
	secondOrderPoles,
	slowTimeConstant,
	stepOvershoot
} from '../src/lib/features/rlc/circuits';

// Default component values of the RLC page: ω₀ = 1e4 rad/s, Z₀ = 1 kΩ, so Q = 1000/R.
const L = 0.1;
const C = 100e-9;

describe('#8 step overshoot of the series-RLC low-pass', () => {
	it('matches the reported closed-form values at high Q (old stat: 84.2 / 64.4 / 39.2 %)', () => {
		const at = (R: number) => stepOvershoot(secondOrder('rlc-c', R, L, C).zeta);
		expect(at(10)).toBeCloseTo(98.4415, 3);
		expect(at(4.7)).toBeCloseTo(99.2644, 3);
		expect(at(1)).toBeCloseTo(99.843, 3);
		// rises monotonically as damping falls
		const rs = [470, 100, 47, 20, 10, 4.7, 1];
		for (let i = 1; i < rs.length; i++) expect(at(rs[i])).toBeGreaterThan(at(rs[i - 1]));
	});

	it('equals the peak of a finely sampled step response (DC gain 1)', () => {
		for (const R of [470, 100, 20, 10, 1]) {
			const so = secondOrder('rlc-c', R, L, C);
			const wd = so.w0 * Math.sqrt(1 - so.zeta * so.zeta);
			// first peak at t = π/ωd; sample one damped period finely
			const st = analogTimeResponse(
				circuitZpk('rlc-c', R, L, C),
				'step',
				(2 * Math.PI) / wd,
				20001
			);
			const sim = (Math.max(...st.y) - 1) * 100;
			expect(Math.abs(sim - stepOvershoot(so.zeta))).toBeLessThan(1e-3);
		}
	});

	it('is zero without complex poles', () => {
		expect(stepOvershoot(1)).toBe(0);
		expect(stepOvershoot(5)).toBe(0);
		expect(stepOvershoot(0.5)).toBeCloseTo(100 * Math.exp(-Math.PI / Math.sqrt(3)), 12);
	});
});

describe('#48 resonance peak of the low-pass / high-pass outputs', () => {
	it('gives the true peak at high Q (old stat: 38.6 / 42.3 / 44.1 dB)', () => {
		const db = (R: number) => {
			const so = secondOrder('rlc-c', R, L, C);
			return 20 * Math.log10(resonancePeak('lowpass', so.w0, so.q)!.gain);
		};
		expect(db(10)).toBeCloseTo(40.0001, 3);
		expect(db(4.7)).toBeCloseTo(46.558, 2);
		expect(db(1)).toBeCloseTo(60.0, 3);
	});

	for (const [id, band] of [
		['rlc-c', 'lowpass'],
		['rlc-l', 'highpass']
	] as const) {
		it(`${id}: |H| at the reported frequency equals the gain and is a local maximum`, () => {
			for (const R of [1, 4.7, 10, 100, 470, 1000]) {
				const so = secondOrder(id, R, L, C);
				const pk = resonancePeak(band, so.w0, so.q)!;
				const zpk = circuitZpk(id, R, L, C);
				const mag = (w: number) => abs(freqsZpk(zpk, [w])[0]);
				expect(mag(pk.w) / pk.gain).toBeCloseTo(1, 10);
				// nothing higher within ±5 bandwidths around the peak
				const bwRel = 1 / so.q;
				for (let i = -200; i <= 200; i++) {
					const w = pk.w * (1 + (i / 40) * bwRel);
					expect(mag(w)).toBeLessThanOrEqual(pk.gain * (1 + 1e-12));
				}
			}
		});
	}

	it('reports no peak for Q ≤ 1/√2', () => {
		expect(resonancePeak('lowpass', 1e4, Math.SQRT1_2)).toBeNull();
		expect(resonancePeak('highpass', 1e4, 0.5)).toBeNull();
		expect(resonancePeak('lowpass', 1e4, 0.71)).not.toBeNull();
	});
});

describe('#49 time constant of an overdamped circuit', () => {
	it('is the slow real pole, not 1/(ζω₀)', () => {
		const so = secondOrder('rlc-c', 1e4, L, C); // Q = 0.1, ζ = 5
		expect(so.zeta).toBeCloseTo(5, 12);
		expect(1 / (so.zeta * so.w0)).toBeCloseTo(2e-5, 12); // what the page used to show
		expect(slowTimeConstant(so.w0, so.zeta)).toBeCloseTo(9.899e-4, 6);
		expect(fastTimeConstant(so.w0, so.zeta)).toBeCloseTo(1.0102e-5, 8);
	});

	it('agrees with −1/Re(slowest pole) for every damping', () => {
		const w0 = 1234;
		for (const zeta of [0.01, 0.3, 0.999, 1, 1.001, 1.5, 5, 50, 1e4]) {
			const p = secondOrderPoles(w0, zeta);
			const slow = Math.max(p[0].re, p[1].re);
			const fast = Math.min(p[0].re, p[1].re);
			expect(slowTimeConstant(w0, zeta) * -slow).toBeCloseTo(1, 10);
			if (zeta >= 1) expect(fastTimeConstant(w0, zeta) * -fast).toBeCloseTo(1, 10);
		}
	});

	it('sets the decay rate of the overdamped step response', () => {
		for (const id of ['rlc-c', 'tank'] as const) {
			// ζ = 5 for both families
			const R = id === 'tank' ? 100 : 1e4;
			const so = secondOrder(id, R, L, C);
			const tau = slowTimeConstant(so.w0, so.zeta);
			const dur = 10 * tau;
			const st = analogTimeResponse(circuitZpk(id, R, L, C), 'step', dur, 4001);
			const final = id === 'tank' ? 0 : 1;
			const e = (i: number) => Math.abs(st.y[i] - final);
			// between 4τ and 6τ the error shrinks by e^(−2)
			const i4 = 1600;
			const i6 = 2400;
			expect(Math.log(e(i4) / e(i6)) / ((st.t[i6] - st.t[i4]) / tau)).toBeCloseTo(1, 3);
		}
	});
});

describe('#104 folding edge of the signal band', () => {
	it('is null, fs − B or 0', () => {
		expect(foldStart(48000, 20000)).toBeNull();
		expect(foldStart(48000, 24000)).toBeNull();
		expect(foldStart(48000, 30000)).toBe(18000);
		expect(foldStart(16000, 20000)).toBe(0); // was shown as "folds above −4 kHz"
		expect(foldStart(48000, 55000)).toBe(0);
		expect(foldStart(48000, 48000)).toBe(0);
	});

	it('matches the lowest frequency in 0…fs/2 hit by an image', () => {
		for (const [fs, B] of [
			[48000, 20000],
			[48000, 30000],
			[48000, 47000],
			[16000, 20000],
			[48000, 57600]
		]) {
			let first: number | null = null;
			for (let i = 0; i <= 2400; i++) {
				const f = ((fs / 2) * i) / 2400;
				let img = 0;
				for (let k = -4; k <= 4; k++) if (k !== 0) img += triangle(f - k * fs, B);
				if (img > 0) {
					first = f;
					break;
				}
			}
			const fold = foldStart(fs, B);
			if (fold === null) expect(first).toBeNull();
			else expect(Math.abs(first! - fold)).toBeLessThanOrEqual(fs / 4800 + 1e-9);
		}
	});
});

describe('#105 interferer-tone images in the two-sided spectrum', () => {
	const brute = (f: number, fs: number, span: number) => {
		const out = new Set<number>();
		for (let k = -50; k <= 50; k++)
			for (const s of [-1, 1]) {
				const v = s * f + k * fs;
				if (Math.abs(v) <= span) out.add(v);
			}
		return [...out].sort((a, b) => a - b);
	};

	it('includes the images the old K = 2 + ⌈B/fs⌉ loop dropped', () => {
		const fs = 48000;
		const span = 2.5 * fs;
		const a = toneImages(80000, fs, span);
		expect(a).toContain(112000);
		expect(a).toContain(-112000);
		const b = toneImages(115200, fs, span); // slider maximum 2.4·fs
		expect(b).toContain(76800);
		expect(b).toContain(-76800);
	});

	it('equals a brute-force enumeration over the whole tone range', () => {
		for (const fs of [1000, 48000]) {
			const span = 2.5 * fs;
			for (let r = 0.05; r <= 2.4; r += 0.0371) {
				expect(toneImages(r * fs, fs, span)).toEqual(brute(r * fs, fs, span));
			}
		}
	});

	it('does not duplicate lines when ±f coincide', () => {
		const t = toneImages(500, 1000, 2500);
		expect(new Set(t).size).toBe(t.length);
		expect(t).toEqual([-2500, -1500, -500, 500, 1500, 2500]);
	});
});
