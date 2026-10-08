/**
 * Pole–zero playground model: editable roots, gain normalisation, geometric
 * evaluation of H on the frequency axis, and presets.
 *
 * Coordinates are "plane units":
 *   z-plane — the complex z itself (dimensionless).
 *   s-plane — s / 2π, i.e. Hz on both axes, so the imaginary coordinate of a
 *             pole reads directly as a frequency. Conversion to the rad/s ZPK
 *             used everywhere else in the code base happens in {@link toZpk}.
 *
 * Plane gain K is defined so that H(x) = K·Π(x − zᵢ)/Π(x − pᵢ) with x the
 * plane coordinate of the evaluation point (z = e^{jω}, or s/2π = j f).
 */
import type { Complex } from '$lib/dsp/complex';
import type { ZPK } from '$lib/dsp/types';
import { designAnalog, designDigital } from '$lib/dsp/design';

export type Domain = 's' | 'z';
export type RootKind = 'pole' | 'zero';
export type GainMode = 'peak' | 'dc' | 'manual';

export interface PzItem {
	id: number;
	kind: RootKind;
	re: number;
	/** |Im| of the upper root for a pair; 0 for real items. */
	im: number;
	/** true: re ± j·im (conjugate pair); false: a single real root at re. */
	pair: boolean;
}

const TWO_PI = 2 * Math.PI;

let nextId = 1;
export const newId = (): number => nextId++;

export function makeItem(kind: RootKind, re: number, im: number, pair = im !== 0): PzItem {
	return { id: newId(), kind, re, im: pair ? Math.abs(im) : 0, pair };
}

// ---------------------------------------------------------------------------
// Roots
// ---------------------------------------------------------------------------

export function expand(items: readonly PzItem[], kind: RootKind): Complex[] {
	const out: Complex[] = [];
	for (const it of items) {
		if (it.kind !== kind) continue;
		if (it.pair) {
			const im = Math.abs(it.im);
			out.push({ re: it.re, im }, { re: it.re, im: -im });
		} else out.push({ re: it.re, im: 0 });
	}
	return out;
}

export interface PlaneRoots {
	zeros: Complex[];
	/** Includes the implied poles at z = 0. */
	poles: Complex[];
	/** Number of poles added at the origin so a z-domain H is causal. */
	implied: number;
}

export function planeRoots(items: readonly PzItem[], domain: Domain): PlaneRoots {
	const zeros = expand(items, 'zero');
	const poles = expand(items, 'pole');
	let implied = 0;
	if (domain === 'z') {
		while (poles.length < zeros.length) {
			poles.push({ re: 0, im: 0 });
			implied++;
		}
	}
	return { zeros, poles, implied };
}

/** Point on the frequency axis of the plane: e^{j2πf/fs} or j·f (Hz plane). */
export function freqPoint(domain: Domain, f: number, fs: number): Complex {
	if (domain === 'z') {
		const w = (TWO_PI * f) / fs;
		return { re: Math.cos(w), im: Math.sin(w) };
	}
	return { re: 0, im: f };
}

/** Distance |x − q|, snapped to 0 when it is round-off (a root exactly on the point). */
function dist(x: Complex, q: Complex): number {
	const m = Math.hypot(x.re - q.re, x.im - q.im);
	return m <= 1e-12 * Math.max(1, Math.hypot(x.re, x.im), Math.hypot(q.re, q.im)) ? 0 : m;
}

/** Π(x − zᵢ) / Π(x − pᵢ) at a plane point x (no gain). */
export function evalRoots(
	zeros: readonly Complex[],
	poles: readonly Complex[],
	x: Complex
): Complex {
	// accumulate magnitude in log form to avoid overflow; angle as a sum
	let logMag = 0;
	let ang = 0;
	for (const q of zeros) {
		const dr = x.re - q.re;
		const di = x.im - q.im;
		const m = dist(x, q);
		if (m === 0) return { re: 0, im: 0 };
		logMag += Math.log(m);
		ang += Math.atan2(di, dr);
	}
	for (const q of poles) {
		const dr = x.re - q.re;
		const di = x.im - q.im;
		const m = dist(x, q);
		if (m === 0) return { re: Infinity, im: 0 };
		logMag -= Math.log(m);
		ang -= Math.atan2(di, dr);
	}
	const mag = Math.exp(logMag);
	return { re: mag * Math.cos(ang), im: mag * Math.sin(ang) };
}

/** 20·log10|H| at a plane point, including the plane gain K (for heatmaps). */
export function dbAt(
	zeros: readonly Complex[],
	poles: readonly Complex[],
	K: number,
	x: Complex
): number {
	let s = Math.log10(Math.max(Math.abs(K), 1e-300));
	for (const q of zeros) s += Math.log10(Math.max(Math.hypot(x.re - q.re, x.im - q.im), 1e-300));
	for (const q of poles) s -= Math.log10(Math.max(Math.hypot(x.re - q.re, x.im - q.im), 1e-300));
	return 20 * s;
}

/** Convert a plane gain K to the ZPK gain k (rad/s for s). */
export function zpkGain(K: number, domain: Domain, nz: number, np: number): number {
	return domain === 's' ? K * Math.pow(TWO_PI, np - nz) : K;
}

/** Convert a ZPK gain k to the plane gain K. */
export function planeGain(k: number, domain: Domain, nz: number, np: number): number {
	return domain === 's' ? k * Math.pow(TWO_PI, nz - np) : k;
}

/** Roots and plane gain → ZPK (z: as is; s: rad/s). */
export function toZpk(roots: PlaneRoots, K: number, domain: Domain): ZPK {
	if (domain === 'z')
		return { z: roots.zeros.map((v) => ({ ...v })), p: roots.poles.map((v) => ({ ...v })), k: K };
	const sc = (v: Complex) => ({ re: v.re * TWO_PI, im: v.im * TWO_PI });
	return {
		z: roots.zeros.map(sc),
		p: roots.poles.map(sc),
		k: zpkGain(K, domain, roots.zeros.length, roots.poles.length)
	};
}

// ---------------------------------------------------------------------------
// Frequency grids and gain normalisation
// ---------------------------------------------------------------------------

/** Geometric mean of the non-zero root magnitudes (plane units); fallback when none. */
export function characteristicMagnitude(roots: PlaneRoots, fallback: number): number {
	const mags = [...roots.zeros, ...roots.poles]
		.map((r) => Math.hypot(r.re, r.im))
		.filter((m) => m > 0 && Number.isFinite(m));
	if (!mags.length) return fallback;
	return Math.exp(mags.reduce((s, m) => s + Math.log(m), 0) / mags.length);
}

/** Frequencies (Hz) used to scan the response for stats and peak normalisation. */
export function scanFrequencies(roots: PlaneRoots, domain: Domain, fs: number, n = 2048): number[] {
	const out: number[] = [];
	if (domain === 'z') {
		const nyq = fs / 2;
		for (let i = 0; i < n; i++) out.push((i / (n - 1)) * nyq);
		for (const p of roots.poles) {
			const a = Math.atan2(p.im, p.re);
			if (a >= 0) out.push((a / Math.PI) * nyq);
		}
	} else {
		const fc = characteristicMagnitude(roots, 1000);
		const lo = fc / 1000;
		const hi = fc * 1000;
		out.push(0);
		for (let i = 0; i < n; i++) out.push(lo * Math.pow(hi / lo, i / (n - 1)));
		for (const p of roots.poles) if (p.im > 0) out.push(p.im);
	}
	return out.sort((a, b) => a - b);
}

export interface GainResult {
	/** Plane gain. */
	K: number;
	/** Explanation when the requested normalisation was not possible. */
	note?: string;
}

/** Value of Π(x−z)/Π(x−p) at DC (z = 1 or s = 0). */
export function dcValue(roots: PlaneRoots, domain: Domain): Complex {
	return evalRoots(roots.zeros, roots.poles, domain === 'z' ? { re: 1, im: 0 } : { re: 0, im: 0 });
}

function magAt(roots: PlaneRoots, domain: Domain, fs: number, f: number): number {
	const h = evalRoots(roots.zeros, roots.poles, freqPoint(domain, f, fs));
	return Math.hypot(h.re, h.im);
}

/**
 * Largest |Π(x−z)/Π(x−p)| along the frequency axis: a grid scan refined by a
 * golden-section search around the best grid point.
 */
export function findPeak(
	roots: PlaneRoots,
	domain: Domain,
	fs: number
): { f: number; mag: number } {
	const fr = scanFrequencies(roots, domain, fs);
	let best = 0;
	let bi = 0;
	for (let i = 0; i < fr.length; i++) {
		const m = magAt(roots, domain, fs, fr[i]);
		if (!Number.isFinite(m)) return { f: fr[i], mag: Infinity };
		if (m > best) {
			best = m;
			bi = i;
		}
	}
	let a = fr[Math.max(0, bi - 1)];
	let b = fr[Math.min(fr.length - 1, bi + 1)];
	const g = (Math.sqrt(5) - 1) / 2;
	let c = b - g * (b - a);
	let d = a + g * (b - a);
	let fc = magAt(roots, domain, fs, c);
	let fd = magAt(roots, domain, fs, d);
	for (let it = 0; it < 60 && b - a > 1e-12 * Math.max(1, b); it++) {
		if (fc > fd) {
			b = d;
			d = c;
			fd = fc;
			c = b - g * (b - a);
			fc = magAt(roots, domain, fs, c);
		} else {
			a = c;
			c = d;
			fc = fd;
			d = a + g * (b - a);
			fd = magAt(roots, domain, fs, d);
		}
	}
	const fm = (a + b) / 2;
	const mm = magAt(roots, domain, fs, fm);
	if (!Number.isFinite(mm)) return { f: fm, mag: Infinity };
	return mm > best ? { f: fm, mag: mm } : { f: fr[bi], mag: best };
}

export function normalizeGain(
	roots: PlaneRoots,
	domain: Domain,
	mode: GainMode,
	fs: number,
	manualPlaneK = 1
): GainResult {
	if (mode === 'manual') return { K: manualPlaneK };
	if (mode === 'dc') {
		const h = dcValue(roots, domain);
		const m = Math.hypot(h.re, h.im);
		if (m > 1e-12 && Number.isFinite(m) && m < 1e300) {
			// real for conjugate-symmetric roots; choose the sign so that H(DC) = +1
			return { K: h.re >= 0 ? 1 / m : -1 / m };
		}
		const why =
			m <= 1e-12
				? 'a zero sits at DC, so |H(DC)| = 0'
				: 'a pole sits at DC, so |H(DC)| is infinite';
		const peak = normalizeGain(roots, domain, 'peak', fs);
		return { K: peak.K, note: `Can't normalise at DC — ${why}. Using 0 dB peak instead.` };
	}
	const pk = findPeak(roots, domain, fs).mag;
	if (!Number.isFinite(pk))
		return { K: 1, note: 'The peak is infinite (a pole lies on the frequency axis); using K = 1.' };
	if (!(pk > 0)) return { K: 1 };
	return { K: 1 / pk };
}

// ---------------------------------------------------------------------------
// Geometric evaluation
// ---------------------------------------------------------------------------

export interface GeoVector {
	kind: RootKind;
	root: Complex;
	/** Length |x − q| in plane units. */
	len: number;
	/** Angle ∠(x − q) in radians (NaN when the root lies on the point). */
	angle: number;
	implied: boolean;
}

export interface Geometric {
	point: Complex;
	vectors: GeoVector[];
	prodZ: number;
	prodP: number;
	/** Σ∠ zero vectors and Σ∠ pole vectors (radians). */
	sumZ: number;
	sumP: number;
	mag: number;
	/** Phase of H wrapped to (−π, π]; NaN when a root lies on the point. */
	phase: number;
}

export const wrapPi = (a: number): number => {
	let x = a % (2 * Math.PI);
	if (x <= -Math.PI) x += 2 * Math.PI;
	if (x > Math.PI) x -= 2 * Math.PI;
	return x;
};

export function geometric(roots: PlaneRoots, K: number, x: Complex): Geometric {
	const vectors: GeoVector[] = [];
	let prodZ = 1;
	let prodP = 1;
	let sumZ = 0;
	let sumP = 0;
	for (const q of roots.zeros) {
		const len = dist(x, q);
		const angle = len === 0 ? NaN : Math.atan2(x.im - q.im, x.re - q.re);
		vectors.push({ kind: 'zero', root: q, len, angle, implied: false });
		prodZ *= len;
		sumZ += angle;
	}
	const firstImplied = roots.poles.length - roots.implied;
	roots.poles.forEach((q, i) => {
		const len = dist(x, q);
		const angle = len === 0 ? NaN : Math.atan2(x.im - q.im, x.re - q.re);
		vectors.push({ kind: 'pole', root: q, len, angle, implied: i >= firstImplied });
		prodP *= len;
		sumP += angle;
	});
	const mag = prodP === 0 ? (prodZ === 0 ? NaN : Infinity) : (Math.abs(K) * prodZ) / prodP;
	// the phase is undefined where a root sits exactly on the evaluation point
	const phase = wrapPi((K < 0 ? Math.PI : 0) + sumZ - sumP);
	return { point: x, vectors, prodZ, prodP, sumZ, sumP, mag, phase };
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export type Stability = 'stable' | 'marginal' | 'unstable';

export function stability(poles: readonly Complex[], domain: Domain, scale = 1): Stability {
	const tol = 1e-9 * scale;
	let worst: Stability = 'stable';
	for (const p of poles) {
		const m = domain === 'z' ? Math.hypot(p.re, p.im) - 1 : p.re;
		if (m > tol) return 'unstable';
		if (m >= -tol) worst = 'marginal';
	}
	return worst;
}

export interface MinPhaseInfo {
	status: 'yes' | 'boundary' | 'no';
	outside: number;
	on: number;
}

export function minimumPhase(zeros: readonly Complex[], domain: Domain, scale = 1): MinPhaseInfo {
	const tol = 1e-9 * scale;
	let outside = 0;
	let on = 0;
	for (const q of zeros) {
		const m = domain === 'z' ? Math.hypot(q.re, q.im) - 1 : q.re;
		if (m > tol) outside++;
		else if (m >= -tol) on++;
	}
	return { status: outside ? 'no' : on ? 'boundary' : 'yes', outside, on };
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/** Group roots into items: one pair item per conjugate pair, one real item per real root. */
export function itemsFromRoots(kind: RootKind, roots: readonly Complex[], scale = 1): PzItem[] {
	const tol = 1e-9;
	const out: PzItem[] = [];
	for (const r of roots) {
		const m = Math.max(1, Math.hypot(r.re, r.im));
		if (Math.abs(r.im) <= tol * m) out.push(makeItem(kind, clean(r.re * scale), 0, false));
		else if (r.im > 0) out.push(makeItem(kind, clean(r.re * scale), clean(r.im * scale), true));
	}
	return out;
}

const clean = (v: number) => (Math.abs(v) < 1e-12 ? 0 : Number(v.toPrecision(12)));

const polar = (r: number, deg: number): [number, number] => {
	const a = (deg * Math.PI) / 180;
	return [clean(r * Math.cos(a)), clean(r * Math.sin(a))];
};

export interface Preset {
	id: string;
	label: string;
	description: string;
	build: (fs: number) => PzItem[];
	/** Select the first item of this kind after loading (to expose its sliders). */
	select?: RootKind;
}

export const Z_PRESETS: Preset[] = [
	{
		id: 'peak-notch',
		label: 'Resonance + notch',
		description:
			'A pole pair near the unit circle makes a peak; a zero pair on the circle makes a null.',
		build: () => [makeItem('pole', ...polar(0.9, 45)), makeItem('zero', ...polar(1, 120))],
		select: 'pole'
	},
	{
		id: 'resonator',
		label: 'Two-pole resonator',
		description: 'H(z) = 1/(1 − 2r cosθ z⁻¹ + r² z⁻²): the peak sharpens as r → 1.',
		build: () => [makeItem('pole', ...polar(0.95, 30))],
		select: 'pole'
	},
	{
		id: 'notch',
		label: 'Notch',
		description:
			'Zeros on the unit circle null one frequency; poles just inside at the same angle restore the gain everywhere else.',
		build: () => [makeItem('zero', ...polar(1, 45)), makeItem('pole', ...polar(0.95, 45))],
		select: 'pole'
	},
	{
		id: 'butter4',
		label: '4th-order Butterworth LP',
		description:
			'Bilinear-transformed Butterworth, cutoff fs/8: four zeros at z = −1, poles on a circle-like arc.',
		build: (fs) => {
			const d = designDigital({ family: 'butter', band: 'lowpass', order: 4, f1: fs / 8, fs });
			return [...itemsFromRoots('pole', d.zpk.p), ...itemsFromRoots('zero', d.zpk.z)];
		}
	},
	{
		id: 'moving-average',
		label: 'Moving average (comb)',
		description:
			'8-tap moving average: zeros evenly spaced on the unit circle (except z = 1), all poles at the origin.',
		build: () => {
			const N = 8;
			const out: PzItem[] = [];
			for (let k = 1; k <= N / 2; k++) {
				const [re, im] = polar(1, (360 * k) / N);
				out.push(k === N / 2 ? makeItem('zero', -1, 0, false) : makeItem('zero', re, im));
			}
			return out;
		}
	},
	{
		id: 'allpass',
		label: 'All-pass pair',
		description:
			'Pole at r∠θ, zero at (1/r)∠θ: every frequency is passed with the same gain, only the phase changes.',
		build: () => [makeItem('pole', ...polar(0.8, 60)), makeItem('zero', ...polar(1 / 0.8, 60))],
		select: 'pole'
	},
	{
		id: 'unstable',
		label: 'Unstable (pole outside)',
		description: 'A pole pair at r = 1.04: the impulse response grows without bound.',
		build: () => [makeItem('pole', ...polar(1.04, 30))],
		select: 'pole'
	}
];

/** s-plane presets in Hz (σ/2π, ω/2π). */
export const S_PRESETS: Preset[] = [
	{
		id: 'resonant',
		label: 'Resonant pair',
		description: 'Complex pole pair at f₀ = 1 kHz, ζ = 0.2 — adjust ζ in “Selected root”.',
		build: () => [makeItem('pole', ...dampedPair(1000, 0.2))],
		select: 'pole'
	},
	{
		id: 'butter3',
		label: 'Butterworth, 3rd order',
		description:
			'Poles evenly spaced on a half circle of radius fc = 1 kHz in the left half-plane.',
		build: () => {
			const z = designAnalog({ family: 'butter', band: 'lowpass', order: 3, f1: 1000 });
			return [
				...itemsFromRoots('pole', z.p, 1 / TWO_PI),
				...itemsFromRoots('zero', z.z, 1 / TWO_PI)
			];
		}
	},
	{
		id: 'notch',
		label: 'Notch',
		description:
			'Zeros on the jω axis at ±1 kHz null that frequency; poles (Q = 2) nearby restore the gain.',
		build: () => [makeItem('zero', 0, 1000), makeItem('pole', ...dampedPair(1000, 0.25))],
		select: 'pole'
	},
	{
		id: 'allpass',
		label: 'All-pass (mirrored zeros)',
		description: 'Zeros mirror the poles across the jω axis: flat magnitude, phase falls by 360°.',
		build: () => {
			const [re, im] = dampedPair(1000, 0.3);
			return [makeItem('pole', re, im), makeItem('zero', -re, im)];
		},
		select: 'pole'
	},
	{
		id: 'rhp',
		label: 'RHP poles (unstable)',
		description: 'A pole pair in the right half-plane: a growing oscillation.',
		build: () => [makeItem('pole', ...dampedPair(1000, -0.08))],
		select: 'pole'
	}
];

/** Pole pair (Hz plane) for natural frequency f0 and damping ζ (|ζ| ≤ 1): −ζf₀ ± j f₀√(1−ζ²). */
export function dampedPair(f0: number, zeta: number): [number, number] {
	const z = Math.max(-1, Math.min(1, zeta));
	return [clean(-z * f0), clean(f0 * Math.sqrt(1 - z * z))];
}

// ---------------------------------------------------------------------------
// Transfer function as TeX (factored)
// ---------------------------------------------------------------------------

/** Number formatted for TeX: 4 significant digits, ×10ⁿ for very large/small. */
export function texNum(v: number, digits = 4): string {
	if (!Number.isFinite(v)) return v > 0 ? '\\infty' : '-\\infty';
	if (v === 0) return '0';
	const a = Math.abs(v);
	if (a >= 1e5 || a < 1e-3) {
		const e = Math.floor(Math.log10(a));
		let m = v / Math.pow(10, e);
		m = Number(m.toPrecision(digits));
		return `${m}\\times10^{${e}}`;
	}
	return String(Number(v.toPrecision(digits)));
}

function factorTex(variable: string, item: { re: number; im: number; pair: boolean }): string {
	if (!item.pair || item.im === 0) {
		const a = item.re;
		if (a === 0) return variable;
		return `${variable} ${a > 0 ? '-' : '+'} ${texNum(Math.abs(a))}`;
	}
	const b = -2 * item.re;
	const c = item.re * item.re + item.im * item.im;
	const bs = texNum(Math.abs(b));
	const mid = bs === '0' ? '' : ` ${b > 0 ? '+' : '-'} ${bs === '1' ? '' : bs}${variable}`;
	return `${variable}^2${mid} + ${texNum(c)}`;
}

/**
 * Factored H as TeX. Roots are given in the units of the ZPK (rad/s for s).
 * Identical factors are collected into powers. A pair with im = 0 (e.g. ζ = 1)
 * is a double real root, as in {@link expand}, so it counts its factor twice.
 */
export function transferTex(
	variable: 's' | 'z',
	zeros: { re: number; im: number; pair: boolean }[],
	poles: { re: number; im: number; pair: boolean }[],
	k: number
): string {
	const side = (list: { re: number; im: number; pair: boolean }[]) => {
		const counts = new Map<string, number>();
		for (const it of list) {
			const f = factorTex(variable, it);
			counts.set(f, (counts.get(f) ?? 0) + (it.pair && it.im === 0 ? 2 : 1));
		}
		const parts: string[] = [];
		for (const [f, n] of counts) {
			const bare = f === variable;
			const base = bare ? f : `\\left(${f}\\right)`;
			parts.push(n > 1 ? `${base}^{${n}}` : base);
		}
		return parts.join('');
	};
	const num = side(zeros) || '1';
	const den = side(poles) || '1';
	const kStr = texNum(k);
	const body = den === '1' ? num : `\\dfrac{${num}}{${den}}`;
	if (num === '1' && den === '1') return `H(${variable}) = ${kStr}`;
	return `H(${variable}) = ${kStr === '1' ? '' : kStr === '-1' ? '-' : kStr + '\\,'}${body}`;
}
