import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	S_PRESETS,
	dampedPair,
	expand,
	makeItem,
	normalizeGain,
	planeRoots,
	toZpk,
	transferTex,
	type PzItem
} from '../src/lib/features/pole-zero/model';
import { zpk2tfAnalog } from '../src/lib/dsp/convert';
import { analogTimeResponse } from '../src/lib/dsp/time';

const TWO_PI = 2 * Math.PI;

describe('#37 transfer-function TeX for a pair with Im = 0', () => {
	it('shows a critically damped pair (ζ = 1) as a squared factor', () => {
		const [re, im] = dampedPair(1000, 1);
		expect(im).toBe(0);
		const item = makeItem('pole', re, im, true);
		expect(expand([item], 'pole')).toHaveLength(2);
		const tf = zpk2tfAnalog(toZpk(planeRoots([item], 's'), 1, 's'));
		expect(tf.a).toHaveLength(3); // second order: s² + 2ω₀s + ω₀²
		const w0 = TWO_PI * 1000;
		const tex = transferTex('s', [], [{ re: re * TWO_PI, im: 0, pair: true }], w0 * w0);
		expect(tex).toBe('H(s) = 3.948\\times10^{7}\\,\\dfrac{1}{\\left(s + 6283\\right)^{2}}');
	});

	it('squares degenerate z-plane pairs, including one at the origin', () => {
		expect(transferTex('z', [], [{ re: 0.5, im: 0, pair: true }], 1)).toBe(
			'H(z) = \\dfrac{1}{\\left(z - 0.5\\right)^{2}}'
		);
		expect(transferTex('z', [{ re: 0, im: 0, pair: true }], [], 1)).toBe('H(z) = z^{2}');
	});

	it('merges a degenerate pair with identical real roots', () => {
		const tex = transferTex(
			'z',
			[],
			[
				{ re: 0.5, im: 0, pair: false },
				{ re: 0.5, im: 0, pair: true },
				{ re: 0.5, im: 0, pair: true }
			],
			1
		);
		expect(tex).toBe('H(z) = \\dfrac{1}{\\left(z - 0.5\\right)^{5}}');
	});

	it('has the same order as the expanded roots for every factor kind', () => {
		const items: PzItem[] = [
			makeItem('zero', -1, 0, false),
			makeItem('zero', 0, 0, true),
			makeItem('pole', 0.3, 0, true),
			makeItem('pole', 0.2, 0.6, true),
			makeItem('pole', -0.4, 0, false)
		];
		const conv = (it: PzItem) => ({ re: it.re, im: it.pair ? it.im : 0, pair: it.pair });
		const tex = transferTex(
			'z',
			items.filter((it) => it.kind === 'zero').map(conv),
			items.filter((it) => it.kind === 'pole').map(conv),
			1
		);
		// degree of each side: first-order factors (power n) and z^2 quadratics
		const degree = (side: string) => {
			let d = 0;
			for (const m of side.matchAll(/\\left\(([^)]*)\\right\)(?:\^\{(\d+)\})?/g))
				d += (m[1].includes('z^2') ? 2 : 1) * Number(m[2] ?? 1);
			const bare = side.replace(/\\left\([^)]*\\right\)(\^\{\d+\})?/g, '');
			const zb = bare.match(/^z(?:\^\{(\d+)\})?$/);
			if (zb) d += Number(zb[1] ?? 1);
			return d;
		};
		const [, num, den] = tex.match(/\\dfrac\{(.*)\}\{(.*)\}$/)!;
		expect(degree(num)).toBe(expand(items, 'zero').length);
		expect(degree(den)).toBe(expand(items, 'pole').length);
	});
});

describe('#101 Resonant pair step overshoot claims', () => {
	const overshoot = (zeta: number) => {
		const preset = S_PRESETS.find((p) => p.id === 'resonant')!;
		const items = preset.build(48000);
		const [re, im] = dampedPair(1000, zeta);
		Object.assign(items[0], { re, im });
		const roots = planeRoots(items, 's');
		const { K } = normalizeGain(roots, 's', 'dc', 48000);
		const r = analogTimeResponse(toZpk(roots, K, 's'), 'step', 0.01, 4000);
		const final = r.y[r.y.length - 1];
		return Math.max(...r.y) / final - 1;
	};

	it('has ~5 % overshoot at ζ = 0.7 and none at ζ = 1', () => {
		expect(overshoot(0.7)).toBeCloseTo(Math.exp((-Math.PI * 0.7) / Math.sqrt(1 - 0.49)), 3);
		expect(overshoot(0.7)).toBeGreaterThan(0.04);
		expect(overshoot(0.7)).toBeLessThan(0.05);
		expect(overshoot(1)).toBeLessThan(1e-6);
	});

	it('the Try item starts the no-overshoot sweep at ζ = 1, not 0.7', () => {
		const page = readFileSync('src/routes/pole-zero/+page.svelte', 'utf8').replace(/\s+/g, ' ');
		expect(page).not.toMatch(/sweep ζ from 0\.7/);
		expect(page).toMatch(/sweep ζ from 1 down to 0/);
		expect(page).toMatch(/no overshoot \(ζ = 1, critically damped/);
		expect(page).toMatch(/about 5 % overshoot at ζ ≈ 0\.7/);
	});
});
