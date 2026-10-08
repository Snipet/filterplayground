import { describe, expect, it } from 'vitest';
import {
	amplitude,
	capabilities,
	demoTaps,
	energyIndex,
	firZeros,
	groupZeros,
	magnitude,
	partialEnergy,
	phaseVersions,
	preRinging,
	energyCentroid,
	randomTaps,
	typeOf,
	type LpType
} from '../src/lib/features/linear-phase/lp';

const win = { type: 'hamming' as const };

describe('linear-phase: types and forced zeros', () => {
	it('random taps have the symmetry of their type', () => {
		for (const [t, N] of [
			[1, 21],
			[2, 20],
			[3, 21],
			[4, 20]
		] as [LpType, number][]) {
			expect(typeOf(randomTaps(t, N, 3))).toBe(t);
			expect(typeOf(demoTaps(t, N, t > 2 ? 'hilbert' : 'lowpass', win))).toBe(t);
		}
	});
	it('forced zeros appear at z = ±1', () => {
		const at = (h: number[], x: number) =>
			Math.min(...firZeros(h).map((z) => Math.hypot(z.re - x, z.im)));
		expect(at(randomTaps(2, 20, 1), -1)).toBeLessThan(1e-6);
		expect(at(randomTaps(3, 21, 1), 1)).toBeLessThan(1e-6);
		expect(at(randomTaps(3, 21, 1), -1)).toBeLessThan(1e-6);
		expect(at(randomTaps(4, 20, 1), 1)).toBeLessThan(1e-6);
		expect(capabilities(2).highpass).toBe(false);
		expect(capabilities(4).highpass).toBe(false); // antisymmetric types are not ordinary selective filters
		expect(capabilities(1)).toMatchObject({ lowpass: true, highpass: true, bandstop: true });
	});
	it('the amplitude is real, signed and matches |H|', () => {
		for (const t of [1, 2, 3, 4] as LpType[]) {
			const h = randomTaps(t, t % 2 ? 15 : 16, 9);
			for (const f of [0.05, 0.17, 0.33])
				expect(Math.abs(amplitude(h, f, t > 2))).toBeCloseTo(magnitude(h, f), 10);
		}
		// Hilbert (−j·sgn) has A = −1 under the H = j·A·e^{−jωM} convention; the differentiator has A = +ω
		expect(amplitude(demoTaps(3, 41, 'hilbert', win), 0.25, true)).toBeCloseTo(-1, 1);
		expect(amplitude(demoTaps(4, 40, 'differentiator', win), 0.05, true)).toBeCloseTo(
			2 * Math.PI * 0.05,
			2
		);
		// type II high-pass is forced to zero at fs/2
		expect(magnitude(demoTaps(2, 20, 'highpass', win), 0.5)).toBeLessThan(1e-12);
	});
});

describe('linear-phase: zero symmetry', () => {
	it('groups the zeros of random taps into quadruples, pairs and forced singles', () => {
		const h = randomTaps(3, 21, 4);
		const groups = groupZeros(firZeros(h));
		const count = groups.reduce((s, g) => s + g.members.length, 0);
		expect(count).toBe(20);
		expect(groups.filter((g) => g.kind === 'other')).toEqual([]);
		expect(groups.some((g) => g.kind === 'plus1')).toBe(true);
		expect(groups.some((g) => g.kind === 'minus1')).toBe(true);
		const q = groups.find((g) => g.kind === 'quad');
		if (q) {
			const [z] = q.members;
			const r2 = z.re * z.re + z.im * z.im;
			expect(q.members.some((w) => Math.hypot(w.re - z.re / r2, w.im + z.im / r2) < 1e-6)).toBe(
				true
			);
		}
	});
	it('a low-pass has its stopband zeros on the unit circle', () => {
		const groups = groupZeros(firZeros(demoTaps(1, 31, 'lowpass', win)));
		expect(groups.filter((g) => g.kind === 'unit-pair').length).toBeGreaterThan(5);
		expect(groups.filter((g) => g.kind === 'other')).toEqual([]);
	});
});

describe('linear-phase: minimum phase', () => {
	const h = demoTaps(1, 41, 'lowpass', win);
	const v = phaseVersions(h);
	it('keeps the magnitude and moves every zero inside the unit circle', () => {
		for (const f of [0, 0.1, 0.15]) expect(magnitude(v.minimum, f)).toBeCloseTo(magnitude(h, f), 2);
		const zs = firZeros(v.minimum);
		expect(Math.max(...zs.map((z) => Math.hypot(z.re, z.im)))).toBeLessThan(1.01); // unit-circle zeros stay (approximately) on it
	});
	it('concentrates energy early; the maximum-phase version late', () => {
		const pl = partialEnergy(v.linear);
		const pm = partialEnergy(v.minimum);
		const px = partialEnergy(v.maximum);
		expect(pl[pl.length - 1]).toBeCloseTo(1, 12);
		for (let n = 0; n < h.length; n++) {
			expect(pm[n] + 1e-9).toBeGreaterThanOrEqual(pl[n]);
			expect(pl[n] + 1e-9).toBeGreaterThanOrEqual(px[n]);
		}
		expect(energyIndex(pm, 0.9)).toBeLessThan(energyIndex(pl, 0.9));
		expect(preRinging(v.minimum)).toBeLessThan(0.002);
		expect(preRinging(v.linear)).toBeGreaterThan(0.005);
		expect(preRinging(v.maximum)).toBeGreaterThan(preRinging(v.linear));
		expect(energyCentroid(v.minimum)).toBeLessThan(energyCentroid(v.linear));
		expect(energyCentroid(v.linear)).toBeCloseTo(20, 6);
	});
});
