/**
 * Frequency transformations (low-pass prototype → LP/HP/BP/BS) and analog →
 * digital mappings (bilinear, matched-Z, impulse invariance, Euler).
 */
import { type Complex, abs, add, c, div, exp, mul, neg, scale, sqrt, sub } from './complex';
import { cleanRealRoots, polyFromRootsC, roots } from './poly';
import { freqsZpk, freqzZpk } from './response';
import type { BandType, ZPK } from './types';

function prod(rs: Complex[]): Complex {
	let out = c(1);
	for (const r of rs) out = mul(out, r);
	return out;
}

export function lp2lp(zpk: ZPK, wo: number): ZPK {
	const degree = zpk.p.length - zpk.z.length;
	return {
		z: zpk.z.map((z) => scale(z, wo)),
		p: zpk.p.map((p) => scale(p, wo)),
		k: zpk.k * Math.pow(wo, degree)
	};
}

export function lp2hp(zpk: ZPK, wo: number): ZPK {
	const degree = zpk.p.length - zpk.z.length;
	const z = zpk.z.map((zz) => div(c(wo), zz));
	const p = zpk.p.map((pp) => div(c(wo), pp));
	for (let i = 0; i < degree; i++) z.push(c(0));
	const k = zpk.k * div(prod(zpk.z.map(neg)), prod(zpk.p.map(neg))).re;
	return { z, p, k };
}

export function lp2bp(zpk: ZPK, wo: number, bw: number): ZPK {
	const degree = zpk.p.length - zpk.z.length;
	const split = (r: Complex): Complex[] => {
		const rl = scale(r, bw / 2);
		const d = sqrt(sub(mul(rl, rl), c(wo * wo)));
		return [add(rl, d), sub(rl, d)];
	};
	const z = zpk.z.flatMap(split);
	const p = zpk.p.flatMap(split);
	for (let i = 0; i < degree; i++) z.push(c(0));
	return { z, p, k: zpk.k * Math.pow(bw, degree) };
}

export function lp2bs(zpk: ZPK, wo: number, bw: number): ZPK {
	const degree = zpk.p.length - zpk.z.length;
	const split = (r: Complex): Complex[] => {
		const rh = div(c(bw / 2), r);
		const d = sqrt(sub(mul(rh, rh), c(wo * wo)));
		return [add(rh, d), sub(rh, d)];
	};
	const z = zpk.z.flatMap(split);
	const p = zpk.p.flatMap(split);
	for (let i = 0; i < degree; i++) z.push(c(0, wo), c(0, -wo));
	const k = zpk.k * div(prod(zpk.z.map(neg)), prod(zpk.p.map(neg))).re;
	return { z, p, k };
}

/**
 * Transform a normalised low-pass prototype (cutoff 1 rad/s).
 * For LP/HP pass `w1` (rad/s). For BP/BS pass the band edges `w1 < w2` (rad/s);
 * the centre is their geometric mean and the bandwidth their difference.
 */
export function transformPrototype(proto: ZPK, band: BandType, w1: number, w2 = w1): ZPK {
	switch (band) {
		case 'lowpass':
			return lp2lp(proto, w1);
		case 'highpass':
			return lp2hp(proto, w1);
		case 'bandpass':
			return lp2bp(proto, Math.sqrt(w1 * w2), w2 - w1);
		case 'bandstop':
			return lp2bs(proto, Math.sqrt(w1 * w2), w2 - w1);
	}
}

// ---------------------------------------------------------------------------
// Analog → digital
// ---------------------------------------------------------------------------

/** Pre-warp a digital frequency (Hz) for the bilinear transform → analog rad/s. */
export function prewarp(fHz: number, fs: number): number {
	return 2 * fs * Math.tan((Math.PI * fHz) / fs);
}

/** Bilinear transform s = 2fs·(z − 1)/(z + 1). */
export function bilinear(zpk: ZPK, fs: number): ZPK {
	const fs2 = 2 * fs;
	const degree = zpk.p.length - zpk.z.length;
	const z = zpk.z.map((zz) => div(add(c(fs2), zz), sub(c(fs2), zz)));
	const p = zpk.p.map((pp) => div(add(c(fs2), pp), sub(c(fs2), pp)));
	for (let i = 0; i < degree; i++) z.push(c(-1));
	const k =
		zpk.k *
		div(prod(zpk.z.map((zz) => sub(c(fs2), zz))), prod(zpk.p.map((pp) => sub(c(fs2), pp)))).re;
	return { z, p, k };
}

/** Choose a reference frequency (rad/s) at which to match analog and digital gain. */
export function referenceFrequency(zpk: ZPK, fs: number): number {
	// prefer DC; else the geometric centre of the poles; else fs/4
	if (abs(freqsZpk(zpk, [0])[0]) > 1e-9) return 0;
	const pm = zpk.p.map(abs).filter((v) => v > 0);
	if (pm.length) {
		const g = Math.exp(pm.reduce((s, v) => s + Math.log(v), 0) / pm.length);
		if (g < Math.PI * fs) return g;
	}
	return (Math.PI * fs) / 2;
}

function matchGain(analog: ZPK, digital: ZPK, fs: number, wRef?: number): ZPK {
	const w = wRef ?? referenceFrequency(analog, fs);
	const ha = abs(freqsZpk(analog, [w])[0]);
	const hd = abs(freqzZpk({ ...digital, k: 1 }, [w / fs])[0]);
	return { ...digital, k: hd > 0 ? ha / hd : 1 };
}

/**
 * Matched-Z transform: map each pole and zero by z = e^{sT}. Zeros at infinity
 * are placed at z = −1 (the "modified" matched-Z), which keeps the order and
 * rolls off towards Nyquist. Gain is matched at a reference frequency.
 */
export function matchedZ(
	zpk: ZPK,
	fs: number,
	infiniteZerosAt: 'nyquist' | 'origin' = 'nyquist'
): ZPK {
	const T = 1 / fs;
	const degree = zpk.p.length - zpk.z.length;
	const z = zpk.z.map((zz) => exp(scale(zz, T)));
	const p = zpk.p.map((pp) => exp(scale(pp, T)));
	for (let i = 0; i < degree; i++) z.push(c(infiniteZerosAt === 'nyquist' ? -1 : 0));
	return matchGain(zpk, { z, p, k: 1 }, fs);
}

/** Forward Euler: s = (z − 1)/T  →  z = 1 + sT. Can turn stable poles unstable! */
export function forwardEuler(zpk: ZPK, fs: number): ZPK {
	const T = 1 / fs;
	const z = zpk.z.map((zz) => add(c(1), scale(zz, T)));
	const p = zpk.p.map((pp) => add(c(1), scale(pp, T)));
	// zeros at infinity stay at infinity (H has fewer finite zeros → pure delay)
	return matchGain(zpk, { z, p, k: 1 }, fs);
}

/** Backward Euler: s = (z − 1)/(zT)  →  z = 1/(1 − sT). Always stable, heavy warping. */
export function backwardEuler(zpk: ZPK, fs: number): ZPK {
	const T = 1 / fs;
	const degree = zpk.p.length - zpk.z.length;
	const z = zpk.z.map((zz) => div(c(1), sub(c(1), scale(zz, T))));
	const p = zpk.p.map((pp) => div(c(1), sub(c(1), scale(pp, T))));
	for (let i = 0; i < degree; i++) z.push(c(0));
	return matchGain(zpk, { z, p, k: 1 }, fs);
}

export interface ImpulseInvarianceResult {
	zpk: ZPK;
	/** Set when the method is not well defined for this filter. */
	warning?: string;
}

/**
 * Impulse invariance: h[n] = T·h(nT). Requires a strictly proper H(s) with
 * distinct poles. A direct-feedthrough term (high-pass / band-stop) cannot be
 * sampled and is reported as a warning.
 */
export function impulseInvariance(zpk: ZPK, fs: number): ImpulseInvarianceResult {
	const T = 1 / fs;
	const np = zpk.p.length;
	let warning: string | undefined;
	if (zpk.z.length >= np) {
		warning =
			'H(s) is not strictly proper (it has a direct feed-through term, as high-pass and band-stop filters do). Impulse invariance cannot represent it — the impulse response contains a Dirac delta and severe aliasing. The constant term was dropped.';
	}
	// residues r_i = k Π(p_i − z_j) / Π_{j≠i}(p_i − p_j)  (strictly proper part)
	// (If H is only proper, H = D + R(s); the residues of R equal those of H, so D is simply dropped.)
	const res: Complex[] = [];
	for (let i = 0; i < np; i++) {
		const pi = zpk.p[i];
		let num = c(zpk.k);
		for (const zz of zpk.z) num = mul(num, sub(pi, zz));
		let den = c(1);
		for (let j = 0; j < np; j++) if (j !== i) den = mul(den, sub(pi, zpk.p[j]));
		if (abs(den) < 1e-12 * Math.pow(Math.max(1, abs(pi)), np - 1)) {
			warning = 'Repeated poles: impulse invariance with simple residues is inaccurate here.';
		}
		res.push(div(num, den));
	}
	// H(z) = T Σ r_i / (1 − e^{p_i T} z⁻¹) = T Σ r_i z / (z − d_i)
	const d = zpk.p.map((pp) => exp(scale(pp, T)));
	// numerator polynomial in z: T Σ r_i z Π_{j≠i}(z − d_j)
	let numPoly: Complex[] = new Array(np + 1).fill(null).map(() => c(0));
	for (let i = 0; i < np; i++) {
		const others = d.filter((_, j) => j !== i);
		const pi = polyFromRootsC(others); // degree np−1
		const term = [...pi, c(0)].map((v) => scale(mul(v, res[i]), T)); // × z
		numPoly = numPoly.map((v, idx) => add(v, term[idx]));
	}
	const numReal = numPoly.map((v) => v.re);
	// leading coefficient & zeros
	let lead = 0;
	while (
		lead < numReal.length - 1 &&
		Math.abs(numReal[lead]) < 1e-14 * Math.max(...numReal.map(Math.abs))
	)
		lead++;
	const trimmed = numReal.slice(lead);
	const zz = cleanRealRoots(roots(trimmed));
	return { zpk: { z: zz, p: d, k: trimmed[0] }, warning };
}

export type Discretization =
	'bilinear' | 'matched' | 'impulse' | 'forward-euler' | 'backward-euler';

export interface DiscretizeResult {
	zpk: ZPK;
	warning?: string;
}

export function discretize(analog: ZPK, fs: number, method: Discretization): DiscretizeResult {
	switch (method) {
		case 'bilinear':
			return { zpk: bilinear(analog, fs) };
		case 'matched':
			return { zpk: matchedZ(analog, fs) };
		case 'impulse':
			return impulseInvariance(analog, fs);
		case 'forward-euler': {
			const zpk = forwardEuler(analog, fs);
			const unstable = zpk.p.some((p) => abs(p) >= 1);
			return {
				zpk,
				warning: unstable
					? 'Forward Euler mapped some stable analog poles outside the unit circle — the digital filter is unstable. Increase fs or use another method.'
					: undefined
			};
		}
		case 'backward-euler':
			return { zpk: backwardEuler(analog, fs) };
	}
}
