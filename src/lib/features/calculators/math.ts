/**
 * Pure math behind the engineering calculators. Every function takes and
 * returns SI units (Hz, s, Ω, F, H, V, W, rad) unless the name says otherwise.
 */
import { E_SERIES, parseSI } from '$lib/dsp/units';

const TAU = 2 * Math.PI;

// ---------------------------------------------------------------------------
// Field entry
// ---------------------------------------------------------------------------

/**
 * Parse a field entry in the field's own unit. A trailing `unit` symbol is the unit, never a
 * prefix, and is stripped before the SI-prefix parse; the letter before it is the prefix. With
 * unit 'm': "2 m" and "2m" → 2, "2 mm" → 0.002, "2 km" → 2000, "34 cm" → 0.34 (centi is accepted
 * in front of the unit only). A unit that starts with a digit (1/s) needs a space before it.
 * Anything else is plain parseSI, so "4k7" and "10 nF" (unit 'F') parse as before.
 */
export function parseQuantity(text: string, unit = ''): number {
	return parseSI(text, unit || undefined);
}

// ---------------------------------------------------------------------------
// Decibels and levels
// ---------------------------------------------------------------------------

/** Amplitude (field) ratio → dB: 20·log10(r). */
export const ampToDb = (r: number): number => 20 * Math.log10(r);
export const dbToAmp = (db: number): number => Math.pow(10, db / 20);
/** Power ratio → dB: 10·log10(r). */
export const powToDb = (r: number): number => 10 * Math.log10(r);
export const dbToPow = (db: number): number => Math.pow(10, db / 10);
/** A dB value for display: rounding residue (|L| < 1e-9 dB, e.g. 9.6e-16 for 1 mW) becomes 0. */
export const snapDb = (db: number): number => (Math.abs(db) < 1e-9 ? 0 : db);

/** 0 dBu: the voltage that dissipates 1 mW in 600 Ω, √0.6 ≈ 0.7746 V rms. */
export const DBU_REF = Math.sqrt(0.6);

export type LevelUnit = 'dBV' | 'dBu' | 'dBm50' | 'dBm600' | 'Vrms' | 'Vpk' | 'Vpp';

/** Convert any supported level to an rms voltage (sine assumed for peak values). */
export function levelToVrms(value: number, unit: LevelUnit): number {
	switch (unit) {
		case 'dBV':
			return dbToAmp(value);
		case 'dBu':
			return DBU_REF * dbToAmp(value);
		case 'dBm50':
			return Math.sqrt(1e-3 * dbToPow(value) * 50);
		case 'dBm600':
			return Math.sqrt(1e-3 * dbToPow(value) * 600);
		case 'Vrms':
			return value;
		case 'Vpk':
			return value / Math.SQRT2;
		case 'Vpp':
			return value / (2 * Math.SQRT2);
	}
}

export interface Levels {
	vrms: number;
	vpk: number;
	vpp: number;
	dBV: number;
	dBu: number;
	dBm50: number;
	p50: number;
	dBm600: number;
	p600: number;
}

export function levelsFromVrms(vrms: number): Levels {
	const p50 = (vrms * vrms) / 50;
	const p600 = (vrms * vrms) / 600;
	return {
		vrms,
		vpk: vrms * Math.SQRT2,
		vpp: 2 * Math.SQRT2 * vrms,
		dBV: ampToDb(vrms),
		dBu: ampToDb(vrms / DBU_REF),
		dBm50: powToDb(p50 / 1e-3),
		p50,
		// = 10·log10(p600/1 mW), which is dBu exactly (0 dBu = 1 mW in 600 Ω); computed
		// the same way so the two agree to the last bit
		dBm600: ampToDb(vrms / DBU_REF),
		p600
	};
}

// ---------------------------------------------------------------------------
// Q, bandwidth, damping
// ---------------------------------------------------------------------------

export const qToZeta = (q: number): number => 1 / (2 * q);
export const zetaToQ = (zeta: number): number => 1 / (2 * zeta);
/** −3 dB bandwidth (Hz) of a second-order resonance: f0/Q. */
export const qToBwHz = (f0: number, q: number): number => f0 / q;
export const bwHzToQ = (f0: number, bw: number): number => f0 / bw;
/** Bandwidth in octaves between the geometric-symmetric −3 dB points. */
export const qToOctaves = (q: number): number => (2 / Math.LN2) * Math.asinh(1 / (2 * q));
export const octavesToQ = (n: number): number => Math.sqrt(Math.pow(2, n)) / (Math.pow(2, n) - 1);

/** −3 dB edges of a second-order band-pass: f0·(√(1 + 1/(4Q²)) ∓ 1/(2Q)). */
export function bandEdges(f0: number, q: number): [number, number] {
	const a = Math.sqrt(1 + 1 / (4 * q * q));
	const b = 1 / (2 * q);
	return [f0 * (a - b), f0 * (a + b)];
}

/** Step-response overshoot (fraction) of a second-order low-pass; 0 when ζ ≥ 1. */
export function overshoot(zeta: number): number {
	if (!(zeta < 1)) return 0;
	if (zeta <= 0) return 1;
	return Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta));
}

/**
 * Resonant peak of a second-order low-pass H = ω0²/(s² + ω0 s/Q + ω0²).
 * Returns null when Q ≤ 1/√2 (no peak).
 */
export function lowpassPeak(f0: number, q: number): { gain: number; fr: number } | null {
	if (!(q > Math.SQRT1_2)) return null;
	return { gain: q / Math.sqrt(1 - 1 / (4 * q * q)), fr: f0 * Math.sqrt(1 - 1 / (2 * q * q)) };
}

// ---------------------------------------------------------------------------
// RC, RL, LC, reactance
// ---------------------------------------------------------------------------

export const rcCutoff = (R: number, C: number): number => 1 / (TAU * R * C);
/** Solve fc = 1/(2πRC) for the missing component (R from C, or C from R). */
export const rcOther = (known: number, fc: number): number => 1 / (TAU * known * fc);

export const rlCutoff = (R: number, L: number): number => R / (TAU * L);
export const rlR = (L: number, fc: number): number => TAU * L * fc;
export const rlL = (R: number, fc: number): number => R / (TAU * fc);

export const lcResonance = (L: number, C: number): number => 1 / (TAU * Math.sqrt(L * C));
/** Solve f0 = 1/(2π√(LC)) for the missing component. */
export const lcOther = (known: number, f0: number): number => 1 / (TAU * TAU * f0 * f0 * known);
export const characteristicImpedance = (L: number, C: number): number => Math.sqrt(L / C);

export const reactanceC = (f: number, C: number): number => 1 / (TAU * f * C);
export const reactanceL = (f: number, L: number): number => TAU * f * L;

// ---------------------------------------------------------------------------
// Ripple and attenuation
// ---------------------------------------------------------------------------

/** Ripple factor ε = √(10^(Rp/10) − 1). */
export const rippleToEps = (rpDb: number): number => Math.sqrt(Math.pow(10, rpDb / 10) - 1);
export const epsToRipple = (eps: number): number => 10 * Math.log10(1 + eps * eps);

/** Passband 1 ± δ (FIR/Parks–McClellan convention): Rp = 20·log10((1+δ)/(1−δ)). */
export const rippleToDeltaSym = (rpDb: number): number => {
	const g = Math.pow(10, rpDb / 20);
	return (g - 1) / (g + 1);
};
export const deltaSymToRipple = (d: number): number => 20 * Math.log10((1 + d) / (1 - d));

/** Passband between 1 − δ and 1 (IIR convention): Rp = −20·log10(1 − δ). */
export const rippleToDeltaOne = (rpDb: number): number => 1 - Math.pow(10, -rpDb / 20);
export const deltaOneToRipple = (d: number): number => -20 * Math.log10(1 - d);

/** Stopband attenuation ↔ peak stopband gain δs = 10^(−Rs/20). */
export const attenToDelta = (rsDb: number): number => Math.pow(10, -rsDb / 20);
export const deltaToAtten = (d: number): number => -20 * Math.log10(d);

/**
 * Lossless doubly-terminated filter: |ρ|² + |t|² = 1, so the worst passband
 * reflection coefficient for a ripple Rp is |ρ| = √(1 − 10^(−Rp/10)) = ε/√(1+ε²).
 */
export const rippleToRho = (rpDb: number): number => Math.sqrt(1 - Math.pow(10, -rpDb / 10));
export const rhoToRipple = (rho: number): number => -10 * Math.log10(1 - rho * rho);
export const rhoToReturnLoss = (rho: number): number => -20 * Math.log10(rho);
export const returnLossToRho = (rl: number): number => Math.pow(10, -rl / 20);
export const rhoToVswr = (rho: number): number => (1 + rho) / (1 - rho);
export const vswrToRho = (s: number): number => (s - 1) / (s + 1);

// ---------------------------------------------------------------------------
// Frequency, period, wavelength, sampling
// ---------------------------------------------------------------------------

export const SPEED_OF_SOUND = 343; // m/s, dry air at 20 °C
export const SPEED_OF_LIGHT = 299_792_458; // m/s, exact

/** Frequency at which a tone sampled at fs appears after sampling (0…fs/2). */
export function aliasFrequency(f: number, fs: number): number {
	const r = ((f % fs) + fs) % fs;
	return r > fs / 2 ? fs - r : r;
}

// ---------------------------------------------------------------------------
// Intervals and fractional-octave bands
// ---------------------------------------------------------------------------

export function interval(f1: number, f2: number) {
	const r = f2 / f1;
	return {
		ratio: r,
		octaves: Math.log2(r),
		decades: Math.log10(r),
		semitones: 12 * Math.log2(r),
		cents: 1200 * Math.log2(r)
	};
}

export type OctaveBase = 2 | 10;
/** Octave ratio G: exactly 2 (base 2) or 10^(3/10) ≈ 1.99526 (base 10, IEC 61260-1). */
export const octaveRatio = (base: OctaveBase): number => (base === 10 ? Math.pow(10, 0.3) : 2);

export interface OctaveBand {
	/** Band index x (0 is the band at or just above 1 kHz). */
	x: number;
	centre: number;
	lower: number;
	upper: number;
	/** IEC nominal mid-band frequency (1/1 and 1/3 octave only). */
	nominal?: number;
}

const R10 = [1, 1.25, 1.6, 2, 2.5, 3.15, 4, 5, 6.3, 8];

/**
 * Fractional-octave band x for 1/b octave (IEC 61260-1 / ANSI S1.11):
 * odd b: fm = fr·G^(x/b); even b: fm = fr·G^((2x+1)/(2b)); edges fm·G^(∓1/(2b)), fr = 1 kHz.
 */
export function octaveBand(x: number, b: number, base: OctaveBase): OctaveBand {
	const G = octaveRatio(base);
	const e = b % 2 === 1 ? x / b : (2 * x + 1) / (2 * b);
	const centre = 1000 * Math.pow(G, e);
	const half = Math.pow(G, 1 / (2 * b));
	const band: OctaveBand = { x, centre, lower: centre / half, upper: centre * half };
	if (b === 1 || b === 3) {
		const k = (3 * x) / b; // index in tenth-decades
		const idx = ((k % 10) + 10) % 10;
		band.nominal = Number((R10[idx] * Math.pow(10, Math.floor(k / 10) + 3)).toPrecision(4));
	}
	return band;
}

/** Index of the 1/b-octave band that contains f. */
export function octaveBandIndex(f: number, b: number, base: OctaveBase): number {
	const G = octaveRatio(base);
	const u = (b * Math.log(f / 1000)) / Math.log(G);
	const eps = 1e-9;
	return b % 2 === 1 ? Math.round(u + eps) : Math.floor(u + eps);
}

export function octaveBands(b: number, base: OctaveBase, fmin: number, fmax: number): OctaveBand[] {
	const out: OctaveBand[] = [];
	const x0 = octaveBandIndex(fmin, b, base);
	const x1 = octaveBandIndex(fmax, b, base);
	for (let x = x0; x <= x1; x++) out.push(octaveBand(x, b, base));
	return out;
}

// ---------------------------------------------------------------------------
// E-series
// ---------------------------------------------------------------------------

export type SeriesName = keyof typeof E_SERIES;
export const SERIES_NAMES: SeriesName[] = ['E6', 'E12', 'E24', 'E48', 'E96'];

export interface Neighbours {
	below: number;
	above: number;
	nearest: number;
	/** Percentage errors (value − target)/target·100. */
	errBelow: number;
	errAbove: number;
	errNearest: number;
}

/** Nearest preferred values at or below and at or above `value`. */
export function eSeriesNeighbours(value: number, series: SeriesName): Neighbours {
	const vals = E_SERIES[series];
	const decade = Math.floor(Math.log10(value));
	const cands: number[] = [];
	for (let d = decade - 1; d <= decade + 1; d++) {
		for (const v of vals) cands.push(Number((v * Math.pow(10, d)).toPrecision(3)));
	}
	cands.sort((a, b) => a - b);
	const tol = 1e-9 * value;
	let below = cands[0];
	let above = cands[cands.length - 1];
	for (const cnd of cands) {
		if (cnd <= value + tol) below = cnd;
		if (cnd >= value - tol) {
			above = cnd;
			break;
		}
	}
	const err = (v: number) => ((v - value) / value) * 100;
	// "nearest" in the logarithmic sense, as tolerances are relative
	const nearest =
		Math.abs(Math.log(below / value)) <= Math.abs(Math.log(above / value)) ? below : above;
	return {
		below,
		above,
		nearest,
		errBelow: err(below),
		errAbove: err(above),
		errNearest: err(nearest)
	};
}

/**
 * Nearest preferred value for the computed R (or C) of an RC section, the cutoff (Hz) it
 * gives with the other component, and that cutoff's error relative to the target in per cent.
 */
export function rcNearestPart(
	exact: number,
	other: number,
	fcTarget: number,
	series: SeriesName
): { part: number; fc: number; errPct: number } {
	const part = eSeriesNeighbours(exact, series).nearest;
	const fc = rcCutoff(part, other);
	return { part, fc, errPct: ((fc - fcTarget) / fcTarget) * 100 };
}

// ---------------------------------------------------------------------------
// First-order time constant
// ---------------------------------------------------------------------------

export const tauFromCutoff = (fc: number): number => 1 / (TAU * fc);
export const cutoffFromTau = (tau: number): number => 1 / (TAU * tau);
/** Fraction of the final value reached after time t: 1 − e^(−t/τ). */
export const settledFraction = (t: number, tau: number): number => 1 - Math.exp(-t / tau);
/** Time for a first-order step response to reach a fraction p (0…1). */
export const timeToFraction = (p: number, tau: number): number => -tau * Math.log(1 - p);
/** 10–90 % rise time: τ·ln 9 ≈ 2.197 τ. */
export const riseTime1090 = (tau: number): number => tau * Math.log(9);

// ---------------------------------------------------------------------------
// Bilinear prewarping
// ---------------------------------------------------------------------------

/** Analog frequency (Hz) that the bilinear transform maps onto digital fd: (fs/π)·tan(π fd/fs). */
export const prewarpHz = (fd: number, fs: number): number =>
	(fs / Math.PI) * Math.tan((Math.PI * fd) / fs);
/** Digital frequency (Hz) that analog fa lands on after the (unwarped) bilinear transform. */
export const unwarpHz = (fa: number, fs: number): number =>
	(fs / Math.PI) * Math.atan((Math.PI * fa) / fs);

// ---------------------------------------------------------------------------
// Phase ↔ delay
// ---------------------------------------------------------------------------

/** Phase lag (degrees) produced by a pure delay t at frequency f: 360·f·t. */
export const delayToPhaseDeg = (t: number, f: number): number => 360 * f * t;
export const phaseDegToDelay = (deg: number, f: number): number => deg / (360 * f);
export const phaseDelayToFreq = (deg: number, t: number): number => deg / (360 * t);

// ---------------------------------------------------------------------------
// Pole position ↔ f0, Q
// ---------------------------------------------------------------------------

export interface PoleInfo {
	/** Natural frequency, Hz. */
	f0: number;
	q: number;
	zeta: number;
	/** Real part σ (1/s) and damped frequency ωd (rad/s) of the upper pole. */
	sigma: number;
	wd: number;
	/** Envelope time constant −1/σ, s. */
	tau: number;
}

/** s-plane pole σ ± jωd (σ < 0) → natural frequency, Q, ζ. */
export function sPoleInfo(sigma: number, wd: number): PoleInfo {
	const w0 = Math.hypot(sigma, wd);
	return { f0: w0 / TAU, q: w0 / (-2 * sigma), zeta: -sigma / w0, sigma, wd, tau: -1 / sigma };
}

/** f0, Q → s-plane poles. Underdamped: σ ± jωd; overdamped: two real poles. */
export function sPolesFromF0Q(f0: number, q: number): { re: number; im: number }[] {
	const w0 = TAU * f0;
	const sigma = -w0 / (2 * q);
	const disc = 1 - 1 / (4 * q * q);
	if (disc >= 0) {
		const wd = w0 * Math.sqrt(disc);
		return [
			{ re: sigma, im: wd },
			{ re: sigma, im: -wd }
		];
	}
	const d = w0 * Math.sqrt(-disc);
	return [
		{ re: sigma + d, im: 0 },
		{ re: sigma - d, im: 0 }
	];
}

/** z-plane pole r·e^(±jθ) → equivalent s-plane pole via z = e^(sT): s = fs·(ln r ± jθ). */
export function zPoleInfo(r: number, theta: number, fs: number): PoleInfo {
	return sPoleInfo(fs * Math.log(r), fs * theta);
}

/** f0, Q → z-plane pole (r, θ) through z = e^(sT) (underdamped poles only). */
export function zPoleFromF0Q(
	f0: number,
	q: number,
	fs: number
): { r: number; theta: number } | null {
	const [p] = sPolesFromF0Q(f0, q);
	if (p.im === 0) return null;
	return { r: Math.exp(p.re / fs), theta: p.im / fs };
}
