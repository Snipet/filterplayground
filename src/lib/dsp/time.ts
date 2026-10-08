/**
 * Time-domain simulation: digital filtering (difference equations) and exact
 * sampled impulse / step responses of analog filters via state space.
 */
import { abs } from './complex';
import { analogStages, digitalSos } from './convert';
import { expm, type Matrix, zeros } from './linalg';
import { polyFromRoots } from './poly';
import type { DigitalFilter, SOS, ZPK } from './types';

// ---------------------------------------------------------------------------
// Digital
// ---------------------------------------------------------------------------

/** Direct-form I filtering with arbitrary-length b, a (a[0] normalised). */
export function lfilter(
	b: readonly number[],
	a: readonly number[],
	x: ArrayLike<number>
): Float64Array {
	const a0 = a[0];
	const bn = b.map((v) => v / a0);
	const an = a.map((v) => v / a0);
	const y = new Float64Array(x.length);
	for (let n = 0; n < x.length; n++) {
		let acc = 0;
		for (let k = 0; k < bn.length && k <= n; k++) acc += bn[k] * x[n - k];
		for (let k = 1; k < an.length && k <= n; k++) acc -= an[k] * y[n - k];
		y[n] = acc;
	}
	return y;
}

/** Cascade of second-order sections, each in transposed direct form II. */
export function sosfilt(sos: SOS, x: ArrayLike<number>): Float64Array {
	let y = Float64Array.from(x);
	for (const s of sos) {
		const a0 = s[3] || 1;
		const b0 = s[0] / a0;
		const b1 = s[1] / a0;
		const b2 = s[2] / a0;
		const a1 = s[4] / a0;
		const a2 = s[5] / a0;
		let z1 = 0;
		let z2 = 0;
		for (let n = 0; n < y.length; n++) {
			const xn = y[n];
			const yn = b0 * xn + z1;
			z1 = b1 * xn - a1 * yn + z2;
			z2 = b2 * xn - a2 * yn;
			y[n] = yn;
		}
	}
	return y;
}

/** FIR convolution (same length as input). */
export function firfilt(h: readonly number[], x: ArrayLike<number>): Float64Array {
	const y = new Float64Array(x.length);
	for (let n = 0; n < x.length; n++) {
		let acc = 0;
		const kmax = Math.min(h.length - 1, n);
		for (let k = 0; k <= kmax; k++) acc += h[k] * x[n - k];
		y[n] = acc;
	}
	return y;
}

/** Filter a signal with any digital filter description. */
export function applyDigital(f: DigitalFilter, x: ArrayLike<number>): Float64Array {
	if (f.fir) return firfilt(f.fir, x);
	if (f.tf && f.tf.a.length === 1)
		return firfilt(
			f.tf.b.map((v) => v / f.tf!.a[0]),
			x
		);
	if (f.tf && !f.sos && !f.zpk) return lfilter(f.tf.b, f.tf.a, x);
	return sosfilt(digitalSos(f), x);
}

export function impulse(n: number): Float64Array {
	const x = new Float64Array(n);
	if (n > 0) x[0] = 1;
	return x;
}

export function step(n: number): Float64Array {
	return new Float64Array(n).fill(1);
}

export function digitalImpulseResponse(f: DigitalFilter, n: number): Float64Array {
	return applyDigital(f, impulse(n));
}

export function digitalStepResponse(f: DigitalFilter, n: number): Float64Array {
	return applyDigital(f, step(n));
}

/** Suggest a response length (samples) that captures the decay of a digital filter. */
export function suggestDigitalLength(f: DigitalFilter, max = 4096): number {
	if (f.fir) return Math.min(max, Math.max(32, Math.ceil(f.fir.length * 1.5)));
	if (f.tf && f.tf.a.length === 1)
		return Math.min(max, Math.max(32, Math.ceil(f.tf.b.length * 1.5)));
	const sos = digitalSos(f);
	let rmax = 0;
	for (const s of sos) {
		const a = s.slice(3, 6).map((v) => v / (s[3] || 1));
		// roots of z² + a1 z + a2
		const disc = a[1] * a[1] - 4 * a[2];
		const r =
			disc < 0
				? Math.sqrt(Math.max(0, a[2]))
				: Math.max(
						Math.abs((-a[1] + Math.sqrt(disc)) / 2),
						Math.abs((-a[1] - Math.sqrt(disc)) / 2)
					);
		rmax = Math.max(rmax, r);
	}
	if (rmax >= 1) return Math.min(max, 256);
	if (rmax === 0) return 32;
	// samples until r^n < 1e-4
	const n = Math.ceil(Math.log(1e-4) / Math.log(rmax));
	return Math.min(max, Math.max(32, n));
}

// ---------------------------------------------------------------------------
// Analog: exact sampling of h(t) and step response via state space
// ---------------------------------------------------------------------------

interface StateSpace {
	A: Matrix;
	B: number[];
	C: number[];
	D: number;
}

function sectionSS(b: number[], a: number[]): StateSpace {
	// b, a descending, a monic, deg(b) ≤ deg(a) ≤ 2
	const n = a.length - 1;
	const bb = [...new Array(n + 1 - b.length).fill(0), ...b];
	if (n === 0) return { A: [], B: [], C: [], D: bb[0] / a[0] };
	const an = a.map((v) => v / a[0]);
	const bn = bb.map((v) => v / a[0]);
	const D = bn[0];
	if (n === 1) {
		return { A: [[-an[1]]], B: [1], C: [bn[1] - D * an[1]], D };
	}
	// controllable canonical form for (b0 s² + b1 s + b2)/(s² + a1 s + a2)
	return {
		A: [
			[0, 1],
			[-an[2], -an[1]]
		],
		B: [0, 1],
		C: [bn[2] - D * an[2], bn[1] - D * an[1]],
		D
	};
}

function cascade(s1: StateSpace, s2: StateSpace): StateSpace {
	const n1 = s1.A.length;
	const n2 = s2.A.length;
	const n = n1 + n2;
	const A = zeros(n, n);
	for (let i = 0; i < n1; i++) for (let j = 0; j < n1; j++) A[i][j] = s1.A[i][j];
	for (let i = 0; i < n2; i++) {
		for (let j = 0; j < n2; j++) A[n1 + i][n1 + j] = s2.A[i][j];
		for (let j = 0; j < n1; j++) A[n1 + i][j] = s2.B[i] * s1.C[j];
	}
	const B = [...s1.B, ...s2.B.map((v) => v * s1.D)];
	const C = [...s1.C.map((v) => v * s2.D), ...s2.C];
	return { A, B, C, D: s1.D * s2.D };
}

function zpkToSS(zpk: ZPK): StateSpace | null {
	if (zpk.z.length > zpk.p.length) return null;
	const stages = analogStages(zpk);
	let ss: StateSpace = { A: [], B: [], C: [], D: zpk.k };
	for (const st of stages) {
		const b = polyFromRoots(st.zeros);
		const a = polyFromRoots(st.poles);
		ss = cascade(ss, sectionSS(b, a));
	}
	return ss;
}

/** Characteristic angular frequency of a filter (geometric mean of |p|, |z|). */
export function characteristicFrequency(zpk: ZPK): number {
	const mags = [...zpk.p, ...zpk.z].map(abs).filter((m) => m > 0);
	if (mags.length === 0) return 1;
	return Math.exp(mags.reduce((s, m) => s + Math.log(m), 0) / mags.length);
}

/** Pick a time span (seconds) long enough for the response to settle. */
export function suggestAnalogDuration(zpk: ZPK): number {
	const decay = zpk.p.map((p) => -p.re).filter((d) => d > 0);
	const wc = characteristicFrequency(zpk);
	if (decay.length === 0 || zpk.p.some((p) => p.re >= 0)) return 40 / wc;
	const slowest = Math.min(...decay);
	return Math.min(8 / slowest, 400 / wc);
}

export interface TimeResponse {
	t: number[];
	y: number[];
	/** Weight of a Dirac impulse at t = 0 (impulse response of a non-strictly-proper H). */
	dirac?: number;
}

/**
 * Exactly sampled impulse or step response of an analog ZPK on [0, duration].
 * Uses frequency normalisation and block-cascaded state space for accuracy.
 */
export function analogTimeResponse(
	zpk: ZPK,
	kind: 'impulse' | 'step',
	duration = suggestAnalogDuration(zpk),
	points = 600
): TimeResponse {
	const wn = characteristicFrequency(zpk);
	// normalise: s' = s / wn
	const zn: ZPK = {
		z: zpk.z.map((z) => ({ re: z.re / wn, im: z.im / wn })),
		p: zpk.p.map((p) => ({ re: p.re / wn, im: p.im / wn })),
		k: zpk.k * Math.pow(wn, zpk.z.length - zpk.p.length)
	};
	const ss = zpkToSS(zn);
	const t = Array.from({ length: points }, (_, i) => (i * duration) / (points - 1));
	if (!ss) return { t, y: t.map(() => NaN) };
	const n = ss.A.length;
	const dtn = (duration * wn) / (points - 1); // normalised time step
	if (n === 0) {
		return kind === 'step' ? { t, y: t.map(() => ss.D) } : { t, y: t.map(() => 0), dirac: ss.D };
	}
	// augmented exponential [[A, B], [0, 0]]·dt → [[Ad, Bd], [0, 1]]
	const M = zeros(n + 1, n + 1);
	for (let i = 0; i < n; i++) {
		for (let j = 0; j < n; j++) M[i][j] = ss.A[i][j] * dtn;
		M[i][n] = ss.B[i] * dtn;
	}
	const E = expm(M);
	const Ad = E.slice(0, n).map((r) => r.slice(0, n));
	const Bd = E.slice(0, n).map((r) => r[n]);
	const y: number[] = [];
	let x: number[];
	if (kind === 'impulse') {
		x = [...ss.B];
		for (let i = 0; i < points; i++) {
			y.push(wn * dot(ss.C, x));
			x = mv(Ad, x);
		}
		return { t, y, dirac: ss.D !== 0 ? ss.D : undefined };
	}
	x = new Array(n).fill(0);
	for (let i = 0; i < points; i++) {
		y.push(dot(ss.C, x) + ss.D);
		const nx = mv(Ad, x);
		for (let j = 0; j < n; j++) nx[j] += Bd[j];
		x = nx;
	}
	return { t, y };
}

/**
 * Response of an analog filter to an arbitrary input sampled at interval dt,
 * assuming the input is held constant between samples (zero-order hold).
 */
export function analogSimulate(zpk: ZPK, u: ArrayLike<number>, dt: number): number[] {
	const wn = characteristicFrequency(zpk);
	const zn: ZPK = {
		z: zpk.z.map((z) => ({ re: z.re / wn, im: z.im / wn })),
		p: zpk.p.map((p) => ({ re: p.re / wn, im: p.im / wn })),
		k: zpk.k * Math.pow(wn, zpk.z.length - zpk.p.length)
	};
	const ss = zpkToSS(zn);
	if (!ss) return Array.from(u, () => NaN);
	const n = ss.A.length;
	if (n === 0) return Array.from(u, (v) => v * ss.D);
	const dtn = dt * wn;
	const M = zeros(n + 1, n + 1);
	for (let i = 0; i < n; i++) {
		for (let j = 0; j < n; j++) M[i][j] = ss.A[i][j] * dtn;
		M[i][n] = ss.B[i] * dtn;
	}
	const E = expm(M);
	const Ad = E.slice(0, n).map((r) => r.slice(0, n));
	const Bd = E.slice(0, n).map((r) => r[n]);
	let x = new Array(n).fill(0);
	const y: number[] = [];
	for (let i = 0; i < u.length; i++) {
		y.push(dot(ss.C, x) + ss.D * u[i]);
		const nx = mv(Ad, x);
		for (let j = 0; j < n; j++) nx[j] += Bd[j] * u[i];
		x = nx;
	}
	return y;
}

const dot = (a: readonly number[], b: readonly number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
const mv = (A: Matrix, x: readonly number[]) => A.map((r) => dot(r, x));
