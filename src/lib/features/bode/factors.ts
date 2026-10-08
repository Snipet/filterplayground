/**
 * Bode plot builder: elementary factors in standard (Bode) form, their exact
 * and straight-line asymptotic magnitude/phase, and loop-gain margins.
 *
 * Every factor is written so that it is 1 (0 dB, 0°) well below its corner:
 *   gain            K
 *   power           (s/ω_u)^n                  n = ±1, ±2 (0 dB at f_u)
 *   real pole       1 / (1 ± s/ω_p)            '−' for a right-half-plane pole
 *   real zero       (1 ± s/ω_z)                '−' for a right-half-plane zero
 *   complex poles   1 / (1 + 2ζ s/ω_n + (s/ω_n)²)
 *   complex zeros   1 + 2ζ s/ω_n + (s/ω_n)²
 *   delay           e^{−sT}
 * Frequencies are in Hz (ω = 2πf).
 */
import type { Complex } from '$lib/dsp/complex';
import { polymul, roots } from '$lib/dsp/poly';

export type FactorType =
	'gain' | 'power' | 'realPole' | 'realZero' | 'complexPole' | 'complexZero' | 'delay';

export interface Factor {
	id: number;
	/** Colour slot 0…7, fixed for the factor's lifetime. */
	slot: number;
	type: FactorType;
	/** Gain magnitude in dB (gain). */
	gainDb: number;
	/** Gain sign (gain): −1 adds −180°. */
	sign: 1 | -1;
	/** Power of s (power). */
	n: number;
	/** Corner / natural / unity-gain frequency, Hz. */
	f: number;
	/** Damping ratio (complex pairs). */
	zeta: number;
	/** Right-half-plane real root. */
	rhp: boolean;
	/** Delay, seconds. */
	T: number;
}

export type PhaseApprox = 'decade' | 'zeta' | 'step';

export const MAX_FACTORS = 8;

export const FACTOR_TYPES: { id: FactorType; name: string }[] = [
	{ id: 'gain', name: 'Constant gain K' },
	{ id: 'power', name: 'Integrator / differentiator sⁿ' },
	{ id: 'realPole', name: 'Real pole' },
	{ id: 'realZero', name: 'Real zero' },
	{ id: 'complexPole', name: 'Complex pole pair' },
	{ id: 'complexZero', name: 'Complex zero pair' },
	{ id: 'delay', name: 'Time delay e^(−sT)' }
];

let nextId = 1;

export function makeFactor(
	type: FactorType,
	slot: number,
	p: Partial<Omit<Factor, 'id' | 'slot' | 'type'>> = {}
): Factor {
	return {
		id: nextId++,
		slot,
		type,
		gainDb: 0,
		sign: 1,
		n: -1,
		f: 100,
		zeta: 0.3,
		rhp: false,
		T: 1e-3,
		...p
	};
}

/** Lowest colour slot not used by any factor (or −1 when all eight are taken). */
export function freeSlot(factors: readonly Factor[]): number {
	for (let s = 0; s < MAX_FACTORS; s++) if (!factors.some((f) => f.slot === s)) return s;
	return -1;
}

const R2D = 180 / Math.PI;

export interface Point {
	db: number;
	deg: number;
}

/** Exact magnitude (dB) and phase (degrees, continuous) of one factor at f (Hz). */
export function exact(fc: Factor, f: number): Point {
	switch (fc.type) {
		case 'gain':
			return { db: fc.gainDb, deg: fc.sign < 0 ? -180 : 0 };
		case 'power':
			return { db: 20 * fc.n * Math.log10(f / fc.f), deg: 90 * fc.n };
		case 'realPole':
		case 'realZero': {
			const x = f / fc.f;
			const db = 10 * Math.log10(1 + x * x);
			const ph = Math.atan(x) * R2D;
			// zero (1 + jx): +db, +ph;  RHP zero (1 − jx): +db, −ph;  poles invert
			const s = fc.type === 'realZero' ? 1 : -1;
			return { db: s * db, deg: s * (fc.rhp ? -ph : ph) };
		}
		case 'complexPole':
		case 'complexZero': {
			const u = f / fc.f;
			const re = 1 - u * u;
			const im = 2 * fc.zeta * u;
			const db = 10 * Math.log10(re * re + im * im);
			const ph = Math.atan2(im, re) * R2D; // 0 … 180 for ζ > 0
			const s = fc.type === 'complexZero' ? 1 : -1;
			return { db: s * db, deg: s * ph };
		}
		case 'delay':
			return { db: 0, deg: -360 * f * fc.T };
	}
}

/** Straight-line asymptotic approximation of one factor. */
export function asymptote(fc: Factor, f: number, approx: PhaseApprox): Point {
	switch (fc.type) {
		case 'gain':
		case 'power':
		case 'delay':
			// exact already (a delay has no straight-line form on a log axis)
			return exact(fc, f);
		case 'realPole':
		case 'realZero': {
			const x = Math.log10(f / fc.f);
			const db = x <= 0 ? 0 : 20 * x;
			const ph = x <= -1 ? 0 : x >= 1 ? 90 : 45 * (x + 1);
			const s = fc.type === 'realZero' ? 1 : -1;
			// "+ 0" turns −0 into 0
			return { db: s * db + 0, deg: s * (fc.rhp ? -ph : ph) + 0 };
		}
		case 'complexPole':
		case 'complexZero': {
			const x = Math.log10(f / fc.f);
			const db = x <= 0 ? 0 : 40 * x;
			let ph: number;
			if (approx === 'step') ph = x < 0 ? 0 : x > 0 ? 180 : 90;
			else {
				const w = approx === 'decade' ? 1 : Math.max(fc.zeta, 1e-6);
				ph = x <= -w ? 0 : x >= w ? 180 : 90 * (x / w + 1);
			}
			const s = fc.type === 'complexZero' ? 1 : -1;
			return { db: s * db + 0, deg: s * ph + 0 };
		}
	}
}

export function totalExact(factors: readonly Factor[], f: number): Point {
	let db = 0;
	let deg = 0;
	for (const fc of factors) {
		const p = exact(fc, f);
		db += p.db;
		deg += p.deg;
	}
	return { db, deg };
}

export function totalAsymptote(factors: readonly Factor[], f: number, approx: PhaseApprox): Point {
	let db = 0;
	let deg = 0;
	for (const fc of factors) {
		const p = asymptote(fc, f, approx);
		db += p.db;
		deg += p.deg;
	}
	return { db, deg };
}

/** Low- and high-frequency magnitude slopes in dB/decade. */
export function slopes(factors: readonly Factor[]): { low: number; high: number } {
	let low = 0;
	let high = 0;
	for (const fc of factors) {
		if (fc.type === 'power') {
			low += 20 * fc.n;
			high += 20 * fc.n;
		} else if (fc.type === 'realPole') high -= 20;
		else if (fc.type === 'realZero') high += 20;
		else if (fc.type === 'complexPole') high -= 40;
		else if (fc.type === 'complexZero') high += 40;
	}
	return { low, high };
}

/**
 * Low-frequency asymptote in dB at f (Hz): K·Π(s/ω_u)^n, the line every other
 * factor sits on well below its corner. With no net power of s it is the DC gain.
 */
export function lowAsymptoteDb(factors: readonly Factor[], f: number): number {
	let db = 0;
	for (const fc of factors) {
		if (fc.type === 'gain') db += fc.gainDb;
		else if (fc.type === 'power') db += 20 * fc.n * Math.log10(f / fc.f);
	}
	return db;
}

/** High-frequency asymptote in dB at f (Hz): every factor on its above-corner line. */
export function highAsymptoteDb(factors: readonly Factor[], f: number): number {
	let db = lowAsymptoteDb(factors, f);
	for (const fc of factors) {
		const x = Math.log10(f / fc.f);
		if (fc.type === 'realPole') db -= 20 * x;
		else if (fc.type === 'realZero') db += 20 * x;
		else if (fc.type === 'complexPole') db -= 40 * x;
		else if (fc.type === 'complexZero') db += 40 * x;
	}
	return db;
}

/**
 * Magnitude at DC in dB: ∞ with a net integrator, −∞ with a net differentiator,
 * otherwise K·Π ω_u^{−n} — powers of s that cancel still leave that constant.
 */
export function dcGainDb(factors: readonly Factor[]): number {
	const { low } = slopes(factors);
	return low < 0 ? Infinity : low > 0 ? -Infinity : lowAsymptoteDb(factors, 1);
}

/** Frequencies (Hz) that characterise the factors: corners, unity-gain points, 1/(2πT). */
export function characteristicFrequencies(factors: readonly Factor[]): number[] {
	const out: number[] = [];
	for (const fc of factors) {
		if (fc.type === 'gain') continue;
		if (fc.type === 'delay') out.push(1 / (2 * Math.PI * fc.T));
		else out.push(fc.f);
	}
	return out.filter((v) => Number.isFinite(v) && v > 0);
}

/** Display range: one decade beyond the extreme corners, at least 3 decades. */
export function autoRange(factors: readonly Factor[], extra: number[] = []): [number, number] {
	const fr = [
		...characteristicFrequencies(factors),
		...extra.filter((v) => Number.isFinite(v) && v > 0)
	];
	if (!fr.length) return [1, 1e4];
	let lo = Math.pow(10, Math.floor(Math.log10(Math.min(...fr))) - 1);
	let hi = Math.pow(10, Math.ceil(Math.log10(Math.max(...fr))) + 1);
	while (hi / lo < 999) {
		lo /= 10;
		hi *= 10;
	}
	return [lo, hi];
}

export function logGrid(lo: number, hi: number, n: number): number[] {
	const a = Math.log10(lo);
	const b = Math.log10(hi);
	return Array.from({ length: n }, (_, i) => Math.pow(10, a + ((b - a) * i) / (n - 1)));
}

// ---------------------------------------------------------------------------
// Loop-gain margins
// ---------------------------------------------------------------------------

/** Wrap an angle in degrees to (−180, 180]. */
export const wrap180 = (d: number): number => {
	let x = d % 360;
	if (x <= -180) x += 360;
	if (x > 180) x -= 360;
	return x;
};

export interface Crossing {
	f: number;
	/** Phase margin (gain crossover) or gain margin in dB (phase crossover). */
	margin: number;
}

export interface Margins {
	/** All gain crossovers (|L| = 0 dB) with their phase margins. */
	gainCrossovers: Crossing[];
	/** All phase crossovers (∠L ≡ −180°) with their gain margins (dB). */
	phaseCrossovers: Crossing[];
	/** Worst (smallest) phase margin, degrees. */
	pm: Crossing | null;
	/** Worst (smallest) gain margin, dB. */
	gm: Crossing | null;
}

function bisect(g: (lf: number) => number, a: number, b: number): number {
	let ga = g(a);
	for (let i = 0; i < 60; i++) {
		const m = (a + b) / 2;
		const gm = g(m);
		if (gm === 0) return m;
		if (Math.sign(gm) === Math.sign(ga)) {
			a = m;
			ga = gm;
		} else b = m;
	}
	return (a + b) / 2;
}

/**
 * Margin search range: [lo, hi] widened so that it contains every gain crossover.
 * Outside a range that already reaches 1000× beyond the extreme corners, |L| follows
 * its low- or high-frequency asymptote (a straight line), so a crossover out there is
 * where that line meets 0 dB — e.g. a 70 dB gain with a pole at 5 Hz crosses at
 * ≈ 15.8 kHz, far above the corner-based range. A decade of slack is added.
 */
export function marginRange(factors: readonly Factor[], lo: number, hi: number): [number, number] {
	const sl = slopes(factors);
	const LIMIT = 1e40; // keeps every factor finite in floating point
	if (sl.low !== 0) {
		// low asymptote: c + sl.low·log10(f) = 0
		const f = Math.pow(10, -lowAsymptoteDb(factors, 1) / sl.low);
		if (f < lo) lo = Math.max(f / 10, 1 / LIMIT);
	}
	if (sl.high !== 0) {
		const f = Math.pow(10, -highAsymptoteDb(factors, 1) / sl.high);
		if (f > hi) hi = Math.min(f * 10, LIMIT);
	}
	return [lo, hi];
}

/**
 * Gain and phase margins of the loop gain L = Π factors, searched on [lo, hi]
 * (see marginRange). PM = 180° + ∠L(f_gc) wrapped to (−180°, 180°]; GM = −|L(f_pc)|
 * in dB where ∠L(f_pc) ≡ −180° (mod 360°). The default grid has ≈ 600 points per decade.
 */
export function margins(
	factors: readonly Factor[],
	lo: number,
	hi: number,
	n = Math.min(40000, Math.max(4000, Math.ceil(600 * Math.log10(hi / lo))))
): Margins {
	const grid = logGrid(lo, hi, n);
	const lg = grid.map(Math.log10);
	const at = (lf: number) => totalExact(factors, Math.pow(10, lf));
	const pts = lg.map(at);
	const gainCrossovers: Crossing[] = [];
	const phaseCrossovers: Crossing[] = [];
	// last grid point with a finite, non-zero dB value: a crossover is a change of sign,
	// possibly through samples that are exactly 0 dB (e.g. |L(0)| = 1 at the low end)
	let last = Number.isFinite(pts[0].db) && pts[0].db !== 0 ? 0 : -1;
	for (let i = 1; i < n; i++) {
		const a = pts[i - 1];
		const b = pts[i];
		if (!Number.isFinite(b.db)) last = -1;
		else if (b.db !== 0) {
			if (last >= 0 && pts[last].db * b.db < 0) {
				const lf = last === i - 1 ? bisect((x) => at(x).db, lg[i - 1], lg[i]) : lg[last + 1];
				gainCrossovers.push({ f: Math.pow(10, lf), margin: wrap180(180 + at(lf).deg) });
			}
			last = i;
		}
		// phase crossover: φ + 180 crosses a multiple of 360°
		const ka = Math.floor((a.deg + 180) / 360);
		const kb = Math.floor((b.deg + 180) / 360);
		if (ka !== kb && Number.isFinite(a.deg) && Number.isFinite(b.deg)) {
			const target = 360 * Math.max(ka, kb) - 180;
			const lf = bisect((x) => at(x).deg - target, lg[i - 1], lg[i]);
			phaseCrossovers.push({ f: Math.pow(10, lf), margin: -at(lf).db });
		}
	}
	const pm = gainCrossovers.reduce<Crossing | null>(
		(m, c) => (m === null || c.margin < m.margin ? c : m),
		null
	);
	const gm = phaseCrossovers.reduce<Crossing | null>(
		(m, c) => (m === null || c.margin < m.margin ? c : m),
		null
	);
	return { gainCrossovers, phaseCrossovers, pm, gm };
}

/** Margins searched over the corner-based range, widened by marginRange to every crossover. */
export function loopMargins(factors: readonly Factor[]): Margins {
	const [lo, hi] = autoRange(factors);
	const [a, b] = marginRange(factors, lo / 100, hi * 100);
	return margins(factors, a, b);
}

/**
 * Gain margins by direction: `up` is the smallest positive margin (how far the gain
 * may rise), `down` the negative margin closest to 0 dB (how far it may fall — only a
 * conditionally stable loop, or one around an unstable L, needs that) and `nearest`
 * whichever of the two is closer to 0 dB.
 */
export function gainMargins(m: Margins): {
	up: Crossing | null;
	down: Crossing | null;
	nearest: Crossing | null;
} {
	let up: Crossing | null = null;
	let down: Crossing | null = null;
	for (const c of m.phaseCrossovers) {
		if (c.margin > 0) {
			if (!up || c.margin < up.margin) up = c;
		} else if (!down || c.margin > down.margin) down = c;
	}
	const nearest = !up ? down : !down ? up : -down.margin < up.margin ? down : up;
	return { up, down, nearest };
}

// ---------------------------------------------------------------------------
// Closed-loop stability of 1/(1 + L)
// ---------------------------------------------------------------------------

/** Open-loop poles in the right half-plane (P in the Nyquist criterion). */
export function rhpPoles(factors: readonly Factor[]): number {
	let p = 0;
	for (const fc of factors) {
		if (fc.type === 'realPole' && fc.rhp) p += 1;
		else if (fc.type === 'complexPole' && fc.zeta < 0) p += 2;
	}
	return p;
}

/**
 * L = k·num/den as polynomials in x = s/ω₀ (descending powers; ω₀ in rad/s is the
 * geometric mean of the extreme characteristic frequencies, which keeps the
 * coefficients moderate). Powers of s are netted first, so s·(1/s) is just a
 * constant. Null when L contains a delay (not rational).
 */
function loopPolynomials(
	factors: readonly Factor[]
): { num: number[]; den: number[]; w0: number } | null {
	if (factors.some((fc) => fc.type === 'delay')) return null;
	const fr = characteristicFrequencies(factors);
	const w0 = fr.length ? 2 * Math.PI * Math.sqrt(Math.min(...fr) * Math.max(...fr)) : 1;
	let k = 1;
	let q = 0;
	let num = [1];
	let den = [1];
	for (const fc of factors) {
		const r = w0 / (2 * Math.PI * fc.f); // s/ω_c = r·x
		switch (fc.type) {
			case 'gain':
				k *= fc.sign * Math.pow(10, fc.gainDb / 20);
				break;
			case 'power':
				k *= Math.pow(r, fc.n);
				q += fc.n;
				break;
			case 'realPole':
				den = polymul(den, [fc.rhp ? -r : r, 1]);
				break;
			case 'realZero':
				num = polymul(num, [fc.rhp ? -r : r, 1]);
				break;
			case 'complexPole':
				den = polymul(den, [r * r, 2 * fc.zeta * r, 1]);
				break;
			case 'complexZero':
				num = polymul(num, [r * r, 2 * fc.zeta * r, 1]);
				break;
		}
	}
	if (q > 0) num = [...num, ...new Array<number>(q).fill(0)];
	if (q < 0) den = [...den, ...new Array<number>(-q).fill(0)];
	return { num: num.map((v) => v * k), den, w0 };
}

/**
 * Closed-loop poles of 1/(1 + L) in rad/s — the roots of den(s) + num(s) — for a
 * rational L; null when L has a delay. A pole–zero pair that cancels in L still
 * shows up here, so a cancelled right-half-plane pole is (rightly) reported.
 */
export function closedLoopPoles(factors: readonly Factor[]): Complex[] | null {
	const lp = loopPolynomials(factors);
	if (!lp) return null;
	return roots(characteristic(lp.num, lp.den)).map((x) => ({ re: x.re * lp.w0, im: x.im * lp.w0 }));
}

/** den + num, dropping leading terms that cancel (a biproper L with L(∞) = −1). */
function characteristic(num: readonly number[], den: readonly number[]): number[] {
	const n = Math.max(num.length, den.length);
	const a = [...new Array<number>(n - den.length).fill(0), ...den];
	const b = [...new Array<number>(n - num.length).fill(0), ...num];
	const ch = a.map((v, i) => v + b[i]);
	let i = 0;
	while (i < n - 1 && Math.abs(ch[i]) <= 1e-12 * (Math.abs(a[i]) + Math.abs(b[i]))) i++;
	return ch.slice(i);
}

/**
 * Closed-loop right-half-plane pole count Z = P − N from the Nyquist criterion, where
 * N counts the counter-clockwise encirclements of −1 by L(jω), −∞ < ω < ∞ (with a
 * small detour to the right of s = 0 around integrators). L crosses the ray
 * (−∞, −1) only where |L| > 1, and along each stretch with |L| > 1 the signed number
 * of crossings follows from the continuous phase at the stretch's two ends, i.e. at
 * the gain crossovers `fgc` (Hz). The ω < 0 half mirrors ω > 0 and doubles the count.
 * Valid when |L| → 0 at high frequency or tends to a constant below 1; with a delay and
 * |L(j∞)| ≥ 1 there are infinitely many right-half-plane poles (returns Infinity).
 * Returns null when the count cannot be decided (a crossover exactly on −1, or the
 * crossovers given are inconsistent).
 */
export function nyquistRhpCount(factors: readonly Factor[], fgc: readonly number[]): number | null {
	const sl = slopes(factors);
	const delay = factors.some((fc) => fc.type === 'delay');
	// |L(j∞)| in dB; a delay with |L(j∞)| > 1 gives a chain of roots at Re s = ln|L(j∞)|/T > 0
	const hf = sl.high < 0 ? -Infinity : sl.high > 0 ? Infinity : highAsymptoteDb(factors, 1);
	if (hf >= -1e-9) return delay && hf > 1e-9 ? Infinity : null;
	// ∠K: −180° per negative gain; the ω < 0 half of the stretch through ω = 0 has
	// phase 2∠K − ∠L(jω), so that stretch counts 2·k(φ) − ∠K/180
	const argK = factors.reduce((s, fc) => s + (fc.type === 'gain' && fc.sign < 0 ? -180 : 0), 0);
	const sorted = [...fgc].sort((a, b) => a - b);
	// |L| > 1 just above ω = 0? Integrators: yes; differentiators: no; else |L(0)| decides
	const dc = lowAsymptoteDb(factors, 1);
	let inside = sl.low < 0 || (sl.low === 0 && dc > 0);
	if (sl.low === 0 && Math.abs(dc) < 1e-9) {
		// |L(0)| = 1: L(0) = −1 puts a closed-loop pole at s = 0; L(0) = +1 — look above DC
		if (argK % 360 !== 0) return null;
		const fr = characteristicFrequencies(factors);
		const ft = sorted.length ? sorted[0] / 1.01 : fr.length ? Math.min(...fr) : 1;
		const d = totalExact(factors, ft).db;
		if (d === 0) return null;
		inside = d > 0;
	}
	const k = (deg: number) => Math.floor((deg + 180) / 360); // +1 each time φ rises through −180°
	const onRay = (deg: number) => {
		const d = (((deg + 180) % 360) + 360) % 360;
		return Math.min(d, 360 - d) < 1e-9;
	};
	let enter: number | null = null; // phase where the current |L| > 1 stretch began
	let ccw = 0;
	for (const f of sorted) {
		const ph = totalExact(factors, f).deg;
		if (onRay(ph)) return null;
		if (inside) ccw += enter === null ? 2 * k(ph) - argK / 180 : 2 * (k(ph) - k(enter));
		else enter = ph;
		inside = !inside;
	}
	if (inside) return null;
	const z = rhpPoles(factors) - ccw;
	return z >= 0 ? z : null;
}

export interface LoopStability {
	/** true: 1/(1 + L) is stable; false: unstable; null: a pole on the jω axis, or undecided. */
	stable: boolean | null;
	/** Closed-loop poles in the right half-plane (Infinity, or NaN when undecided). */
	rhp: number;
	/** Open-loop right-half-plane poles P. */
	openRhp: number;
	/** 'poles': roots of den + num (rational L); 'nyquist': Nyquist count (L with a delay). */
	method: 'poles' | 'nyquist';
}

/**
 * Exact closed-loop stability of 1/(1 + L). Reading it off the signs of the margins
 * fails for a conditionally stable loop (|L| > 1 at a phase crossover yet stable) and
 * for an unstable L, so a rational L is decided by its closed-loop poles and a loop
 * with a delay by the Nyquist count over its gain crossovers (`m`, default loopMargins).
 */
export function closedLoopStability(factors: readonly Factor[], m?: Margins): LoopStability {
	const openRhp = rhpPoles(factors);
	const lp = loopPolynomials(factors);
	if (lp) {
		const ch = characteristic(lp.num, lp.den);
		// 1 + L ≡ 0 (L = −1): no closed loop to speak of
		if (
			ch.length === 1 &&
			Math.abs(ch[0]) <= 1e-12 * (Math.abs(lp.den.at(-1)!) + Math.abs(lp.num.at(-1)!))
		)
			return { stable: null, rhp: NaN, openRhp, method: 'poles' };
		let rhp = 0;
		let edge = false;
		for (const p of closedLoopPoles(factors) ?? []) {
			if (!Number.isFinite(p.re) || !Number.isFinite(p.im))
				return { stable: null, rhp: NaN, openRhp, method: 'poles' };
			const tol = 1e-9 * Math.hypot(p.re, p.im);
			if (p.re > tol) rhp++;
			else if (p.re >= -tol) edge = true;
		}
		return { stable: rhp > 0 ? false : edge ? null : true, rhp, openRhp, method: 'poles' };
	}
	const z = nyquistRhpCount(
		factors,
		(m ?? loopMargins(factors)).gainCrossovers.map((c) => c.f)
	);
	return { stable: z === null ? null : z === 0, rhp: z ?? NaN, openRhp, method: 'nyquist' };
}

// ---------------------------------------------------------------------------
// Labels and TeX
// ---------------------------------------------------------------------------

export function fmtHz(f: number): string {
	if (f >= 1e6) return `${trim(f / 1e6)} MHz`;
	if (f >= 1e3) return `${trim(f / 1e3)} kHz`;
	return `${trim(f)} Hz`;
}

const trim = (v: number, d = 3) => String(Number(v.toPrecision(d)));

export function factorLabel(fc: Factor): string {
	switch (fc.type) {
		case 'gain': {
			const lin = Math.pow(10, fc.gainDb / 20) * fc.sign;
			return `Gain ${trim(lin)} (${trim(fc.gainDb)} dB)`;
		}
		case 'power': {
			const name = fc.n === -1 ? '1/s' : fc.n === -2 ? '1/s²' : fc.n === 1 ? 's' : 's²';
			return `${name}, 0 dB at ${fmtHz(fc.f)}`;
		}
		case 'realPole':
			return `${fc.rhp ? 'RHP pole' : 'Pole'} ${fmtHz(fc.f)}`;
		case 'realZero':
			return `${fc.rhp ? 'RHP zero' : 'Zero'} ${fmtHz(fc.f)}`;
		case 'complexPole':
			return `Poles ${fmtHz(fc.f)}, ζ ${trim(fc.zeta, 2)}`;
		case 'complexZero':
			return `Zeros ${fmtHz(fc.f)}, ζ ${trim(fc.zeta, 2)}`;
		case 'delay':
			return `Delay ${fc.T >= 1e-3 ? `${trim(fc.T * 1e3)} ms` : `${trim(fc.T * 1e6)} µs`}`;
	}
}

/** Number for TeX, 4 significant digits, ×10ⁿ outside [1e-3, 1e5). */
export function texNum(v: number, digits = 4): string {
	if (!Number.isFinite(v)) return v > 0 ? '\\infty' : '-\\infty';
	if (v === 0) return '0';
	const a = Math.abs(v);
	if (a >= 1e5 || a < 1e-3) {
		const e = Math.floor(Math.log10(a));
		const m = Number((v / Math.pow(10, e)).toPrecision(digits));
		return `${m}\\times10^{${e}}`;
	}
	return String(Number(v.toPrecision(digits)));
}

/** One factor as TeX, s in rad/s. */
export function factorTex(fc: Factor): string {
	const w = texNum(2 * Math.PI * fc.f);
	switch (fc.type) {
		case 'gain':
			return texNum(Math.pow(10, fc.gainDb / 20) * fc.sign);
		case 'power': {
			const m = Math.abs(fc.n);
			const wn = texNum(Math.pow(2 * Math.PI * fc.f, m));
			const sp = m === 1 ? 's' : `s^{${m}}`;
			return fc.n < 0 ? `\\dfrac{${wn}}{${sp}}` : `\\dfrac{${sp}}{${wn}}`;
		}
		case 'realPole':
			return `\\dfrac{1}{1 ${fc.rhp ? '-' : '+'} s/${w}}`;
		case 'realZero':
			return `\\left(1 ${fc.rhp ? '-' : '+'} \\dfrac{s}{${w}}\\right)`;
		case 'complexPole':
		case 'complexZero': {
			const poly = `1 + ${texNum(2 * fc.zeta, 3)}\\dfrac{s}{${w}} + \\left(\\dfrac{s}{${w}}\\right)^{2}`;
			return fc.type === 'complexPole' ? `\\dfrac{1}{${poly}}` : `\\left(${poly}\\right)`;
		}
		case 'delay':
			return `e^{-s\\,${texNum(fc.T)}}`;
	}
}

export function transferTex(factors: readonly Factor[]): string {
	if (!factors.length) return 'H(s) = 1';
	return `H(s) = ${factors.map(factorTex).join('\\,\\cdot\\,')}`;
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export interface BodePreset {
	id: string;
	label: string;
	description: string;
	loop: boolean;
	build: () => Factor[];
}

const seq = (list: [FactorType, Partial<Omit<Factor, 'id' | 'slot' | 'type'>>][]): Factor[] =>
	list.map(([t, p], i) => makeFactor(t, i, p));

export const PRESETS: BodePreset[] = [
	{
		id: 'mixed',
		label: 'Mixed example',
		description:
			'Gain, a real pole, a real zero and a lightly damped pole pair — every kind of corner at once.',
		loop: false,
		build: () =>
			seq([
				['gain', { gainDb: 20 }],
				['realPole', { f: 10 }],
				['realZero', { f: 200 }],
				['complexPole', { f: 3000, zeta: 0.15 }]
			])
	},
	{
		id: 'loop',
		label: 'Integrator + two poles (type-1 loop)',
		description:
			'L(s) = (ω_u/s)·1/((1 + s/ω_p1)(1 + s/ω_p2)): a classic servo loop. The second pole takes the phase past −180°, so the gain margin is finite.',
		loop: true,
		build: () =>
			seq([
				['power', { n: -1, f: 100 }],
				['realPole', { f: 200 }],
				['realPole', { f: 2000 }]
			])
	},
	{
		id: 'lead',
		label: 'Lead compensator',
		description:
			'A zero below a pole: up to +55° of phase boost between them, at the cost of high-frequency gain.',
		loop: false,
		build: () =>
			seq([
				['realZero', { f: 100 }],
				['realPole', { f: 1000 }]
			])
	},
	{
		id: 'lag',
		label: 'Lag compensator',
		description:
			'A pole below a zero: raises low-frequency gain (smaller steady-state error) with little phase cost far above.',
		loop: false,
		build: () =>
			seq([
				['gain', { gainDb: 20 }],
				['realPole', { f: 10 }],
				['realZero', { f: 100 }]
			])
	},
	{
		id: 'pid',
		label: 'PID-like controller',
		description:
			'Integrator plus two zeros (PI and D action) and a roll-off pole to keep the derivative finite.',
		loop: false,
		build: () =>
			seq([
				['power', { n: -1, f: 10 }],
				['realZero', { f: 10 }],
				['realZero', { f: 300 }],
				['realPole', { f: 3000 }]
			])
	},
	{
		id: 'resonance',
		label: '2nd-order resonance, ζ = 0.1',
		description:
			'A lightly damped pole pair: a +14 dB peak the asymptote ignores, and a phase drop that is nearly a step.',
		loop: false,
		build: () => seq([['complexPole', { f: 1000, zeta: 0.1 }]])
	},
	{
		id: 'delay',
		label: 'Loop with time delay',
		description:
			'The integrator + two poles loop plus a 1 ms delay: the magnitude is unchanged, but the phase margin shrinks from 63° to 30° and the gain margin from 26.8 dB to 4.8 dB.',
		loop: true,
		build: () =>
			seq([
				['power', { n: -1, f: 100 }],
				['realPole', { f: 200 }],
				['realPole', { f: 2000 }],
				['delay', { T: 1e-3 }]
			])
	},
	{
		id: 'nmp',
		label: 'Right-half-plane zero',
		description:
			'(1 − s/ω_z): the same magnitude as a normal zero but the phase goes the wrong way — non-minimum phase.',
		loop: false,
		build: () =>
			seq([
				['realZero', { f: 100, rhp: true }],
				['realPole', { f: 1000 }]
			])
	}
];
