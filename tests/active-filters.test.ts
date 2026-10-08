import { describe, expect, it } from 'vitest';
import { type Complex, abs, c, div, mul, sub } from '../src/lib/dsp/complex';
import { designAnalog } from '../src/lib/dsp/design';
import { freqsZpk } from '../src/lib/dsp/response';
import {
	cascadeZpk,
	ceilToSeries,
	floorToSeries,
	seriesNeighbours,
	stepUpSeries,
	designStage,
	monteCarlo,
	stageSpecs,
	stageTf,
	tfAt,
	tfParams,
	type StageBand,
	type StageTopology,
	type Topology,
	type Values
} from '../src/lib/features/active-filters/design';

// ---------------------------------------------------------------------------
// A small modified-nodal-analysis solver (complex, ideal op-amps) used as an
// independent reference for the closed-form stage transfer functions.
// ---------------------------------------------------------------------------

type El = { kind: 'R' | 'C'; a: string; b: string; v: number };
type OpAmp = { plus: string; minus: string; out: string };

function solveComplex(A: Complex[][], b: Complex[]): Complex[] {
	const n = b.length;
	const M = A.map((r, i) => [...r, b[i]]);
	for (let col = 0; col < n; col++) {
		let piv = col;
		for (let r = col + 1; r < n; r++) if (abs(M[r][col]) > abs(M[piv][col])) piv = r;
		[M[col], M[piv]] = [M[piv], M[col]];
		for (let r = 0; r < n; r++) {
			if (r === col) continue;
			const f = div(M[r][col], M[col][col]);
			for (let k = col; k <= n; k++) M[r][k] = sub(M[r][k], mul(f, M[col][k]));
		}
	}
	return M.map((r, i) => div(r[n], r[i]));
}

/** v(out)/v(in) of a netlist driven by an ideal 1 V source at node "in". */
function mna(els: El[], amps: OpAmp[], w: number): Complex {
	const nodes = [...new Set(els.flatMap((e) => [e.a, e.b]).concat(amps.flatMap((o) => [o.plus, o.minus, o.out])))].filter((n) => n !== '0');
	const idx = new Map(nodes.map((n, i) => [n, i]));
	const N = nodes.length + 1 + amps.length; // + source current + op-amp output currents
	const A: Complex[][] = Array.from({ length: N }, () => Array.from({ length: N }, () => c(0)));
	const b: Complex[] = Array.from({ length: N }, () => c(0));
	const addA = (r: number, col: number, v: Complex) => (A[r][col] = { re: A[r][col].re + v.re, im: A[r][col].im + v.im });
	for (const e of els) {
		if (!Number.isFinite(e.v)) continue; // open circuit
		const y = e.kind === 'R' ? c(1 / e.v) : c(0, w * e.v);
		const ia = idx.get(e.a);
		const ib = idx.get(e.b);
		if (ia !== undefined) addA(ia, ia, y);
		if (ib !== undefined) addA(ib, ib, y);
		if (ia !== undefined && ib !== undefined) {
			addA(ia, ib, { re: -y.re, im: -y.im });
			addA(ib, ia, { re: -y.re, im: -y.im });
		}
	}
	// ideal voltage source at "in": current variable k = nodes.length
	const ks = nodes.length;
	const iin = idx.get('in')!;
	addA(iin, ks, c(1));
	addA(ks, iin, c(1));
	b[ks] = c(1);
	amps.forEach((o, j) => {
		const kj = nodes.length + 1 + j;
		addA(idx.get(o.out)!, kj, c(1)); // output current injected at out
		const ip = idx.get(o.plus);
		const im = idx.get(o.minus);
		if (ip !== undefined) addA(kj, ip, c(1));
		if (im !== undefined) addA(kj, im, c(-1));
	});
	const x = solveComplex(A, b);
	return x[idx.get('out')!];
}

function netlist(topology: StageTopology, band: StageBand, v: Values): { els: El[]; amps: OpAmp[] } {
	const R = (name: string, a: string, b: string): El => ({ kind: 'R', a, b, v: v[name] });
	const C = (name: string, a: string, b: string): El => ({ kind: 'C', a, b, v: v[name] });
	switch (topology) {
		case 'rc1':
			return {
				els: band === 'lowpass' ? [R('R1', 'in', 'P'), C('C1', 'P', '0')] : [C('C1', 'in', 'P'), R('R1', 'P', '0')],
				amps: [{ plus: 'P', minus: 'out', out: 'out' }]
			};
		case 'sk-unity':
		case 'sk-equal': {
			const els =
				band === 'lowpass'
					? [R('R1', 'in', 'A'), R('R2', 'A', 'B'), C('C1', 'A', 'out'), C('C2', 'B', '0')]
					: [C('C1', 'in', 'A'), C('C2', 'A', 'B'), R('R1', 'A', 'out'), R('R2', 'B', '0')];
			if (topology === 'sk-equal') {
				els.push(R('R3', 'N', '0'), R('R4', 'N', 'out'));
				return { els, amps: [{ plus: 'B', minus: 'N', out: 'out' }] };
			}
			return { els, amps: [{ plus: 'B', minus: 'out', out: 'out' }] };
		}
		case 'mfb':
			return {
				els:
					band === 'lowpass'
						? [R('R1', 'in', 'A'), R('R2', 'A', 'out'), R('R3', 'A', 'B'), C('C1', 'A', '0'), C('C2', 'B', 'out')]
						: [C('C1', 'in', 'A'), C('C2', 'A', 'out'), C('C3', 'A', 'B'), R('R1', 'A', '0'), R('R2', 'B', 'out')],
				amps: [{ plus: '0', minus: 'B', out: 'out' }]
			};
		case 'mfb-bp':
			return {
				els: [R('R1', 'in', 'A'), C('C2', 'A', 'out'), C('C1', 'A', 'B'), R('R3', 'A', '0'), R('R2', 'B', 'out')],
				amps: [{ plus: '0', minus: 'B', out: 'out' }]
			};
	}
}

const rnd = (() => {
	let s = 12345;
	return () => {
		s = (s * 1103515245 + 12345) % 2147483648;
		return s / 2147483648;
	};
})();
const logRand = (lo: number, hi: number) => lo * Math.pow(hi / lo, rnd());

const combos: [StageTopology, StageBand][] = [
	['rc1', 'lowpass'],
	['rc1', 'highpass'],
	['sk-unity', 'lowpass'],
	['sk-unity', 'highpass'],
	['sk-equal', 'lowpass'],
	['sk-equal', 'highpass'],
	['mfb', 'lowpass'],
	['mfb', 'highpass'],
	['mfb-bp', 'bandpass']
];

describe('stage transfer functions agree with nodal analysis', () => {
	for (const [topo, band] of combos) {
		it(`${topo} ${band}`, () => {
			for (let trial = 0; trial < 6; trial++) {
				const v: Values = {};
				for (const k of ['R1', 'R2', 'R3', 'R4']) v[k] = logRand(1e3, 1e5);
				for (const k of ['C1', 'C2', 'C3']) v[k] = logRand(1e-9, 1e-7);
				if (topo === 'mfb-bp' && trial === 5) v.R3 = Infinity;
				const tf = stageTf(topo, band, v);
				for (const w of [10, 1e3, 3e4, 1e6]) {
					const h = tfAt(tf, w);
					const { els, amps } = netlist(topo, band, v);
					const ref = mna(els, amps, w);
					expect(abs(sub(h, ref)) / Math.max(abs(ref), 1e-12)).toBeLessThan(1e-9);
				}
			}
		});
	}
});

describe('design equations reproduce the target w0 and Q exactly', () => {
	const topos: Topology[] = ['sk-unity', 'sk-equal', 'mfb'];
	for (const band of ['lowpass', 'highpass', 'bandpass'] as StageBand[]) {
		for (const topology of topos) {
			if (band === 'bandpass' && topology !== 'mfb') continue;
			it(`${band} / ${topology}`, () => {
				for (let trial = 0; trial < 40; trial++) {
					const w0 = 2 * Math.PI * logRand(10, 1e5);
					const q = topology === 'sk-equal' ? logRand(0.5, 20) : logRand(0.2, 25);
					const gain = logRand(0.2, 10);
					for (const cSeries of ['exact', 'E12'] as const) {
						const st = designStage({ band, order: 2, w0, q }, { topology, gain, baseC: logRand(1e-10, 1e-6), rSeries: 'exact', cSeries });
						const p = tfParams(st.exactTf, band);
						expect(p.w0 / w0).toBeCloseTo(1, 9);
						expect(p.q / q).toBeCloseTo(1, 8);
						// with exact parts the realised and exact transfer functions coincide
						expect(st.realized.den[1] / st.exactTf.den[1]).toBeCloseTo(1, 12);
						// the nominal gain matches the built circuit — except MFB HP, whose gain
						// is the capacitor ratio −C1/C2 and moves when C2 is rounded
						if (topology === 'mfb' && band === 'highpass') {
							const cv = (r: string) => st.parts.find((pt) => pt.role === r)!.value;
							expect(p.gain / (-cv('C1') / cv('C2'))).toBeCloseTo(1, 9);
						} else expect(p.gain / st.gain).toBeCloseTo(1, 9);
						if (band === 'bandpass') expect(Math.abs(st.gain)).toBeLessThanOrEqual(Math.min(gain, 2 * q * q) * (1 + 1e-9));
						else if (topology === 'mfb' && cSeries === 'exact') expect(st.gain).toBeCloseTo(-gain, 9);
						else if (topology === 'sk-equal') expect(st.gain).toBeCloseTo(3 - 1 / q, 9);
						// and the circuit, solved numerically, agrees
						const vals = Object.fromEntries(st.parts.map((pt) => [pt.role, pt.exact]));
						const { els, amps } = netlist(st.topology, band, vals);
						const ratio0 = div(tfAt(st.exactTf, w0), tfAt(st.target, w0));
						for (const m of [0.3, 1, 2.7]) {
							const ref = mna(els, amps, w0 * m);
							const h = tfAt(st.exactTf, w0 * m);
							expect(abs(sub(h, ref)) / abs(ref)).toBeLessThan(1e-7);
							// same shape as the target (identical up to a gain constant)
							const ratio = div(h, tfAt(st.target, w0 * m));
							expect(abs(sub(ratio, ratio0)) / abs(ratio0)).toBeLessThan(1e-7);
						}
						if (!(topology === 'mfb' && band === 'highpass' && cSeries !== 'exact')) {
							expect(abs(sub(ratio0, c(1)))).toBeLessThan(1e-8);
						}
					}
				}
			});
		}
	}

	it('first-order buffered RC stages', () => {
		for (const band of ['lowpass', 'highpass'] as StageBand[]) {
			const st = designStage({ band, order: 1, w0: 6283.185, q: 0.5 }, { topology: 'mfb', gain: 3, baseC: 10e-9, rSeries: 'exact', cSeries: 'exact' });
			expect(st.topology).toBe('rc1');
			expect(tfParams(st.exactTf, band).w0).toBeCloseTo(6283.185, 6);
			expect(st.gain).toBe(1);
		}
	});

	it('MFB band-pass gain is capped at 2Q² with R3 open', () => {
		const st = designStage({ band: 'bandpass', order: 2, w0: 1e4, q: 0.6 }, { topology: 'mfb', gain: 5, baseC: 10e-9, rSeries: 'exact', cSeries: 'exact' });
		expect(st.gain).toBeCloseTo(-2 * 0.36, 12);
		expect(st.parts.find((p) => p.role === 'R3')!.exact).toBe(Infinity);
		expect(tfParams(st.exactTf, 'bandpass').q).toBeCloseTo(0.6, 12);
	});

	it('equal-component Sallen–Key falls back to unity gain for Q < 0.5', () => {
		const st = designStage({ band: 'lowpass', order: 2, w0: 1e4, q: 0.4 }, { topology: 'sk-equal', gain: 1, baseC: 10e-9, rSeries: 'exact', cSeries: 'exact' });
		expect(st.topology).toBe('sk-unity');
		expect(tfParams(st.exactTf, 'lowpass').q).toBeCloseTo(0.4, 10);
	});
});

describe('full filters', () => {
	for (const band of ['lowpass', 'highpass', 'bandpass'] as const) {
		for (const N of [1, 2, 3, 4, 5]) {
			it(`Butterworth ${band} N=${N}: exact cascade equals the designed filter`, () => {
				const zpk = designAnalog({ family: 'butter', band, order: N, f1: 1000, f2: 3000 });
				const specs = stageSpecs(zpk, band);
				expect(specs.reduce((s, x) => s + x.order, 0)).toBe(zpk.p.length);
				const stages = specs.map((s) => designStage(s, { topology: 'sk-unity', gain: 1, baseC: 10e-9, rSeries: 'exact', cSeries: 'exact' }));
				const casc = cascadeZpk(stages.map((s) => s.exactTf));
				// compare normalised magnitudes
				const fRef = band === 'lowpass' ? 1 : band === 'highpass' ? 1e7 : Math.sqrt(1000 * 3000) * 2 * Math.PI;
				const g1 = abs(freqsZpk(zpk, [fRef])[0]);
				const g2 = abs(freqsZpk(casc, [fRef])[0]);
				for (const f of [100, 700, 1000, 1700, 3000, 9000]) {
					const w = 2 * Math.PI * f;
					expect(abs(freqsZpk(casc, [w])[0]) / g2).toBeCloseTo(abs(freqsZpk(zpk, [w])[0]) / g1, 9);
				}
			});
		}
	}

	it('cascadeZpk matches the product of stage responses', () => {
		const specs = stageSpecs(designAnalog({ family: 'cheby1', band: 'lowpass', order: 5, f1: 2000, rp: 1 }), 'lowpass');
		const stages = specs.map((s) => designStage(s, { topology: 'mfb', gain: 2, baseC: 4.7e-9, rSeries: 'E24', cSeries: 'E12' }));
		const casc = cascadeZpk(stages.map((s) => s.realized));
		for (const w of [100, 5000, 12566, 40000]) {
			let prod: Complex = c(1);
			for (const s of stages) prod = mul(prod, tfAt(s.realized, w));
			expect(abs(sub(freqsZpk(casc, [w])[0], prod)) / abs(prod)).toBeLessThan(1e-9);
		}
	});
});

describe('helpers', () => {
	it('ceilToSeries returns the next preferred value', () => {
		expect(ceilToSeries(4.71e-9, 'E12')).toBeCloseTo(5.6e-9, 20);
		expect(ceilToSeries(4.7e-9, 'E12')).toBeCloseTo(4.7e-9, 20);
		expect(ceilToSeries(9.5e-9, 'E6')).toBeCloseTo(1e-8, 20);
		expect(ceilToSeries(123, 'exact')).toBe(123);
	});

	it('Monte-Carlo is deterministic and spreads with tolerance', () => {
		const specs = stageSpecs(designAnalog({ family: 'butter', band: 'lowpass', order: 4, f1: 1000 }), 'lowpass');
		const stages = specs.map((s) => designStage(s, { topology: 'sk-unity', gain: 1, baseC: 10e-9, rSeries: 'E24', cSeries: 'E12' }));
		const f = [100, 1000, 3000];
		const a = monteCarlo(stages, 0.05, f, 20);
		const b = monteCarlo(stages, 0.05, f, 20);
		expect(a).toEqual(b);
		const spread = (runs: number[][]) => Math.max(...runs.map((r) => r[1])) - Math.min(...runs.map((r) => r[1]));
		expect(spread(monteCarlo(stages, 0.01, f, 20))).toBeLessThan(spread(a));
	});
});

describe('standard-value optimiser', () => {
	it('is never worse than plain rounding and usually much better', () => {
		let better = 0;
		const err = (st: ReturnType<typeof designStage>) => {
			const p = tfParams(st.realized, st.spec.band);
			return (
				Math.abs(Math.log(p.w0 / st.spec.w0)) +
				(st.spec.order === 2 ? Math.abs(Math.log(p.q / st.spec.q)) : 0) +
				0.25 * Math.abs(Math.log(Math.abs(p.gain / st.gain)))
			);
		};
		for (const topology of ['sk-unity', 'sk-equal', 'mfb'] as Topology[]) {
			for (const band of ['lowpass', 'highpass', 'bandpass'] as StageBand[]) {
				for (let t = 0; t < 30; t++) {
					const spec = { band, order: 2 as const, w0: 2 * Math.PI * logRand(20, 5e4), q: logRand(0.55, 8) };
					const o = { topology, gain: logRand(0.5, 4), baseC: logRand(1e-9, 1e-7), rSeries: 'E24' as const, cSeries: 'E12' as const };
					const plain = designStage(spec, o);
					const opt = designStage(spec, { ...o, optimize: true });
					expect(err(opt)).toBeLessThanOrEqual(err(plain) + 1e-12);
					if (err(opt) < err(plain) * 0.7) better++;
					// the exact design still hits the target for the chosen capacitors
					expect(tfParams(opt.exactTf, band).w0 / spec.w0).toBeCloseTo(1, 9);
					expect(tfParams(opt.exactTf, band).q / spec.q).toBeCloseTo(1, 8);
				}
			}
		}
		expect(better).toBeGreaterThan(50);
	});

	it('series helpers bracket values', () => {
		expect(floorToSeries(4.69e3, 'E12')).toBe(3900);
		expect(floorToSeries(4.7e3, 'E12')).toBe(4700);
		expect(seriesNeighbours(5e3, 'E24')).toEqual([4700, 5100]);
		expect(stepUpSeries(4.5e-9, 'E6', 0)).toBeCloseTo(4.7e-9, 20);
		expect(stepUpSeries(4.5e-9, 'E6', 2)).toBeCloseTo(1e-8, 20);
	});
});
