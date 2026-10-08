/**
 * Doubly-terminated LC ladder synthesis (Darlington) and ABCD-matrix circuit
 * simulation for the Passive LC Ladder Designer.
 *
 * Conventions
 *  - Prototypes are all-pole low-pass H(s) = k / D(s) normalised to a peak
 *    transmission of 1 (|S21| = 1 at the passband maxima, i.e. lossless match).
 *  - Normalised source resistance Rs = 1. Element values g₁…g_n are the
 *    classical "g-values"; g_{n+1} follows Matthaei's convention (load
 *    resistance if g_n is a shunt capacitor, load conductance if g_n is a
 *    series inductor).
 */
import { type Complex, abs, add, c, div, mul, sqrt, sub } from '$lib/dsp/complex';
import { polyder, polyFromRoots, polymul, polyval, roots } from '$lib/dsp/poly';
import { freqsZpk } from '$lib/dsp/response';
import { besselap, buttap, cheb1ap, criticalap, gaussianap, legendreap } from '$lib/dsp/analog';
import { solveVec } from '$lib/dsp/linalg';
import { lp2bp, lp2hp, lp2lp } from '$lib/dsp/transforms';
import type { ZPK } from '$lib/dsp/types';

export type LadderFamily = 'butter' | 'cheby1' | 'bessel' | 'legendre' | 'gaussian' | 'critical';
export type LadderForm = 'series' | 'shunt';
export type LadderBand = 'lowpass' | 'highpass' | 'bandpass';

export const LADDER_FAMILIES: { id: LadderFamily; name: string; cutoff: string }[] = [
	{ id: 'butter', name: 'Butterworth', cutoff: '−3 dB frequency' },
	{ id: 'cheby1', name: 'Chebyshev I', cutoff: 'ripple-band edge (attenuation = Rp)' },
	{ id: 'bessel', name: 'Bessel (Thomson)', cutoff: '−3 dB frequency' },
	{ id: 'legendre', name: 'Legendre (Optimum-L)', cutoff: '−3 dB frequency' },
	{ id: 'gaussian', name: 'Gaussian', cutoff: '−3 dB frequency' },
	{ id: 'critical', name: 'Critically damped', cutoff: '−3 dB frequency' }
];

/** All-pole low-pass prototype (cutoff 1 rad/s), scaled so that max |H(jω)| = 1. */
export function ladderPrototype(family: LadderFamily, N: number, rp = 0.5): ZPK {
	let z: ZPK;
	switch (family) {
		case 'butter':
			z = buttap(N);
			break;
		case 'cheby1':
			z = cheb1ap(N, rp);
			break;
		case 'bessel':
			z = besselap(N, 'mag');
			break;
		case 'legendre':
			z = legendreap(N);
			break;
		case 'gaussian':
			z = gaussianap(N);
			break;
		case 'critical':
			z = criticalap(N);
			break;
	}
	const peak = peakGain(z);
	return { z: [], p: z.p, k: z.k / peak };
}

/** Maximum of |H(jω)| for a low-pass ZPK (dense scan plus golden-section refinement). */
export function peakGain(zpk: ZPK): number {
	const pm = Math.max(...zpk.p.map(abs), 1e-12);
	const n = 3000;
	const wmax = 2 * pm;
	const mag = (w: number) => abs(freqsZpk(zpk, [w])[0]);
	let best = 0;
	let bestV = mag(0);
	const ws: number[] = [];
	for (let i = 0; i <= n; i++) ws.push((wmax * i) / n);
	const vals = freqsZpk(zpk, ws).map(abs);
	for (let i = 1; i <= n; i++) {
		if (vals[i] > bestV) {
			bestV = vals[i];
			best = i;
		}
	}
	if (best === 0) return bestV;
	// golden-section search around the best grid point
	let a = ws[Math.max(0, best - 1)];
	let b = ws[Math.min(n, best + 1)];
	const gr = (Math.sqrt(5) - 1) / 2;
	let x1 = b - gr * (b - a);
	let x2 = a + gr * (b - a);
	let f1 = mag(x1);
	let f2 = mag(x2);
	for (let i = 0; i < 80; i++) {
		if (f1 > f2) {
			b = x2;
			x2 = x1;
			f2 = f1;
			x1 = b - gr * (b - a);
			f1 = mag(x1);
		} else {
			a = x1;
			x1 = x2;
			f1 = f2;
			x2 = a + gr * (b - a);
			f2 = mag(x2);
		}
	}
	return Math.max(bestV, f1, f2);
}

export interface LadderSynthesis {
	/** g₁ … g_n */
	g: number[];
	/** g_{n+1} (Matthaei convention). */
	gLoad: number;
	/** Normalised load resistance (Rs = 1) of the series-L-first form. */
	rLoadSeries: number;
	/** Normalised load resistance (Rs = 1) of the shunt-C-first form. */
	rLoadShunt: number;
	/** How the values were obtained (for the curious). */
	method: 'cauer' | 'cauer+newton';
}

/**
 * Darlington synthesis of a doubly-terminated LC ladder from an all-pole
 * transfer function with peak transmission 1 (source resistance 1 Ω).
 *
 *   |S21(jω)|² = |H(jω)|²            (normalised so max = 1)
 *   S11(s)S11(−s) = 1 − S21(s)S21(−s) = [D(s)D(−s) − k²] / [D(s)D(−s)]
 *   S11(s) = N(s)/D(s)               N: minimum-phase (LHP / jω-axis) roots
 *   Z_in(s) = (D + N)/(D − N)         → Cauer-I continued fraction at s = ∞
 *
 * Continued fractions on polynomial coefficients lose digits as the order grows,
 * so the element values are then polished by Newton iteration on the ladder's
 * own denominator (computed with exact chain matrices). If the expansion breaks
 * down entirely, the ladder is tracked continuously from the Butterworth one.
 */
export function synthesizeLadder(proto: ZPK): LadderSynthesis {
	const n = proto.p.length;
	if (n < 1) throw new Error('The prototype has no poles.');
	if (proto.z.length > 0)
		throw new Error('Ladder synthesis here supports all-pole (no finite zeros) prototypes only.');
	const D = polyFromRoots(proto.p);
	const rl = seriesLoad(proto, D);
	const N = reflectionNumerator(proto, D);
	// Input side: Z_in = (D + N)/(D − N) → g₁, g₂, …
	const front = cfExpand(
		D.map((v, i) => v + N[i]),
		D.map((v, i) => v - N[i]).slice(1),
		n
	);
	// Output side: S22 = −N(−s)/D(s), Z_out/R_L = (D − N₋)/(D + N₋) → g_n, g_{n−1}, …
	const Nm = N.map((v, i) => ((n - i) % 2 === 0 ? v : -v));
	const plus = D.map((v, i) => v + Nm[i]);
	const minus = D.map((v, i) => v - Nm[i]);
	const back = n % 2 === 1 ? cfExpand(minus, plus.slice(1), n) : cfExpand(plus, minus.slice(1), n);
	// Each expansion loses digits as it goes, so take each half from the end it is accurate at.
	const half = Math.ceil(n / 2);
	const g: number[] = [];
	for (let k = 1; k <= n; k++) {
		const fromBack = back[n - k];
		const backVal =
			fromBack === undefined ? undefined : k % 2 === 1 ? fromBack * rl : fromBack / rl;
		const v = k <= half ? (front[k - 1] ?? backVal) : (backVal ?? front[k - 1]);
		if (v === undefined)
			throw new Error('Continued-fraction expansion broke down for this prototype.');
		g.push(v);
	}
	const pol = polishLadder(g, rl, D);
	if (!pol)
		throw new Error(
			'Ladder synthesis did not converge for this prototype (order too high for double precision).'
		);
	return finish(pol.g, rl, pol.iterations > 0 ? 'cauer+newton' : 'cauer');
}

function finish(g: number[], rl: number, method: LadderSynthesis['method']): LadderSynthesis {
	const n = g.length;
	// series-L first: element k is a series L for odd k; g_{n+1} is a resistance after a shunt C
	const gLoad = n % 2 === 0 ? rl : 1 / rl;
	return { g, gLoad, rLoadSeries: rl, rLoadShunt: 1 / rl, method };
}

/**
 * Load resistance (Rs = 1) of the series-L-first ladder from the DC transmission:
 * |S21(0)|² = 4R_L/(1 + R_L)². The series-first form takes the root R_L ≥ 1.
 */
function seriesLoad(proto: ZPK, D: number[]): number {
	const h0 = Math.min(1, Math.abs(proto.k / D[D.length - 1]));
	if (h0 >= 1 - 1e-13) return 1;
	const t = h0 * h0;
	return (2 - t + 2 * Math.sqrt(1 - t)) / t;
}

/** Minimum-phase reflection numerator N(s) with N(s)N(−s) = D(s)D(−s) − k². */
function reflectionNumerator(proto: ZPK, D: number[]): number[] {
	const n = proto.p.length;
	const K2 = proto.k * proto.k;
	// D(−s): coefficient of s^(n−i) gets (−1)^(n−i)
	const Dm = D.map((v, i) => ((n - i) % 2 === 0 ? v : -v));
	const P = polymul(D, Dm); // degree 2n, even polynomial
	const scaleP = polymul(D.map(Math.abs), Dm.map(Math.abs));
	P[P.length - 1] -= K2;
	scaleP[scaleP.length - 1] += K2;
	// remove cancellation noise; odd powers are exactly zero in theory
	for (let j = 0; j < P.length; j++) {
		const power = P.length - 1 - j;
		if (power % 2 === 1 || Math.abs(P[j]) <= 1e-11 * scaleP[j]) P[j] = 0;
	}
	// Q(x) with x = s²: Q[j] = P[2j]
	const Q: number[] = [];
	for (let j = 0; j <= n; j++) Q.push(P[2 * j]);

	const xr = roots(Q);
	const sRoots: Complex[] = [];
	// Roots of Q on the negative real axis are reflection zeros on the jω axis: they are
	// double roots of P (|S11|² touches zero at the passband maxima). A root finder only
	// resolves a double root to ~√ε, so pair them up and polish each pair as the simple
	// root of Q′ it is.
	const axis: number[] = [];
	for (const x of xr) {
		const m = abs(x);
		if (m === 0) {
			sRoots.push(c(0));
		} else if (Math.abs(x.im) <= 1e-3 * m && x.re < 0) {
			axis.push(x.re);
		} else {
			const r = sqrt(x); // principal root, Re ≥ 0 → take the left half-plane one
			sRoots.push(c(-r.re, -r.im));
		}
	}
	if (axis.length % 2 === 1) throw new Error('unpaired jω-axis reflection zero');
	axis.sort((a, b) => a - b);
	const dQ = polyder(Q);
	const d2Q = polyder(dQ);
	for (let i = 0; i + 1 < axis.length; i += 2) {
		const x0 = (axis[i] + axis[i + 1]) / 2;
		let x = x0;
		for (let it = 0; it < 30; it++) {
			const d2 = polyval(d2Q, x);
			if (d2 === 0) break;
			const step = polyval(dQ, x) / d2;
			x -= step;
			if (Math.abs(step) <= 1e-16 * Math.abs(x)) break;
		}
		if (!(x < 0) || Math.abs(x - x0) > 1e-3 * Math.abs(x0)) x = x0;
		const w = Math.sqrt(-x);
		sRoots.push(c(0, w), c(0, -w));
	}
	const N = polyFromRoots(sRoots);
	if (N.length !== D.length) throw new Error('wrong reflection-zero count');

	return N;
}

/**
 * Cauer-I continued fraction of A/B at s = ∞ (deg A = deg B + 1): the element
 * values of alternating series/shunt branches. Stops early (returning fewer
 * values) if the expansion breaks down numerically.
 */
function cfExpand(Ain: readonly number[], Bin: readonly number[], count: number): number[] {
	let A = [...Ain];
	let B = [...Bin];
	const out: number[] = [];
	for (let step = 1; step <= count; step++) {
		if (!(B.length >= 1) || !(Math.abs(B[0]) > 0)) break;
		const e = A[0] / B[0];
		if (!(e > 0) || !Number.isFinite(e)) break;
		out.push(e);
		if (step === count) break;
		// R = A − e·s·B; the leading term cancels exactly and so must the next one
		const R = A.map((v, i) => v - (i < B.length ? e * B[i] : 0));
		R.shift();
		const scale = Math.abs(A[1]) + Math.abs(e * B[1]);
		if (!(Math.abs(R[0]) <= 1e-2 * scale)) break;
		R.shift();
		A = B;
		B = R;
	}
	return out;
}

// ---------------------------------------------------------------------------
// Newton polishing on the ladder's own denominator
// ---------------------------------------------------------------------------

/**
 * Denominator of V_L/V_S for the series-L-first ladder (Rs = 1):
 * Den(s) = A·R_L + B + C·R_L + D from the chain matrix at s.
 */
function ladderDen(g: readonly number[], rl: number, s: Complex): Complex {
	let A = c(1);
	let B = c(0);
	let C = c(0);
	let Dd = c(1);
	for (let i = 0; i < g.length; i++) {
		const x = mul(s, c(g[i]));
		if (i % 2 === 0) {
			B = add(mul(A, x), B);
			Dd = add(mul(C, x), Dd);
		} else {
			A = add(A, mul(B, x));
			C = add(C, mul(Dd, x));
		}
	}
	return add(add(mul(A, c(rl)), B), add(mul(C, c(rl)), Dd));
}

/**
 * n real residuals: (Den(s)/lead − D(s))/ρⁿ at the n-th roots of unity scaled by ρ
 * (upper half only; conjugates are implied). Zero ⇔ the ladder's poles are D's roots.
 */
function ladderResidual(g: readonly number[], rl: number, D: readonly number[]): number[] {
	const n = g.length;
	const rho = Math.pow(Math.abs(D[D.length - 1]), 1 / n) || 1;
	let lead = g.reduce((a, b) => a * b, 1);
	if (n % 2 === 0) lead *= rl;
	const scale = Math.pow(rho, n);
	const out: number[] = [];
	const evalAt = (theta: number) => {
		const s = c(rho * Math.cos(theta), rho * Math.sin(theta));
		const den = ladderDen(g, rl, s);
		let dv = c(0);
		for (const coef of D) dv = add(mul(dv, s), c(coef));
		return { re: (den.re / lead - dv.re) / scale, im: (den.im / lead - dv.im) / scale };
	};
	if (n % 2 === 0) {
		for (let k = 0; k < n / 2; k++) {
			const r = evalAt((Math.PI * (2 * k + 1)) / n);
			out.push(r.re, r.im);
		}
	} else {
		out.push(evalAt(0).re);
		for (let k = 1; k <= (n - 1) / 2; k++) {
			const r = evalAt((2 * Math.PI * k) / n);
			out.push(r.re, r.im);
		}
	}
	return out;
}

const norm2 = (v: readonly number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));

function ladderResidualNorm(g: readonly number[], rl: number, D: readonly number[]): number {
	return norm2(ladderResidual(g, rl, D));
}

/**
 * Levenberg–Marquardt on log(g). Plain Newton is not enough: a ladder with full
 * power transfer at its passband maxima sits on a fold of the element → response
 * map (the first-order sensitivity to every element is zero — Orchard's argument),
 * so the Jacobian is singular exactly at the solution. Returns null if the
 * residual cannot be brought below 1e-9.
 */
export function polishLadder(
	gInit: readonly number[],
	rl: number,
	D: readonly number[]
): { g: number[]; iterations: number } | null {
	const n = gInit.length;
	let g = [...gInit];
	let r = ladderResidual(g, rl, D);
	let nr = norm2(r);
	let mu = 1e-3;
	let iterations = 0;
	for (let iter = 0; iter < 200 && nr > 1e-15; iter++) {
		const J: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
		const h = 1e-7;
		for (let j = 0; j < n; j++) {
			const gp = [...g];
			gp[j] *= Math.exp(h);
			const rp = ladderResidual(gp, rl, D);
			for (let i = 0; i < n; i++) J[i][j] = (rp[i] - r[i]) / h;
		}
		// normal equations (n ≤ ~16, fine)
		const JtJ: number[][] = Array.from({ length: n }, (_, i) =>
			Array.from({ length: n }, (_, j) => J.reduce((acc, row) => acc + row[i] * row[j], 0))
		);
		const Jtr = Array.from({ length: n }, (_, i) =>
			J.reduce((acc, row, k) => acc + row[i] * r[k], 0)
		);
		const scale = Math.max(...JtJ.map((row, i) => row[i]), 1e-300);
		let accepted = false;
		for (let tries = 0; tries < 30; tries++) {
			const M = JtJ.map((row, i) => row.map((v, j) => (i === j ? v + mu * scale : v)));
			let delta: number[];
			try {
				delta = solveVec(
					M,
					Jtr.map((v) => -v)
				);
			} catch {
				mu *= 10;
				continue;
			}
			const gn = g.map((v, i) => v * Math.exp(delta[i]));
			const rn = ladderResidual(gn, rl, D);
			const nn = norm2(rn);
			if (Number.isFinite(nn) && nn < nr) {
				g = gn;
				r = rn;
				nr = nn;
				mu = Math.max(mu / 10, 1e-16);
				accepted = true;
				break;
			}
			mu *= 10;
			if (mu > 1e12) break;
		}
		if (!accepted) break;
		iterations++;
	}
	return nr < 1e-9 ? { g, iterations } : null;
}

// ---------------------------------------------------------------------------
// Closed-form g-values (for validation and display)
// ---------------------------------------------------------------------------

export function butterworthG(n: number): number[] {
	return Array.from({ length: n }, (_, i) => 2 * Math.sin(((2 * (i + 1) - 1) * Math.PI) / (2 * n)));
}

/**
 * Chebyshev I g-values g₁…g_{n+1} (Matthaei, Young & Jones). The tables write
 * β = ln coth(Rp/17.37); 17.37 is 40·log₁₀e, used exactly here.
 */
export function chebyshevG(n: number, rp: number): number[] {
	const beta = Math.log(1 / Math.tanh((rp * Math.LN10) / 40));
	const gamma = Math.sinh(beta / (2 * n));
	const a = (k: number) => Math.sin(((2 * k - 1) * Math.PI) / (2 * n));
	const b = (k: number) => gamma * gamma + Math.pow(Math.sin((k * Math.PI) / n), 2);
	const g: number[] = [(2 * a(1)) / gamma];
	for (let k = 2; k <= n; k++) g.push((4 * a(k - 1) * a(k)) / (b(k - 1) * g[k - 2]));
	g.push(n % 2 === 1 ? 1 : Math.pow(1 / Math.tanh(beta / 4), 2));
	return g;
}

// ---------------------------------------------------------------------------
// Denormalised network
// ---------------------------------------------------------------------------

/**
 * One ladder branch. Series branches have their elements in series
 * (Z = jωL + 1/(jωC)); shunt branches have their elements in parallel
 * (Y = jωC + 1/(jωL)). Missing elements are simply absent.
 */
export interface Branch {
	pos: 'series' | 'shunt';
	L?: number;
	C?: number;
	/** The prototype g-value this branch was derived from. */
	g: number;
	index: number;
}

export interface LadderNetwork {
	branches: Branch[];
	rs: number;
	rl: number;
}

export interface ScaleOptions {
	form: LadderForm;
	band: LadderBand;
	/** Impedance level (source resistance) in Ω. */
	r0: number;
	/** Cutoff (LP/HP) or centre frequency (BP) in Hz. */
	f0: number;
	/** Bandwidth in Hz (BP only). */
	bw?: number;
}

/** Turn normalised g-values into real component values. */
export function scaleLadder(syn: LadderSynthesis, opts: ScaleOptions): LadderNetwork {
	const { form, band, r0 } = opts;
	const w = 2 * Math.PI * opts.f0;
	const B = 2 * Math.PI * (opts.bw ?? opts.f0 / 2);
	const branches: Branch[] = syn.g.map((gk, i) => {
		const isSeries = form === 'series' ? i % 2 === 0 : i % 2 === 1;
		const index = i + 1;
		if (isSeries) {
			// normalised series inductor g
			if (band === 'lowpass') return { pos: 'series', L: (gk * r0) / w, g: gk, index };
			if (band === 'highpass') return { pos: 'series', C: 1 / (gk * r0 * w), g: gk, index };
			return { pos: 'series', L: (gk * r0) / B, C: B / (gk * r0 * w * w), g: gk, index };
		}
		// normalised shunt capacitor g
		if (band === 'lowpass') return { pos: 'shunt', C: gk / (r0 * w), g: gk, index };
		if (band === 'highpass') return { pos: 'shunt', L: r0 / (gk * w), g: gk, index };
		return { pos: 'shunt', C: gk / (r0 * B), L: (r0 * B) / (gk * w * w), g: gk, index };
	});
	const rl = r0 * (form === 'series' ? syn.rLoadSeries : syn.rLoadShunt);
	return { branches, rs: r0, rl };
}

/** Target transfer function (|S21|) for the chosen band, matching {@link scaleLadder}. */
export function targetZpk(proto: ZPK, opts: Pick<ScaleOptions, 'band' | 'f0' | 'bw'>): ZPK {
	const w = 2 * Math.PI * opts.f0;
	if (opts.band === 'lowpass') return lp2lp(proto, w);
	if (opts.band === 'highpass') return lp2hp(proto, w);
	return lp2bp(proto, w, 2 * Math.PI * (opts.bw ?? opts.f0 / 2));
}

export interface SimResult {
	/** Transducer transmission S21 = 2√(Rs/RL)·V_L/V_S (equals 2·V_L/V_S when RL = Rs). */
	s21: Complex[];
	/** Input reflection coefficient S11 = (Z_in − Rs)/(Z_in + Rs). */
	s11: Complex[];
}

/** Simulate the ladder between Rs and RL with ABCD (chain) matrices. */
export function simulateLadder(net: LadderNetwork, fHz: readonly number[]): SimResult {
	const s21: Complex[] = [];
	const s11: Complex[] = [];
	const { rs, rl } = net;
	const kS21 = 2 * Math.sqrt(rs / rl);
	for (const f of fHz) {
		const jw = c(0, 2 * Math.PI * f);
		// running ABCD
		let A = c(1);
		let Bm = c(0);
		let C = c(0);
		let Dm = c(1);
		for (const br of net.branches) {
			if (br.pos === 'series') {
				let Z = c(0);
				if (br.L !== undefined) Z = add(Z, mul(jw, c(br.L)));
				if (br.C !== undefined) Z = add(Z, div(c(1), mul(jw, c(br.C))));
				// [A B; C D] · [1 Z; 0 1]
				Bm = add(mul(A, Z), Bm);
				Dm = add(mul(C, Z), Dm);
			} else {
				let Y = c(0);
				if (br.C !== undefined) Y = add(Y, mul(jw, c(br.C)));
				if (br.L !== undefined) Y = add(Y, div(c(1), mul(jw, c(br.L))));
				// [A B; C D] · [1 0; Y 1]
				A = add(A, mul(Bm, Y));
				C = add(C, mul(Dm, Y));
			}
		}
		// V_L / V_S = RL / (A·RL + B + Rs·(C·RL + D))
		const num = add(mul(A, c(rl)), Bm);
		const den = add(num, mul(c(rs), add(mul(C, c(rl)), Dm)));
		const vt = div(c(rl), den);
		s21.push(mul(vt, c(kS21)));
		const zin = div(num, add(mul(C, c(rl)), Dm));
		s11.push(div(sub(zin, c(rs)), add(zin, c(rs))));
	}
	return { s21, s11 };
}

/** SPICE netlist of the ladder (AC 2 V source, so the load voltage reads 2·V_L/V_S). */
export function spiceNetlist(
	net: LadderNetwork,
	title: string,
	fStart: number,
	fStop: number
): string {
	const num = (v: number) => Number(v.toPrecision(6)).toExponential().replace('e+', 'e');
	const lines: string[] = [
		`* ${title}`,
		'* AC magnitude 2 V: the voltage across RL reads 2·VL/VS (0 dB in a matched passband)',
		'V1 in 0 AC 2',
		`RS in n1 ${num(net.rs)}`
	];
	let node = 1;
	let mid = 0;
	for (const br of net.branches) {
		const cur = `n${node}`;
		if (br.pos === 'series') {
			const next = `n${node + 1}`;
			if (br.L !== undefined && br.C !== undefined) {
				const m = `m${++mid}`;
				lines.push(
					`L${br.index} ${cur} ${m} ${num(br.L)}`,
					`C${br.index} ${m} ${next} ${num(br.C)}`
				);
			} else if (br.L !== undefined) lines.push(`L${br.index} ${cur} ${next} ${num(br.L)}`);
			else if (br.C !== undefined) lines.push(`C${br.index} ${cur} ${next} ${num(br.C)}`);
			node++;
		} else {
			if (br.L !== undefined) lines.push(`L${br.index} ${cur} 0 ${num(br.L)}`);
			if (br.C !== undefined) lines.push(`C${br.index} ${cur} 0 ${num(br.C)}`);
		}
	}
	lines.push(
		`RL n${node} 0 ${num(net.rl)}`,
		`.ac dec 200 ${num(fStart)} ${num(fStop)}`,
		'.print ac vdb(n' + node + ')',
		'.end'
	);
	return lines.join('\n');
}
