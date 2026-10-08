/**
 * Helpers for the Digital IIR Designer: per-section pole/zero summaries, a
 * coefficient-sensitivity check (one b/a vs. second-order sections in float32),
 * spec-mask verification, order estimation under the page's order cap, the
 * band-edge −3 dB frequency and SciPy / MATLAB recipes.
 */
import { type Complex, abs } from '$lib/dsp/complex';
import { sos2tf, tf2zpk } from '$lib/dsp/convert';
import { roots } from '$lib/dsp/poly';
import { evaluate, freqzSos, linspace, logspace, toDb } from '$lib/dsp/response';
import { type AnalogFamily, type BesselNorm, estimateOrder } from '$lib/dsp/analog';
import { type OrderEstimate, type SpecEdges, estimateFromSpecs } from '$lib/dsp/design';
import { prewarp } from '$lib/dsp/transforms';
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
	return {
		coef,
		poles: zpk.p,
		zeros: zpk.z,
		poleR,
		poleAngle,
		order: coef[4] === 0 && coef[2] === 0 ? 1 : 2
	};
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

/** Spec-mode band edges (Hz) for each response type. */
export type SpecTable = Record<BandType, { fp: [number, number]; fs: [number, number] }>;

/**
 * Validate the spec table of a shared link (links can be edited by hand). Each
 * band's entry is taken only when fp and fs are both pairs of finite positive
 * numbers; anything else keeps the band's current edges, and unknown keys are
 * ignored. Edges that are out of order or above Nyquist are left to the page's
 * own spec checks.
 */
export function restoreSpecs(current: SpecTable, raw: unknown): SpecTable {
	const pos = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;
	const pair = (v: unknown): v is [number, number] =>
		Array.isArray(v) && v.length === 2 && v.every(pos);
	const out = { ...current };
	if (!raw || typeof raw !== 'object') return out;
	for (const b of Object.keys(current) as BandType[]) {
		const v = (raw as Record<string, unknown>)[b] as { fp?: unknown; fs?: unknown } | null;
		if (v && typeof v === 'object' && pair(v.fp) && pair(v.fs))
			out[b] = { fp: [v.fp[0], v.fp[1]], fs: [v.fs[0], v.fs[1]] };
	}
	return out;
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

export interface CappedEstimate extends OrderEstimate {
	/**
	 * Order the specification asks for before any cap (what SciPy's *ord functions
	 * return); undefined when it lies beyond the family's searchable range.
	 */
	requiredOrder?: number;
}

/**
 * estimateFromSpecs under a lower order cap than the family's own maximum. When
 * the specification needs more than `maxOrder`, the filter is designed at
 * maxOrder with its natural frequencies recomputed for that order, so the
 * passband edge still sits at exactly −Rp (the rule estimateOrder applies at the
 * family cap). Without this, Butterworth and Chebyshev II would be designed at
 * the lower order with a natural frequency meant for the higher one.
 */
export function estimateCapped(
	family: AnalogFamily,
	spec: SpecEdges,
	opts: { besselNorm?: BesselNorm; maxOrder?: number } = {}
): CappedEstimate {
	const o = { besselNorm: opts.besselNorm };
	const est = estimateFromSpecs(family, spec, o);
	if (est.error) return est;
	const sel = est.selectivity;
	const needed = estimateOrder(family, sel, spec.rp, spec.rs, o);
	const requiredOrder = needed.capped ? undefined : needed.N;
	const cap = Math.max(1, Math.floor(opts.maxOrder ?? Infinity));
	if (!(est.order > cap)) return { ...est, requiredOrder };
	// The natural frequency scales the prototype: ω = wn at the passband edge
	// (low-pass), 1/wn (high-pass), and the band-pass (band-stop) bandwidth by
	// wn (1/wn) around the same centre. Rescale the edges by wn(cap)/wn(order).
	const rho =
		estimateOrder(family, sel, spec.rp, spec.rs, o, cap).wn /
		estimateOrder(family, sel, spec.rp, spec.rs, o, est.order).wn;
	const fs = spec.fs;
	const toW = (f: number) => (fs ? prewarp(f, fs) : 2 * Math.PI * f);
	const fromW = (w: number) => (fs ? (fs / Math.PI) * Math.atan(w / (2 * fs)) : w / (2 * Math.PI));
	let f1: number;
	let f2: number | undefined;
	if (spec.band === 'lowpass') f1 = fromW(toW(est.f1) * rho);
	else if (spec.band === 'highpass') f1 = fromW(toW(est.f1) / rho);
	else {
		const w1 = toW(est.f1);
		const w2 = toW(est.f2 ?? est.f1);
		const W = spec.band === 'bandpass' ? (w2 - w1) * rho : (w2 - w1) / rho;
		const r = Math.sqrt(W * W + 4 * w1 * w2);
		f1 = fromW((r - W) / 2);
		f2 = fromW((r + W) / 2);
	}
	return { ...est, order: cap, f1, f2, capped: true, requiredOrder };
}

/**
 * The −3 dB frequency (or any `levelDb` relative to the peak) of a digital low-
 * or high-pass: the crossing at the band edge, found coming in from the stopband
 * so that passband ripple deeper than the level is skipped, then refined by
 * bisection on single-frequency evaluations. A linear grid alone is too coarse
 * for low cut-offs (6 Hz steps at 48 kHz). null if the level is never crossed.
 */
export function edgeCrossing(
	filter: DigitalFilter,
	band: 'lowpass' | 'highpass',
	levelDb = -10 * Math.log10(2)
): number | null {
	const nyq = filter.fs / 2;
	// log spacing resolves low cut-offs, linear spacing the region near Nyquist
	const grid = [...logspace(nyq * 1e-6, nyq, 2000), ...linspace(0, nyq, 2001)].sort(
		(a, b) => a - b
	);
	// magnitude only (evaluate() would also compute the group delay)
	const sos = filter.sos;
	const magDb = (f: number[]): number[] =>
		sos
			? freqzSos(
					sos,
					f.map((v) => (2 * Math.PI * v) / filter.fs)
				).map((h) => toDb(abs(h)))
			: evaluate(filter, f).magDb;
	const db = (f: number) => magDb([f])[0];
	const r = magDb(grid);
	let iPeak = -1;
	for (let i = 0; i < r.length; i++)
		if (Number.isFinite(r[i]) && (iPeak < 0 || r[i] > r[iPeak])) iPeak = i;
	if (iPeak < 0) return null;
	// refine the peak between its grid neighbours (golden-section search)
	let a = grid[Math.max(0, iPeak - 1)];
	let b = grid[Math.min(grid.length - 1, iPeak + 1)];
	const g = (Math.sqrt(5) - 1) / 2;
	for (let i = 0; i < 60 && b - a > 1e-12 * nyq; i++) {
		const x1 = b - g * (b - a);
		const x2 = a + g * (b - a);
		if (db(x1) < db(x2)) a = x1;
		else b = x2;
	}
	const peak = Math.max(r[iPeak], db((a + b) / 2));
	const above = (v: number) => v - peak >= levelDb;
	// LP: the last fall below the level; HP: the first rise above it
	let lo = -1;
	if (band === 'lowpass') {
		for (let i = grid.length - 1; i > 0 && lo < 0; i--)
			if (above(r[i - 1]) && !above(r[i])) lo = i - 1;
	} else {
		for (let i = 1; i < grid.length && lo < 0; i++) if (!above(r[i - 1]) && above(r[i])) lo = i - 1;
	}
	if (lo < 0) return null;
	let fa = grid[lo];
	let fb = grid[lo + 1];
	const aAbove = above(r[lo]);
	for (let i = 0; i < 100 && fb - fa > 1e-12 * fb; i++) {
		const m = (fa + fb) / 2;
		if (above(db(m)) === aAbove) fa = m;
		else fb = m;
	}
	return (fa + fb) / 2;
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
	/** Specification mode: `order` is a cap, below what the specification needs. */
	capped?: boolean;
	/** With `capped`: the order the specification asks for, if known. */
	requiredOrder?: number;
}

const fmt = (v: number) => num(v, 10);
const pyList = (v: number | [number, number]) =>
	Array.isArray(v) ? `[${v.map(fmt).join(', ')}]` : fmt(v);
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
		const fn = ordFn[r.family];
		if (fn && r.capped) {
			const needs = r.requiredOrder ? `gives N = ${r.requiredOrder}` : 'gives a higher order';
			ord =
				`# Order and natural frequencies from the specification:\n# N, Wn = ${fn}\n` +
				`# ${needs}, more than this page's maximum. The call below designs at\n` +
				`# N = ${r.order} with the Wn this page computed for that order: the passband\n` +
				`# edge stays exact and the stopband attenuation falls short of the spec.\n`;
		} else if (fn)
			ord = `# Order and natural frequencies from the specification\n# (gives N = ${r.order}; the Wn below is what this page uses):\n# N, Wn = ${fn}\n`;
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
	const wn = isBand(r.band)
		? `[${fmt(r.f1)} ${fmt(r.f2 ?? r.f1 * 2)}]/(${nyq})`
		: `${fmt(r.f1)}/(${nyq})`;
	const ftype = {
		lowpass: "'low'",
		highpass: "'high'",
		bandpass: "'bandpass'",
		bandstop: "'stop'"
	}[r.band];
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
