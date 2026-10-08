/**
 * Minimum-order computation for every IIR family plus FIR length estimates,
 * for one passband/stopband specification.
 */
import { FAMILIES, estimateOrder, findLevel, prototype, type AnalogFamily } from '$lib/dsp/analog';
import type { SpecEdges } from '$lib/dsp/design';
import { abs } from '$lib/dsp/complex';
import { zpk2sos } from '$lib/dsp/convert';
import { kaiserOrder } from '$lib/dsp/windows';
import { passbandRippleToDelta, remezOrderEstimate, stopbandAttenToDelta } from '$lib/dsp/fir';
import { evaluate, freqsZpk, linspace, logspace } from '$lib/dsp/response';
import { bilinear, prewarp, transformPrototype } from '$lib/dsp/transforms';
import type { BandType, Filter, ZPK } from '$lib/dsp/types';

export interface OrderSpec {
	domain: 'analog' | 'digital';
	/** Sampling rate, Hz (digital only). */
	fs: number;
	band: BandType;
	/** Passband edge(s), Hz; for LP/HP only [0] is used. */
	fp: [number, number];
	/** Stopband edge(s), Hz; for LP/HP only [0] is used. */
	fst: [number, number];
	rp: number;
	rs: number;
}

export const isBand = (b: BandType): boolean => b === 'bandpass' || b === 'bandstop';

/** Human-readable problem with the specification, or null if it is valid. */
export function validateSpec(s: OrderSpec): string | null {
	const edges = isBand(s.band) ? [...s.fp, ...s.fst] : [s.fp[0], s.fst[0]];
	if (edges.some((e) => !(e > 0) || !Number.isFinite(e)))
		return 'All band edges must be positive frequencies.';
	if (s.domain === 'digital') {
		if (!(s.fs > 0)) return 'The sample rate must be positive.';
		if (edges.some((e) => e >= s.fs / 2))
			return `All band edges must lie below the Nyquist frequency fs/2 = ${s.fs / 2} Hz.`;
	}
	if (!(s.rp > 0)) return 'The passband ripple Rp must be greater than 0 dB.';
	if (!(s.rs > s.rp)) return 'The stopband attenuation Rs must exceed the passband ripple Rp.';
	const [p1, p2] = s.fp;
	const [s1, s2] = s.fst;
	switch (s.band) {
		case 'lowpass':
			return s1 > p1
				? null
				: 'For a low-pass filter the stopband edge must be above the passband edge.';
		case 'highpass':
			return s1 < p1
				? null
				: 'For a high-pass filter the stopband edge must be below the passband edge.';
		case 'bandpass':
			return s1 < p1 && p1 < p2 && p2 < s2
				? null
				: 'For a band-pass filter the edges must be ordered: stop₁ < pass₁ < pass₂ < stop₂.';
		case 'bandstop':
			return p1 < s1 && s1 < s2 && s2 < p2
				? null
				: 'For a band-stop filter the edges must be ordered: pass₁ < stop₁ < stop₂ < pass₂.';
	}
}

export function specEdges(s: OrderSpec): SpecEdges {
	const band = isBand(s.band);
	return {
		band: s.band,
		fp: band ? [s.fp[0], s.fp[1]] : s.fp[0],
		fstop: band ? [s.fst[0], s.fst[1]] : s.fst[0],
		rp: s.rp,
		rs: s.rs,
		fs: s.domain === 'digital' ? s.fs : undefined
	};
}

// ---------------------------------------------------------------------------
// Selectivity and discrimination
// ---------------------------------------------------------------------------

/** Discrimination factor k₁ = εp/εs = √((10^(Rp/10) − 1)/(10^(Rs/10) − 1)). */
export const discrimination = (rp: number, rs: number): number =>
	Math.sqrt((Math.pow(10, rp / 10) - 1) / (Math.pow(10, rs / 10) - 1));

/** Prototype frequency (rad/s) of a band edge: prewarped for digital specs. */
const toW = (s: OrderSpec, f: number): number =>
	s.domain === 'digital' ? prewarp(f, s.fs) : 2 * Math.PI * f;
const fromW = (s: OrderSpec, w: number): number =>
	s.domain === 'digital' ? (s.fs / Math.PI) * Math.atan(w / (2 * s.fs)) : w / (2 * Math.PI);

/** Ωs of the equivalent low-pass prototype for edges in rad/s (passband edge → 1). */
function protoSelectivity(band: BandType, [p1, p2]: number[], [s1, s2]: number[]): number {
	switch (band) {
		case 'lowpass':
			return s1 / p1;
		case 'highpass':
			return p1 / s1;
		case 'bandpass': {
			const B = p2 - p1;
			const w02 = p1 * p2;
			return Math.min(Math.abs((s1 * s1 - w02) / (B * s1)), Math.abs((s2 * s2 - w02) / (B * s2)));
		}
		case 'bandstop': {
			const B = p2 - p1;
			const w02 = p1 * p2;
			return Math.min(Math.abs((B * s1) / (w02 - s1 * s1)), Math.abs((B * s2) / (w02 - s2 * s2)));
		}
	}
}

/**
 * Passband edges (rad/s, prewarped for digital specs) that set the order. For band-stop
 * specs each passband edge is first slid towards the stopband as far as that raises Ωs, as
 * SciPy's buttord / cheb1ord / cheb2ord / ellipord do (band_stop_obj): the filter then meets
 * Rp over a wider passband than asked, and the order can only drop. Otherwise as given.
 */
function orderPassband(s: OrderSpec): [number, number] {
	let [p1, p2] = s.fp.map((f) => toW(s, f));
	const [s1, s2] = s.fst.map((f) => toW(s, f));
	if (s.band === 'bandstop' && p1 < s1 && s2 < p2) {
		const sel = (a: number, b: number) => protoSelectivity('bandstop', [a, b], [s1, s2]);
		p1 = goldenMax((a) => sel(a, p2), p1, s1 - 1e-9 * s1);
		p2 = goldenMax((b) => sel(p1, b), s2 + 1e-9 * s2, p2);
	}
	return [p1, p2];
}

/**
 * Selectivity of the equivalent low-pass prototype, Ωs ≥ 1 (the stopband edge
 * in units of the passband edge), after bilinear prewarping for digital specs.
 * This is the Ωs that sets the orders in the table: band-stop passband edges are
 * first optimised as in SciPy (see {@link orderPassband}); pass `asGiven = true`
 * for the value with the edges exactly as entered.
 */
export function selectivity(s: OrderSpec, asGiven = false): number {
	const pass = asGiven ? s.fp.map((f) => toW(s, f)) : orderPassband(s);
	const stop = s.fst.map((f) => toW(s, f));
	return protoSelectivity(s.band, pass, stop);
}

/**
 * Passband edges (Hz) that set the order: the entered ones, except that band-stop
 * edges are slid towards the stopband as in SciPy (see {@link selectivity}).
 */
export function orderPassbandHz(s: OrderSpec): [number, number] {
	const [p1, p2] = orderPassband(s);
	return [fromW(s, p1), fromW(s, p2)];
}

/** Transition bands as [passband edge, stopband edge] pairs (Hz). */
function transitions(s: OrderSpec): [number, number][] {
	const [p1, p2] = s.fp;
	const [s1, s2] = s.fst;
	switch (s.band) {
		case 'lowpass':
		case 'highpass':
			return [[p1, s1]];
		case 'bandpass':
		case 'bandstop':
			return [
				[p1, s1],
				[p2, s2]
			];
	}
}

/**
 * Narrowest transition band (in Hz): its width in Hz and in octaves, log2 of the
 * ratio of its two edges, and the edges themselves (low, high).
 */
export function narrowestTransition(s: OrderSpec): {
	hz: number;
	octaves: number;
	edges: [number, number];
} {
	let best: { hz: number; octaves: number; edges: [number, number] } | null = null;
	for (const [p, st] of transitions(s)) {
		const lo = Math.min(p, st);
		const hi = Math.max(p, st);
		const t = { hz: hi - lo, octaves: Math.log2(hi / lo), edges: [lo, hi] as [number, number] };
		if (!best || t.hz < best.hz || (t.hz === best.hz && t.octaves < best.octaves)) best = t;
	}
	return best!;
}

/** Narrowest transition band, Hz. */
export function transitionHz(s: OrderSpec): number {
	return narrowestTransition(s).hz;
}

// ---------------------------------------------------------------------------
// IIR families
// ---------------------------------------------------------------------------

export interface IirResult {
	family: AnalogFamily;
	name: string;
	/** Index in FAMILIES — fixes the series colour. */
	index: number;
	order: number;
	capped: boolean;
	maxOrder: number;
	f1: number;
	f2?: number;
	cutoffMeaning: string;
	/** Number of poles of the final filter (2N for band filters). */
	poles: number;
	biquads: number;
	firstOrder: number;
	/** Multiplications per sample: 5 per biquad, 3 per first-order section. */
	mults: number;
	/** Worst attenuation inside the passband(s), dB (≥ 0). */
	passAtt: number;
	/** Worst (smallest) attenuation inside the stopband(s), dB. */
	stopAtt: number;
	filter: Filter;
	error?: string;
}

const CUTOFF_MEANING: Record<AnalogFamily, string> = {
	butter: '−3 dB frequency',
	cheby1: 'passband edge',
	cheby2: 'stopband edge',
	ellip: 'passband edge',
	bessel: '−3 dB frequency (SciPy norm="mag")',
	legendre: '−3 dB frequency',
	gaussian: '−3 dB frequency',
	critical: '−3 dB frequency'
};

/** Frequencies (Hz) inside the passband(s) and stopband(s), including the edges. */
export function checkGrids(s: OrderSpec, n = 400): { pass: number[]; stop: number[] } {
	const analog = s.domain === 'analog';
	const nyq = s.fs / 2;
	const seg = (a: number, b: number) => (analog ? logspace(a, b, n) : linspace(a, b, n));
	const lowEnd = (f: number) => (analog ? f / 1000 : 0);
	const highEnd = (f: number) => (analog ? f * 1000 : nyq);
	const [p1, p2] = s.fp;
	const [s1, s2] = s.fst;
	switch (s.band) {
		case 'lowpass':
			return { pass: seg(lowEnd(p1), p1), stop: seg(s1, highEnd(s1)) };
		case 'highpass':
			return { pass: seg(p1, highEnd(p1)), stop: seg(lowEnd(s1), s1) };
		case 'bandpass':
			return { pass: seg(p1, p2), stop: [...seg(lowEnd(s1), s1), ...seg(s2, highEnd(s2))] };
		case 'bandstop':
			return { pass: [...seg(lowEnd(p1), p1), ...seg(p2, highEnd(p2))], stop: seg(s1, s2) };
	}
}

/**
 * |H| in dB at the frequencies fHz. An analog ZPK is evaluated as a sum of logarithms:
 * a high-order band design (k ≈ 1e200, N factors |jω − z| of 1e6 and more) overflows the
 * running product of freqsZpk and would come out as NaN.
 */
export function magnitudeDb(filter: Filter, fHz: readonly number[]): number[] {
	if (filter.kind !== 'analog') return evaluate(filter, fHz).magDb;
	const { z, p, k } = filter.zpk;
	const lk = Math.log10(Math.abs(k));
	return fHz.map((f) => {
		const w = 2 * Math.PI * f;
		let l = lk;
		for (const r of z) l += Math.log10(Math.hypot(r.re, w - r.im));
		for (const r of p) l -= Math.log10(Math.hypot(r.re, w - r.im));
		return Math.max(20 * l, -6000); // the floor of toDb (|H| ≥ 1e-300)
	});
}

/** Worst passband loss / smallest stopband attenuation (dB) on a grid; NaN if any point fails. */
function worst(filter: Filter, grid: number[], kind: 'pass' | 'stop'): number {
	const db = magnitudeDb(filter, grid);
	if (db.some((v) => Number.isNaN(v))) return NaN;
	return kind === 'pass' ? -Math.min(...db) : -Math.max(...db);
}

// The spec-independent prototypes (Bessel, Legendre, Gaussian, …) are slow to
// build at high order and the order search needs every order up to the maximum,
// so they are memoised. Ripple-dependent prototypes are cheap and rebuilt.
const protoCache = new Map<string, ZPK>();
const RIPPLE_FAMILIES: AnalogFamily[] = ['cheby1', 'cheby2', 'ellip'];

export function cachedPrototype(family: AnalogFamily, N: number, rp: number, rs: number): ZPK {
	if (RIPPLE_FAMILIES.includes(family)) return prototype(family, N, { rp, rs });
	const key = `${family}:${N}`;
	let p = protoCache.get(key);
	if (!p) {
		p = prototype(family, N, { besselNorm: 'mag' });
		protoCache.set(key, p);
	}
	return p;
}

/** Minimum order N and natural-frequency factor wn of the normalised prototype (as estimateOrder). */
function orderFor(
	family: AnalogFamily,
	ws: number,
	rp: number,
	rs: number
): { N: number; wn: number; capped: boolean } {
	if (family === 'butter' || RIPPLE_FAMILIES.includes(family)) {
		const r = estimateOrder(family, ws, rp, rs);
		return { N: r.N, wn: r.wn, capped: !!r.capped };
	}
	const maxN = FAMILIES.find((f) => f.id === family)!.maxOrder;
	let wn = 1;
	for (let N = 1; N <= maxN; N++) {
		const proto = cachedPrototype(family, N, rp, rs);
		const wp = findLevel(proto, -rp);
		wn = 1 / wp;
		const g0 = abs(freqsZpk(proto, [0])[0]) || 1;
		const att = -20 * Math.log10(abs(freqsZpk(proto, [ws * wp])[0]) / g0);
		if (att >= rs) return { N, wn, capped: false };
	}
	return { N: maxN, wn, capped: true };
}

/** Golden-section search for the maximum of a unimodal function on [a, b]. */
function goldenMax(f: (x: number) => number, a: number, b: number): number {
	const g = (Math.sqrt(5) - 1) / 2;
	let x1 = b - g * (b - a);
	let x2 = a + g * (b - a);
	let f1 = f(x1);
	let f2 = f(x2);
	for (let i = 0; i < 100 && Math.abs(b - a) > 1e-10 * Math.abs(a + b); i++) {
		if (f1 < f2) {
			a = x1;
			x1 = x2;
			f1 = f2;
			x2 = a + g * (b - a);
			f2 = f(x2);
		} else {
			b = x2;
			x2 = x1;
			f2 = f1;
			x1 = b - g * (b - a);
			f1 = f(x1);
		}
	}
	return (a + b) / 2;
}

export interface Estimate {
	order: number;
	f1: number;
	f2?: number;
	capped: boolean;
}

/**
 * Same result as `estimateFromSpecs(family, specEdges(s), { besselNorm: 'mag' })`
 * (verified in tests), but with memoised prototypes — except that a capped
 * Butterworth / Chebyshev II order gets the cutoff that matches the capped order.
 */
export function estimate(family: AnalogFamily, s: OrderSpec): Estimate {
	const [p1, p2] = orderPassband(s);
	const B = p2 - p1;
	const w02 = p1 * p2;
	const stop = s.fst.map((f) => toW(s, f));
	const nat = protoSelectivity(s.band, [p1, p2], stop);
	const { N, wn: wnN, capped } = orderFor(family, nat, s.rp, s.rs);
	const maxN = FAMILIES.find((f) => f.id === family)!.maxOrder;
	const order = Math.min(N, maxN);
	// When the order is capped, re-derive wn for the order actually used so the
	// passband edge still sees exactly Rp (estimateFromSpecs keeps the uncapped wn).
	let wn = wnN;
	if (N > maxN) {
		const gp = Math.pow(10, s.rp / 10) - 1;
		const gs = Math.pow(10, s.rs / 10) - 1;
		if (family === 'butter') wn = Math.pow(gp, -1 / (2 * maxN));
		else if (family === 'cheby2') wn = Math.cosh(Math.acosh(Math.sqrt(gs / gp)) / maxN);
	}
	const pair = (W: number): [number, number] => [
		fromW(s, (-W + Math.sqrt(W * W + 4 * w02)) / 2),
		fromW(s, (W + Math.sqrt(W * W + 4 * w02)) / 2)
	];
	switch (s.band) {
		case 'lowpass':
			return { order, f1: fromW(s, wn * p1), capped: capped || N > maxN };
		case 'highpass':
			return { order, f1: fromW(s, p1 / wn), capped: capped || N > maxN };
		case 'bandpass': {
			const [f1, f2] = pair(wn * B);
			return { order, f1, f2, capped: capped || N > maxN };
		}
		case 'bandstop': {
			const [f1, f2] = pair(B / wn);
			return { order, f1, f2, capped: capped || N > maxN };
		}
	}
}

/** Same result as designAnalog / designDigital (bilinear, prewarped), with memoised prototypes. */
export function designFor(family: AnalogFamily, s: OrderSpec, est: Estimate): Filter {
	const proto = cachedPrototype(family, est.order, s.rp, s.rs);
	const f2 = est.f2 ?? est.f1 * 2;
	const band = isBand(s.band);
	if (s.domain === 'analog') {
		const w1 = 2 * Math.PI * est.f1;
		return {
			kind: 'analog',
			zpk: transformPrototype(proto, s.band, w1, band ? 2 * Math.PI * f2 : w1)
		};
	}
	const nyq = s.fs / 2;
	const clamp = (f: number) => Math.min(Math.max(f, nyq * 1e-6), nyq * 0.999999);
	// The analog filter is built for the normalised rate 2fs = 1 (SciPy likewise designs at
	// fs = 2), where the prewarped edges are tan(πf/fs); the bilinear transform gives the same
	// H(z). At the true rate a high-order band design overflows: 2N factors (2fs − p) of ~1e5.
	const w1 = Math.tan((Math.PI * clamp(est.f1)) / s.fs);
	const w2 = Math.tan((Math.PI * clamp(f2)) / s.fs);
	const analog = transformPrototype(proto, s.band, w1, band ? w2 : w1);
	return { kind: 'digital', fs: s.fs, sos: zpk2sos(bilinear(analog, 0.5)) };
}

export function iirResults(s: OrderSpec): IirResult[] {
	const grids = checkGrids(s);
	return FAMILIES.map((fam, index) => {
		const est = estimate(fam.id, s);
		const order = est.order;
		const poles = isBand(s.band) ? 2 * order : order;
		const base = {
			family: fam.id,
			name: fam.name,
			index,
			order,
			capped: est.capped,
			maxOrder: fam.maxOrder,
			f1: est.f1,
			f2: est.f2,
			cutoffMeaning: CUTOFF_MEANING[fam.id],
			poles,
			biquads: Math.floor(poles / 2),
			firstOrder: poles % 2,
			mults: 5 * Math.floor(poles / 2) + 3 * (poles % 2)
		};
		try {
			const filter = designFor(fam.id, s, est);
			return {
				...base,
				passAtt: worst(filter, grids.pass, 'pass'),
				stopAtt: worst(filter, grids.stop, 'stop'),
				filter
			};
		} catch (e) {
			return {
				...base,
				passAtt: NaN,
				stopAtt: NaN,
				filter: { kind: 'analog', zpk: { z: [], p: [], k: 1 } },
				error: String(e)
			};
		}
	});
}

// ---------------------------------------------------------------------------
// FIR estimates
// ---------------------------------------------------------------------------

export interface FirResult {
	id: string;
	method: string;
	taps: number;
	/** e.g. "β = 5.65" or "Δf ≈ 3.3/N" */
	detail: string;
	/** Can this method meet both Rp and Rs at all? */
	meets: boolean;
	/** Typical attenuation / ripple of a fixed window (dB). */
	windowAtt?: number;
	windowRipple?: number;
	/** Taps were bumped to an odd length (needed for HP/BS). */
	madeOdd: boolean;
}

/** Fixed-window design rules: transition width Δf ≈ C/N (cycles/sample), typical ripple and attenuation. */
export const WINDOW_RULES = [
	{ id: 'hann', name: 'Hann', c: 3.1, att: 44, ripple: 0.0546 },
	{ id: 'hamming', name: 'Hamming', c: 3.3, att: 53, ripple: 0.0194 },
	{ id: 'blackman', name: 'Blackman', c: 5.5, att: 74, ripple: 0.0017 }
] as const;

export function firResults(s: OrderSpec): {
	df: number;
	dp: number;
	ds: number;
	kaiserA: number;
	rows: FirResult[];
} {
	const df = transitionHz(s) / s.fs;
	const dp = passbandRippleToDelta(s.rp);
	const ds = stopbandAttenToDelta(s.rs);
	// the window method gives (roughly) equal ripple δ in both bands, so it must meet the tighter one
	const kaiserA = -20 * Math.log10(Math.min(dp, ds));
	const needOdd = s.band === 'highpass' || s.band === 'bandstop';
	const odd = (n: number) => (needOdd && n % 2 === 0 ? n + 1 : n);
	const rows: FirResult[] = [];
	const k = kaiserOrder(kaiserA, df);
	rows.push({
		id: 'kaiser',
		method: 'Kaiser window',
		taps: odd(k.numtaps),
		detail: `β = ${k.beta.toFixed(3)}, A = ${kaiserA.toFixed(1)} dB`,
		meets: true,
		madeOdd: odd(k.numtaps) !== k.numtaps
	});
	const pm = remezOrderEstimate(dp, ds, df);
	rows.push({
		id: 'remez',
		method: 'Parks–McClellan (equiripple)',
		taps: odd(pm),
		detail: `δp = ${dp.toPrecision(3)}, δs = ${ds.toPrecision(3)} (Herrmann)`,
		meets: true,
		madeOdd: odd(pm) !== pm
	});
	for (const w of WINDOW_RULES) {
		const n = Math.ceil(w.c / df);
		rows.push({
			id: w.id,
			method: `${w.name} window`,
			taps: odd(n),
			detail: `Δf ≈ ${w.c}/N`,
			meets: w.att >= s.rs && w.ripple <= s.rp,
			windowAtt: w.att,
			windowRipple: w.ripple,
			madeOdd: odd(n) !== n
		});
	}
	return { df, dp, ds, kaiserA, rows };
}

/** Multiplications per output sample for an N-tap FIR: direct and exploiting coefficient symmetry. */
export const firMults = (taps: number): { direct: number; symmetric: number } => ({
	direct: taps,
	symmetric: Math.ceil(taps / 2)
});
