/**
 * Helpers for the Filter Family Comparison page: designs every family at a
 * common order/cutoff (optionally all normalised to −3 dB at the cutoff) and
 * measures frequency- and time-domain figures of merit.
 *
 * Everything here works on designs normalised to a cutoff of ω = 1 rad/s; the
 * page scales frequencies by fc and times by 1/(2π fc).
 */
import { abs } from '$lib/dsp/complex';
import { FAMILIES, prototype, type AnalogFamily, type BesselNorm } from '$lib/dsp/analog';
import { analogStages } from '$lib/dsp/convert';
import { freqsZpk, groupDelayAnalogZpk, linspace, logspace } from '$lib/dsp/response';
import { analogTimeResponse, characteristicFrequency } from '$lib/dsp/time';
import { lp2lp } from '$lib/dsp/transforms';
import type { ZPK } from '$lib/dsp/types';

/** Fixed colour slot per family (never repainted when others are hidden). */
export const FAMILY_COLOR: Record<AnalogFamily, string> = Object.fromEntries(
	FAMILIES.map((f, i) => [f.id, `var(--s${i + 1})`])
) as Record<AnalogFamily, string>;

export type CutoffMode = 'native' | '3db';

export interface CompareSettings {
	order: number;
	rp: number;
	rs: number;
	mode: CutoffMode;
	/** Bessel normalisation used in 'native' mode. */
	besselNative: BesselNorm;
}

/**
 * −3 dB edge (rad/s) of a low-pass, relative to its passband peak: the highest
 * frequency at which |H| falls through peak/√2. Robust to passband ripple deeper
 * than 3 dB and to stopband ripple (which stays below −3 dB for Rs > 3 dB).
 */
export function edge3dB(zpk: ZPK): number {
	const wc = characteristicFrequency(zpk);
	const w = edgeGrid(zpk, wc * 1e-3, wc * 1e3);
	const mag = freqsZpk(zpk, w).map(abs);
	const find = (target: number) => {
		for (let k = mag.length - 2; k >= 0; k--) if (mag[k] >= target && mag[k + 1] < target) return k;
		return -1;
	};
	let i = find(Math.max(abs(freqsZpk(zpk, [0])[0]), ...mag) / Math.SQRT2);
	if (i < 0) return NaN;
	// refine the peak on a dense linear grid below the edge, then re-locate the edge
	const peak = passbandPeak(zpk, w[i + 1]);
	const target = peak / Math.SQRT2;
	i = find(target);
	if (i < 0) return NaN;
	let lo = Math.log(w[i]);
	let hi = Math.log(w[i + 1]);
	for (let it = 0; it < 60; it++) {
		const mid = (lo + hi) / 2;
		if (abs(freqsZpk(zpk, [Math.exp(mid)])[0]) >= target) lo = mid;
		else hi = mid;
	}
	return Math.exp((lo + hi) / 2);
}

/**
 * Search grid for edge3dB: a log grid over [lo, hi] (steps of ≈0.46 %) plus samples
 * every σ/8 within ±8σ of each complex pole p = −σ + jω_d. Elliptic designs with
 * Rp > 3 dB have a last passband lobe above −3 dB just below the ripple edge that is
 * only ≈3σ of their highest-Q pole wide, which the log grid alone can step over.
 */
function edgeGrid(zpk: ZPK, lo: number, hi: number): number[] {
	const w = logspace(lo, hi, 3000);
	for (const p of zpk.p) {
		const s = -p.re;
		if (!(p.im > 0 && s > 0)) continue;
		for (let k = -64; k <= 64; k++) {
			const x = p.im + (k * s) / 8;
			if (x > lo && x < hi) w.push(x);
		}
	}
	return w.sort((a, b) => a - b);
}

/** Maximum of f on [a, b] (unimodal there) by golden-section search. */
function goldenMax(f: (x: number) => number, a: number, b: number): number {
	const gr = (Math.sqrt(5) - 1) / 2;
	let x1 = b - gr * (b - a);
	let x2 = a + gr * (b - a);
	let f1 = f(x1);
	let f2 = f(x2);
	for (let it = 0; it < 60; it++) {
		if (f1 > f2) {
			b = x2;
			x2 = x1;
			f2 = f1;
			x1 = b - gr * (b - a);
			f1 = f(x1);
		} else {
			a = x1;
			x1 = x2;
			f1 = f2;
			x2 = a + gr * (b - a);
			f2 = f(x2);
		}
	}
	return Math.max(f1, f2);
}

/** max |H(jω)| on [0, wmax]: dense scan plus golden-section refinement. */
export function passbandPeak(zpk: ZPK, wmax: number): number {
	const n = 2000;
	const ws = linspace(0, wmax, n + 1);
	const m = freqsZpk(zpk, ws).map(abs);
	let best = 0;
	for (let i = 1; i <= n; i++) if (m[i] > m[best]) best = i;
	if (best === 0 || best === n) return m[best];
	const f = (x: number) => abs(freqsZpk(zpk, [x])[0]);
	return Math.max(m[best], goldenMax(f, ws[best - 1], ws[best + 1]));
}

/**
 * Group delay at DC and its spread (max − min) over [0, wmax]. A high-Q pole pair
 * p = −σ ± jω_d puts a peak of height ≈1/σ and width ≈2σ at ω_d — far narrower than
 * a fixed grid step for high-order elliptic designs — so ω_d of every pole is sampled
 * too and each local extremum is refined by golden-section search.
 */
function groupDelaySpread(zpk: ZPK, wmax: number): { gd0: number; spread: number } {
	const ws = linspace(0, wmax, 400);
	for (const p of zpk.p) if (p.im > 0 && p.im < wmax) ws.push(p.im);
	ws.sort((a, b) => a - b);
	const g = groupDelayAnalogZpk(zpk, ws);
	const tau = (x: number) => groupDelayAnalogZpk(zpk, [x])[0];
	let max = Math.max(g[0], g[g.length - 1]);
	let min = Math.min(g[0], g[g.length - 1]);
	for (let i = 1; i < g.length - 1; i++) {
		if (g[i] >= g[i - 1] && g[i] >= g[i + 1])
			max = Math.max(max, g[i], goldenMax(tau, ws[i - 1], ws[i + 1]));
		if (g[i] <= g[i - 1] && g[i] <= g[i + 1])
			min = Math.min(min, g[i], -goldenMax((x) => -tau(x), ws[i - 1], ws[i + 1]));
	}
	return { gd0: g[0], spread: max - min };
}

/** Normalised design (cutoff 1 rad/s in the chosen sense). */
export function designNormalised(family: AnalogFamily, s: CompareSettings): ZPK {
	const besselNorm: BesselNorm = s.mode === '3db' ? 'mag' : s.besselNative;
	const proto = prototype(family, s.order, { rp: s.rp, rs: s.rs, besselNorm });
	if (s.mode === 'native' || family === 'bessel') return proto;
	const w3 = edge3dB(proto);
	return Number.isFinite(w3) && w3 > 0 ? lp2lp(proto, 1 / w3) : proto;
}

export interface FamilyMetrics {
	/** −3 dB edge in units of the cutoff. */
	f3: number;
	/** Attenuation (dB, positive) relative to the passband peak at 2·fc and 10·fc. */
	att2: number;
	att10: number;
	/** Peak-to-valley passband ripple (dB) up to the last passband maximum. */
	ripple: number;
	/** Step overshoot (%), 10–90 % rise time and 2 % settling time (normalised: ωc = 1). */
	overshoot: number;
	rise: number;
	settle: number;
	/** Group delay at DC and its spread (max − min) over 0…f₋₃dB (normalised). */
	gd0: number;
	gdVar: number;
	maxQ: number;
}

/** Step-response samples per period of the fastest pole (|p|), and an overall cap. */
const STEP_SAMPLES_PER_PERIOD = 50;
const MAX_STEP_POINTS = 200000;

/** Magnitude of the fastest pole (rad/s). */
const fastestPole = (zpk: ZPK) => (zpk.p.length ? Math.max(...zpk.p.map(abs)) : 1);

/**
 * Longest step-response span simulated for the step metrics: 3000 normalised time
 * units, stretched when every pole is slower than the cutoff (a native Chebyshev II
 * of low order and high Rs has its −3 dB point decades below fc).
 */
const maxSpan = (zpk: ZPK) => 3000 / Math.min(1, fastestPole(zpk));

/** Duration (normalised time) long enough for the step response to settle. */
export function settleSpan(zpk: ZPK): number {
	const decay = zpk.p.map((p) => -p.re).filter((d) => d > 0);
	if (!decay.length) return 12;
	const slowest = Math.min(...decay);
	// an m-fold pole (critically damped: all N poles coincide) decays as
	// e^{−σt}·Σ_{k<m}(σt)^k/k!, far slower than e^{−σt}: its 2 % point is σt ≈ 20 at m = 12
	const ps = zpk.p.filter((p) => -p.re === slowest);
	const m = Math.max(
		...ps.map(
			(p) => zpk.p.filter((q) => Math.hypot(q.re - p.re, q.im - p.im) <= 1e-9 * abs(p)).length
		)
	);
	return Math.min((12 + 2 * (m - 1)) / slowest, maxSpan(zpk));
}

export function familyMetrics(zpk: ZPK): FamilyMetrics {
	const w3 = edge3dB(zpk);
	const H0 = freqsZpk(zpk, [0])[0];
	const g0 = abs(H0);
	// passband peak (dense linear scan up to the edge)
	const wp = linspace(0, Number.isFinite(w3) ? w3 : 1, 2001);
	const mp = freqsZpk(zpk, wp).map(abs);
	const peak = Math.max(g0, passbandPeak(zpk, wp[wp.length - 1]));
	const dbp = mp.map((m) => 20 * Math.log10(m / peak));
	let lastPeak = 0;
	for (let i = 1; i < dbp.length - 1; i++)
		if (dbp[i] > dbp[i - 1] + 1e-9 && dbp[i] >= dbp[i + 1]) lastPeak = i;
	let mx = -Infinity;
	let mn = Infinity;
	for (let i = 0; i <= lastPeak; i++) {
		mx = Math.max(mx, dbp[i]);
		mn = Math.min(mn, dbp[i]);
	}
	const ripple = lastPeak > 0 ? mx - mn : 0;

	const [h2, h10] = freqsZpk(zpk, [2, 10]).map(abs);
	const att = (m: number) => -20 * Math.log10(Math.max(m, 1e-300) / peak);

	const { gd0, spread: gdVar } = groupDelaySpread(zpk, Number.isFinite(w3) ? w3 : 1);

	// step response: exact samples, ≥ 50 per period of the fastest pole so that the
	// ringing of high-order elliptic designs is resolved, over a span that is doubled
	// while the response has not yet reached 90 % or entered the 2 % band
	const yf = H0.re;
	const dt = (2 * Math.PI) / (STEP_SAMPLES_PER_PERIOD * fastestPole(zpk));
	const Tmax = maxSpan(zpk);
	let T = settleSpan(zpk);
	let step = stepMetrics(zpk, yf, T, dt);
	while (!(Number.isFinite(step.rise) && Number.isFinite(step.settle)) && T < Tmax) {
		T = Math.min(2 * T, Tmax);
		step = stepMetrics(zpk, yf, T, dt);
	}

	const maxQ = Math.max(...analogStages(zpk).map((s) => s.q));
	return {
		f3: w3,
		att2: att(h2),
		att10: att(h10),
		ripple,
		overshoot: step.overshoot,
		rise: step.rise,
		settle: step.settle,
		gd0,
		gdVar,
		maxQ
	};
}

/**
 * Largest zero in [lo, hi] of the parabola through (−1, f0), (0, f1), (1, f2), or NaN.
 * The step metrics are read between exact samples with it: crossings near a ringing
 * peak are far from straight lines.
 */
function parabolaZero(f0: number, f1: number, f2: number, lo: number, hi: number): number {
	const a = (f0 - 2 * f1 + f2) / 2;
	const b = (f2 - f0) / 2;
	const D = b * b - 4 * a * f1;
	if (D < 0) return NaN;
	const q = -(b + (b < 0 ? -1 : 1) * Math.sqrt(D)) / 2;
	const xs = [a !== 0 ? q / a : NaN, q !== 0 ? f1 / q : NaN].filter((x) => x >= lo && x <= hi);
	return xs.length ? Math.max(...xs) : NaN;
}

/** Overshoot (%), 10–90 % rise and 2 % settling time of the step response on [0, T]. */
function stepMetrics(
	zpk: ZPK,
	yf: number,
	T: number,
	dt: number
): { overshoot: number; rise: number; settle: number } {
	const points = Math.min(MAX_STEP_POINTS, Math.max(4000, Math.ceil(T / dt) + 1));
	const { t, y } = analogTimeResponse(zpk, 'step', T, points);
	const h = t[1] - t[0];
	const n = y.length;
	// peak: largest sample, refined by the parabola through it and its neighbours
	let im = 0;
	for (let i = 1; i < n; i++) if (y[i] > y[im]) im = i;
	let ymax = y[im];
	if (im > 0 && im < n - 1) {
		const curv = y[im - 1] - 2 * y[im] + y[im + 1];
		if (curv < 0) ymax -= (y[im + 1] - y[im - 1]) ** 2 / (8 * curv);
	}
	const overshoot = Math.max(0, (ymax / yf - 1) * 100);
	// first time y reaches the level; a step that already starts at or above it (the
	// feedthrough H(∞) of even-order Chebyshev II / elliptic designs) reaches it at t = 0
	const cross = (level: number) => {
		if (y[0] >= level - 1e-9 * Math.abs(yf)) return t[0];
		for (let i = 1; i < n; i++) {
			if (y[i - 1] < level && y[i] >= level) {
				const x =
					i < n - 1 ? parabolaZero(y[i - 1] - level, y[i] - level, y[i + 1] - level, -1, 0) : NaN;
				return Number.isFinite(x)
					? t[i] + x * h
					: t[i - 1] + ((level - y[i - 1]) / (y[i] - y[i - 1])) * h;
			}
		}
		return NaN;
	};
	const rise = cross(0.9 * yf) - cross(0.1 * yf);
	// 2 % settling: the last time |y − yf| leaves the band (NaN if it is still outside at T)
	const band = 0.02 * Math.abs(yf);
	const e = (i: number) => Math.abs(y[i] - yf) - band;
	let last = n - 1;
	while (last >= 0 && e(last) <= 0) last--;
	let settle = last < 0 ? 0 : NaN;
	if (last >= 0 && last < n - 1) {
		const x = last > 0 ? parabolaZero(e(last - 1), e(last), e(last + 1), 0, 1) : NaN;
		settle = Number.isFinite(x)
			? t[last] + x * h
			: t[last] + (e(last) / (e(last) - e(last + 1))) * h;
		// a later ringing lobe can poke out of the band between two samples: take the
		// falling crossing of the last local maximum whose parabola rises above the band
		for (let j = n - 2; j > last; j--) {
			const [e0, e1, e2] = [e(j - 1), e(j), e(j + 1)];
			if (e1 < e0 || e1 < e2) continue;
			const curv = e0 - 2 * e1 + e2;
			if (curv < 0 && e1 - (e2 - e0) ** 2 / (8 * curv) > 0) {
				settle = t[j] + parabolaZero(e0, e1, e2, -1, 1) * h;
				break;
			}
		}
	}
	return { overshoot, rise, settle };
}
