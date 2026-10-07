/**
 * High-level IIR design: family + band type + frequencies (Hz) → analog or
 * digital filter, plus order estimation from passband/stopband specifications.
 */
import { type AnalogFamily, type BesselNorm, estimateOrder, familyInfo, prototype } from './analog';
import { zpk2sos } from './convert';
import { type Discretization, discretize, prewarp, transformPrototype } from './transforms';
import type { BandType, SOS, ZPK } from './types';

export interface IIRSpec {
	family: AnalogFamily;
	band: BandType;
	order: number;
	/** Cutoff (LP/HP) or lower band edge (BP/BS), Hz. */
	f1: number;
	/** Upper band edge for BP/BS, Hz. */
	f2?: number;
	/** Passband ripple, dB (Chebyshev I, elliptic). */
	rp?: number;
	/** Stopband attenuation, dB (Chebyshev II, elliptic). */
	rs?: number;
	besselNorm?: BesselNorm;
}

export interface DigitalIIRSpec extends IIRSpec {
	fs: number;
	method?: Discretization;
	/** Pre-warp the critical frequencies (bilinear only). Default true. */
	prewarp?: boolean;
}

const isBand = (b: BandType) => b === 'bandpass' || b === 'bandstop';

/** Design an analog filter. Result is in rad/s. */
export function designAnalog(spec: IIRSpec): ZPK {
	const proto = prototype(spec.family, spec.order, {
		rp: spec.rp,
		rs: spec.rs,
		besselNorm: spec.besselNorm
	});
	const w1 = 2 * Math.PI * spec.f1;
	const w2 = 2 * Math.PI * (spec.f2 ?? spec.f1 * 2);
	return transformPrototype(proto, spec.band, w1, isBand(spec.band) ? w2 : w1);
}

export interface DigitalIIRResult {
	zpk: ZPK;
	sos: SOS;
	/** The analog filter that was discretised (rad/s). */
	analog: ZPK;
	warning?: string;
}

/** Design a digital IIR filter by discretising an analog prototype. */
export function designDigital(spec: DigitalIIRSpec): DigitalIIRResult {
	const method = spec.method ?? 'bilinear';
	const nyq = spec.fs / 2;
	const clamp = (f: number) => Math.min(Math.max(f, nyq * 1e-6), nyq * 0.999999);
	const f1 = clamp(spec.f1);
	const f2 = clamp(spec.f2 ?? spec.f1 * 2);
	const warp = method === 'bilinear' && spec.prewarp !== false;
	const w1 = warp ? prewarp(f1, spec.fs) : 2 * Math.PI * f1;
	const w2 = warp ? prewarp(f2, spec.fs) : 2 * Math.PI * f2;
	const proto = prototype(spec.family, spec.order, {
		rp: spec.rp,
		rs: spec.rs,
		besselNorm: spec.besselNorm
	});
	const analog = transformPrototype(proto, spec.band, w1, isBand(spec.band) ? w2 : w1);
	const { zpk, warning } = discretize(analog, spec.fs, method);
	return { zpk, sos: zpk2sos(zpk), analog, warning };
}

// ---------------------------------------------------------------------------
// Order estimation from specs
// ---------------------------------------------------------------------------

export interface SpecEdges {
	band: BandType;
	/** Passband edge(s), Hz. For BP/BS: [low, high]. */
	fp: number | [number, number];
	/** Stopband edge(s), Hz. For BP: [low, high] outside fp; for BS: inside fp. */
	fstop: number | [number, number];
	/** Max passband attenuation, dB. */
	rp: number;
	/** Min stopband attenuation, dB. */
	rs: number;
	/** Sampling rate for digital (bilinear) designs; omit for analog. */
	fs?: number;
}

export interface OrderEstimate {
	order: number;
	/** Natural/cutoff frequencies (Hz) to pass to the designer: f1 (and f2). */
	f1: number;
	f2?: number;
	/** Low-pass prototype selectivity ratio (stopband/passband). */
	selectivity: number;
	/** True if the family's maximum order was reached without meeting the spec. */
	capped: boolean;
	error?: string;
}

export function estimateFromSpecs(
	family: AnalogFamily,
	spec: SpecEdges,
	opts: { besselNorm?: BesselNorm } = {}
): OrderEstimate {
	const toW = (f: number) => (spec.fs ? prewarp(f, spec.fs) : 2 * Math.PI * f);
	const fromW = (w: number) =>
		spec.fs ? (spec.fs / Math.PI) * Math.atan(w / (2 * spec.fs)) : w / (2 * Math.PI);
	const arr = (v: number | [number, number]): [number, number] =>
		Array.isArray(v) ? v : [v, v];
	let [p1, p2] = arr(spec.fp).map(toW);
	const [s1, s2] = arr(spec.fstop).map(toW);
	if (spec.band === 'bandstop' && p1 < s1 && s2 < p2) {
		// Like SciPy: slide each passband edge towards the stopband to make the
		// geometry symmetric, which maximises the worst-case selectivity.
		const sel = (a: number, b: number) =>
			Math.min(
				Math.abs((s1 * (b - a)) / (a * b - s1 * s1)),
				Math.abs((s2 * (b - a)) / (a * b - s2 * s2))
			);
		p1 = goldenMax((a) => sel(a, p2), p1, s1 - 1e-9 * s1);
		p2 = goldenMax((b) => sel(p1, b), s2 + 1e-9 * s2, p2);
	}
	let nat: number;
	switch (spec.band) {
		case 'lowpass':
			nat = s1 / p1;
			break;
		case 'highpass':
			nat = p1 / s1;
			break;
		case 'bandpass': {
			const B = p2 - p1;
			const w02 = p1 * p2;
			nat = Math.min(
				Math.abs((s1 * s1 - w02) / (B * s1)),
				Math.abs((s2 * s2 - w02) / (B * s2))
			);
			break;
		}
		case 'bandstop': {
			const B = p2 - p1;
			const w02 = p1 * p2;
			nat = Math.min(
				Math.abs((B * s1) / (w02 - s1 * s1)),
				Math.abs((B * s2) / (w02 - s2 * s2))
			);
			break;
		}
	}
	if (!(nat > 1) || !Number.isFinite(nat)) {
		return {
			order: 1,
			f1: fromW(p1),
			f2: isBand(spec.band) ? fromW(p2) : undefined,
			selectivity: nat,
			capped: false,
			error: 'The stopband edge must lie beyond the passband edge (transition band is empty or inverted).'
		};
	}
	if (!(spec.rs > spec.rp)) {
		return {
			order: 1,
			f1: fromW(p1),
			selectivity: nat,
			capped: false,
			error: 'Stopband attenuation must exceed the passband ripple.'
		};
	}
	const { N, wn, capped } = estimateOrder(family, nat, spec.rp, spec.rs, opts);
	const maxN = familyInfo(family).maxOrder;
	const order = Math.min(N, maxN);
	// map the prototype natural frequency back to real frequencies
	let f1: number;
	let f2: number | undefined;
	switch (spec.band) {
		case 'lowpass':
			f1 = fromW(wn * p1);
			break;
		case 'highpass':
			f1 = fromW(p1 / wn);
			break;
		case 'bandpass': {
			const B = p2 - p1;
			const w02 = p1 * p2;
			const W = wn * B;
			f1 = fromW((-W + Math.sqrt(W * W + 4 * w02)) / 2);
			f2 = fromW((W + Math.sqrt(W * W + 4 * w02)) / 2);
			break;
		}
		case 'bandstop': {
			const B = p2 - p1;
			const w02 = p1 * p2;
			const W = B / wn;
			f1 = fromW((-W + Math.sqrt(W * W + 4 * w02)) / 2);
			f2 = fromW((W + Math.sqrt(W * W + 4 * w02)) / 2);
			break;
		}
	}
	return { order, f1, f2, selectivity: nat, capped: !!capped || N > maxN };
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
	const xm = (a + b) / 2;
	return xm;
}
