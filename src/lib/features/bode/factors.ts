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
 * Gain and phase margins of the loop gain L = Π factors, searched on [lo, hi].
 * PM = 180° + ∠L(f_gc) wrapped to (−180°, 180°]; GM = −|L(f_pc)| in dB where
 * ∠L(f_pc) ≡ −180° (mod 360°).
 */
export function margins(factors: readonly Factor[], lo: number, hi: number, n = 4000): Margins {
	const grid = logGrid(lo, hi, n);
	const lg = grid.map(Math.log10);
	const at = (lf: number) => totalExact(factors, Math.pow(10, lf));
	const pts = lg.map(at);
	const gainCrossovers: Crossing[] = [];
	const phaseCrossovers: Crossing[] = [];
	for (let i = 1; i < n; i++) {
		const a = pts[i - 1];
		const b = pts[i];
		if (Number.isFinite(a.db) && Number.isFinite(b.db) && (a.db === 0 || a.db * b.db < 0)) {
			const lf = a.db === 0 ? lg[i - 1] : bisect((x) => at(x).db, lg[i - 1], lg[i]);
			gainCrossovers.push({ f: Math.pow(10, lf), margin: wrap180(180 + at(lf).deg) });
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
		label: 'Integrator + pole (type-1 loop)',
		description:
			'L(s) = (ω_u/s)·1/(1 + s/ω_p): a classic servo loop. Turn on open-loop analysis to read the margins.',
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
			'The type-1 loop plus a 1 ms delay: the magnitude is unchanged but the phase margin shrinks.',
		loop: true,
		build: () =>
			seq([
				['power', { n: -1, f: 100 }],
				['realPole', { f: 500 }],
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
