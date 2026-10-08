/**
 * Loudspeaker crossover networks (analog prototypes, complex summation, digital
 * export) for the Crossover Designer page.
 *
 * Every way is a single analog ZPK in rad/s; polarity inversion and an optional
 * acoustic delay are applied when the ways are summed.
 */
import { type Complex, abs, add, c, div, mul, sub } from '$lib/dsp/complex';
import { besselap, buttap } from '$lib/dsp/analog';
import { polyadd, polyFromRoots, roots } from '$lib/dsp/poly';
import { bilinear, lp2hp, lp2lp, prewarp } from '$lib/dsp/transforms';
import { zpk2sos } from '$lib/dsp/convert';
import { freqsZpk, freqzSos } from '$lib/dsp/response';
import type { SOS, ZPK } from '$lib/dsp/types';

export type XoType = 'bw1' | 'bw2' | 'bw3' | 'bw4' | 'lr2' | 'lr4' | 'lr8' | 'bes2' | 'bes4';
export type WayId = 'low' | 'mid' | 'high';

export interface XoTypeInfo {
	id: XoType;
	name: string;
	/** Asymptotic slope in dB/octave. */
	slope: number;
	/**
	 * Polarity of the high-pass relative to the low-pass that gives the better sum
	 * in a 2-way system (+1 normal, −1 inverted).
	 */
	sigma: 1 | -1;
	/** With `sigma`, LP + σ·HP is an all-pass (flat magnitude). */
	allPass: boolean;
	family: 'butter' | 'lr' | 'bessel';
	order: number;
}

export const XO_TYPES: XoTypeInfo[] = [
	{
		id: 'bw1',
		name: 'Butterworth 1st order',
		slope: 6,
		sigma: 1,
		allPass: true,
		family: 'butter',
		order: 1
	},
	{
		id: 'bw2',
		name: 'Butterworth 2nd order',
		slope: 12,
		sigma: -1,
		allPass: false,
		family: 'butter',
		order: 2
	},
	{
		id: 'bw3',
		name: 'Butterworth 3rd order',
		slope: 18,
		sigma: 1,
		allPass: true,
		family: 'butter',
		order: 3
	},
	{
		id: 'bw4',
		name: 'Butterworth 4th order',
		slope: 24,
		sigma: 1,
		allPass: false,
		family: 'butter',
		order: 4
	},
	{
		id: 'lr2',
		name: 'Linkwitz–Riley LR2 (12 dB/oct)',
		slope: 12,
		sigma: -1,
		allPass: true,
		family: 'lr',
		order: 2
	},
	{
		id: 'lr4',
		name: 'Linkwitz–Riley LR4 (24 dB/oct)',
		slope: 24,
		sigma: 1,
		allPass: true,
		family: 'lr',
		order: 4
	},
	{
		id: 'lr8',
		name: 'Linkwitz–Riley LR8 (48 dB/oct)',
		slope: 48,
		sigma: 1,
		allPass: true,
		family: 'lr',
		order: 8
	},
	{
		id: 'bes2',
		name: 'Bessel 2nd order',
		slope: 12,
		sigma: -1,
		allPass: false,
		family: 'bessel',
		order: 2
	},
	{
		id: 'bes4',
		name: 'Bessel 4th order',
		slope: 24,
		sigma: 1,
		allPass: false,
		family: 'bessel',
		order: 4
	}
];

export const xoInfo = (id: XoType): XoTypeInfo => XO_TYPES.find((t) => t.id === id) ?? XO_TYPES[5];

/** Low-pass prototype with its crossover point at ω = 1 rad/s. */
export function xoPrototype(type: XoType): ZPK {
	const info = xoInfo(type);
	if (info.family === 'butter') return buttap(info.order);
	if (info.family === 'bessel') return besselap(info.order, 'phase');
	// Linkwitz–Riley: Butterworth of half the order, squared (−6 dB at ω = 1)
	const b = buttap(info.order / 2);
	return { z: [], p: [...b.p, ...b.p], k: b.k * b.k };
}

export const lowpass = (type: XoType, wc: number): ZPK => lp2lp(xoPrototype(type), wc);
export const highpass = (type: XoType, wc: number): ZPK => lp2hp(xoPrototype(type), wc);

/** Product of two ZPKs (cascade). */
export function mulZpk(a: ZPK, b: ZPK): ZPK {
	return { z: [...a.z, ...b.z], p: [...a.p, ...b.p], k: a.k * b.k };
}

export const negZpk = (a: ZPK): ZPK => ({ ...a, k: -a.k });

/** Remove zero/pole pairs that coincide (relative tolerance). */
export function cancelCommon(zpk: ZPK, tol = 1e-7): ZPK {
	const z = [...zpk.z];
	const p = [...zpk.p];
	for (let i = z.length - 1; i >= 0; i--) {
		const j = p.findIndex((q) => abs(sub(q, z[i])) <= tol * Math.max(1, abs(q)));
		if (j >= 0) {
			z.splice(i, 1);
			p.splice(j, 1);
		}
	}
	return { z, p, k: zpk.k };
}

/**
 * Rebuild an (approximately) all-pass ZPK exactly: zeros are the poles mirrored in
 * the jω axis, and the gain keeps the value at s = 0.
 */
export function exactAllPass(ap: ZPK): ZPK {
	const z = ap.p.map((q) => c(-q.re, q.im));
	// |k| = 1 because |zᵢ| = |pᵢ|; the sign follows the approximate all-pass at DC
	const unit = freqsZpk({ z, p: ap.p, k: 1 }, [0])[0].re;
	const h0 = freqsZpk(ap, [0])[0].re;
	return { z, p: [...ap.p], k: Math.sign(h0) * Math.sign(unit) || 1 };
}

function samePoles(a: readonly Complex[], b: readonly Complex[]): boolean {
	if (a.length !== b.length) return false;
	const used = new Array(b.length).fill(false);
	for (const q of a) {
		const j = b.findIndex((r, i) => !used[i] && abs(sub(q, r)) <= 1e-9 * Math.max(1, abs(q)));
		if (j < 0) return false;
		used[j] = true;
	}
	return true;
}

/** Sum of two analog ZPKs as one ZPK (common denominator, then cancellation). */
export function addZpk(a: ZPK, b: ZPK): ZPK {
	const na = polyFromRoots(a.z).map((v) => v * a.k);
	const nb = polyFromRoots(b.z).map((v) => v * b.k);
	let num: number[];
	let mag: number[]; // magnitude of the terms summed into each coefficient (cancellation scale)
	let poles: Complex[];
	const absAdd = (x: number[], y: number[]) => polyadd(x.map(Math.abs), y.map(Math.abs));
	if (samePoles(a.p, b.p)) {
		num = polyadd(na, nb);
		mag = absAdd(na, nb);
		poles = [...a.p];
	} else {
		const da = polyFromRoots(a.p);
		const db = polyFromRoots(b.p);
		const t1 = polymulReal(na, db);
		const t2 = polymulReal(nb, da);
		num = polyadd(t1, t2);
		mag = absAdd(t1, t2);
		poles = [...a.p, ...b.p];
	}
	// drop leading coefficients that cancelled
	while (num.length > 1 && Math.abs(num[0]) <= 1e-12 * mag[0]) {
		num.shift();
		mag.shift();
	}
	const zeros = num.length > 1 ? roots(num) : [];
	return cancelCommon({ z: zeros, p: poles, k: num[0] });
}

function polymulReal(a: readonly number[], b: readonly number[]): number[] {
	const out = new Array<number>(a.length + b.length - 1).fill(0);
	for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
	return out;
}

// ---------------------------------------------------------------------------
// Crossover assembly
// ---------------------------------------------------------------------------

export interface XoConfig {
	type: XoType;
	ways: 2 | 3;
	/** Crossover frequencies in Hz: [f] for 2-way, [f1, f2] for 3-way. */
	freqs: number[];
	/** 3-way only: add the upper section's all-pass to the low way so the sum is exact. */
	compensate?: boolean;
	invert: Record<WayId, boolean>;
	/** Delay of the high-frequency driver in seconds (acoustic offset). */
	highDelay: number;
}

export interface Way {
	id: WayId;
	label: string;
	zpk: ZPK;
	sign: 1 | -1;
	delay: number;
}

/** Build the ways (all in rad/s). Inversions and delays are kept separate from the ZPK. */
export function buildWays(
	cfg: XoConfig,
	freqScale: (fHz: number) => number = (f) => 2 * Math.PI * f
): Way[] {
	const info = xoInfo(cfg.type);
	const sgn = (w: WayId): 1 | -1 => (cfg.invert[w] ? -1 : 1);
	if (cfg.ways === 2) {
		const w = freqScale(cfg.freqs[0]);
		return [
			{ id: 'low', label: 'Low', zpk: lowpass(cfg.type, w), sign: sgn('low'), delay: 0 },
			{
				id: 'high',
				label: 'High',
				zpk: highpass(cfg.type, w),
				sign: sgn('high'),
				delay: cfg.highDelay
			}
		];
	}
	const w1 = freqScale(cfg.freqs[0]);
	const w2 = freqScale(cfg.freqs[1]);
	const lp1 = lowpass(cfg.type, w1);
	const hp1 = highpass(cfg.type, w1);
	const lp2 = lowpass(cfg.type, w2);
	const hp2 = highpass(cfg.type, w2);
	if (cfg.compensate && info.allPass) {
		const ap2 = exactAllPass(addZpk(lp2, info.sigma === 1 ? hp2 : negZpk(hp2)));
		return [
			{ id: 'low', label: 'Low', zpk: mulZpk(lp1, ap2), sign: sgn('low'), delay: 0 },
			{ id: 'mid', label: 'Mid', zpk: mulZpk(hp1, lp2), sign: sgn('mid'), delay: 0 },
			{ id: 'high', label: 'High', zpk: mulZpk(hp1, hp2), sign: sgn('high'), delay: cfg.highDelay }
		];
	}
	return [
		{ id: 'low', label: 'Low', zpk: lp1, sign: sgn('low'), delay: 0 },
		{ id: 'mid', label: 'Mid', zpk: mulZpk(hp1, lp2), sign: sgn('mid'), delay: 0 },
		{ id: 'high', label: 'High', zpk: hp2, sign: sgn('high'), delay: cfg.highDelay }
	];
}

/** Recommended polarity inversions for a type and number of ways. */
export function recommendedInvert(type: XoType, ways: 2 | 3): Record<WayId, boolean> {
	const s = xoInfo(type).sigma;
	if (ways === 2) return { low: false, mid: false, high: s === -1 };
	// (LP1 + σHP1)(LP2 + σHP2) = LP1·AP2 + σ·HP1·LP2 + σ²·HP1·HP2
	return { low: false, mid: s === -1, high: false };
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/** H(jω) and dH/dω of one way, including its sign and delay. */
export function wayResponse(way: Way, w: number): { H: Complex; dH: Complex } {
	const s = c(0, w);
	let H = c(way.zpk.k * way.sign);
	let sum = c(0); // Σ 1/(jω − z) − Σ 1/(jω − p)
	for (const z of way.zpk.z) {
		const d = sub(s, z);
		H = mul(H, d);
		sum = add(sum, div(c(1), d));
	}
	for (const p of way.zpk.p) {
		const d = sub(s, p);
		H = div(H, d);
		sum = sub(sum, div(c(1), d));
	}
	if (way.delay !== 0) {
		const ph = -w * way.delay;
		H = mul(H, c(Math.cos(ph), Math.sin(ph)));
	}
	// d/dω [H0(jω) e^{−jωτ}] = H·(j·sum − jτ)
	return { H, dH: mul(mul(H, c(0, 1)), sub(sum, c(way.delay))) };
}

export interface XoResponse {
	f: number[];
	ways: { id: WayId; label: string; H: Complex[]; magDb: number[]; phaseDeg: number[] }[];
	sum: { H: Complex[]; magDb: number[]; phaseDeg: number[]; groupDelay: number[] };
	powerDb: number[];
}

const toDb = (m: number) => 20 * Math.log10(Math.max(m, 1e-12));

function unwrapDeg(rad: number[]): number[] {
	const out: number[] = [];
	let off = 0;
	for (let i = 0; i < rad.length; i++) {
		if (i > 0) {
			let d = rad[i] + off - out[i - 1];
			while (d > Math.PI) {
				off -= 2 * Math.PI;
				d -= 2 * Math.PI;
			}
			while (d < -Math.PI) {
				off += 2 * Math.PI;
				d += 2 * Math.PI;
			}
		}
		out.push(rad[i] + off);
	}
	return out.map((v) => (v * 180) / Math.PI);
}

export function evaluateCrossover(ways: Way[], fHz: readonly number[]): XoResponse {
	const per = ways.map((w) => ({
		id: w.id,
		label: w.label,
		H: [] as Complex[],
		dH: [] as Complex[]
	}));
	const S: Complex[] = [];
	const gd: number[] = [];
	const power: number[] = [];
	for (const f of fHz) {
		const w = 2 * Math.PI * f;
		let sH = c(0);
		let sdH = c(0);
		let pw = 0;
		ways.forEach((way, i) => {
			const r = wayResponse(way, w);
			per[i].H.push(r.H);
			sH = add(sH, r.H);
			sdH = add(sdH, r.dH);
			const m = abs(r.H);
			pw += m * m;
		});
		S.push(sH);
		const m2 = sH.re * sH.re + sH.im * sH.im;
		// τ = −dφ/dω = −Im(S′/S)
		gd.push(m2 > 1e-24 ? -(sdH.im * sH.re - sdH.re * sH.im) / m2 : NaN);
		power.push(10 * Math.log10(Math.max(pw, 1e-24)));
	}
	return {
		f: [...fHz],
		ways: per.map((p) => ({
			id: p.id,
			label: p.label,
			H: p.H,
			magDb: p.H.map((h) => toDb(abs(h))),
			phaseDeg: unwrapDeg(p.H.map((h) => Math.atan2(h.im, h.re)))
		})),
		sum: {
			H: S,
			magDb: S.map((h) => toDb(abs(h))),
			phaseDeg: unwrapDeg(S.map((h) => Math.atan2(h.im, h.re))),
			groupDelay: gd
		},
		powerDb: power
	};
}

/** Phase of b relative to a, wrapped to (−180°, 180°]. */
export function phaseDifferenceDeg(a: Complex, b: Complex): number {
	const r = div(b, a);
	let d = (Math.atan2(r.im, r.re) * 180) / Math.PI;
	if (d <= -180) d += 360;
	return d;
}

// ---------------------------------------------------------------------------
// Digital export (bilinear transform, pre-warped at every crossover frequency)
// ---------------------------------------------------------------------------

export interface DigitalWay {
	id: WayId;
	label: string;
	sos: SOS;
	/** Integer delay (samples) that approximates the requested acoustic offset. */
	delaySamples: number;
}

export function digitalWays(cfg: XoConfig, fs: number): DigitalWay[] {
	const ways = buildWays(cfg, (f) => prewarp(f, fs));
	return ways.map((w) => {
		const zd = bilinear({ ...w.zpk, k: w.zpk.k * w.sign }, fs);
		return { id: w.id, label: w.label, sos: zpk2sos(zd), delaySamples: Math.round(w.delay * fs) };
	});
}

/** Complex sum of the digital ways at frequencies fHz (including integer delays). */
export function digitalSum(ways: DigitalWay[], fs: number, fHz: readonly number[]): Complex[] {
	const w = fHz.map((f) => (2 * Math.PI * f) / fs);
	const out = w.map(() => c(0));
	for (const way of ways) {
		const H = freqzSos(way.sos, w);
		for (let i = 0; i < w.length; i++) {
			const ph = -w[i] * way.delaySamples;
			out[i] = add(out[i], mul(H[i], c(Math.cos(ph), Math.sin(ph))));
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// Passive networks for a resistive driver load R
// ---------------------------------------------------------------------------

export type PassiveType = 'bw1' | 'bw2' | 'lr2';

export interface PassiveValues {
	/** Low-pass: series inductor (H) and, for 2nd order, a capacitor across the driver (F). */
	lowL: number;
	lowC?: number;
	/** High-pass: series capacitor (F) and, for 2nd order, an inductor across the driver (H). */
	highC: number;
	highL?: number;
	q?: number;
}

/**
 * 1st order:  L = R/ωc,  C = 1/(ωc·R).
 * 2nd order:  H_LP = 1/(s²LC + sL/R + 1) → ω0 = 1/√(LC), Q = R·√(C/L), so
 *             L = R/(Q·ωc),  C = Q/(R·ωc)   (Q = 1/√2 Butterworth, 1/2 Linkwitz–Riley);
 *             the high-pass (series C, shunt L) has the same denominator and values.
 */
export function passiveValues(type: PassiveType, fc: number, R: number): PassiveValues {
	const wc = 2 * Math.PI * fc;
	if (type === 'bw1') return { lowL: R / wc, highC: 1 / (wc * R) };
	const q = type === 'bw2' ? Math.SQRT1_2 : 0.5;
	const L = R / (q * wc);
	const C = q / (R * wc);
	return { lowL: L, lowC: C, highC: C, highL: L, q };
}

/** Voltage across the (resistive) driver divided by the source voltage, per section. */
export function simulatePassive(
	v: PassiveValues,
	R: number,
	fHz: readonly number[]
): { low: Complex[]; high: Complex[] } {
	const low: Complex[] = [];
	const high: Complex[] = [];
	const par = (a: Complex, b: Complex) => div(mul(a, b), add(a, b));
	for (const f of fHz) {
		const s = c(0, 2 * Math.PI * f);
		const r = c(R);
		// low-pass: series L, then (C ∥ R)
		const zsL = mul(s, c(v.lowL));
		const zpL = v.lowC !== undefined ? par(r, div(c(1), mul(s, c(v.lowC)))) : r;
		low.push(div(zpL, add(zsL, zpL)));
		// high-pass: series C, then (L ∥ R)
		const zsH = div(c(1), mul(s, c(v.highC)));
		const zpH = v.highL !== undefined ? par(r, mul(s, c(v.highL))) : r;
		high.push(div(zpH, add(zsH, zpH)));
	}
	return { low, high };
}
