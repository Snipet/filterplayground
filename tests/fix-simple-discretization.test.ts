import { describe, expect, it } from 'vitest';
import {
	SIMPLE_FILTERS,
	defaults,
	type Built,
	type ParamValues
} from '../src/lib/features/simple-filters/catalog';
import {
	METHODS,
	bandEdgeError,
	discretizeWith,
	maxDbError,
	passbandEdges,
	passbandGrid,
	timeLength,
	timeLimits,
	type MethodId,
	type MethodResult
} from '../src/lib/features/discretization/mapping';
import { designAnalog, type IIRSpec } from '../src/lib/dsp/design';
import { evaluate } from '../src/lib/dsp/response';
import { digitalTf } from '../src/lib/dsp/convert';
import {
	analogTimeResponse,
	digitalImpulseResponse,
	digitalStepResponse,
	lfilter
} from '../src/lib/dsp/time';

const byId = (id: string) => SIMPLE_FILTERS.find((f) => f.id === id)!;
const build = (id: string, over: ParamValues = {}, fs = 48000): Built => {
	const f = byId(id);
	return f.build({ ...defaults(f), ...over }, fs);
};
const stat = (b: Built, label: string) => b.stats.find((s) => s.label === label)!.value;

// ---------------------------------------------------------------------------
// #106 differentiator edge gains
// ---------------------------------------------------------------------------

describe('#106 differentiator: exact zeros at DC / Nyquist read −∞ dB', () => {
	for (const fs of [1000, 8000, 44100, 48000]) {
		it(`at fs = ${fs}`, () => {
			const back = build('diff', { variant: 'backward' }, fs);
			expect(stat(back, 'Gain at DC')).toBe('−∞ dB (zero at z = 1)');
			expect(stat(back, 'Gain at Nyquist')).toBe('6.021 dB');
			const cen = build('diff', { variant: 'central' }, fs);
			expect(stat(cen, 'Gain at DC')).toBe('−∞ dB (zero at z = 1)');
			expect(stat(cen, 'Gain at Nyquist')).toBe('−∞ dB (zero at z = −1)');
			const pre1 = build('diff', { variant: 'pre', a: 1 }, fs);
			expect(stat(pre1, 'Gain at DC')).toBe('−∞ dB (zero at z = 1)');
		});
	}
	it('a pre-emphasis without a zero still shows its finite gains', () => {
		const b = build('diff', { variant: 'pre', a: 0.97 });
		// |1 − 0.97| = 0.03 → −30.46 dB; |1 + 0.97| = 1.97 → +5.889 dB
		expect(stat(b, 'Gain at DC')).toBe(`${(20 * Math.log10(0.03)).toFixed(2)} dB`);
		expect(stat(b, 'Gain at Nyquist')).toBe('5.889 dB');
	});
	it('no stat in the catalogue shows a float-floor value such as −6000 dB', () => {
		for (const f of SIMPLE_FILTERS)
			for (const fs of [1000, 48000])
				for (const s of f.build(defaults(f), fs).stats)
					expect(s.value).not.toMatch(/-(2[5-9]\d|[3-9]\d\d|\d{4,})(\.\d+)? dB/);
	});
});

// ---------------------------------------------------------------------------
// #107 per-sample C snippets are complete
// ---------------------------------------------------------------------------

/** Run a catalogue snippet once per sample from zero state (C float literals → JS). */
function runSnippet(code: string, input: number[]): number[] {
	const js = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(\d)f\b/g, '$1');
	const fn = new Function(
		'input',
		`let x = 0, y = 0, x1 = 0, x2 = 0, y1 = 0, y2 = 0, i = 0, acc = 0;
		const N = 4096, xd = new Float64Array(4096), yd = new Float64Array(4096), buf = new Float64Array(4096);
		const out = [];
		for (const s of input) { x = s; ${js} out.push(y); }
		return out;`
	);
	return fn(input) as number[];
}

function noise(n: number): number[] {
	let s = 12345;
	const out = [1];
	for (let i = 1; i < n; i++) {
		s = (s * 1103515245 + 12345) % 2147483648;
		out.push(s / 1073741824 - 1);
	}
	return out;
}

function expectSnippetMatches(b: Built, tol: number) {
	const x = noise(400);
	const tf = digitalTf(b.filter);
	const ref = Array.from(lfilter(tf.b, tf.a, x));
	const got = runSnippet(b.code, x);
	const scale = Math.max(1, ...ref.map(Math.abs));
	let err = 0;
	for (let i = 0; i < x.length; i++) err = Math.max(err, Math.abs(got[i] - ref[i]));
	expect(err / scale).toBeLessThan(tol);
}

describe('#107 per-sample code updates its state', () => {
	it('the old comb / notch snippets did not filter (harness sanity check)', () => {
		const x = noise(50);
		expect(runSnippet('y = x + 0.7f * xd[(i + N - 8) % N];', x)).toEqual(x);
		const g = 0.9743387;
		const old = 'y = 0.9743387f*(x + -1.732051f*x1 + x2) + 1.687294f*y1 + -0.9489873f*y2;';
		runSnippet(old, x).forEach((v, i) => expect(v).toBeCloseTo(g * x[i], 12));
	});
	for (const [D, g] of [
		[1, 0.7],
		[8, 0.7],
		[8, -0.5],
		[37, 1],
		[100, -1]
	])
		it(`feed-forward comb D = ${D}, g = ${g}`, () =>
			expectSnippetMatches(build('comb', { kind: 'ff', D, g }), 1e-12));
	for (const [D, gfb] of [
		[1, 0.7],
		[8, 0.7],
		[13, -0.9],
		[100, 0.99]
	])
		it(`feedback comb D = ${D}, g = ${gfb}`, () =>
			expectSnippetMatches(build('comb', { kind: 'fb', D, gfb }), 1e-12));
	// coefficients are printed with 7 significant digits; the 5 Hz-wide notch at 60 Hz
	// (poles at r = 0.99967) is the most sensitive to that rounding
	for (const [f0, B, tol] of [
		[4000, 400, 1e-4],
		[60, 5, 1e-3],
		[20000, 2000, 1e-4]
	])
		it(`notch f0 = ${f0} Hz, B = ${B} Hz`, () =>
			expectSnippetMatches(build('notch', { f0, B }), tol));
	it('every other recursive snippet in the catalogue matches its b/a as well', () => {
		for (const f of SIMPLE_FILTERS) {
			const b = f.build(defaults(f), 48000);
			if (b.code.includes('for (')) continue; // array formulation of the direct moving average
			expectSnippetMatches(b, 1e-4);
		}
		expectSnippetMatches(build('reson', { zeros: 'pm1' }), 1e-4);
		expectSnippetMatches(build('ma', { impl: 'recursive' }), 1e-12);
		for (const variant of ['backward', 'central', 'pre'])
			expectSnippetMatches(build('diff', { variant }), 1e-12);
	});
});

// ---------------------------------------------------------------------------
// #51 time-response limits cover what is drawn
// ---------------------------------------------------------------------------

const lp = (f1: number, family: IIRSpec['family'] = 'butter'): IIRSpec => ({
	family,
	band: 'lowpass',
	order: 4,
	f1,
	rp: 1,
	rs: 40,
	besselNorm: 'mag'
});
const run = (spec: IIRSpec, fs: number, ids: MethodId[]) =>
	ids.map((id) => discretizeWith(id, spec, fs));
const peak = (y: ArrayLike<number>) => Math.max(...Array.from(y, Math.abs));

describe('#51 time-response y-limits', () => {
	it('all stable: no clamp, the plot autoscales over the full curves', () => {
		const fs = 8000;
		const rs = run(lp(5), fs, ['bilinear-prewarp', 'bilinear', 'matched', 'impulse']);
		expect(
			timeLength(
				rs.map((r) => r.zpk),
				fs
			)
		).toBe(1024);
		expect(timeLimits(designAnalog(lp(5)), rs, fs, 1024)).toBeUndefined();
	});
	it('with an unstable result, the clamp covers every stable curve over the drawn length', () => {
		// fs = 8 kHz, fc = 5 Hz: the step only settles after ~1000 samples (old limit ±0.039)
		const fs = 8000;
		const analog = designAnalog(lp(5));
		const stable = run(lp(5), fs, ['bilinear', 'impulse']);
		const unstable: MethodResult = {
			analog,
			zpk: { z: [], p: [{ re: 1.05, im: 0 }], k: 1 },
			stable: false,
			maxPoleRadius: 1.05
		};
		const all = [...stable, unstable];
		const n = timeLength(
			all.map((r) => r.zpk),
			fs
		);
		expect(n).toBe(1024);
		const lim = timeLimits(analog, all, fs, n)!;
		expect(lim).toBeDefined();
		for (const r of stable) {
			const f = { kind: 'digital' as const, fs, zpk: r.zpk };
			expect(lim[1]).toBeGreaterThan(peak(digitalStepResponse(f, n)));
			expect(lim[1]).toBeGreaterThan(peak(digitalImpulseResponse(f, n)));
		}
		expect(lim[1]).toBeGreaterThan(peak(analogTimeResponse(analog, 'step', (n - 1) / fs, n).y));
		expect(lim[1]).toBeGreaterThan(0.9);
		expect(lim[0]).toBe(-lim[1]);
		// but it still stops the unstable curve from flattening the plot
		const u = digitalStepResponse({ kind: 'digital', fs, zpk: unstable.zpk }, n);
		expect(peak(u)).toBeGreaterThan(1e6 * lim[1]);
	});
	it('forward Euler at the defaults (unstable) gets a clamp from the stable results', () => {
		const fs = 8000;
		const rs = run(lp(2000), fs, ['bilinear', 'forward-euler']);
		expect(rs[1].stable).toBe(false);
		const n = timeLength(
			rs.map((r) => r.zpk),
			fs
		);
		const lim = timeLimits(designAnalog(lp(2000)), rs, fs, n)!;
		const f = { kind: 'digital' as const, fs, zpk: rs[0].zpk };
		expect(lim[1]).toBeGreaterThan(peak(digitalStepResponse(f, n)));
		expect(lim[1]).toBeLessThan(5);
	});
});

// ---------------------------------------------------------------------------
// #52 Chebyshev II passband
// ---------------------------------------------------------------------------

describe('#52 Chebyshev II passband is the −3 dB region, not up to the stopband edge', () => {
	const c2 = (band: IIRSpec['band'], f1: number, f2?: number): IIRSpec => ({
		family: 'cheby2',
		band,
		order: 4,
		f1,
		f2,
		rs: 40
	});
	// scipy.signal.cheby2(4, 40, 2π·f, btype, analog=True): −3 dB frequencies (brentq)
	it('finds the −3 dB edges SciPy finds', () => {
		const lpE = passbandEdges(designAnalog(c2('lowpass', 1000)), 'cheby2', 'lowpass', 1000, 0);
		expect(lpE[0]).toBeCloseTo(496.7152, 1);
		const hpE = passbandEdges(designAnalog(c2('highpass', 2000)), 'cheby2', 'highpass', 2000, 0);
		expect(hpE[0]).toBeCloseTo(4026.452, 0);
		const bp = passbandEdges(
			designAnalog(c2('bandpass', 1000, 3000)),
			'cheby2',
			'bandpass',
			1000,
			3000
		);
		expect(bp[0]).toBeCloseTo(1305.152, 0);
		expect(bp[1]).toBeCloseTo(2298.583, 0);
		const bs = passbandEdges(
			designAnalog(c2('bandstop', 1000, 2000)),
			'cheby2',
			'bandstop',
			1000,
			2000
		);
		expect(bs[0]).toBeCloseTo(729.2642, 0);
		expect(bs[1]).toBeCloseTo(2742.49, 0);
	});
	it('other families keep their design edges', () => {
		for (const family of ['butter', 'cheby1', 'ellip', 'bessel'] as const) {
			const a = designAnalog({ ...lp(1000, family) });
			expect(passbandEdges(a, family, 'lowpass', 1000, 3000)).toEqual([1000, 3000]);
		}
	});
	it('LP 1 kHz, fs = 8 kHz: passband errors measured inside the passband', () => {
		const fs = 8000;
		const spec = c2('lowpass', 1000);
		const analog = designAnalog(spec);
		const [p1, p2] = passbandEdges(analog, 'cheby2', 'lowpass', 1000, 0);
		const grid = passbandGrid('lowpass', p1, p2, fs);
		// every grid point is in the analog passband (≥ −3.0103 dB)
		const g = evaluate({ kind: 'analog', zpk: analog }, grid).magDb;
		expect(Math.min(...g)).toBeGreaterThan(-3.0103 - 1e-3);
		const err = (id: MethodId) => maxDbError(analog, discretizeWith(id, spec, fs).zpk, fs, grid);
		// previously 1.3 / 11.3 / 6.25 dB (transition band down to −40 dB counted as passband)
		expect(err('bilinear')).toBeLessThan(0.3);
		expect(err('impulse')).toBeLessThan(0.3);
		expect(err('bilinear-prewarp')).toBeLessThan(0.8);
		expect(err('bilinear')).toBeLessThan(err('bilinear-prewarp'));
		// the edge column (at the stopband edge) is unchanged: prewarping hits it exactly
		expect(
			maxDbError(analog, discretizeWith('bilinear-prewarp', spec, fs).zpk, fs, [1000])
		).toBeLessThan(1e-6);
	});
	it('HP with its passband above Nyquist has no passband grid', () => {
		const analog = designAnalog(c2('highpass', 2000));
		const [p1, p2] = passbandEdges(analog, 'cheby2', 'highpass', 2000, 0);
		expect(passbandGrid('highpass', p1, p2, 8000)).toEqual([]);
		expect(maxDbError(analog, analog, 8000, [])).toBeNaN();
	});
});

// ---------------------------------------------------------------------------
// #53 band collapsed by the clamp
// ---------------------------------------------------------------------------

describe('#53 band edges are validated after clamping to 0.99·fs/2', () => {
	it('both edges above the clamp is an input error', () => {
		expect(bandEdgeError(2000, 3000, 1000)).toMatch(/zero width/);
		expect(bandEdgeError(2000, 3000, 4000)).toMatch(/zero width/);
		expect(bandEdgeError(495, 3000, 1000)).toMatch(/zero width/);
	});
	it('reversed edges keep their own message; valid bands pass', () => {
		expect(bandEdgeError(3000, 2000, 8000)).toMatch(/lower band edge/);
		expect(bandEdgeError(2000, 3000, 8000)).toBeNull();
		// only the upper edge is clamped: still a real band
		expect(bandEdgeError(200, 3000, 1000)).toBeNull();
	});
	it('every method keeps a valid narrow band stable', () => {
		const fs = 1000;
		const spec: IIRSpec = { family: 'butter', band: 'bandpass', order: 4, f1: 400, f2: 495 };
		for (const m of METHODS.filter((x) => x.id !== 'forward-euler'))
			expect(discretizeWith(m.id, spec, fs).stable).toBe(true);
	});
});
