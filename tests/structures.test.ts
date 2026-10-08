import { describe, expect, it } from 'vitest';
import { sosfilt, lfilter } from '../src/lib/dsp/time';
import { designDigital } from '../src/lib/dsp/design';
import { sos2tf, zpk2sos, tf2zpk } from '../src/lib/dsp/convert';
import { biquad, BIQUAD_TYPES } from '../src/lib/dsp/biquad';
import {
	cascade,
	df1,
	df2,
	firDirect,
	firLattice,
	firLatticeProc,
	firTransposed,
	latticeLadder,
	latticeLadderProc,
	normalizeTf,
	parallel,
	parallelForm,
	reflectionCoefficients,
	runProcessor,
	tdf2,
	trace
} from '../src/lib/features/structures/realize';
import { buildStructures } from '../src/lib/features/structures/structures';
import { PRESETS, presetFilter } from '../src/lib/features/structures/presets';

const impulse = (n: number) => {
	const x = new Array(n).fill(0);
	x[0] = 1;
	return x;
};

function maxDiff(a: ArrayLike<number>, b: ArrayLike<number>) {
	let m = 0;
	for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
	return m;
}

// a deterministic "random" input
function noise(n: number, seed = 1) {
	let s = seed;
	return Array.from({ length: n }, () => {
		s = (s * 1103515245 + 12345) % 2147483648;
		return s / 1073741824 - 1;
	});
}

const iirCases = [
	{
		name: 'butter4',
		sos: designDigital({ family: 'butter', band: 'lowpass', order: 4, f1: 2000, fs: 48000 }).sos
	},
	{
		name: 'ellip3',
		sos: designDigital({
			family: 'ellip',
			band: 'lowpass',
			order: 3,
			f1: 3000,
			rp: 1,
			rs: 40,
			fs: 48000
		}).sos
	},
	{
		name: 'cheby1 bp6',
		sos: designDigital({
			family: 'cheby1',
			band: 'bandpass',
			order: 3,
			f1: 1000,
			f2: 4000,
			rp: 0.5,
			fs: 48000
		}).sos
	},
	{
		name: 'ellip hp5',
		sos: designDigital({
			family: 'ellip',
			band: 'highpass',
			order: 5,
			f1: 5000,
			rp: 0.5,
			rs: 50,
			fs: 48000
		}).sos
	},
	{ name: 'peaking', sos: [biquad({ type: 'peaking', f0: 1000, fs: 48000, q: 2, gainDb: 6 })] },
	// numerator longer than denominator (direct terms in the parallel form)
	{ name: 'b longer', ba: { b: [0.3, 0.2, -0.1, 0.05, 0.02], a: [1, -0.6, 0.3] } }
];

describe('IIR structures reproduce lfilter / sosfilt', () => {
	for (const c of iirCases) {
		it(c.name, () => {
			const tf = c.ba ?? sos2tf(c.sos!);
			const { b, a } = normalizeTf(tf.b, tf.a);
			const x = [...impulse(1), ...noise(299)];
			const ref = c.sos ? Array.from(sosfilt(c.sos, x)) : Array.from(lfilter(b, a, x));
			const scale = Math.max(...ref.map(Math.abs));
			const tol = 1e-9 * scale; // direct forms of a 6th-order band-pass are only good to ~1e-11
			expect(maxDiff(runProcessor(df1(b, a), x), ref)).toBeLessThan(tol);
			expect(maxDiff(runProcessor(df2(b, a), x), ref)).toBeLessThan(tol);
			expect(maxDiff(runProcessor(tdf2(b, a), x), ref)).toBeLessThan(tol);
			expect(maxDiff(runProcessor(parallel(parallelForm(b, a)), x), ref)).toBeLessThan(
				1e-9 * scale
			);
			expect(maxDiff(runProcessor(latticeLadderProc(latticeLadder(b, a)), x), ref)).toBeLessThan(
				1e-9 * scale
			);
			const sos = c.sos ?? zpk2sos(tf2zpk({ b, a }));
			expect(maxDiff(runProcessor(cascade(sos), x), ref)).toBeLessThan(1e-9 * scale);
		});
	}
	it('every RBJ biquad type', () => {
		for (const t of BIQUAD_TYPES) {
			const row = biquad({ type: t.id, f0: 2500, fs: 48000, q: 0.9, gainDb: -8 });
			const { b, a } = normalizeTf(row.slice(0, 3), row.slice(3, 6));
			const x = impulse(200);
			const ref = Array.from(sosfilt([row], x));
			for (const p of [
				df1(b, a),
				df2(b, a),
				tdf2(b, a),
				cascade([row]),
				latticeLadderProc(latticeLadder(b, a)),
				parallel(parallelForm(b, a))
			])
				expect(maxDiff(runProcessor(p, x), ref)).toBeLessThan(1e-10);
		}
	});
});

describe('lattice', () => {
	it('reflection coefficients detect stability', () => {
		const stable = designDigital({
			family: 'ellip',
			band: 'lowpass',
			order: 6,
			f1: 2000,
			rp: 1,
			rs: 60,
			fs: 48000
		}).sos;
		const { a } = sos2tf(stable);
		expect(reflectionCoefficients(a).k.every((k) => Math.abs(k) < 1)).toBe(true);
		const unstable = reflectionCoefficients([1, -1.6, -0.81]).k;
		expect(unstable.some((k) => Math.abs(k) >= 1)).toBe(true);
	});
	it('first-order case: k₁ = a₁', () => {
		expect(reflectionCoefficients([1, 0.5]).k).toEqual([0.5]);
	});
	it('FIR lattice reproduces the taps', () => {
		const h = [0.5, 0.3, -0.2, 0.1, 0.05];
		const fl = firLattice(h);
		const y = runProcessor(firLatticeProc(fl), impulse(10));
		expect(maxDiff(y.slice(0, 5), h)).toBeLessThan(1e-14);
		expect(maxDiff(y.slice(5), [0, 0, 0, 0, 0])).toBeLessThan(1e-14);
	});
	it('a symmetric FIR has |k_M| = 1 and no lattice', () => {
		expect(() => firLattice([0.25, 0.5, 0.25])).toThrow(/= 1/);
	});
});

describe('FIR structures', () => {
	it('direct and transposed forms equal the taps', () => {
		const h = [0.1, -0.4, 0.7, 0.2, 0.05, -0.01];
		const x = noise(100, 7);
		const ref = Array.from(lfilter(h, [1], x));
		expect(maxDiff(runProcessor(firDirect(h), x), ref)).toBeLessThan(1e-14);
		expect(maxDiff(runProcessor(firTransposed(h), x), ref)).toBeLessThan(1e-14);
	});
});

describe('buildStructures on every preset', () => {
	const bq = { type: 'peaking' as const, f0: 1000, q: 1, gainDb: 6 };
	for (const p of PRESETS) {
		it(p.id, () => {
			const f = presetFilter(p.id, bq);
			const list = buildStructures(f.b, f.a, f.sos);
			const N = 200;
			const ref = Array.from(sosfilt(f.sos, impulse(N)));
			const applicable = list.filter((s) => s.applicable);
			expect(applicable.length).toBeGreaterThanOrEqual(3);
			for (const s of applicable) {
				const y = runProcessor(s.make!(), impulse(N));
				expect(maxDiff(y, ref)).toBeLessThan(1e-12);
				// the diagram and the step-through work
				const d = s.diagram!();
				expect(d.width).toBeGreaterThan(100);
				expect(d.els.filter((e) => e.t === 'delay').length).toBe(s.ops!.delay);
				const rows = trace(s.make!(), impulse(9));
				expect(rows[0].state.length).toBe(s.stateLabels.length);
				expect(s.code).toContain('process(float x)');
			}
			if (p.id === 'fir7') expect(list.find((s) => s.id === 'lattice')!.applicable).toBe(false);
			if (p.id === 'firmin') expect(list.find((s) => s.id === 'lattice')!.latticeStable).toBe(true);
		});
	}
});
