/**
 * Helpers for the Digital IIR Designer: per-section pole/zero summaries, a
 * coefficient-sensitivity check (one b/a vs. second-order sections in float32),
 * spec-mask verification and SciPy / MATLAB recipes.
 */
import { type Complex, abs } from '$lib/dsp/complex';
import { sos2tf, tf2zpk } from '$lib/dsp/convert';
import { roots } from '$lib/dsp/poly';
import { evaluate, linspace } from '$lib/dsp/response';
import type { AnalogFamily, BesselNorm } from '$lib/dsp/analog';
import type { BandType, DigitalFilter, SOS } from '$lib/dsp/types';
import { num } from '$lib/export';

export interface SectionInfo {
	/** Coefficients normalised so a0 = 1: [b0, b1, b2, a1, a2]. */
	coef: [number, number, number, number, number];
	poles: Complex[];
	zeros: Complex[];
	/** Largest pole radius in this section (0 if it has no poles). */
	poleR: number;
	/** Angle of that pole, radians in [0, π]. */
	poleAngle: number;
	order: 1 | 2;
}

/** Summarise one digital second-order section. */
export function sectionInfo(s: readonly number[]): SectionInfo {
	const a0 = s[3] || 1;
	const coef: SectionInfo['coef'] = [s[0] / a0, s[1] / a0, s[2] / a0, s[4] / a0, s[5] / a0];
	const zpk = tf2zpk({ b: [coef[0], coef[1], coef[2]], a: [1, coef[3], coef[4]] });
	let poleR = 0;
	let poleAngle = 0;
	for (const p of zpk.p) {
		const r = abs(p);
		if (r > poleR) {
			poleR = r;
			poleAngle = Math.abs(Math.atan2(p.im, p.re));
		}
	}
	return { coef, poles: zpk.p, zeros: zpk.z, poleR, poleAngle, order: coef[4] === 0 && coef[2] === 0 ? 1 : 2 };
}

/** Largest root magnitude of a real polynomial given in ascending powers of z⁻¹. */
function maxRootRadius(a: readonly number[]): number {
	let p = [...a];
	while (p.length > 1 && p[p.length - 1] === 0) p.pop(); // roots at the origin
	while (p.length > 1 && p[0] === 0) p.shift();
	if (p.length <= 1) return 0;
	return Math.max(...roots(p).map(abs));
}

export interface SensitivityResult {
	/** Max pole radius when the whole filter is one b/a with float32 coefficients. */
	tfRadius: number;
	/** Max pole radius when each section's a1, a2 are rounded to float32. */
	sosRadius: number;
	/** Max pole radius of the exact (float64) design. */
	exactRadius: number;
	/** Order of the expanded denominator. */
	order: number;
}

/**
 * Round the denominator coefficients to IEEE single precision and see where the
 * poles move — once for the expanded transfer function, once per section.
 */
export function float32Sensitivity(sos: SOS): SensitivityResult {
	const tf = sos2tf(sos);
	const a0 = tf.a[0];
	const aq = tf.a.map((v) => Math.fround(v / a0));
	const tfRadius = maxRootRadius(aq);
	let sosRadius = 0;
	let exactRadius = 0;
	for (const s of sos) {
		const n0 = s[3] || 1;
		const exact = [1, s[4] / n0, s[5] / n0];
		exactRadius = Math.max(exactRadius, maxRootRadius(exact));
		sosRadius = Math.max(sosRadius, maxRootRadius(exact.map((v) => Math.fround(v))));
	}
	return { tfRadius, sosRadius, exactRadius, order: tf.a.length - 1 };
}

export interface SpecCheck {
	/** Worst (lowest) passband gain, dB. */
	passMinDb: number;
	/** Peak-to-peak variation inside the passband, dB. */
	passRippleDb: number;
	/** Worst (highest) stopband gain, dB. */
	stopMaxDb: number;
}

/** Evaluate a digital filter over the pass- and stopbands of a spec (edges in Hz). */
export function checkSpec(
	filter: DigitalFilter,
	band: BandType,
	fp: [number, number],
	fstop: [number, number],
	n = 600
): SpecCheck {
	const nyq = filter.fs / 2;
	const pass: [number, number][] = [];
	const stop: [number, number][] = [];
	switch (band) {
		case 'lowpass':
			pass.push([0, fp[0]]);
			stop.push([fstop[0], nyq]);
			break;
		case 'highpass':
			stop.push([0, fstop[0]]);
			pass.push([fp[0], nyq]);
			break;
		case 'bandpass':
			stop.push([0, fstop[0]], [fstop[1], nyq]);
			pass.push([fp[0], fp[1]]);
			break;
		case 'bandstop':
			pass.push([0, fp[0]], [fp[1], nyq]);
			stop.push([fstop[0], fstop[1]]);
			break;
	}
	const sample = (ranges: [number, number][]) =>
		ranges.flatMap(([a, b]) => (b > a ? linspace(a, Math.min(b, nyq), n) : []));
	const pDb = evaluate(filter, sample(pass)).magDb.filter(Number.isFinite);
	const sDb = evaluate(filter, sample(stop)).magDb;
	const passMin = pDb.length ? Math.min(...pDb) : 0;
	const passMax = pDb.length ? Math.max(...pDb) : 0;
	let stopMax = -Infinity;
	for (const v of sDb) if (!Number.isNaN(v) && v > stopMax) stopMax = v;
	return { passMinDb: passMin, passRippleDb: passMax - passMin, stopMaxDb: stopMax };
}

// ---------------------------------------------------------------------------
// Code recipes
// ---------------------------------------------------------------------------

export interface RecipeSpec {
	family: AnalogFamily;
	band: BandType;
	order: number;
	f1: number;
	f2?: number;
	rp: number;
	rs: number;
	fs: number;
	besselNorm: BesselNorm;
	/** Specification mode: also show the *ord call. */
	spec?: { fp: number | [number, number]; fstop: number | [number, number] };
}

const fmt = (v: number) => num(v, 10);
const pyList = (v: number | [number, number]) => (Array.isArray(v) ? `[${v.map(fmt).join(', ')}]` : fmt(v));
const isBand = (b: BandType) => b === 'bandpass' || b === 'bandstop';

/** SciPy call that designs exactly this filter (bilinear with prewarping). */
export function scipyRecipe(r: RecipeSpec): string | null {
	const wn = isBand(r.band) ? `[${fmt(r.f1)}, ${fmt(r.f2 ?? r.f1 * 2)}]` : fmt(r.f1);
	const bt = `btype='${r.band}'`;
	const tail = `${bt}, fs=fs, output='sos'`;
	const calls: Partial<Record<AnalogFamily, string>> = {
		butter: `signal.butter(${r.order}, ${wn}, ${tail})`,
		cheby1: `signal.cheby1(${r.order}, ${fmt(r.rp)}, ${wn}, ${tail})`,
		cheby2: `signal.cheby2(${r.order}, ${fmt(r.rs)}, ${wn}, ${tail})`,
		ellip: `signal.ellip(${r.order}, ${fmt(r.rp)}, ${fmt(r.rs)}, ${wn}, ${tail})`,
		bessel: `signal.bessel(${r.order}, ${wn}, ${tail}, norm='${r.besselNorm}')`
	};
	const call = calls[r.family];
	if (!call) return null;
	let ord = '';
	if (r.spec) {
		const wp = pyList(r.spec.fp);
		const ws = pyList(r.spec.fstop);
		const ordFn: Partial<Record<AnalogFamily, string>> = {
			butter: `signal.buttord(${wp}, ${ws}, ${fmt(r.rp)}, ${fmt(r.rs)}, fs=fs)`,
			cheby1: `signal.cheb1ord(${wp}, ${ws}, ${fmt(r.rp)}, ${fmt(r.rs)}, fs=fs)`,
			cheby2: `signal.cheb2ord(${wp}, ${ws}, ${fmt(r.rp)}, ${fmt(r.rs)}, fs=fs)`,
			ellip: `signal.ellipord(${wp}, ${ws}, ${fmt(r.rp)}, ${fmt(r.rs)}, fs=fs)`
		};
		if (ordFn[r.family])
			ord = `# Order and natural frequencies from the specification\n# (gives N = ${r.order}; the Wn below is what this page uses):\n# N, Wn = ${ordFn[r.family]}\n`;
	}
	return `import numpy as np
from scipy import signal

fs = ${fmt(r.fs)}
${ord}sos = ${call}

w, h = signal.sosfreqz(sos, worN=4096, fs=fs)   # frequency response
y = signal.sosfilt(sos, x)                       # filter a signal x`;
}

/** MATLAB (Signal Processing Toolbox) equivalent. */
export function matlabRecipe(r: RecipeSpec): string | null {
	const nyq = 'fs/2';
	const wn = isBand(r.band) ? `[${fmt(r.f1)} ${fmt(r.f2 ?? r.f1 * 2)}]/(${nyq})` : `${fmt(r.f1)}/(${nyq})`;
	const ftype = { lowpass: "'low'", highpass: "'high'", bandpass: "'bandpass'", bandstop: "'stop'" }[r.band];
	const calls: Partial<Record<AnalogFamily, string>> = {
		butter: `butter(${r.order}, ${wn}, ${ftype})`,
		cheby1: `cheby1(${r.order}, ${fmt(r.rp)}, ${wn}, ${ftype})`,
		cheby2: `cheby2(${r.order}, ${fmt(r.rs)}, ${wn}, ${ftype})`,
		ellip: `ellip(${r.order}, ${fmt(r.rp)}, ${fmt(r.rs)}, ${wn}, ${ftype})`
	};
	const call = calls[r.family];
	if (!call) return null;
	return `fs = ${fmt(r.fs)};
[z, p, k] = ${call};
sos = zp2sos(z, p, k);          % gain folded into the first section

[h, f] = freqz(sos, 4096, fs);  % frequency response
y = sosfilt(sos, x);            % filter a signal x`;
}
