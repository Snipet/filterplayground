import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import {
	designAt,
	designFir,
	measureSpec,
	meetsSpec,
	rescaleFreq,
	scanLength,
	specBands,
	validateBands,
	validateSpec,
	type Band,
	type FirConfig,
	type Spec
} from '../src/lib/features/fir-designer/design';
import {
	matlabRecipe,
	matlabWindow,
	scipyRecipe,
	scipyWindowArray
} from '../src/lib/features/fir-designer/recipes';
import { firwinFast } from '../src/lib/features/fir-designer/windowing';
import { firlsSweep } from '../src/lib/features/fir-designer/fastLs';
import { firls, firwin } from '../src/lib/dsp/fir';
import { kaiserOrder, WINDOWS } from '../src/lib/dsp/windows';

const fs = 48000;
const lp: Spec = { band: 'lowpass', edges: [6000, 8000], rp: 0.5, rs: 60 };
const hp: Spec = { band: 'highpass', edges: [6000, 8000], rp: 0.5, rs: 60 };
const bp: Spec = { band: 'bandpass', edges: [4000, 6000, 10000, 12000], rp: 0.5, rs: 60 };

const cfg = (over: Partial<FirConfig>): FirConfig => ({
	method: 'window',
	fs,
	shape: over.spec?.band ?? 'lowpass',
	spec: lp,
	bands: [],
	numtaps: 41,
	auto: true,
	window: { type: 'hamming' },
	symmetry: 'even',
	relWeight: false,
	...over
});

const peak = (h: readonly number[]) => Math.max(...h.map(Math.abs));

/** Every allowed length below the auto result fails the mask, and the result passes. */
function expectMinimal(c: FirConfig, oddOnly: boolean) {
	const d = designFir(c);
	expect(d.auto!.met).toBe(true);
	expect(measureSpec(d.h, c.spec, fs).met).toBe(true);
	for (let N = 3; N < d.numtaps; N += oddOnly ? 2 : 1)
		expect(measureSpec(designAt(c, N).h, c.spec, fs).met, `N = ${N}`).toBe(false);
	return d;
}

describe('#5 even-length high-pass window designs are not blown up', () => {
	it('firwinFast matches firwin for even lengths that pass fs/2', () => {
		const cases: [number, number[], boolean][] = [
			[60, [7000], false],
			[40, [4000, 11000], true],
			[4, [7000], false],
			[200, [7000], false]
		];
		for (const w of [
			{ type: 'hamming' as const },
			{ type: 'kaiser' as const, param: 5 },
			{ type: 'chebyshev' as const, param: 70 }
		])
			for (const [N, c, pz] of cases) {
				const a = firwinFast(N, c, w, pz, fs);
				const b = firwin(N, c, w, pz, fs);
				expect(peak(a)).toBeLessThan(1);
				for (let i = 0; i < N; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(1e-12);
			}
	});
	it('window and Kaiser HP designs at N = 60 have taps of order 1 and a sane response', () => {
		for (const method of ['window', 'kaiser'] as const) {
			const d = designFir(cfg({ method, spec: hp, auto: false, numtaps: 60 }));
			expect(d.h.every(Number.isFinite)).toBe(true);
			expect(peak(d.h)).toBeLessThan(1);
			const m = measureSpec(d.h, hp, fs);
			// the forced zero at fs/2 wrecks the passband, but otherwise the design is like N = 61
			const odd = measureSpec(
				designFir(cfg({ method, spec: hp, auto: false, numtaps: 61 })).h,
				hp,
				fs
			);
			expect(Math.abs(m.attenDb - odd.attenDb)).toBeLessThan(2);
			expect(m.passMax).toBeLessThan(1.01);
			expect(m.passMin).toBeLessThan(1e-12);
		}
	});
});

describe('#25 the auto length is the smallest one that meets the mask', () => {
	it('scanLength finds the first passing length even when passes come in islands', () => {
		const islands = (N: number) => (N >= 127 && N <= 130) || N >= 158;
		expect(scanLength(islands, false, 1023)).toMatchObject({ N: 127, met: true });
		expect(scanLength((N) => N === 133 || N >= 151, true, 1023).N).toBe(133);
		expect(scanLength(() => false, true, 401)).toMatchObject({ N: 401, met: false });
		expect(scanLength(() => false, false, 1023)).toMatchObject({ N: 1023, met: false });
	});
	it('meetsSpec gives the same verdict as measureSpec', () => {
		for (const [c, Ns] of [
			[cfg({ spec: bp, shape: 'bandpass' }), [100, 126, 127, 130, 131, 158, 300]],
			[cfg({ method: 'fsamp' }), [100, 119, 120, 121, 400]],
			[cfg({ window: { type: 'rectangular' } }), [61, 500, 1023]]
		] as [FirConfig, number[]][])
			for (const N of Ns) {
				const h = designAt(c, N).h;
				expect(meetsSpec(h, c.spec, fs), `N = ${N}`).toBe(measureSpec(h, c.spec, fs).met);
			}
	});
	it('window method: Hamming band-pass finds 127, not 412', () => {
		const d = expectMinimal(cfg({ spec: bp, shape: 'bandpass' }), false);
		expect(d.numtaps).toBe(127);
	});
	it('window method: Hamming low-pass and high-pass find their true minimum', () => {
		expect(designFir(cfg({})).numtaps).toBe(294);
		expect(designFir(cfg({ spec: hp, shape: 'highpass' })).numtaps).toBe(257);
	});
	it('frequency sampling finds the 813-tap design instead of reporting failure at 1023', () => {
		const c = cfg({
			method: 'fsamp',
			spec: { band: 'lowpass', edges: [3000, 3500], rp: 0.1, rs: 80 }
		});
		const d = designFir(c);
		expect(d.auto).toMatchObject({ met: true, capped: false });
		expect(d.numtaps).toBe(813);
		expect(measureSpec(d.h, c.spec, fs).met).toBe(true);
		for (let N = 3; N < 813; N++)
			expect(meetsSpec(designAt(c, N).h, c.spec, fs), `N = ${N}`).toBe(false);
		// lengths above the island fail again
		expect(measureSpec(designAt(c, 1023).h, c.spec, fs).met).toBe(false);
	});
	it('least squares finds a passing island below a failing stretch', () => {
		// passes at 63 and 65, fails at 67 and 69, passes again from 71
		const spec: Spec = {
			band: 'bandstop',
			edges: [1978, 4858, 9271, 12785],
			rp: 1.154477128982544,
			rs: 75.44320106506348
		};
		const d = expectMinimal(cfg({ method: 'ls', spec, shape: 'bandstop' }), true);
		expect(d.numtaps).toBe(63);
	});
	it('the least-squares sweep used to screen lengths matches firls', () => {
		for (const spec of [lp, bp, { ...lp, edges: [6000, 6300], rp: 0.1, rs: 80 }] as Spec[]) {
			const bands = specBands(spec, fs).bands;
			const sweep = firlsSweep(bands, fs, 401);
			for (let N = 3; N <= 101; N += 2) {
				const a = sweep(N)!;
				const b = firls(N, bands, fs);
				for (let i = 0; i < N; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(1e-9 * peak(b));
			}
		}
		// and the screened search gives the plain scan's answer, also when nothing passes
		for (const spec of [
			lp,
			{ ...lp, rp: 0.01, rs: 120 },
			{ ...lp, edges: [6000, 6300], rp: 0.1, rs: 80 }
		]) {
			const c = cfg({ method: 'ls', spec });
			const d = designFir(c);
			const plain = scanLength((N) => measureSpec(designAt(c, N).h, spec, fs).met, true, 401);
			expect({ N: d.numtaps, met: d.auto!.met }).toEqual({ N: plain.N, met: plain.met });
		}
	});
	it('still reports failure when no length works', () => {
		const d = designFir(cfg({ window: { type: 'rectangular' } }));
		expect(d.auto).toMatchObject({ met: false, capped: true });
		expect(d.numtaps).toBe(1023);
	});
});

describe('#26 MATLAB recipes for every window', () => {
	it('has an explicit MATLAB window for every window type', () => {
		for (const w of WINDOWS) expect(matlabWindow({ type: w.id }, 41), w.id).not.toBeNull();
	});
	it('fir1/fir2 calls are complete statements with the right window', () => {
		const welch = "1 - (((0:40)' - 20) / 21).^2";
		for (const w of WINDOWS)
			for (const method of ['window', 'fsamp'] as const) {
				const c = cfg({ method, auto: false, numtaps: 41, window: { type: w.id } });
				const code = matlabRecipe(c, designFir(c));
				const line = code.split('\n').find((l) => /\bfir[12]\(/.test(l))!;
				expect(line, `${method} ${w.id}`).toMatch(/\);$/);
				expect(line, `${method} ${w.id}`).not.toContain('%');
				if (w.id !== 'welch') expect(line, `${method} ${w.id}`).not.toContain(welch);
			}
		const nut = cfg({ auto: false, numtaps: 41, window: { type: 'nuttall' } });
		expect(matlabRecipe(nut, designFir(nut))).toContain(
			"0.355768 - 0.487396*cos(2*pi*(0:40)'/40) + 0.144232*cos(4*pi*(0:40)'/40) - 0.012604*cos(6*pi*(0:40)'/40)"
		);
		const lan = cfg({ auto: false, numtaps: 41, window: { type: 'lanczos' } });
		expect(matlabRecipe(lan, designFir(lan))).toContain(
			"h = fir1(N-1, 7000 / (fs/2), 'low', sinc(2*(0:40)'/40 - 1));"
		);
	});
});

describe('#27 differentiator recipes weight the bands like the page', () => {
	const ramp: Band = {
		f1: 0,
		f2: 7200,
		d1: 0,
		d2: Number((0.3 * Math.PI).toPrecision(6)),
		weight: 1
	};
	const stop: Band = { f1: 9600, f2: 24000, d1: 0, d2: 0, weight: 1 };
	const diff = (bands: Band[]) =>
		cfg({
			method: 'pm',
			shape: 'custom',
			auto: false,
			numtaps: 32,
			symmetry: 'odd',
			relWeight: true,
			bands
		});
	it('divides each ramp weight by its slope per cycle/sample (SciPy and MATLAB alike)', () => {
		const c = diff([ramp, { ...stop, weight: 10 }]);
		const d = designFir(c);
		const slopeCyc = ramp.d2 / (ramp.f2 / fs); // 2π
		const py = scipyRecipe(c, d);
		expect(py).toContain("type='differentiator'");
		expect(py).toContain(`weight=[${Number((1 / slopeCyc).toPrecision(6))}, 10]`);
		const m = matlabRecipe(c, d);
		// firpm's 'differentiator' weight is 2/f on its fs/2-normalised grid, i.e. 1/f in
		// cycles/sample like SciPy, so it takes the same weights
		expect(m).toContain('w = [0.159155 10];');
		expect(m).toContain("'differentiator'");
	});
	it('a single ramp is unchanged up to a common factor', () => {
		const c = diff([{ ...ramp, f2: 21600, d2: Number((0.9 * Math.PI).toPrecision(6)) }]);
		expect(scipyRecipe(c, designFir(c))).toMatch(/weight=\[0\.159155\]/);
	});
	it('a falling ramp cannot be expressed with 1/f weighting', () => {
		const c = diff([{ ...ramp, d2: -ramp.d2 }, stop]);
		const d = designFir(c);
		expect(scipyRecipe(c, d)).toContain('cannot express');
		expect(matlabRecipe(c, d)).toContain('cannot express');
	});
});

describe('#89 Nuttall SciPy recipes apply the window by hand', () => {
	it('never passes general_cosine to firwin or firwin2', () => {
		for (const method of ['window', 'fsamp'] as const)
			for (const [spec, shape] of [
				[lp, 'lowpass'],
				[bp, 'bandpass']
			] as const) {
				const c = cfg({
					method,
					spec,
					shape,
					auto: false,
					numtaps: 61,
					window: { type: 'nuttall' }
				});
				const py = scipyRecipe(c, designFir(c));
				expect(py).not.toMatch(/window=\('general_cosine'/);
				expect(py).toContain(
					'h = h * signal.windows.general_cosine(numtaps, [0.355768, 0.487396, 0.144232, 0.012604], sym=True)'
				);
				expect(py).toContain(method === 'window' ? "window='boxcar'" : 'window=None');
			}
	});
	it('the explicit Welch window is parenthesised so it multiplies as a whole', () => {
		expect(scipyWindowArray({ type: 'welch' })).toMatch(/^\(.*\)$/);
		expect(scipyWindowArray({ type: 'hann' })).toBeNull();
	});
});

describe('even-length HP/BS recipes (SciPy and MATLAB refuse them in firwin/fir1)', () => {
	it('builds the windowed ideal response explicitly, unscaled for a high-pass', () => {
		const c = cfg({ spec: hp, shape: 'highpass', auto: false, numtaps: 60 });
		const d = designFir(c);
		const py = scipyRecipe(c, d);
		expect(py).not.toContain('signal.firwin(');
		expect(py).toContain('e = np.array([7000, 24000]) / (fs / 2)');
		expect(py).toContain('no re-normalisation');
		const m = matlabRecipe(c, d);
		expect(m).not.toContain('fir1(');
		expect(m).toContain("h = (h .* (hamming(60))).';");
		const bs = cfg({
			spec: { band: 'bandstop', edges: [4000, 6000, 10000, 12000], rp: 0.5, rs: 60 },
			shape: 'bandstop',
			auto: false,
			numtaps: 60
		});
		expect(scipyRecipe(bs, designFir(bs))).toContain('f0 = 0');
		expect(matlabRecipe(bs, designFir(bs))).toContain('h = h / sum(h);');
	});
});

describe('#86 capped Kaiser designs are not described as bumped to odd', () => {
	const capped = cfg({
		method: 'kaiser',
		spec: { band: 'lowpass', edges: [6000, 6200], rp: 0.01, rs: 120 }
	});
	it('the SciPy and MATLAB comments say the length was capped', () => {
		const d = designFir(capped);
		expect(d.auto).toMatchObject({ estimate: 1875, capped: true, met: false });
		expect(d.numtaps).toBe(1023);
		const py = scipyRecipe(capped, d);
		expect(py).toContain(
			"numtaps, beta = 1023, 12.26526  # capped at this page's limit (kaiserord says 1875)"
		);
		expect(py).not.toContain('bumped');
		const m = matlabRecipe(capped, d);
		expect(m).not.toContain('±1 tap');
		expect(m).toContain('kaiserord would give about 1875 taps');
	});
	it('keeps the bumped-to-odd comment for a high-pass whose estimate is even', () => {
		let found = false;
		for (let stop = 6600; stop < 9000 && !found; stop += 10) {
			const spec: Spec = { band: 'highpass', edges: [6000, stop], rp: 0.5, rs: 60 };
			const est = kaiserOrder(60, (stop - 6000) / fs).numtaps;
			if (est % 2) continue;
			found = true;
			const c = cfg({ method: 'kaiser', spec, shape: 'highpass' });
			const d = designFir(c);
			expect(d.numtaps).toBe(est + 1);
			expect(scipyRecipe(c, d)).toContain(`# kaiserord says ${est}; bumped to odd: a highpass`);
		}
		expect(found).toBe(true);
	});
});

describe('#87 the numbers behind the window-method tip', () => {
	it('Hann reaches 60 dB at N = 162 (Kaiser estimate 89); Rectangular stays near 47 dB at 1023', () => {
		const hann = designFir(cfg({ window: { type: 'hann' } }));
		expect(hann.auto).toMatchObject({ met: true, estimate: 89 });
		expect(hann.numtaps).toBe(162);
		const rect = designFir(cfg({ window: { type: 'rectangular' } }));
		expect(rect.auto!.met).toBe(false);
		expect(measureSpec(rect.h, lp, fs).attenDb).toBeCloseTo(47, 0);
	});
});

describe('#29 changing fs keeps custom band edges within fs/2', () => {
	it('an edge at fs/2 stays at fs/2 when fs/2 needs more than 6 digits', () => {
		let f = 48000;
		let bands: Band[] = [
			{ f1: 0, f2: 7200, d1: 1, d2: 1, weight: 1 },
			{ f1: 9600, f2: 16800, d1: 0, d2: 0, weight: 10 },
			{ f1: 19200, f2: 24000, d1: 0, d2: 0, weight: 10 }
		];
		for (const next of [60000, 75000, 93750, 117187.5, 146484.375]) {
			bands = bands.map((b) => ({
				...b,
				f1: rescaleFreq(b.f1, f, next),
				f2: rescaleFreq(b.f2, f, next)
			}));
			f = next;
			expect(bands[2].f2).toBe(f / 2);
			expect(validateBands(bands, f, 'pm')).toEqual([]);
		}
		// odd sampling rates: rounding to 6 digits never lands above fs/2
		expect(rescaleFreq(500000, 1000000, 1234567)).toBe(617283.5);
		expect(rescaleFreq(499999, 1000000, 1234567)).toBeLessThanOrEqual(617283.5);
		const spec: Spec = { ...lp, edges: [6000, 8000].map((e) => rescaleFreq(e, 48000, 117187.5)) };
		expect(validateSpec(spec, 117187.5)).toBeNull();
	});
});

describe('#88 TeX strings in the FIR designer page', () => {
	it('every backslash command in a math string is escaped', () => {
		const src = readFileSync('src/routes/fir-designer/+page.svelte', 'utf8');
		const strings = [...src.matchAll(/math=\{'((?:[^'\\]|\\.)*)'\}/g)].map((m) => m[1]);
		expect(strings.length).toBeGreaterThan(10);
		// in the JS source a TeX command needs two backslashes: an odd run before a letter is a bug
		for (const s of strings)
			for (const m of s.matchAll(/(\\+)[A-Za-z]/g)) expect(m[1].length % 2, s).toBe(0);
	});
});

describe('frequency-sampling SciPy recipe (#18 follow-up)', () => {
	it('writes the firwin2 break frequencies as Python floats', () => {
		// a brick-wall (0 % transition) design has a repeated break frequency
		const c = cfg({ method: 'fsamp', auto: false, numtaps: 61, fsampFrac: 0 });
		const m = scipyRecipe(c, designFir(c)).match(/firwin2\(numtaps, \[([^\]]*)\]/);
		expect(m).not.toBeNull();
		const toks = m![1].split(',').map((t) => t.trim());
		expect(new Set(toks).size).toBeLessThan(toks.length);
		for (const tok of toks) expect(tok).toMatch(/[.eE]/);
	});
});
