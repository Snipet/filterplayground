import { describe, expect, it } from 'vitest';
import {
	completeConjugates,
	parseComplexList,
	parseNumbers,
	parseScalar,
	parseSos
} from '../src/lib/features/tf-analyzer/parse';
import {
	impulseFromResidues,
	evalAnalogPfe,
	polydiv,
	residue,
	residuez
} from '../src/lib/features/tf-analyzer/pfe';
import {
	analyze,
	buildModel,
	linearPhaseOf,
	rootRows
} from '../src/lib/features/tf-analyzer/analyze';
import { EXAMPLES } from '../src/lib/features/tf-analyzer/examples';
import { lfilter } from '../src/lib/dsp/time';
import { freqsTf } from '../src/lib/dsp/response';
import { designDigital } from '../src/lib/dsp/design';
import { sos2tf } from '../src/lib/dsp/convert';

const ok = <T>(r: { ok: true; value: T } | { ok: false }) => {
	expect(r.ok).toBe(true);
	return (r as { value: T }).value;
};

describe('parseNumbers', () => {
	it('accepts commas, whitespace, newlines and brackets', () => {
		expect(ok(parseNumbers('1, 2, 3'))).toEqual([1, 2, 3]);
		expect(ok(parseNumbers('1 2\t3\n4'))).toEqual([1, 2, 3, 4]);
		expect(ok(parseNumbers('[1, -0.5, 0.25]'))).toEqual([1, -0.5, 0.25]);
		expect(ok(parseNumbers('(1; 2; 3)'))).toEqual([1, 2, 3]);
		expect(ok(parseNumbers('{1.0f, 2}'.replace('f', '')))).toEqual([1, 2]);
	});
	it('accepts scientific notation, fractions, unicode minus and lone signs', () => {
		expect(ok(parseNumbers('1e-3, 2.5E+2, -.5, +4, 1/4'))).toEqual([1e-3, 250, -0.5, 4, 0.25]);
		expect(ok(parseNumbers('−0.5'))).toEqual([-0.5]);
		expect(ok(parseNumbers('1 - 2'))).toEqual([1, -2]);
	});
	it('strips Python / MATLAB / C wrappers and comments', () => {
		expect(ok(parseNumbers('b = np.array([1, 2, 1])  # numerator'))).toEqual([1, 2, 1]);
		expect(ok(parseNumbers('a = [1 -1.6 0.81]; % denominator'))).toEqual([1, -1.6, 0.81]);
		expect(ok(parseNumbers('static const double b[3] = { 1, 2, 1 }; // taps'))).toEqual([1, 2, 1]);
		expect(ok(parseNumbers('[1, 2, ...\n 3]'))).toEqual([1, 2, 3]);
		expect(ok(parseNumbers('numpy.asarray([1, 2], dtype=float)'))).toEqual([1, 2]);
	});
	it('reports the offending token with line and column', () => {
		const r = parseNumbers('1, 2,\n 3, 0.3k, 5');
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.error.token).toBe('0.3k');
			expect(r.error.line).toBe(2);
			expect(r.error.col).toBe(5);
		}
		const r2 = parseNumbers('1, 2j');
		expect(r2.ok).toBe(false);
		if (!r2.ok) expect(r2.error.message).toMatch(/complex/);
		const r3 = parseNumbers('1, inf');
		expect(r3.ok).toBe(false);
		const r4 = parseNumbers('  ');
		expect(r4.ok).toBe(false);
	});
	it('parses scalars', () => {
		expect(ok(parseScalar('k = 0.5'))).toBe(0.5);
		expect(parseScalar('1 2').ok).toBe(false);
	});
});

describe('parseSos', () => {
	it('reads rows split by newlines, semicolons or nested brackets', () => {
		const want = [
			[1, 2, 1, 1, -0.5, 0.25],
			[1, 0, -1, 1, 0.1, 0.2]
		];
		expect(ok(parseSos('1 2 1 1 -0.5 0.25\n1 0 -1 1 0.1 0.2'))).toEqual(want);
		expect(ok(parseSos('[1 2 1 1 -0.5 0.25; 1 0 -1 1 0.1 0.2]'))).toEqual(want);
		expect(ok(parseSos('[[1, 2, 1, 1, -0.5, 0.25], [1, 0, -1, 1, 0.1, 0.2]]'))).toEqual(want);
		expect(
			ok(parseSos('sos = np.array([\n  [1, 2, 1, 1, -0.5, 0.25],\n  [1, 0, -1, 1, 0.1, 0.2],\n])'))
		).toEqual(want);
	});
	it('splits one flat row whose length is a multiple of 6', () => {
		const r = parseSos('1,2,1,1,-0.5,0.25,1,0,-1,1,0.1,0.2');
		expect(ok(r)).toHaveLength(2);
	});
	it('rejects rows of the wrong length', () => {
		const r = parseSos('1 2 1 1 -0.5\n1 0 -1 1 0.1 0.2');
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.message).toMatch(/Section 1 has 5 numbers/);
	});
});

describe('parseComplexList', () => {
	const near = (a: { re: number; im: number }, re: number, im: number) => {
		expect(a.re).toBeCloseTo(re, 12);
		expect(a.im).toBeCloseTo(im, 12);
	};
	it('reads Python, MATLAB and plain notations', () => {
		const v = ok(parseComplexList('0.5+0.3j, 1-2i, -3, 2j, -j, 1+j, 2*i, 1e-1-1e-1j'));
		near(v[0], 0.5, 0.3);
		near(v[1], 1, -2);
		near(v[2], -3, 0);
		near(v[3], 0, 2);
		near(v[4], 0, -1);
		near(v[5], 1, 1);
		near(v[6], 0, 2);
		near(v[7], 0.1, -0.1);
	});
	it('handles spaces inside a number and one value per line', () => {
		const v = ok(parseComplexList('0.5 + 0.3j\n0.5 - 0.3j\n-0.2'));
		expect(v).toHaveLength(3);
		near(v[1], 0.5, -0.3);
		const w = ok(parseComplexList('1 -2j'));
		expect(w).toHaveLength(1);
		const x = ok(parseComplexList('0.5 -0.2'));
		expect(x).toHaveLength(2);
	});
	it('expands ± and polar notation', () => {
		const v = ok(parseComplexList('0.5±0.3j'));
		expect(v).toHaveLength(2);
		near(v[1], 0.5, -0.3);
		const p = ok(parseComplexList('0.9∠30°, 1∠±90'));
		near(p[0], 0.9 * Math.cos(Math.PI / 6), 0.9 * Math.sin(Math.PI / 6));
		expect(p).toHaveLength(3);
		near(p[2], 0, -1);
		const r = ok(parseComplexList('1∠1.5rad'));
		near(r[0], Math.cos(1.5), Math.sin(1.5));
	});
	it('accepts an empty list and Python complex arrays', () => {
		expect(ok(parseComplexList(''))).toEqual([]);
		expect(ok(parseComplexList('p = [(-0.5+0.5j), (-0.5-0.5j)]'))).toHaveLength(2);
	});
	it('reports bad tokens', () => {
		const r = parseComplexList('0.5+0.3j, 0.5+x');
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.token).toBe('0.5+x');
	});
	it('completes conjugate pairs', () => {
		const { roots, added } = completeConjugates([
			{ re: 0.5, im: 0.3 },
			{ re: -1, im: 0 },
			{ re: 0.2, im: 0.4 },
			{ re: 0.2, im: -0.4 }
		]);
		expect(roots).toHaveLength(5);
		expect(added).toEqual([{ re: 0.5, im: -0.3 }]);
	});
});

describe('partial fractions', () => {
	it('polydiv', () => {
		const { q, r } = polydiv([1, 0, 0, -1], [1, -1]);
		expect(q).toEqual([1, 1, 1]);
		expect(r[0]).toBeCloseTo(0, 14);
	});
	it('residuez reconstructs the impulse response (with direct terms)', () => {
		const b = [1, 0.4, -0.3, 0.2];
		const a = [1, -0.9, 0.5];
		const pf = residuez(b, a);
		expect(pf.repeated).toBe(false);
		expect(pf.direct.length).toBe(2);
		const N = 40;
		const x = new Array(N).fill(0);
		x[0] = 1;
		const ref = lfilter(b, a, x);
		const h = impulseFromResidues(pf, N);
		for (let n = 0; n < N; n++) expect(h[n]).toBeCloseTo(ref[n], 12);
	});
	it('residuez matches a hand-computed example', () => {
		// H(z) = 1 / ((1 − 0.5 z⁻¹)(1 − 0.25 z⁻¹)) = 2/(1 − 0.5z⁻¹) − 1/(1 − 0.25z⁻¹)
		const pf = residuez([1], [1, -0.75, 0.125]);
		const byPole = new Map(pf.poles.map((p, i) => [Math.round(p.re * 100), pf.residues[i].re]));
		expect(byPole.get(50)).toBeCloseTo(2, 12);
		expect(byPole.get(25)).toBeCloseTo(-1, 12);
	});
	it('residuez of an elliptic filter', () => {
		const { sos } = designDigital({
			family: 'ellip',
			band: 'lowpass',
			order: 5,
			f1: 3000,
			rp: 1,
			rs: 50,
			fs: 48000
		});
		const tf = sos2tf(sos);
		const pf = residuez(tf.b, tf.a);
		const N = 200;
		const x = new Array(N).fill(0);
		x[0] = 1;
		const ref = lfilter(tf.b, tf.a, x);
		const h = impulseFromResidues(pf, N);
		for (let n = 0; n < N; n++) expect(Math.abs(h[n] - ref[n])).toBeLessThan(1e-10);
	});
	it('flags repeated poles', () => {
		const pf = residuez([1], [1, -1, 0.25]);
		expect(pf.repeated).toBe(true);
	});
	it('residue (analog) reconstructs H(s)', () => {
		const b = [2, 3, 5, 1];
		const a = [1, 3, 4, 2];
		const pf = residue(b, a);
		expect(pf.direct).toEqual([2]);
		for (const w of [0.1, 1, 7]) {
			const s = { re: 0, im: w };
			const h = evalAnalogPfe(pf, s);
			const ref = freqsTf({ b, a }, [w])[0];
			expect(h.re).toBeCloseTo(ref.re, 10);
			expect(h.im).toBeCloseTo(ref.im, 10);
		}
		// simple hand example: 1/((s+1)(s+2)) = 1/(s+1) − 1/(s+2)
		const pf2 = residue([1], [1, 3, 2]);
		const m = new Map(pf2.poles.map((p, i) => [Math.round(p.re), pf2.residues[i].re]));
		expect(m.get(-1)).toBeCloseTo(1, 12);
		expect(m.get(-2)).toBeCloseTo(-1, 12);
	});
});

describe('analysis', () => {
	it('detects linear-phase FIR types', () => {
		expect(linearPhaseOf([1, 2, 1]).type).toBe('I');
		expect(linearPhaseOf([1, 2, 2, 1]).type).toBe('II');
		expect(linearPhaseOf([1, 0, -1]).type).toBe('III');
		expect(linearPhaseOf([1, -1]).type).toBe('IV');
		expect(linearPhaseOf([0, 0, 1, 2, 1, 0]).type).toBe('I');
		expect(linearPhaseOf([1, 2, 3]).kind).toBeNull();
	});
	it('analyses every example without throwing, with the expected verdicts', () => {
		const verdicts: Record<string, string> = {};
		for (const ex of EXAMPLES) {
			const t = ex.texts;
			const raw = {
				b: t.b !== undefined ? ok(parseNumbers(t.b)) : undefined,
				a: t.a !== undefined ? ok(parseNumbers(t.a)) : undefined,
				sos: t.sos !== undefined ? ok(parseSos(t.sos)) : undefined,
				z: t.z !== undefined ? completeConjugates(ok(parseComplexList(t.z))).roots : undefined,
				p: t.p !== undefined ? completeConjugates(ok(parseComplexList(t.p))).roots : undefined,
				k: t.k !== undefined ? ok(parseScalar(t.k)) : undefined,
				taps: t.taps !== undefined ? ok(parseNumbers(t.taps)) : undefined
			};
			const m = buildModel(ex.domain, ex.fs ?? 48000, ex.form, raw);
			const p = analyze(m);
			verdicts[ex.id] = p.stability;
			rootRows(m);
			if (ex.id === 'butter-biquad') {
				expect(p.dcGain).toBeCloseTo(1, 6); // coefficients printed with 10 digits
				expect(p.minus3).toHaveLength(1);
				expect(p.minus3[0]).toBeCloseTo(1000, 3);
				expect(p.order).toBe(2);
				expect(p.sections).toBe(1);
			}
			if (ex.id === 'moving-average') expect(p.linearPhase.type).toBe('I');
			if (ex.id === 'differentiator') expect(p.linearPhase.type).toBe('III');
			if (ex.id === 'allpass') expect(p.allPass.status).toBe(true);
			if (ex.id === 'nonmin') expect(p.minPhase.status).toBe('no');
			if (ex.id === 'rlc') {
				expect(p.peak.f).toBeCloseTo(1 / (2 * Math.PI * Math.sqrt(1e-2 * 1e-7)), 2);
				expect(p.peak.mag).toBeCloseTo(1, 9);
				expect(p.minus3).toHaveLength(2);
			}
			if (ex.id === 'butter-analog') {
				expect(p.dcGain).toBeCloseTo(1, 9);
				expect(p.minus3[0]).toBeCloseTo(1000, 3);
			}
		}
		expect(verdicts['unstable']).toBe('unstable');
		expect(verdicts['ellip-ba']).toBe('unstable');
		expect(verdicts['ellip-sos']).toBe('stable');
		expect(verdicts['notch']).toBe('stable');
	});
	it('reports a delay as not strictly minimum phase', () => {
		const m = buildModel('digital', 48000, 'ba', { b: [0, 0.5], a: [1, -0.5] });
		const p = analyze(m);
		expect(p.minPhase.status).toBe('boundary');
		expect(p.minPhase.delay).toBe(1);
	});
	it('reports marginal stability for a simple pole on the unit circle', () => {
		const m = buildModel('digital', 48000, 'ba', { b: [1], a: [1, -1] });
		expect(analyze(m).stability).toBe('marginal');
	});
});
