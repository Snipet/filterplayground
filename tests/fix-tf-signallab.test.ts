import { describe, expect, it } from 'vitest';
import {
	completeConjugates,
	formatComplex,
	parseComplexList,
	parseNumbers,
	parseScalar,
	parseSos
} from '../src/lib/features/tf-analyzer/parse';
import { analyze, buildModel, rootRows, type Model } from '../src/lib/features/tf-analyzer/analyze';
import { EXAMPLES } from '../src/lib/features/tf-analyzer/examples';
import { arrayToC, sosToC, sosToJson, sosToMatlab, sosToPython, tfToC } from '../src/lib/export';
import { designDigital } from '../src/lib/dsp/design';
import { oddTaps, playbackGain } from '../src/lib/features/signal-lab/signals';

const ok = <T>(r: { ok: true; value: T } | { ok: false }) => {
	expect(r).toMatchObject({ ok: true });
	return (r as { value: T }).value;
};

function exampleModel(id: string): Model {
	const ex = EXAMPLES.find((e) => e.id === id)!;
	const t = ex.texts;
	return buildModel(ex.domain, ex.fs ?? 48000, ex.form, {
		b: t.b !== undefined ? ok(parseNumbers(t.b)) : undefined,
		a: t.a !== undefined ? ok(parseNumbers(t.a)) : undefined,
		sos: t.sos !== undefined ? ok(parseSos(t.sos)) : undefined,
		z: t.z !== undefined ? completeConjugates(ok(parseComplexList(t.z))).roots : undefined,
		p: t.p !== undefined ? completeConjugates(ok(parseComplexList(t.p))).roots : undefined,
		k: t.k !== undefined ? ok(parseScalar(t.k)) : undefined,
		taps: t.taps !== undefined ? ok(parseNumbers(t.taps)) : undefined
	});
}

// ---------------------------------------------------------------------------
// #115 — digital peak: infinite magnitudes and band-edge maxima
// ---------------------------------------------------------------------------

describe('#115 digital peak gain', () => {
	it('an accumulator (pole at z = 1) peaks at ∞ at 0 Hz, in every input form', () => {
		const models = [
			buildModel('digital', 48000, 'ba', { b: [1], a: [1, -1] }),
			buildModel('digital', 48000, 'sos', { sos: [[1, 0, 0, 1, -1, 0]] }),
			buildModel('digital', 48000, 'zpk', { z: [], p: [{ re: 1, im: 0 }], k: 1 })
		];
		for (const m of models) {
			const p = analyze(m);
			expect(p.dcGain).toBe(Infinity);
			expect(p.peak).toEqual({ f: 0, mag: Infinity });
			expect(p.nyquistGain).toBeCloseTo(0.5, 12);
		}
	});
	it('a pole at z = −1 gives ∞ at fs/2, not a huge finite gain', () => {
		for (const m of [
			buildModel('digital', 48000, 'ba', { b: [1], a: [1, 1] }),
			buildModel('digital', 48000, 'sos', { sos: [[1, 0, 0, 1, 1, 0]] }),
			buildModel('digital', 48000, 'zpk', { z: [], p: [{ re: -1, im: 0 }], k: 1 })
		]) {
			const p = analyze(m);
			expect(p.nyquistGain).toBe(Infinity);
			expect(p.peak).toEqual({ f: 24000, mag: Infinity });
			expect(p.dcGain).toBeCloseTo(0.5, 12);
		}
	});
	it('low-pass examples peak exactly at DC', () => {
		for (const id of ['moving-average', 'butter-biquad']) {
			const p = analyze(exampleModel(id));
			expect(p.peak.f).toBe(0);
			expect(p.peak.mag).toBe(p.dcGain);
		}
		const lp = designDigital({ family: 'butter', band: 'lowpass', order: 1, f1: 1000, fs: 48000 });
		const p = analyze(buildModel('digital', 48000, 'sos', { sos: lp.sos }));
		expect(p.peak.f).toBe(0);
	});
	it('a high-pass peaks exactly at fs/2; interior peaks are still refined', () => {
		const hp = designDigital({ family: 'butter', band: 'highpass', order: 4, f1: 1000, fs: 48000 });
		const p = analyze(buildModel('digital', 48000, 'sos', { sos: hp.sos }));
		expect(p.peak.f).toBe(24000);
		expect(p.peak.mag).toBe(p.nyquistGain);
		expect(analyze(exampleModel('notch')).peak.f).toBe(24000);
		const e = analyze(exampleModel('ellip-sos'));
		expect(e.peak.f).toBeGreaterThan(200);
		expect(e.peak.f).toBeLessThan(1000);
	});
	it('a zero exactly at z = −1 gives an exact Nyquist gain of 0', () => {
		const p = analyze(buildModel('digital', 48000, 'fir', { taps: [0.5, 0, -0.5] }));
		expect(p.nyquistGain).toBe(0);
		expect(p.dcGain).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// #118 — Butterworth biquad example keeps its double zero at z = −1
// ---------------------------------------------------------------------------

describe('#118 Butterworth biquad example', () => {
	it('prints b = g·[1, 2, 1] exactly, so the table shows a real double zero at −1', () => {
		const ex = EXAMPLES.find((e) => e.id === 'butter-biquad')!;
		const b = ok(parseNumbers(ex.texts.b!));
		expect(b[1]).toBe(2 * b[0]);
		expect(b[2]).toBe(b[0]);
		const zeros = rootRows(exampleModel('butter-biquad')).filter((r) => r.kind === 'zero');
		expect(zeros).toHaveLength(1);
		expect(zeros[0].pair).toBe(false);
		expect(zeros[0].multiplicity).toBe(2);
		expect(zeros[0].value).toEqual({ re: -1, im: 0 });
		expect(analyze(exampleModel('butter-biquad')).nyquistGain).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// #57 — rows that wrap inside their own brackets (NumPy, indented JSON)
// ---------------------------------------------------------------------------

// scipy.signal.butter(4, 1000, fs=48000, output='sos'), NumPy 2 repr / print
const NP_REPR =
	'array([[ 1.55517218e-05,  3.11034436e-05,  1.55517218e-05,\n         1.00000000e+00, -1.76950435e+00,  7.84773332e-01],\n       [ 1.00000000e+00,  2.00000000e+00,  1.00000000e+00,\n         1.00000000e+00, -1.88855595e+00,  9.04852229e-01]])';
const NP_PRINT =
	'[[ 1.55517218e-05  3.11034436e-05  1.55517218e-05  1.00000000e+00\n  -1.76950435e+00  7.84773332e-01]\n [ 1.00000000e+00  2.00000000e+00  1.00000000e+00  1.00000000e+00\n  -1.88855595e+00  9.04852229e-01]]';
const NP_WANT = [
	[1.55517218e-5, 3.11034436e-5, 1.55517218e-5, 1, -1.76950435, 7.84773332e-1],
	[1, 2, 1, 1, -1.88855595, 9.04852229e-1]
];

describe('#57 parseSos with wrapped rows', () => {
	const sos = designDigital({
		family: 'butter',
		band: 'lowpass',
		order: 4,
		f1: 1000,
		fs: 48000
	}).sos;
	it('reads NumPy repr and print output', () => {
		expect(ok(parseSos(NP_REPR))).toEqual(NP_WANT);
		expect(ok(parseSos('sos = np.' + NP_REPR))).toEqual(NP_WANT);
		expect(ok(parseSos(NP_PRINT))).toEqual(NP_WANT);
	});
	it('reads json.dumps(indent=2) and round-trips the site’s own JSON export', () => {
		expect(ok(parseSos(JSON.stringify(NP_WANT, null, 2)))).toEqual(NP_WANT);
		expect(ok(parseSos(sosToJson(sos)))).toEqual(sos);
	});
	it('reads Python tuples whose rows wrap', () => {
		expect(ok(parseSos('((1, 2, 1,\n  1, -0.5, 0.25),\n (1, 0, -1,\n  1, 0.1, 0.2))'))).toEqual([
			[1, 2, 1, 1, -0.5, 0.25],
			[1, 0, -1, 1, 0.1, 0.2]
		]);
	});
	it('still splits rows at newlines outside inner brackets', () => {
		const want = [
			[1, 2, 1, 1, -0.5, 0.25],
			[1, 0, -1, 1, 0.1, 0.2]
		];
		expect(ok(parseSos('np.array([\n1 2 1 1 -0.5 0.25\n1 0 -1 1 0.1 0.2\n])'))).toEqual(want);
		expect(ok(parseSos('sos = [\n  1 2 1 1 -0.5 0.25\n  1 0 -1 1 0.1 0.2\n];'))).toEqual(want);
		expect(ok(parseSos('1 2 1 1 -0.5 0.25\n1 0 -1 1 0.1 0.2'))).toEqual(want);
		const r = parseSos('[[1, 2, 1, 1, -0.5],\n [1, 0, -1, 1, 0.1, 0.2]]');
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.message).toMatch(/Section 1 has 5 numbers/);
	});
	it('one-number-per-line lists outside a 2-D bracket keep working', () => {
		expect(ok(parseNumbers('[\n  1,\n  -0.5,\n  0.25\n]'))).toEqual([1, -0.5, 0.25]);
		expect(ok(parseComplexList('np.array([0.5+0.3j,\n 0.5-0.3j])'))).toEqual([
			{ re: 0.5, im: 0.3 },
			{ re: 0.5, im: -0.3 }
		]);
	});
});

// ---------------------------------------------------------------------------
// #114 — the site's own C and Python exports parse back
// ---------------------------------------------------------------------------

describe('#114 C / Python exports round-trip', () => {
	const sos = designDigital({
		family: 'ellip',
		band: 'lowpass',
		order: 4,
		f1: 2000,
		rp: 0.5,
		rs: 60,
		fs: 48000
	}).sos;
	const tf = { b: [0.25, 0.5, 1, -0.125, 3e-7], a: [1, -1.5, 0.75] };
	it('C arrays in float and double, with block comments and f suffixes', () => {
		for (const t of ['float', 'double'] as const) {
			expect(ok(parseSos(sosToC(sos, 'sos', t)))).toEqual(sos);
			expect(ok(parseNumbers(arrayToC('b', tf.b, t)))).toEqual(tf.b);
			expect(ok(parseNumbers(tfToC(tf, t)))).toEqual([...tf.b, ...tf.a]);
		}
		expect(ok(parseNumbers('{ 1.0F, .5f, 2.f, 1e-3f, -4L }'))).toEqual([1, 0.5, 2, 1e-3, -4]);
		expect(ok(parseNumbers('/* a\n multi-line\n comment */ 1, /* inline */ 2'))).toEqual([1, 2]);
	});
	it('Python (with the import line) and MATLAB', () => {
		expect(ok(parseSos(sosToPython(sos)))).toEqual(sos);
		expect(
			ok(parseSos('import numpy as np\nfrom scipy import signal\n' + sosToMatlab(sos)))
		).toEqual(sos);
		expect(ok(parseSos(sosToMatlab(sos)))).toEqual(sos);
	});
	it('keeps error positions and does not accept suffixes on identifiers', () => {
		const r = parseNumbers('/* header */\n 1, x1f, 2');
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.error.token).toBe('x1f');
			expect(r.error.line).toBe(2);
			expect(r.error.col).toBe(5);
		}
		expect(parseNumbers('1, 2ff').ok).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// #113 — ZPK code block uses an ASCII minus
// ---------------------------------------------------------------------------

describe('#113 ASCII complex formatting for copyable code', () => {
	it('formats conjugate and imaginary roots with "-"', () => {
		const zs = exampleModel('notch').zpk.z.map((v) => formatComplex(v, 12));
		expect(zs).toEqual(['0.991444861374+0.13052619222j', '0.991444861374-0.13052619222j']);
		expect(formatComplex({ re: 0, im: -2 }, 12)).toBe('-2j');
		for (const s of zs) expect(s).not.toMatch(/[^\x20-\x7e]/);
	});
});

// ---------------------------------------------------------------------------
// #58 / #116 — Signal Lab playback gain and FIR length
// ---------------------------------------------------------------------------

describe('#58 Signal Lab playback gain', () => {
	it('a muted (blown-up) output does not turn the input down', () => {
		// clamped output peak 1e4, input at −6 dBFS
		expect(playbackGain(0.5, 1e4, 1, true, 0.5)).toBe(1);
		expect(playbackGain(0.5, 1e4, 1, false, 0.5)).toBeCloseTo(5e-5, 12);
		expect(playbackGain(0.5, 2, 0.5, false, 0.5)).toBe(0.5);
		expect(playbackGain(0.5, 0.1, 1, false, 0.5)).toBe(1);
	});
});

describe('#116 Signal Lab FIR length', () => {
	it('rounds an even tap count up to the odd length that is built', () => {
		expect(oddTaps(100)).toBe(101);
		expect(oddTaps(101)).toBe(101);
		expect(oddTaps(12)).toBe(13);
		expect((oddTaps(100) - 1) / 2).toBe(50);
	});
});
