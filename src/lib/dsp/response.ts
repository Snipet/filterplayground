/**
 * Frequency-response evaluation (magnitude, phase, group delay) for analog and
 * digital filters in any representation.
 */
import { type Complex, abs, abs2, c, div, mul } from './complex';
import { digitalTf, sos2zpk } from './convert';
import type { DigitalFilter, Filter, SOS, TF, ZPK } from './types';

export function linspace(a: number, b: number, n: number): number[] {
	if (n <= 1) return [a];
	const out = new Array<number>(n);
	const step = (b - a) / (n - 1);
	for (let i = 0; i < n; i++) out[i] = a + i * step;
	return out;
}

export function logspace(a: number, b: number, n: number): number[] {
	const la = Math.log10(a);
	const lb = Math.log10(b);
	return linspace(la, lb, n).map((v) => Math.pow(10, v));
}

export const toDb = (mag: number): number => 20 * Math.log10(Math.max(mag, 1e-300));
export const fromDb = (db: number): number => Math.pow(10, db / 20);
export const powerToDb = (p: number): number => 10 * Math.log10(Math.max(p, 1e-300));

/** Unwrap a phase sequence (radians) by removing 2π jumps. */
export function unwrap(phase: readonly number[]): number[] {
	const out = new Array<number>(phase.length);
	let offset = 0;
	for (let i = 0; i < phase.length; i++) {
		if (i > 0) {
			let d = phase[i] + offset - out[i - 1];
			while (d > Math.PI) {
				offset -= 2 * Math.PI;
				d -= 2 * Math.PI;
			}
			while (d < -Math.PI) {
				offset += 2 * Math.PI;
				d += 2 * Math.PI;
			}
		}
		out[i] = phase[i] + offset;
	}
	return out;
}

// ---------------------------------------------------------------------------
// Analog (s = jω)
// ---------------------------------------------------------------------------

/** H(jω) for an analog ZPK, ω in rad/s. */
export function freqsZpk(zpk: ZPK, w: readonly number[]): Complex[] {
	return w.map((wi) => {
		let re = zpk.k;
		let im = 0;
		for (const z of zpk.z) {
			const fre = -z.re;
			const fim = wi - z.im;
			const nre = re * fre - im * fim;
			im = re * fim + im * fre;
			re = nre;
		}
		let h: Complex = { re, im };
		for (const p of zpk.p) h = div(h, { re: -p.re, im: wi - p.im });
		return h;
	});
}

/** H(jω) for an analog TF (descending powers of s). */
export function freqsTf(tf: TF, w: readonly number[]): Complex[] {
	return w.map((wi) => {
		const s = c(0, wi);
		return div(polyvalSC(tf.b, s), polyvalSC(tf.a, s));
	});
}

function polyvalSC(p: readonly number[], s: Complex): Complex {
	let y = c(0);
	for (const coef of p) y = { re: y.re * s.re - y.im * s.im + coef, im: y.re * s.im + y.im * s.re };
	return y;
}

/** Group delay (seconds) of an analog ZPK at ω (rad/s). */
export function groupDelayAnalogZpk(zpk: ZPK, w: readonly number[]): number[] {
	return w.map((wi) => {
		let tau = 0;
		for (const p of zpk.p) {
			const dre = -p.re;
			const dim = wi - p.im;
			tau += dre / (dre * dre + dim * dim);
		}
		for (const z of zpk.z) {
			const dre = -z.re;
			const dim = wi - z.im;
			const den = dre * dre + dim * dim;
			if (den > 0) tau -= dre / den;
		}
		return tau;
	});
}

// ---------------------------------------------------------------------------
// Digital (z = e^{jω}), ω in radians/sample
// ---------------------------------------------------------------------------

export function freqzZpk(zpk: ZPK, w: readonly number[]): Complex[] {
	return w.map((wi) => {
		const e = { re: Math.cos(wi), im: Math.sin(wi) };
		let h: Complex = c(zpk.k);
		for (const z of zpk.z) h = mul(h, { re: e.re - z.re, im: e.im - z.im });
		for (const p of zpk.p) h = div(h, { re: e.re - p.re, im: e.im - p.im });
		return h;
	});
}

/** Evaluate Σ b_k e^{-jωk}. */
function dtft(b: readonly number[], wi: number): Complex {
	// Horner in z⁻¹
	const zr = Math.cos(wi);
	const zi = -Math.sin(wi);
	let re = 0;
	let im = 0;
	for (let k = b.length - 1; k >= 0; k--) {
		const nre = re * zr - im * zi + b[k];
		im = re * zi + im * zr;
		re = nre;
	}
	return { re, im };
}

export function freqzTf(tf: TF, w: readonly number[]): Complex[] {
	return w.map((wi) => div(dtft(tf.b, wi), dtft(tf.a, wi)));
}

export function freqzSos(sos: SOS, w: readonly number[]): Complex[] {
	return w.map((wi) => {
		let h: Complex = c(1);
		for (const s of sos) h = mul(h, div(dtft(s.slice(0, 3), wi), dtft(s.slice(3, 6), wi)));
		return h;
	});
}

/** Group delay (samples) of a polynomial in z⁻¹: Re{Σ k b_k e^{-jωk} / Σ b_k e^{-jωk}}. */
function polyGroupDelay(b: readonly number[], wi: number): number {
	const nb = b.map((v, k) => v * k);
	const num = dtft(nb, wi);
	const den = dtft(b, wi);
	const d2 = abs2(den);
	if (d2 < 1e-24 * Math.max(1, b.reduce((s, v) => s + v * v, 0))) return NaN;
	return (num.re * den.re + num.im * den.im) / d2;
}

export function groupDelayTf(tf: TF, w: readonly number[]): number[] {
	return w.map((wi) => polyGroupDelay(tf.b, wi) - polyGroupDelay(tf.a, wi));
}

export function groupDelaySos(sos: SOS, w: readonly number[]): number[] {
	return w.map((wi) => {
		let g = 0;
		for (const s of sos) g += polyGroupDelay(s.slice(0, 3), wi) - polyGroupDelay(s.slice(3, 6), wi);
		return g;
	});
}

/** Group delay (samples) of a digital ZPK, H(z) = kΠ(z−zᵢ)/Π(z−pᵢ). */
export function groupDelayZpk(zpk: ZPK, w: readonly number[]): number[] {
	return w.map((wi) => {
		const e = { re: Math.cos(wi), im: Math.sin(wi) };
		// dφ/dω = Σ_z Re(e/(e−z)) − Σ_p Re(e/(e−p)); τ = −dφ/dω
		let dphi = 0;
		for (const z of zpk.z) {
			const d = { re: e.re - z.re, im: e.im - z.im };
			const den = abs2(d);
			if (den < 1e-24) return NaN;
			dphi += (e.re * d.re + e.im * d.im) / den;
		}
		for (const p of zpk.p) {
			const d = { re: e.re - p.re, im: e.im - p.im };
			dphi -= (e.re * d.re + e.im * d.im) / abs2(d);
		}
		return -dphi;
	});
}

// ---------------------------------------------------------------------------
// Unified evaluation
// ---------------------------------------------------------------------------

export interface Response {
	/** Frequencies in Hz. */
	f: number[];
	H: Complex[];
	mag: number[];
	magDb: number[];
	/** Unwrapped phase in degrees. */
	phaseDeg: number[];
	/** Group delay in seconds. */
	groupDelay: number[];
}

/**
 * Evaluate any filter at the given frequencies (Hz). Digital filters ignore
 * frequencies above fs/2 only in the sense that the response is periodic.
 */
export function evaluate(filter: Filter, fHz: readonly number[]): Response {
	let H: Complex[];
	let gd: number[];
	if (filter.kind === 'analog') {
		const w = fHz.map((f) => 2 * Math.PI * f);
		H = freqsZpk(filter.zpk, w);
		gd = groupDelayAnalogZpk(filter.zpk, w);
	} else {
		const w = fHz.map((f) => (2 * Math.PI * f) / filter.fs);
		({ H, gd } = evalDigital(filter, w));
		gd = gd.map((g) => g / filter.fs);
	}
	const mag = H.map(abs);
	const phase = unwrap(H.map((h) => Math.atan2(h.im, h.re)));
	return {
		f: [...fHz],
		H,
		mag,
		magDb: mag.map(toDb),
		phaseDeg: phase.map((p) => (p * 180) / Math.PI),
		groupDelay: gd
	};
}

function evalDigital(f: DigitalFilter, w: readonly number[]): { H: Complex[]; gd: number[] } {
	// Group delay from the roots is exact; the polynomial ratio loses precision near zeros.
	if (f.sos) return { H: freqzSos(f.sos, w), gd: groupDelayZpk(sos2zpk(f.sos), w) };
	if (f.zpk) return { H: freqzZpk(f.zpk, w), gd: groupDelayZpk(f.zpk, w) };
	const tf = digitalTf(f);
	return { H: freqzTf(tf, w), gd: groupDelayTf(tf, w) };
}

/** Magnitude (linear) of an analog ZPK at one frequency in rad/s. */
export function magAnalogAt(zpk: ZPK, w: number): number {
	return abs(freqsZpk(zpk, [w])[0]);
}

/** Magnitude (linear) of a digital ZPK at ω rad/sample. */
export function magDigitalAt(zpk: ZPK, w: number): number {
	return abs(freqzZpk(zpk, [w])[0]);
}

/**
 * Pick a good frequency grid (Hz) for plotting a filter. Returns log-spaced
 * points for analog filters and for digital filters on a log axis; linear
 * spacing otherwise.
 */
export function frequencyGrid(
	fmin: number,
	fmax: number,
	n: number,
	scale: 'log' | 'linear'
): number[] {
	if (scale === 'log') return logspace(Math.max(fmin, 1e-9), fmax, n);
	return linspace(fmin, fmax, n);
}

/** Find the frequency (in the same units as the grid) where |H| first crosses a level (dB). */
export function findCrossing(
	f: readonly number[],
	magDb: readonly number[],
	levelDb: number,
	fromIndex = 0
): number | null {
	for (let i = Math.max(1, fromIndex); i < f.length; i++) {
		const a = magDb[i - 1] - levelDb;
		const b = magDb[i] - levelDb;
		if (a === 0) return f[i - 1];
		if (a * b < 0) {
			const t = a / (a - b);
			return f[i - 1] + t * (f[i] - f[i - 1]);
		}
	}
	return null;
}
