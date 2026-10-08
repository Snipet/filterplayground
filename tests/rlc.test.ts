import { describe, expect, it } from 'vitest';
import { type Complex, abs, add, c, div, mul } from '../src/lib/dsp/complex';
import { freqsZpk } from '../src/lib/dsp/response';
import { analogTimeResponse } from '../src/lib/dsp/time';
import {
	CIRCUITS,
	bandEdges,
	circuitZpk,
	dampingClass,
	secondOrder,
	secondOrderPoles,
	solveFirstOrder,
	solveSecondOrder,
	stateZpks,
	texNum,
	type CircuitId
} from '../src/lib/features/rlc/circuits';

/** v_out / v_in computed directly from the impedance divider at s = jω. */
function divider(id: CircuitId, R: number, L: number, C: number, w: number): Complex {
	const s = c(0, w);
	const zR = c(R);
	const zL = mul(s, c(L));
	const zC = div(c(1), mul(s, c(C)));
	const par = (a: Complex, b: Complex) => div(mul(a, b), add(a, b));
	const vd = (shunt: Complex, ser: Complex) => div(shunt, add(ser, shunt));
	switch (id) {
		case 'rc-lp':
			return vd(zC, zR);
		case 'rc-hp':
			return vd(zR, zC);
		case 'rl-lp':
			return vd(zR, zL);
		case 'rl-hp':
			return vd(zL, zR);
		case 'rlc-c':
			return vd(zC, add(zR, zL));
		case 'rlc-r':
			return vd(zR, add(zL, zC));
		case 'rlc-l':
			return vd(zL, add(zR, zC));
		case 'rlc-lc':
			return vd(add(zL, zC), zR);
		case 'tank':
			return vd(par(zL, zC), zR);
	}
}

const cases: [number, number, number][] = [
	[470, 0.1, 100e-9], // underdamped
	[2000, 0.1, 100e-9], // Q = 0.5 → critical
	[1e5, 1e-3, 1e-6], // overdamped
	[10, 1e-6, 1e-12] // RF values
];

describe('RLC circuits', () => {
	for (const info of CIRCUITS) {
		it(`${info.id}: ZPK matches the impedance divider`, () => {
			for (const [R, L, C] of cases) {
				const zpk = circuitZpk(info.id, R, L, C);
				const w0 =
					info.order === 2 ? 1 / Math.sqrt(L * C) : info.family === 'rl' ? R / L : 1 / (R * C);
				for (const m of [0.013, 0.31, 0.97, 1.0001, 3.3, 77]) {
					const w = w0 * m;
					const h = freqsZpk(zpk, [w])[0];
					const ref = divider(info.id, R, L, C, w);
					expect(abs({ re: h.re - ref.re, im: h.im - ref.im })).toBeLessThan(
						1e-9 * Math.max(1, abs(ref))
					);
				}
			}
		});
	}

	it('second-order poles have the right sum and product', () => {
		for (const zeta of [0.01, 0.5, 0.999, 1, 1.001, 3, 1e4]) {
			const w0 = 1234;
			const [a, b] = secondOrderPoles(w0, zeta);
			expect((a.re + b.re) / (-2 * zeta * w0)).toBeCloseTo(1, 10);
			const prod = a.re * b.re - a.im * b.im;
			expect(prod / (w0 * w0)).toBeCloseTo(1, 10);
		}
	});

	it('Q and damping: series falls with R, parallel rises with R', () => {
		const s = secondOrder('rlc-c', 100, 0.1, 100e-9);
		expect(s.q).toBeCloseTo(10, 12);
		expect(s.zeta).toBeCloseTo(0.05, 12);
		const p = secondOrder('tank', 100, 0.1, 100e-9);
		expect(p.q).toBeCloseTo(0.1, 12);
		expect(dampingClass(0.5)).toBe('underdamped');
		expect(dampingClass(1)).toBe('critical');
		expect(dampingClass(2)).toBe('overdamped');
	});

	it('band edges sit at −3 dB of the band-pass and are f0/Q apart', () => {
		const [R, L, C] = [330, 0.1, 100e-9];
		const { w0, q } = secondOrder('rlc-r', R, L, C);
		const [lo, hi] = bandEdges(w0, q);
		expect((hi - lo) / (w0 / q)).toBeCloseTo(1, 12);
		expect(Math.sqrt(lo * hi) / w0).toBeCloseTo(1, 12);
		const zpk = circuitZpk('rlc-r', R, L, C);
		for (const w of [lo, hi]) expect(abs(freqsZpk(zpk, [w])[0])).toBeCloseTo(Math.SQRT1_2, 10);
		expect(abs(freqsZpk(zpk, [w0])[0])).toBeCloseTo(1, 12);
	});

	it('the notch is exactly zero at f0', () => {
		const zpk = circuitZpk('rlc-lc', 470, 0.1, 100e-9);
		const w0 = 1 / Math.sqrt(0.1 * 100e-9);
		expect(abs(freqsZpk(zpk, [w0])[0])).toBeLessThan(1e-9);
	});

	it('first-order step response passes 63.2 % at t = τ', () => {
		const R = 1e3;
		const C = 1e-6;
		const tau = R * C;
		const r = analogTimeResponse(circuitZpk('rc-lp', R, 0, C), 'step', 5 * tau, 501);
		expect(r.y[100]).toBeCloseTo(1 - Math.exp(-1), 8);
	});

	it('series RLC: half the delivered energy is stored in C at the end', () => {
		const [R, L, C] = [470, 0.1, 100e-9];
		const z = stateZpks('rlc-c', R, L, C);
		const vc = analogTimeResponse(z.vC, 'step', 0.02, 4001);
		const il = analogTimeResponse(z.iL, 'step', 0.02, 4001);
		expect(vc.y[vc.y.length - 1]).toBeCloseTo(1, 6);
		let eR = 0;
		for (let k = 1; k < il.y.length; k++)
			eR += 0.5 * R * (il.y[k] ** 2 + il.y[k - 1] ** 2) * (il.t[k] - il.t[k - 1]);
		expect(eR / (0.5 * C)).toBeCloseTo(1, 3);
		// i = C dv/dt
		const k = 300;
		const dv = (vc.y[k + 1] - vc.y[k - 1]) / (vc.t[k + 1] - vc.t[k - 1]);
		expect((C * dv) / il.y[k]).toBeCloseTo(1, 3);
	});

	it('solvers reproduce their targets', () => {
		for (const known of ['R', 'C'] as const) {
			const v = solveFirstOrder('rc', 1590, known, known === 'R' ? 4700 : 22e-9, {
				R: 1,
				L: 1,
				C: 1
			});
			expect(1 / (2 * Math.PI * v.R * v.C)).toBeCloseTo(1590, 8);
		}
		for (const known of ['R', 'L'] as const) {
			const v = solveFirstOrder('rl', 1590, known, known === 'R' ? 4700 : 0.01, {
				R: 1,
				L: 1,
				C: 1
			});
			expect(v.R / (2 * Math.PI * v.L)).toBeCloseTo(1590, 8);
		}
		for (const fam of ['series', 'parallel'] as const) {
			for (const known of ['R', 'L', 'C'] as const) {
				const value = { R: 330, L: 0.047, C: 220e-9 }[known];
				const v = solveSecondOrder(fam, 2500, 3.3, known, value);
				expect(v[known]).toBe(value);
				const s = secondOrder(fam === 'series' ? 'rlc-c' : 'tank', v.R, v.L, v.C);
				expect(s.w0 / (2 * Math.PI)).toBeCloseTo(2500, 8);
				expect(s.q).toBeCloseTo(3.3, 10);
			}
		}
	});

	it('texNum formats magnitudes', () => {
		expect(texNum(4700)).toBe('4700');
		expect(texNum(1e8)).toBe('10^{8}');
		expect(texNum(2.5e-6)).toBe('2.5\\times 10^{-6}');
	});
});
