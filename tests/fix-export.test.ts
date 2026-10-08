import { describe, expect, it } from 'vitest';
import {
	clampFixedBits,
	FIXED_BITS_MAX,
	FIXED_BITS_MIN,
	firToFixedC,
	fixedFormat
} from '../src/lib/export';
import { differentiatorFir, firwin } from '../src/lib/dsp/fir';

/** Read a firToFixedC listing back: the stated scale, the C type and the integer taps. */
function parse(code: string) {
	const frac = Number(/value = integer \/ 2\^(-?\d+(?:\.\d+)?)/.exec(code)![1]);
	const q = /\/\* Q(\d+)\.(\d+) coefficients, (\d+)-bit/.exec(code)!;
	const type = /static const (\w+) /.exec(code)![1];
	const body = code.slice(code.indexOf('{') + 1, code.lastIndexOf('}'));
	const ints = body
		.split(',')
		.map((s) => s.trim())
		.filter((s) => s.length > 0)
		.map(Number);
	return { frac, intBits: Number(q[1]), qFrac: Number(q[2]), bits: Number(q[3]), type, ints };
}

/** |H(e^jw)| of an FIR. */
const mag = (h: readonly number[], w: number) => {
	let re = 0;
	let im = 0;
	h.forEach((v, n) => {
		re += v * Math.cos(w * n);
		im -= v * Math.sin(w * n);
	});
	return Math.hypot(re, im);
};

const typeRange: Record<string, [number, number]> = {
	int8_t: [-128, 127],
	int16_t: [-32768, 32767],
	int32_t: [-2147483648, 2147483647]
};

describe('fixed-point FIR export: Q format follows the largest tap (#9)', () => {
	// Special FIR → differentiator, type IV (L = 21 → 22 taps), Hann: centre taps ±1.26613.
	const h = differentiatorFir(22, { type: 'hann' });

	it('uses Q1.14 for the type IV differentiator instead of clipping to Q15', () => {
		expect(Math.max(...h.map(Math.abs))).toBeCloseTo(1.26613, 5);
		const code = firToFixedC(h, 16);
		const p = parse(code);
		expect(p.type).toBe('int16_t');
		expect(p.bits).toBe(16);
		expect(p.intBits).toBe(1);
		expect(p.qFrac).toBe(14);
		expect(p.frac).toBe(14);
		expect(code).toContain('1 integer bit is used');
		expect(code).not.toContain('WARNING');
		// centre taps were 32767 / −32768 (read back as 0.99997 / −1) before the fix
		expect(p.ints[10]).toBe(20744);
		expect(p.ints[11]).toBe(-20744);
		// read back with the stated scale, every tap is within half an LSB
		p.ints.forEach((q, i) =>
			expect(Math.abs(q / 2 ** p.frac - h[i])).toBeLessThanOrEqual(2 ** -15)
		);
		// and the differentiator gain is preserved (was −2.7 … −1.7 dB)
		const hq = p.ints.map((q) => q / 2 ** p.frac);
		for (const f of [0.1, 0.25, 0.5, 0.75, 0.95]) {
			const errDb = 20 * Math.log10(mag(hq, f * Math.PI) / mag(h, f * Math.PI));
			expect(Math.abs(errDb)).toBeLessThan(0.01);
		}
	});

	it('maps the reported [1, −1, 1.5, −0.25] example exactly', () => {
		const p = parse(firToFixedC([1, -1, 1.5, -0.25], 16));
		expect(p.frac).toBe(14);
		expect(p.ints).toEqual([16384, -16384, 24576, -4096]);
	});

	it('keeps Q0.(bits−1) when every tap fits, with the same integers as before', () => {
		const lp = firwin(31, [5000], { type: 'hamming' }, true, 48000);
		for (const bits of [8, 12, 16, 24, 32]) {
			const code = firToFixedC(lp, bits);
			const p = parse(code);
			expect(p.intBits).toBe(0);
			expect(p.frac).toBe(bits - 1);
			expect(p.ints).toEqual(lp.map((v) => Math.round(v * 2 ** (bits - 1)) + 0)); // + 0: no −0
			expect(code.split('\n')[1]).toBe('#include <stdint.h>');
		}
	});

	it('handles the ±1 boundary: −1 fits Q0.15, +1 does not', () => {
		expect(fixedFormat([-1, 0.5], 16)).toMatchObject({ intBits: 0, frac: 15, clipped: 0 });
		expect(parse(firToFixedC([-1, 0.5], 16)).ints).toEqual([-32768, 16384]);
		// type III differentiator, rectangular window: taps of exactly ±1 stay antisymmetric
		const p = parse(firToFixedC([0.5, -1, 0, 1, -0.5], 16));
		expect(p.frac).toBe(14);
		expect(p.ints).toEqual([8192, -16384, 0, 16384, -8192]);
		// a tap that only rounds up to 1 also needs the integer bit
		expect(fixedFormat([1 - 2 ** -17], 16).intBits).toBe(1);
	});

	it('adds as many integer bits as needed', () => {
		expect(fixedFormat([2.5, -0.1], 16)).toMatchObject({ intBits: 2, frac: 13, clipped: 0 });
		const code = firToFixedC([2.5, -0.1], 16);
		expect(code).toContain('/* Q2.13 coefficients, 16-bit (value = integer / 2^13) */');
		expect(code).toContain('2 integer bits are used');
		expect(parse(code).ints).toEqual([20480, -819]);
	});

	it('uses the fewest integer bits that avoid saturation (random taps, all word lengths)', () => {
		let seed = 12345;
		const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 2 - 1;
		for (let trial = 0; trial < 200; trial++) {
			const scale = 2 ** Math.floor(rnd() * 6);
			const taps = Array.from({ length: 9 }, () => rnd() * scale);
			const bits = FIXED_BITS_MIN + (trial % (FIXED_BITS_MAX - FIXED_BITS_MIN + 1));
			const f = fixedFormat(taps, bits);
			const max = 2 ** (bits - 1) - 1;
			const min = -(2 ** (bits - 1));
			const fits = (frac: number) =>
				taps.every((v) => Math.round(v * 2 ** frac) <= max && Math.round(v * 2 ** frac) >= min);
			expect(f.frac).toBe(bits - 1 - f.intBits);
			if (f.clipped === 0) expect(fits(f.frac)).toBe(true);
			if (f.intBits > 0 && f.clipped === 0) expect(fits(f.frac + 1)).toBe(false);
			const code = firToFixedC(taps, bits);
			const p = parse(code);
			expect(p.frac).toBe(f.frac);
			expect(code.includes('WARNING')).toBe(f.clipped > 0);
			p.ints.forEach((q, i) => {
				expect(Number.isInteger(q)).toBe(true);
				if (f.clipped === 0)
					expect(Math.abs(q / 2 ** p.frac - taps[i])).toBeLessThanOrEqual(2 ** -(p.frac + 1));
			});
		}
	});

	it('warns when a tap cannot be represented even with no fractional bits', () => {
		const f = fixedFormat([100, 3, -0.5], 4);
		expect(f).toMatchObject({ bits: 4, intBits: 3, frac: 0, clipped: 1 });
		const code = firToFixedC([100, 3, -0.5], 4);
		expect(code).toContain('WARNING: 1 tap exceeds the 4-bit range');
		expect(parse(code).ints).toEqual([7, 3, 0]);
	});
});

describe('fixed-point word length is sanitised (#119)', () => {
	const h = differentiatorFir(22, { type: 'hann' });

	it('clampFixedBits rounds, clamps and falls back to 16 for a non-number', () => {
		expect(clampFixedBits(null)).toBe(16);
		expect(clampFixedBits(undefined)).toBe(16);
		expect(clampFixedBits(NaN)).toBe(16);
		expect(clampFixedBits(Infinity)).toBe(16);
		expect(clampFixedBits('12' as unknown as number)).toBe(16);
		expect(clampFixedBits(40)).toBe(FIXED_BITS_MAX);
		expect(clampFixedBits(64)).toBe(32);
		expect(clampFixedBits(3)).toBe(FIXED_BITS_MIN);
		expect(clampFixedBits(-5)).toBe(4);
		expect(clampFixedBits(12.4)).toBe(12);
		expect(clampFixedBits(12.5)).toBe(13);
		expect(clampFixedBits(24)).toBe(24);
	});

	it('an empty field (null) exports the default 16-bit code, not Q-1 fractions', () => {
		const code = firToFixedC(h, null as unknown as number);
		expect(code).toBe(firToFixedC(h, 16));
		expect(code).not.toMatch(/Q-|2\^-/);
	});

	it('every bits value gives integers that fit the declared C type and stated word length', () => {
		for (const bits of [-5, 0, 2, 3, 4, 7.5, 8, 12.5, 16, 31, 32, 33, 40, 64]) {
			const p = parse(firToFixedC(h, bits));
			const b = clampFixedBits(bits);
			expect(p.bits).toBe(b);
			expect(Number.isInteger(p.frac)).toBe(true);
			expect(p.frac).toBeGreaterThanOrEqual(0);
			const [lo, hi] = typeRange[p.type];
			expect(p.type).toBe(b <= 8 ? 'int8_t' : b <= 16 ? 'int16_t' : 'int32_t');
			for (const q of p.ints) {
				expect(Number.isInteger(q)).toBe(true);
				expect(q).toBeGreaterThanOrEqual(Math.max(lo, -(2 ** (b - 1))));
				expect(q).toBeLessThanOrEqual(Math.min(hi, 2 ** (b - 1) - 1));
			}
		}
		// the reported 40-bit case is now a valid 32-bit Q1.30 array
		const p40 = parse(firToFixedC(h, 40));
		expect(p40.type).toBe('int32_t');
		expect(p40.frac).toBe(30);
		expect(p40.ints[10]).toBe(Math.round(h[10] * 2 ** 30));
	});
});
