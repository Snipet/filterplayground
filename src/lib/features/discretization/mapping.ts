/**
 * Analog → digital mapping helpers: the six discretisation methods compared on
 * the page, their frequency-axis mappings and s → z point mappings (for the
 * s-plane grid visualisation).
 */
import { type Complex, abs, c, div, exp, add, scale, sub } from '$lib/dsp/complex';
import type { AnalogFamily } from '$lib/dsp/analog';
import { designAnalog, type IIRSpec } from '$lib/dsp/design';
import { bilinear, discretize, prewarp } from '$lib/dsp/transforms';
import { evaluate, findCrossing, linspace, logspace } from '$lib/dsp/response';
import {
	analogTimeResponse,
	digitalImpulseResponse,
	digitalStepResponse,
	suggestDigitalLength,
	suggestAnalogDuration
} from '$lib/dsp/time';
import type { BandType, ZPK } from '$lib/dsp/types';
import { formatSI } from '$lib/dsp/units';

export type MethodId =
	'bilinear-prewarp' | 'bilinear' | 'matched' | 'impulse' | 'backward-euler' | 'forward-euler';

export interface MethodInfo {
	id: MethodId;
	name: string;
	/** Fixed categorical colour (the analog reference uses --s1). */
	color: string;
	/** s → z relation, TeX. */
	formula: string;
}

export const ANALOG_COLOR = 'var(--s1)';

export const METHODS: MethodInfo[] = [
	{
		id: 'bilinear-prewarp',
		name: 'Bilinear, prewarped',
		color: 'var(--s2)',
		formula: 's = 2f_s\\frac{z-1}{z+1},\\ \\omega_c\\to 2f_s\\tan\\frac{\\omega_c}{2f_s}'
	},
	{
		id: 'bilinear',
		name: 'Bilinear (no prewarp)',
		color: 'var(--s3)',
		formula: 's = 2f_s\\frac{z-1}{z+1}'
	},
	{
		id: 'matched',
		name: 'Matched-Z',
		color: 'var(--s4)',
		formula: 'z_i = e^{s_i T},\\ p_i = e^{p_i T}'
	},
	{ id: 'impulse', name: 'Impulse invariance', color: 'var(--s5)', formula: 'h[n] = T\\,h(nT)' },
	{
		id: 'backward-euler',
		name: 'Backward Euler',
		color: 'var(--s6)',
		formula: 's = \\frac{z-1}{zT}'
	},
	{ id: 'forward-euler', name: 'Forward Euler', color: 'var(--s7)', formula: 's = \\frac{z-1}{T}' }
];

export const methodInfo = (id: MethodId): MethodInfo =>
	METHODS.find((m) => m.id === id) ?? METHODS[0];

const isBand = (b: BandType) => b === 'bandpass' || b === 'bandstop';

/** Analog frequency (Hz) that the bilinear transform maps onto digital frequency f. */
export const warpedHz = (f: number, fs: number): number =>
	prewarp(Math.min(f, 0.49999 * fs), fs) / (2 * Math.PI);

export interface MethodResult {
	/** The analog filter that was actually discretised (prewarped for 'bilinear-prewarp'). */
	analog: ZPK;
	zpk: ZPK;
	warning?: string;
	stable: boolean;
	maxPoleRadius: number;
}

/** Discretise the analog design `spec` (edges in Hz) with one of the six methods. */
export function discretizeWith(method: MethodId, spec: IIRSpec, fs: number): MethodResult {
	let analog: ZPK;
	let zpk: ZPK;
	let warning: string | undefined;
	if (method === 'bilinear-prewarp') {
		// Prewarping = designing the analog prototype at the warped edge frequencies
		analog = designAnalog({
			...spec,
			f1: warpedHz(spec.f1, fs),
			f2: isBand(spec.band) ? warpedHz(spec.f2 ?? spec.f1 * 2, fs) : undefined
		});
		zpk = bilinear(analog, fs);
	} else {
		analog = designAnalog(spec);
		const r = discretize(analog, fs, method);
		zpk = r.zpk;
		warning = r.warning;
	}
	const maxPoleRadius = Math.max(0, ...zpk.p.map(abs));
	return { analog, zpk, warning, stable: maxPoleRadius < 1, maxPoleRadius };
}

/**
 * Digital frequency (Hz) at which an analog frequency fa (Hz) appears.
 * `fRef` is the frequency matched by prewarping. For z = e^{sT} methods the
 * analog axis is folded (aliased) around multiples of fs/2; for the Euler
 * methods the jω axis does not land on the unit circle and this is the angle of
 * its image.
 */
export function digitalFrequency(method: MethodId, fa: number, fs: number, fRef: number): number {
	switch (method) {
		case 'bilinear':
			return (fs / Math.PI) * Math.atan((Math.PI * fa) / fs);
		case 'bilinear-prewarp': {
			const fr = Math.min(fRef, 0.49999 * fs);
			const k = Math.tan((Math.PI * fr) / fs) / ((Math.PI * fr) / fs);
			return (fs / Math.PI) * Math.atan((Math.PI * fa * k) / fs);
		}
		case 'matched':
		case 'impulse': {
			const r = ((fa % fs) + fs) % fs;
			return r <= fs / 2 ? r : fs - r;
		}
		case 'forward-euler':
		case 'backward-euler':
			return (fs / (2 * Math.PI)) * Math.atan((2 * Math.PI * fa) / fs);
	}
}

/** Map a point of the s-plane (rad/s) to the z-plane with a method's s ↔ z relation. */
export function mapS(method: MethodId, s: Complex, fs: number): Complex {
	const T = 1 / fs;
	switch (method) {
		case 'bilinear':
		case 'bilinear-prewarp':
			return div(add(c(1), scale(s, T / 2)), sub(c(1), scale(s, T / 2)));
		case 'matched':
		case 'impulse':
			return exp(scale(s, T));
		case 'forward-euler':
			return add(c(1), scale(s, T));
		case 'backward-euler':
			return div(c(1), sub(c(1), scale(s, T)));
	}
}

/** True for the methods that use z = e^{sT} (and therefore alias). */
export const usesExp = (m: MethodId): boolean => m === 'matched' || m === 'impulse';

// ---------------------------------------------------------------------------
// s-plane grid (coordinates in Hz: σ/2π, ω/2π)
// ---------------------------------------------------------------------------

export interface GridLine {
	kind: 'sigma' | 'omega' | 'jw';
	/** True for parts outside the primary strip |ω| ≤ π·fs. */
	aliased: boolean;
	/** Points in Hz units (s/2π). */
	pts: Complex[];
}

/** Dense near zero, then geometric out to ±big. */
function axisSamples(visible: number, big: number): number[] {
	const inner = linspace(-visible, visible, 241);
	const tail = logspace(visible * 1.02, big, 90);
	return [...tail.map((v) => -v).reverse(), ...inner, ...tail];
}

/**
 * Lines of constant σ and constant ω covering the visible square of half-width
 * R (Hz). For e^{sT} methods the lines are cut at the visible range (their images
 * wrap around); otherwise they extend far enough for the images to converge.
 */
export function sPlaneGrid(fs: number, R: number, method: MethodId): GridLine[] {
	const wraps = usesExp(method);
	const nyq = fs / 2;
	const out: GridLine[] = [];
	const wSamples = wraps ? linspace(-R, R, 721) : axisSamples(R, 200 * fs);
	const sigmaSamples = wraps
		? linspace(-R, 0, 241)
		: [
				...logspace(R * 1.02, 200 * fs, 60)
					.map((v) => -v)
					.reverse(),
				...linspace(-R, 0, 161)
			];
	// constant σ (σ = 0 is the jω axis)
	const sigmas = [-0.4, -0.2, -0.1, -0.05].map((k) => k * fs).filter((v) => -v <= R);
	for (const sg of [...sigmas, 0]) {
		const kind = sg === 0 ? 'jw' : 'sigma';
		// split into inside / outside the primary strip
		let cur: Complex[] = [];
		let curAliased = Math.abs(wSamples[0]) > nyq;
		for (const w of wSamples) {
			const al = Math.abs(w) > nyq;
			if (al !== curAliased && cur.length) {
				out.push({ kind, aliased: curAliased, pts: cur });
				cur = [cur[cur.length - 1]];
				curAliased = al;
			}
			cur.push(c(sg, w));
		}
		if (cur.length) out.push({ kind, aliased: curAliased, pts: cur });
	}
	// constant ω
	const step = fs / 8;
	for (let k = -Math.floor(R / step); k <= Math.floor(R / step); k++) {
		const w = k * step;
		out.push({
			kind: 'omega',
			aliased: Math.abs(w) > nyq + 1e-9,
			pts: sigmaSamples.map((sg) => c(sg, w))
		});
	}
	return out;
}

/** Image of a grid line (Hz units) under a method, in z coordinates. */
export function mapLine(method: MethodId, pts: Complex[], fs: number): Complex[] {
	return pts.map((p) => mapS(method, c(2 * Math.PI * p.re, 2 * Math.PI * p.im), fs));
}

// ---------------------------------------------------------------------------
// Comparison metrics
// ---------------------------------------------------------------------------

/**
 * Why band edges f1, f2 (Hz) cannot be designed at fs, or null. The design
 * uses each edge clamped to 0.99·fs/2, so two edges at or above that would
 * collapse into a zero-width band (gain 0, poles on the jω axis).
 */
export function bandEdgeError(f1: number, f2: number, fs: number): string | null {
	if (!(f1 < f2)) return 'The lower band edge must be below the upper band edge.';
	const top = 0.99 * (fs / 2);
	if (!(Math.min(f1, top) < Math.min(f2, top)))
		return `Both band edges are at or above 0.99·fs/2 = ${formatSI(top, 'Hz', 4)}, so clamping them leaves a band of zero width. Lower f₁ or raise fs.`;
	return null;
}

/** Frequencies (Hz) inside the passband of an analog design, below Nyquist. */
export function passbandGrid(
	band: BandType,
	f1: number,
	f2: number,
	fs: number,
	n = 300
): number[] {
	const nyq = fs / 2;
	const top = (f: number) => Math.min(f, nyq * 0.999);
	switch (band) {
		case 'lowpass':
			return logspace(Math.min(f1, nyq) / 1000, top(f1), n);
		case 'highpass':
			return f1 < nyq ? linspace(f1, nyq * 0.999, n) : [];
		case 'bandpass':
			return f1 < nyq ? linspace(f1, top(f2), n) : [];
		case 'bandstop':
			return [
				...logspace(Math.min(f1, nyq) / 1000, top(f1), n),
				...(f2 < nyq ? linspace(f2, nyq * 0.999, n) : [])
			];
	}
}

const HALF_POWER_DB = -10 * Math.log10(2);

/**
 * Walk on a log grid from a stopband edge `from` towards the passband `to` and
 * return where the analog gain first reaches −3 dB (`from` itself if it already does).
 */
function halfPowerFrom(analog: ZPK, from: number, to: number): number {
	const f = logspace(from, to, 2000);
	const db = evaluate({ kind: 'analog', zpk: analog }, f).magDb;
	if (db[0] >= HALF_POWER_DB) return from;
	return findCrossing(f, db, HALF_POWER_DB) ?? from;
}

/**
 * Edges (Hz) bounding the passband of an analog design, for passbandGrid. These
 * are the design edges f1, f2, except for Chebyshev II: its edges are stopband
 * edges (gain −Rs), so its passband ends at the −3 dB points of the response,
 * found between each stopband edge and the passband (unity gain).
 */
export function passbandEdges(
	analog: ZPK,
	family: AnalogFamily,
	band: BandType,
	f1: number,
	f2: number
): [number, number] {
	if (family !== 'cheby2') return [f1, f2];
	switch (band) {
		case 'lowpass':
			return [halfPowerFrom(analog, f1, f1 / 1e4), f2];
		case 'highpass':
			return [halfPowerFrom(analog, f1, f1 * 1e4), f2];
		case 'bandpass': {
			const f0 = Math.sqrt(f1 * f2);
			return [halfPowerFrom(analog, f1, f0), halfPowerFrom(analog, f2, f0)];
		}
		case 'bandstop':
			return [halfPowerFrom(analog, f1, f1 / 1e4), halfPowerFrom(analog, f2, f2 * 1e4)];
	}
}

/** Largest |dB difference| between digital and analog over frequencies f. */
export function maxDbError(analog: ZPK, digital: ZPK, fs: number, f: number[]): number {
	if (!f.length) return NaN;
	const a = evaluate({ kind: 'analog', zpk: analog }, f).magDb;
	const d = evaluate({ kind: 'digital', fs, zpk: digital }, f).magDb;
	let m = 0;
	for (let i = 0; i < f.length; i++) {
		const e = Math.abs(d[i] - a[i]);
		if (Number.isFinite(e) && e > m) m = e;
	}
	return m;
}

// ---------------------------------------------------------------------------
// Time responses
// ---------------------------------------------------------------------------

/** Samples drawn for the time responses of these digital results (TimeCard's default length). */
export function timeLength(digital: ZPK[], fs: number, analog?: ZPK): number {
	// with no digital result enabled the analog reference alone sets the length
	const fromAnalog =
		analog && digital.length === 0
			? Math.min(1024, Math.max(32, Math.ceil(suggestAnalogDuration(analog) * fs)))
			: 16;
	return Math.max(
		fromAnalog,
		...digital.map((zpk) => suggestDigitalLength({ kind: 'digital', fs, zpk }, 1024))
	);
}

/**
 * y-range clamp for the time-response plot of `results` over n samples. Only
 * an unstable result needs one (it would flatten everything else), so this is
 * undefined when all are stable; otherwise ±1.6× the largest |value| of the
 * analog reference (T·h(nT) and step) and of the stable results, impulse and
 * step, over the same n samples that are drawn.
 */
export function timeLimits(
	analog: ZPK,
	results: MethodResult[],
	fs: number,
	n: number
): [number, number] | undefined {
	if (results.every((r) => r.stable)) return undefined;
	let m = 1e-6;
	const take = (y: ArrayLike<number>, scale = 1) => {
		for (let i = 0; i < y.length; i++) {
			const v = Math.abs(y[i] * scale);
			if (v > m && Number.isFinite(v)) m = v;
		}
	};
	try {
		take(analogTimeResponse(analog, 'impulse', (n - 1) / fs, n).y, 1 / fs);
		take(analogTimeResponse(analog, 'step', (n - 1) / fs, n).y);
	} catch {
		/* analog reference unavailable */
	}
	for (const r of results) {
		if (!r.stable) continue;
		const f = { kind: 'digital' as const, fs, zpk: r.zpk };
		take(digitalImpulseResponse(f, n));
		take(digitalStepResponse(f, n));
	}
	return [-1.6 * m, 1.6 * m];
}
