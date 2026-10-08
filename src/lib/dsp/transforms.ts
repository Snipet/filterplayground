/**
 * Frequency transformations (low-pass prototype → LP/HP/BP/BS) and analog →
 * digital mappings (bilinear, matched-Z, impulse invariance, Euler).
 */
import { type Complex, abs, add, c, div, exp, mul, neg, scale, sqrt, sub } from './complex';
import { cleanRealRoots, roots } from './poly';
import { freqzZpk, logspace } from './response';
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
	// a band given as (high, low) is the same band
	if ((band === 'bandpass' || band === 'bandstop') && w2 < w1) [w1, w2] = [w2, w1];
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
	// k·Π(2fs − z)/Π(2fs − p) as a running product of ratios: the separate products
	// overflow for high-order band filters (≈ (2fs)^60 for 60 poles at audio rates)
	let g = c(zpk.k);
	const n = Math.max(zpk.z.length, zpk.p.length);
	for (let i = 0; i < n; i++) {
		if (i < zpk.z.length) g = mul(g, sub(c(fs2), zpk.z[i]));
		if (i < zpk.p.length) g = div(g, sub(c(fs2), zpk.p[i]));
	}
	return { z, p, k: g.re };
}

/** |H| at least this far up from the peak (−8 dB) puts DC or ω → ∞ in the passband. */
const IN_PASSBAND = (-8 / 20) * Math.LN10;
/** −3 dB, as a difference of natural-log magnitudes. */
const HALF_POWER = -0.5 * Math.LN2;

/**
 * ln|H(s)| = ln|k| + Σ ln|s − z_i| − Σ ln|s − p_i| at one point of the complex plane
 * (s = jω for an analog filter, z = e^{jω} for a digital one). A sum of logarithms cannot
 * overflow: multiplying out a high-order band-pass/band-stop numerator (≈ 40 zeros) far
 * above every pole gives Infinity, and Infinity/Infinity = NaN.
 */
function logAbsZpk(zpk: ZPK, s: Complex): number {
	let l = Math.log(Math.abs(zpk.k));
	for (const z of zpk.z) l += Math.log(Math.hypot(s.re - z.re, s.im - z.im));
	for (const p of zpk.p) l -= Math.log(Math.hypot(s.re - p.re, s.im - p.im));
	return l;
}

/**
 * Choose a reference frequency (rad/s) at which to match analog and digital gain, from the
 * shape of |H(jω)| (a caller that knows the band can pass its own `wRef` instead):
 * - DC when it lies in the passband, i.e. |H(0)| is within 8 dB of the peak (low-pass,
 *   band-stop; the DC ripple trough of an even-order Chebyshev I / elliptic is −Rp, and the
 *   designers allow Rp ≤ 6 dB). A nonzero H(0) can also be a stopband floor (even-order
 *   Chebyshev II / elliptic high- and band-pass: H(0) = −Rs, Rs ≥ 10 dB) that comes from a
 *   near-cancellation of zeros the mappings do not preserve; matching there would move the
 *   passband by tens of dB.
 * - Otherwise the passband starts at the lowest −3 dB point ω_l. A high-pass (|H(∞)| in
 *   the passband) is matched an octave above it, at 2·ω_l; a band-pass at the geometric
 *   centre √(ω_l·ω_h) of the outermost −3 dB points, which is exactly ω₀ = √(ω₁ω₂) since an
 *   LP → BP response is symmetric under ω → ω₀²/ω. Both at most 0.9·Nyquist.
 * Not the frequency of max |H|: an equiripple passband has N equal peaks, and the one
 * that wins by rounding is often at a band edge, where the mappings distort most.
 * |H| is compared as ln|H| (see {@link logAbsZpk}), so it stays finite at any order.
 */
export function referenceFrequency(zpk: ZPK, fs: number): number {
	const wMax = 0.9 * Math.PI * fs;
	const mag = (w: number) => logAbsZpk(zpk, c(0, w));
	// log grid from far below to far above Nyquist and every pole (to tell a high-pass from a
	// band-pass), plus the pole frequencies so that a very narrow passband is not missed
	const top = 1e3 * Math.max(wMax, ...zpk.p.map(abs), ...zpk.z.map(abs));
	const bottom = 1e-9 * wMax;
	const w = [
		...logspace(bottom, top, Math.ceil(64 * Math.log10(top / bottom))),
		...zpk.p.map((p) => Math.abs(p.im)).filter((v) => v > bottom && v < top)
	].sort((a, b) => a - b);
	const m = w.map(mag);
	const h0 = mag(0);
	const peak = Math.max(h0, ...m);
	if (!Number.isFinite(peak)) return (Math.PI * fs) / 2;
	if (h0 >= peak + IN_PASSBAND) return 0;
	const thr = peak + HALF_POWER;
	let first = -1;
	let last = -1;
	m.forEach((v, i) => {
		if (v < thr) return;
		if (first < 0) first = i;
		last = i;
	});
	// the −3 dB crossing between w[a] and w[a + 1] (bisection in log ω)
	const cross = (a: number): number => {
		let lo = Math.log(w[a]);
		let hi = Math.log(w[a + 1]);
		const loAbove = m[a] >= thr;
		for (let i = 0; i < 60 && hi - lo > 1e-12; i++) {
			const mid = (lo + hi) / 2;
			if (mag(Math.exp(mid)) >= thr === loAbove) lo = mid;
			else hi = mid;
		}
		return Math.exp((lo + hi) / 2);
	};
	const wl = first > 0 ? cross(first - 1) : w[0];
	// high-pass: the top of the grid (far above every pole and zero) is in the passband
	if (m[m.length - 1] >= peak + IN_PASSBAND) return Math.min(2 * wl, wMax);
	return Math.min(Math.sqrt(wl * cross(last)), wMax);
}

function matchGain(analog: ZPK, digital: ZPK, fs: number, wRef?: number): ZPK {
	const w = wRef ?? referenceFrequency(analog, fs);
	// |Ha(jω)| / |Hd(e^{jωT})| with k = 1, as a difference of logs (no overflow at high order)
	const la = logAbsZpk(analog, c(0, w));
	const ld = logAbsZpk({ ...digital, k: 1 }, c(Math.cos(w / fs), Math.sin(w / fs)));
	return { ...digital, k: ld > -Infinity ? Math.exp(la - ld) : 1 };
}

/**
 * Matched-Z transform: map each pole and zero by z = e^{sT}. Zeros at infinity
 * are placed at z = −1 (the "modified" matched-Z), which keeps the order and
 * rolls off towards Nyquist. Gain is matched at `wRef` (rad/s; default
 * {@link referenceFrequency}).
 */
export function matchedZ(
	zpk: ZPK,
	fs: number,
	infiniteZerosAt: 'nyquist' | 'origin' = 'nyquist',
	wRef?: number
): ZPK {
	const T = 1 / fs;
	const degree = zpk.p.length - zpk.z.length;
	const z = zpk.z.map((zz) => exp(scale(zz, T)));
	const p = zpk.p.map((pp) => exp(scale(pp, T)));
	for (let i = 0; i < degree; i++) z.push(c(infiniteZerosAt === 'nyquist' ? -1 : 0));
	return matchGain(zpk, { z, p, k: 1 }, fs, wRef);
}

/**
 * Forward Euler: s = (z − 1)/T  →  z = 1 + sT. Can turn stable poles unstable!
 * Gain is matched at `wRef` (rad/s; default {@link referenceFrequency}).
 */
export function forwardEuler(zpk: ZPK, fs: number, wRef?: number): ZPK {
	const T = 1 / fs;
	const z = zpk.z.map((zz) => add(c(1), scale(zz, T)));
	const p = zpk.p.map((pp) => add(c(1), scale(pp, T)));
	// zeros at infinity stay at infinity (H has fewer finite zeros → pure delay)
	return matchGain(zpk, { z, p, k: 1 }, fs, wRef);
}

/**
 * Backward Euler: s = (z − 1)/(zT)  →  z = 1/(1 − sT). Always stable, heavy warping.
 * Gain is matched at `wRef` (rad/s; default {@link referenceFrequency}).
 */
export function backwardEuler(zpk: ZPK, fs: number, wRef?: number): ZPK {
	const T = 1 / fs;
	const degree = zpk.p.length - zpk.z.length;
	const z = zpk.z.map((zz) => div(c(1), sub(c(1), scale(zz, T))));
	const p = zpk.p.map((pp) => div(c(1), sub(c(1), scale(pp, T))));
	for (let i = 0; i < degree; i++) z.push(c(0));
	return matchGain(zpk, { z, p, k: 1 }, fs, wRef);
}

export interface ImpulseInvarianceResult {
	zpk: ZPK;
	/** Set when the method is not well defined for this filter. */
	warning?: string;
}

interface ImpulseInvariantModel {
	/** H(z) = T·Σ_{n≥0} h(nT)·z⁻ⁿ (h(0) = h(0⁺)) and dH/dz at any point z ≠ 0. */
	at(z: Complex): { h: Complex; dh: Complex };
	/** Relative degree of the strictly proper part of H(s) (h(t) ∝ t^{r−1} near t = 0). */
	relDegree: number;
}

/**
 * The impulse-invariant H(z) evaluated without residues or expanded polynomials, so it
 * keeps its relative accuracy near the zeros at any order and for repeated poles. (The
 * residues of a high-order filter are large and cancel almost completely, and its poles
 * e^{pT} crowd around z = 1, so the partial-fraction sum T·Σ r_i z/(z − e^{p_iT}) cannot
 * locate the zeros once it is multiplied out.) It uses the aliasing (Poisson) sum
 *   H(e^{sT}) = Σ_k H_sp(s + jkω_s) + T·h(0⁺)/2,
 * where H_sp is the strictly proper part of H(s). The terms |k| ≤ K are evaluated in
 * pole–zero form; the tail |k| > K comes from the Laurent (Markov) coefficients
 * H_sp(s) = Σ m_n s^{−n−1}, which are exact power-series products of the poles and zeros.
 * Frequencies are normalised to ω_s = 2π·fs, so s̃ = s/ω_s = ln(z)/2π.
 */
function impulseInvariantModel(zpk: ZPK, fs: number): ImpulseInvariantModel {
	const ws = 2 * Math.PI * fs;
	const N = zpk.p.length;
	const M = zpk.z.length;
	const r = N - M;
	const pr = zpk.p.map((v) => v.re / ws);
	const pim = zpk.p.map((v) => v.im / ws);
	const zr = zpk.z.map((v) => v.re / ws);
	const zim = zpk.z.map((v) => v.im / ws);
	const k0 = zpk.k * Math.pow(ws, -r); // H = k0·Π(s̃ − z̃)/Π(s̃ − p̃)
	// Π(1 − z̃u)/Π(1 − p̃u) = Σ c_j u^j with u = 1/s̃, so H = k0·Σ c_j s̃^{−r−j}: the terms
	// r + j ≤ 0 are the polynomial part, m_n = c_{n+1−r} the Markov coefficients of H_sp.
	const Q = 2 * Math.ceil((Math.max(r, 1) + 32) / 2); // highest tail power s̃^{−Q}
	const nc = Q + Math.max(0, -r) + 1;
	const cr = new Float64Array(nc);
	const ci = new Float64Array(nc);
	cr[0] = 1;
	for (let i = 0; i < M; i++)
		for (let j = nc - 1; j > 0; j--) {
			cr[j] -= zr[i] * cr[j - 1] - zim[i] * ci[j - 1];
			ci[j] -= zr[i] * ci[j - 1] + zim[i] * cr[j - 1];
		}
	for (let i = 0; i < N; i++)
		for (let j = 1; j < nc; j++) {
			cr[j] += pr[i] * cr[j - 1] - pim[i] * ci[j - 1];
			ci[j] += pr[i] * ci[j - 1] + pim[i] * cr[j - 1];
		}
	const m = new Float64Array(Q);
	for (let n = Math.max(0, r - 1); n < Q; n++) m[n] = cr[n + 1 - r];
	const poly = r <= 0 ? Array.from(cr.subarray(0, 1 - r)) : [];
	let relDegree = Math.max(r, 1);
	if (r <= 0) {
		// H_sp(s) = k0·(c_{1−r}/s̃ + …); c_{1−r} vanishes only by an exact cancellation
		const scl = [...pr, ...pim, ...zr, ...zim].reduce((s, v) => s + Math.abs(v), 0);
		if (Math.abs(m[0]) <= 1e-13 * Math.pow(1 + scl, 1 - r)) {
			m[0] = 0;
			relDegree = 2;
		}
	}
	const first = relDegree - 1;
	// binomials C(q−1, n) for the tail
	const binom: Float64Array[] = [];
	for (let q = 2; q <= Q; q += 2) {
		const b = new Float64Array(q);
		b[0] = 1;
		for (let n = 1; n < q; n++) b[n] = (b[n - 1] * (q - n)) / n;
		binom[q] = b;
	}
	// ζ_K(q) = Σ_{k>K} k^{−q} (even q): 16 terms, then Euler–Maclaurin
	const zetaCache = new Map<number, Float64Array>();
	const zetaTail = (K: number): Float64Array => {
		let zt = zetaCache.get(K);
		if (zt) return zt;
		zt = new Float64Array(Q + 1);
		const a = K + 17;
		for (let q = 2; q <= Q; q += 2) {
			const aq = Math.pow(a, -q);
			let s =
				(a * aq) / (q - 1) +
				aq / 2 +
				(q * aq) / (12 * a) -
				(q * (q + 1) * (q + 2) * aq) / (720 * a ** 3) +
				(q * (q + 1) * (q + 2) * (q + 3) * (q + 4) * aq) / (30240 * a ** 5) -
				(q * (q + 1) * (q + 2) * (q + 3) * (q + 4) * (q + 5) * (q + 6) * aq) / (1209600 * a ** 7);
			for (let k = K + 16; k > K; k--) s += Math.pow(k, -q);
			zt[q] = s;
		}
		zetaCache.set(K, zt);
		return zt;
	};
	// K is chosen so that (|s̃| + ρ)/(K + 1) ≤ 1/4: the tail then converges like 4^{−q}
	// (ρ includes the zeros, which set the size of the first Markov coefficients)
	const rho = Math.max(0, ...zpk.p.map(abs), ...zpk.z.map(abs)) / ws;

	const at = (z: Complex): { h: Complex; dh: Complex } => {
		const sr = Math.log(abs(z)) / (2 * Math.PI);
		const si = Math.atan2(z.im, z.re) / (2 * Math.PI);
		const K = Math.min(400, Math.ceil(4 * (Math.hypot(sr, si) + rho)));
		let hr = 0;
		let hi = 0;
		let dr = 0;
		let di = 0;
		// aliases |k| ≤ K in pole–zero form (zeros and poles interleaved against overflow)
		for (let k = -K; k <= K; k++) {
			const xi = si + k;
			let ar = k0;
			let ai = 0;
			let lr = 0;
			let li = 0;
			for (let i = 0; i < N || i < M; i++) {
				if (i < M) {
					const ur = sr - zr[i];
					const ui = xi - zim[i];
					const t = ar * ur - ai * ui;
					ai = ar * ui + ai * ur;
					ar = t;
					const q = ur * ur + ui * ui;
					lr += ur / q;
					li -= ui / q;
				}
				if (i < N) {
					const ur = sr - pr[i];
					const ui = xi - pim[i];
					const q = ur * ur + ui * ui;
					const t = (ar * ur + ai * ui) / q;
					ai = (ai * ur - ar * ui) / q;
					ar = t;
					lr -= ur / q;
					li += ui / q;
				}
			}
			let er = ar * lr - ai * li;
			let ei = ar * li + ai * lr;
			if (!Number.isFinite(er) || !Number.isFinite(ei)) {
				er = 0; // s̃ + jk sits exactly on an analog zero (only used as a Newton slope)
				ei = 0;
			}
			if (r <= 0) {
				// remove the polynomial part k0·Σ_{j≤−r} c_j σ^{−r−j}
				let vr = 0;
				let vi = 0;
				let gr = 0;
				let gi = 0;
				for (const cj of poly) {
					const tg = gr * sr - gi * xi + vr;
					gi = gr * xi + gi * sr + vi;
					gr = tg;
					const tv = vr * sr - vi * xi + cj;
					vi = vr * xi + vi * sr;
					vr = tv;
				}
				ar -= k0 * vr;
				ai -= k0 * vi;
				er -= k0 * gr;
				ei -= k0 * gi;
			}
			hr += ar;
			hi += ai;
			dr += er;
			di += ei;
		}
		// tail Σ_{|k|>K} Σ_n m_n (s̃ + jk)^{−n−1}
		//   = Σ_{q even} 2ζ_K(q)·j^{−q}·Σ_{n<q} C(q−1, n)·m_n·(−s̃)^{q−1−n}
		const zt = zetaTail(K);
		let tr = 0;
		let ti = 0;
		let tdr = 0;
		let tdi = 0;
		for (let q = 2 * Math.ceil((first + 1) / 2); q <= Q; q += 2) {
			const b = binom[q];
			let vr = 0;
			let vi = 0;
			let gr = 0;
			let gi = 0;
			for (let n = first; n < q; n++) {
				const tg = -(gr * sr - gi * si) + vr;
				gi = -(gr * si + gi * sr) + vi;
				gr = tg;
				const tv = -(vr * sr - vi * si) + b[n] * m[n];
				vi = -(vr * si + vi * sr);
				vr = tv;
			}
			const f = 2 * zt[q] * (q % 4 === 0 ? 1 : -1);
			tr += f * vr;
			ti += f * vi;
			tdr -= f * gr;
			tdi -= f * gi;
		}
		hr += k0 * tr + Math.PI * k0 * m[0]; // + T·h(0⁺)/2
		hi += k0 * ti;
		dr += k0 * tdr;
		di += k0 * tdi;
		// dH/dz = (dH/ds̃)/(2π z)
		return { h: c(hr, hi), dh: div(c(dr, di), scale(z, 2 * Math.PI)) };
	};
	return { at, relDegree };
}

/**
 * Aberth–Ehrlich iteration for the roots of a polynomial known only through its
 * logarithmic derivative P'/P (null where P vanishes exactly).
 */
function aberthImplicit(
	logDeriv: (z: Complex) => Complex | null,
	init: readonly Complex[],
	maxIter = 400
): { roots: Complex[]; converged: boolean } {
	const n = init.length;
	const zr = Float64Array.from(init, (v) => v.re);
	const zi = Float64Array.from(init, (v) => v.im);
	const done = new Uint8Array(n);
	const prev = new Float64Array(n).fill(Infinity);
	let remaining = n;
	for (let it = 0; it < maxIter && remaining > 0; it++) {
		for (let i = 0; i < n; i++) {
			if (done[i]) continue;
			const L = logDeriv(c(zr[i], zi[i]));
			const ll = L ? L.re * L.re + L.im * L.im : Infinity;
			if (!L || ll === Infinity) {
				done[i] = 1;
				remaining--;
				continue;
			}
			if (!(ll > 0)) continue;
			const wr = L.re / ll; // w = 1/L = P/P'
			const wi = -L.im / ll;
			let sr = 0;
			let si = 0;
			for (let j = 0; j < n; j++) {
				if (j === i) continue;
				const er = zr[i] - zr[j];
				const ei = zi[i] - zi[j];
				const e2 = er * er + ei * ei;
				if (e2 === 0) continue;
				sr += er / e2;
				si -= ei / e2;
			}
			// step = w / (1 − w·S)
			const qr = 1 - (wr * sr - wi * si);
			const qi = -(wr * si + wi * sr);
			const q2 = qr * qr + qi * qi;
			const stepR = (wr * qr + wi * qi) / q2;
			const stepI = (wi * qr - wr * qi) / q2;
			if (!Number.isFinite(stepR) || !Number.isFinite(stepI)) continue;
			zr[i] -= stepR;
			zi[i] -= stepI;
			const st = Math.hypot(stepR, stepI);
			const az = Math.hypot(zr[i], zi[i]);
			// converged, or stalled at the rounding floor
			if (st <= 1e-14 * az || (st <= 1e-10 * az && st >= 0.5 * prev[i])) {
				done[i] = 1;
				remaining--;
			}
			prev[i] = st;
		}
	}
	return {
		roots: Array.from(zr, (re, i) => c(re, zi[i])),
		converged: remaining === 0
	};
}

/**
 * Impulse invariance: h[n] = T·h(nT), i.e. H(z) = T·Σ r_i/(1 − e^{p_iT}z⁻¹) for simple
 * poles (repeated poles give the t^{m−1}e^{pt} terms). A direct-feedthrough term
 * (high-pass / band-stop) cannot be sampled and is reported as a warning.
 *
 * The poles are e^{p_iT} exactly. The zeros are not computed by multiplying the partial
 * fractions out and re-rooting the numerator: at high order that polynomial is pure
 * rounding noise. Instead they are found as the roots of B(z) = H(z)·Π(z − e^{p_iT}),
 * which is evaluated through an accurate model of H(z). B always has a zero at z = 0; its
 * degree is N, or N − 1 when h(0⁺) = 0 (relative degree ≥ 2), which is then also the
 * number of zeros.
 */
export function impulseInvariance(zpk: ZPK, fs: number): ImpulseInvarianceResult {
	const T = 1 / fs;
	const np = zpk.p.length;
	let warning: string | undefined;
	if (zpk.z.length >= np) {
		warning =
			'H(s) is not strictly proper (it has a direct feed-through term, as high-pass and band-stop filters do). Impulse invariance cannot represent it — the impulse response contains a Dirac delta and severe aliasing. The constant term was dropped.';
	}
	const d = zpk.p.map((pp) => exp(scale(pp, T)));
	if (np === 0 || zpk.k === 0) return { zpk: { z: [], p: d, k: 0 }, warning };
	const model = impulseInvariantModel(zpk, fs);
	const nz = Math.max(0, model.relDegree >= 2 ? np - 2 : np - 1); // besides z = 0
	const bAt = (z: Complex): Complex => {
		let b = model.at(z).h;
		for (const di of d) b = mul(b, sub(z, di));
		return b;
	};

	// Starting points: the coefficients of B from N + 1 samples on the unit circle. They
	// are only accurate to ~eps·max|B|, which is enough to start the iteration.
	let guess: Complex[] = [];
	if (nz > 0) {
		const L = np + 1;
		const beta = Array.from({ length: L }, () => c(0));
		for (let k = 0; k < L; k++) {
			const th = (Math.PI * (2 * k + 1)) / L;
			const b = scale(bAt(c(Math.cos(th), Math.sin(th))), 1 / L);
			for (let i = 1; i < L; i++)
				beta[i] = add(beta[i], mul(b, c(Math.cos(th * i), -Math.sin(th * i))));
		}
		const desc = beta.map((v) => v.re).reverse(); // descending powers; β₀ = B(0) = 0
		desc[desc.length - 1] = 0;
		if (model.relDegree >= 2) desc[0] = 0; // T·h(0⁺) = 0 exactly
		guess = roots(desc);
		const iz = guess.findIndex((g) => g.re === 0 && g.im === 0);
		if (iz >= 0) guess.splice(iz, 1);
		guess = guess.filter((g) => Number.isFinite(g.re) && Number.isFinite(g.im)).slice(0, nz);
		while (guess.length < nz) guess.push(c(-2 - guess.length, 0.5)); // never needed in practice
		// keep the starting points distinct and away from z = 0
		guess = guess.map((g, i) => {
			const a = abs(g);
			return a < 1e-12 ? c(1e-3 * Math.cos(i + 1), 1e-3 * Math.sin(i + 1)) : g;
		});
	}
	const { roots: found, converged } = aberthImplicit((z) => {
		const { h, dh } = model.at(z);
		if (h.re === 0 && h.im === 0) return null;
		let L = div(dh, h);
		for (const di of d) L = add(L, div(c(1), sub(z, di)));
		return sub(L, div(c(1), z));
	}, guess);
	const zeros = cleanRealRoots([c(0), ...found]);

	// Gain from the point of largest |H| among the pole frequencies and a coarse grid
	const cand = [
		...zpk.p.flatMap((pp) => [abs(pp) * T, Math.abs(pp.im) * T]),
		...Array.from({ length: 32 }, (_, i) => (Math.PI * (i + 0.5)) / 32)
	].filter((w) => w > 0 && w < Math.PI);
	const pts = cand.map((w) => ({ w, h: model.at(c(Math.cos(w), Math.sin(w))).h }));
	const top = pts.reduce((a, b) => (abs(b.h) > abs(a.h) ? b : a));
	const k = div(top.h, freqzZpk({ z: zeros, p: d, k: 1 }, [top.w])[0]).re;
	const out: ZPK = { z: zeros, p: d, k };

	// Self-check against the model wherever the response is within 100 dB of its peak
	const hz = freqzZpk(
		out,
		pts.map((v) => v.w)
	);
	const peak = abs(top.h);
	const bad =
		!converged ||
		!Number.isFinite(k) ||
		pts.some((v, i) => abs(v.h) > 1e-5 * peak && abs(sub(hz[i], v.h)) > 1e-6 * abs(v.h));
	if (bad) {
		const msg =
			'Impulse invariance is numerically ill-conditioned for this filter: the zeros could not be computed to full accuracy. Lower the order or use the bilinear transform.';
		warning = warning ? `${warning} ${msg}` : msg;
	}
	return { zpk: out, warning };
}

export type Discretization =
	'bilinear' | 'matched' | 'impulse' | 'forward-euler' | 'backward-euler';

export interface DiscretizeResult {
	zpk: ZPK;
	warning?: string;
}

/**
 * Discretise an analog ZPK (rad/s). `wRef` (rad/s) is the frequency at which the
 * matched-Z and Euler methods match the gain; pass a passband frequency when the band
 * is known (DC for LP/BS, √(ω₁ω₂) for BP, e.g. min(2ω₁, 0.9·πfs) for HP). The default
 * is {@link referenceFrequency}.
 */
export function discretize(
	analog: ZPK,
	fs: number,
	method: Discretization,
	wRef?: number
): DiscretizeResult {
	switch (method) {
		case 'bilinear':
			return { zpk: bilinear(analog, fs) };
		case 'matched':
			return { zpk: matchedZ(analog, fs, 'nyquist', wRef) };
		case 'impulse':
			return impulseInvariance(analog, fs);
		case 'forward-euler': {
			const zpk = forwardEuler(analog, fs, wRef);
			const unstable = zpk.p.some((p) => abs(p) >= 1);
			return {
				zpk,
				warning: unstable
					? 'Forward Euler mapped some stable analog poles outside the unit circle — the digital filter is unstable. Increase fs or use another method.'
					: undefined
			};
		}
		case 'backward-euler':
			return { zpk: backwardEuler(analog, fs, wRef) };
	}
}
