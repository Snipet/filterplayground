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
	const w = logspace(wc * 1e-3, wc * 1e3, 3000);
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

/** max |H(jω)| on [0, wmax]: dense scan plus golden-section refinement. */
export function passbandPeak(zpk: ZPK, wmax: number): number {
	const n = 2000;
	const ws = linspace(0, wmax, n + 1);
	const m = freqsZpk(zpk, ws).map(abs);
	let best = 0;
	for (let i = 1; i <= n; i++) if (m[i] > m[best]) best = i;
	if (best === 0 || best === n) return m[best];
	const f = (x: number) => abs(freqsZpk(zpk, [x])[0]);
	let a = ws[best - 1];
	let b = ws[best + 1];
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
	return Math.max(m[best], f1, f2);
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

/** Duration (normalised time) long enough for the step response to settle. */
export function settleSpan(zpk: ZPK): number {
	const decay = zpk.p.map((p) => -p.re).filter((d) => d > 0);
	const slowest = decay.length ? Math.min(...decay) : 1;
	return Math.min(12 / slowest, 3000);
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
	for (let i = 1; i < dbp.length - 1; i++) if (dbp[i] > dbp[i - 1] + 1e-9 && dbp[i] >= dbp[i + 1]) lastPeak = i;
	let mx = -Infinity;
	let mn = Infinity;
	for (let i = 0; i <= lastPeak; i++) {
		mx = Math.max(mx, dbp[i]);
		mn = Math.min(mn, dbp[i]);
	}
	const ripple = lastPeak > 0 ? mx - mn : 0;

	const [h2, h10] = freqsZpk(zpk, [2, 10]).map(abs);
	const att = (m: number) => -20 * Math.log10(Math.max(m, 1e-300) / peak);

	const gd = groupDelayAnalogZpk(zpk, linspace(0, Number.isFinite(w3) ? w3 : 1, 400));
	const gdVar = Math.max(...gd) - Math.min(...gd);

	// step response
	const T = settleSpan(zpk);
	const st = analogTimeResponse(zpk, 'step', T, 4000);
	const yf = H0.re;
	const { t, y } = st;
	const over = Math.max(0, (Math.max(...y) / yf - 1) * 100);
	const cross = (level: number) => {
		for (let i = 1; i < y.length; i++) {
			if (y[i - 1] < level && y[i] >= level) return t[i - 1] + ((level - y[i - 1]) / (y[i] - y[i - 1])) * (t[i] - t[i - 1]);
		}
		return NaN;
	};
	const rise = cross(0.9 * yf) - cross(0.1 * yf);
	let settle = NaN;
	const band = 0.02 * Math.abs(yf);
	for (let i = y.length - 1; i >= 0; i--) {
		if (Math.abs(y[i] - yf) > band) {
			if (i < y.length - 1) {
				const a = Math.abs(y[i] - yf) - band;
				const b = Math.abs(y[i + 1] - yf) - band;
				settle = t[i] + (a / (a - b)) * (t[i + 1] - t[i]);
			}
			break;
		}
		if (i === 0) settle = 0;
	}

	const maxQ = Math.max(...analogStages(zpk).map((s) => s.q));
	return {
		f3: w3,
		att2: att(h2),
		att10: att(h10),
		ripple,
		overshoot: over,
		rise,
		settle,
		gd0: gd[0],
		gdVar,
		maxQ
	};
}
