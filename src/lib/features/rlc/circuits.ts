/**
 * Passive first- and second-order RC / RL / RLC circuits: transfer functions,
 * characteristic numbers, component solvers and schematic layouts.
 * All angular frequencies are rad/s; component values are SI (Ω, F, H).
 */
import { type Complex, c } from '$lib/dsp/complex';
import type { BandType, ZPK } from '$lib/dsp/types';
import { formatSI, toESeries, type ESeries } from '$lib/dsp/units';
import type { SchematicItem } from './schematic/types';

export type CircuitId = 'rc-lp' | 'rc-hp' | 'rl-lp' | 'rl-hp' | 'rlc-c' | 'rlc-r' | 'rlc-l' | 'rlc-lc' | 'tank';

export interface CircuitInfo {
	id: CircuitId;
	name: string;
	group: 'First order' | 'Second order';
	order: 1 | 2;
	/** Which components appear in the circuit. */
	uses: { R: boolean; L: boolean; C: boolean };
	band: BandType;
	/** Plain-language description of the output. */
	output: string;
	/** Series RLC (Q = Z₀/R) or parallel tank (Q = R/Z₀); first-order circuits use 'rc' / 'rl'. */
	family: 'rc' | 'rl' | 'series' | 'parallel';
}

export const CIRCUITS: CircuitInfo[] = [
	{ id: 'rc-lp', name: 'RC low-pass', group: 'First order', order: 1, uses: { R: true, L: false, C: true }, band: 'lowpass', output: 'across C', family: 'rc' },
	{ id: 'rc-hp', name: 'RC high-pass', group: 'First order', order: 1, uses: { R: true, L: false, C: true }, band: 'highpass', output: 'across R', family: 'rc' },
	{ id: 'rl-lp', name: 'RL low-pass', group: 'First order', order: 1, uses: { R: true, L: true, C: false }, band: 'lowpass', output: 'across R', family: 'rl' },
	{ id: 'rl-hp', name: 'RL high-pass', group: 'First order', order: 1, uses: { R: true, L: true, C: false }, band: 'highpass', output: 'across L', family: 'rl' },
	{ id: 'rlc-c', name: 'Series RLC — output across C (low-pass)', group: 'Second order', order: 2, uses: { R: true, L: true, C: true }, band: 'lowpass', output: 'across C', family: 'series' },
	{ id: 'rlc-r', name: 'Series RLC — output across R (band-pass)', group: 'Second order', order: 2, uses: { R: true, L: true, C: true }, band: 'bandpass', output: 'across R', family: 'series' },
	{ id: 'rlc-l', name: 'Series RLC — output across L (high-pass)', group: 'Second order', order: 2, uses: { R: true, L: true, C: true }, band: 'highpass', output: 'across L', family: 'series' },
	{ id: 'rlc-lc', name: 'Series RLC — output across L + C (notch)', group: 'Second order', order: 2, uses: { R: true, L: true, C: true }, band: 'bandstop', output: 'across the L–C pair', family: 'series' },
	{ id: 'tank', name: 'Parallel LC tank fed through R (band-pass)', group: 'Second order', order: 2, uses: { R: true, L: true, C: true }, band: 'bandpass', output: 'across the tank', family: 'parallel' }
];

export const circuitInfo = (id: CircuitId): CircuitInfo => CIRCUITS.find((c) => c.id === id) ?? CIRCUITS[0];

// ---------------------------------------------------------------------------
// Characteristic numbers
// ---------------------------------------------------------------------------

/** Pole frequency of a first-order circuit, rad/s (1/τ). */
export function firstOrderW(id: CircuitId, R: number, L: number, C: number): number {
	return circuitInfo(id).family === 'rl' ? R / L : 1 / (R * C);
}

export interface SecondOrder {
	/** Natural (resonant) frequency, rad/s. */
	w0: number;
	q: number;
	zeta: number;
	/** Characteristic impedance √(L/C), Ω. */
	z0: number;
}

export function secondOrder(id: CircuitId, R: number, L: number, C: number): SecondOrder {
	const w0 = 1 / Math.sqrt(L * C);
	const z0 = Math.sqrt(L / C);
	const q = circuitInfo(id).family === 'parallel' ? R / z0 : z0 / R;
	return { w0, q, zeta: 1 / (2 * q), z0 };
}

/**
 * Roots of s² + 2ζω₀s + ω₀². Overdamped roots are computed without
 * cancellation (p₂ = ω₀² / p₁).
 */
export function secondOrderPoles(w0: number, zeta: number): Complex[] {
	if (zeta < 1) {
		const wd = w0 * Math.sqrt(1 - zeta * zeta);
		return [c(-zeta * w0, wd), c(-zeta * w0, -wd)];
	}
	const p1 = -w0 * (zeta + Math.sqrt(zeta * zeta - 1));
	return [c(p1), c((w0 * w0) / p1)];
}

export type DampingClass = 'underdamped' | 'critical' | 'overdamped';

/** Damping class with a small tolerance band around ζ = 1. */
export function dampingClass(zeta: number, tol = 2e-3): DampingClass {
	if (Math.abs(zeta - 1) <= tol) return 'critical';
	return zeta < 1 ? 'underdamped' : 'overdamped';
}

/** Transfer function v_out / v_in of a circuit as a ZPK (rad/s). */
export function circuitZpk(id: CircuitId, R: number, L: number, C: number): ZPK {
	const info = circuitInfo(id);
	if (info.order === 1) {
		const w = firstOrderW(id, R, L, C);
		return info.band === 'lowpass' ? { z: [], p: [c(-w)], k: w } : { z: [c(0)], p: [c(-w)], k: 1 };
	}
	const { w0, q, zeta } = secondOrder(id, R, L, C);
	const p = secondOrderPoles(w0, zeta);
	switch (id) {
		case 'rlc-c':
			return { z: [], p, k: w0 * w0 };
		case 'rlc-r':
		case 'tank':
			return { z: [c(0)], p, k: w0 / q };
		case 'rlc-l':
			return { z: [c(0), c(0)], p, k: 1 };
		default:
			return { z: [c(0, w0), c(0, -w0)], p, k: 1 };
	}
}

/**
 * Transfer functions from v_in to the two energy-storing state variables:
 * the capacitor voltage and the inductor current (A per V).
 */
export function stateZpks(id: CircuitId, R: number, L: number, C: number): { vC: ZPK; iL: ZPK } {
	const { w0, zeta } = secondOrder(id, R, L, C);
	const p = secondOrderPoles(w0, zeta);
	if (circuitInfo(id).family === 'parallel') {
		// v_C = tank voltage; i_L = v / (sL)
		return { vC: { z: [c(0)], p, k: 1 / (R * C) }, iL: { z: [], p, k: 1 / (R * L * C) } };
	}
	// series loop: v_C = ω₀²/D(s), i = sC·v_C = (s/L)/D(s)
	return { vC: { z: [], p, k: w0 * w0 }, iL: { z: [c(0)], p, k: 1 / L } };
}

/** −3 dB edges of the band-pass / notch (exact for the second-order resonator). */
export function bandEdges(w0: number, q: number): [number, number] {
	const a = 1 / (2 * q);
	const r = Math.sqrt(1 + a * a);
	return [w0 * (r - a), w0 * (r + a)];
}

// ---------------------------------------------------------------------------
// Solvers
// ---------------------------------------------------------------------------

export type Known = 'R' | 'L' | 'C';

export interface Values {
	R: number;
	L: number;
	C: number;
}

/** First order: corner frequency (Hz) and one known component → the other. */
export function solveFirstOrder(family: 'rc' | 'rl', fc: number, known: Known, value: number, current: Values): Values {
	const w = 2 * Math.PI * fc;
	const out = { ...current, [known]: value };
	if (family === 'rc') {
		if (known === 'R') out.C = 1 / (w * value);
		else out.R = 1 / (w * out.C);
	} else {
		if (known === 'R') out.L = value / w;
		else out.R = w * out.L;
	}
	return out;
}

/** Second order: f₀ (Hz), Q and one known component → the other two. */
export function solveSecondOrder(family: 'series' | 'parallel', f0: number, q: number, known: Known, value: number): Values {
	const w = 2 * Math.PI * f0;
	let R: number;
	let L: number;
	let C: number;
	if (family === 'series') {
		// Q = ω₀L/R = 1/(ω₀RC)
		if (known === 'C') {
			C = value;
			L = 1 / (w * w * C);
			R = 1 / (w * q * C);
		} else if (known === 'L') {
			L = value;
			C = 1 / (w * w * L);
			R = (w * L) / q;
		} else {
			R = value;
			L = (q * R) / w;
			C = 1 / (w * q * R);
		}
	} else {
		// Q = R/(ω₀L) = ω₀RC
		if (known === 'C') {
			C = value;
			L = 1 / (w * w * C);
			R = q / (w * C);
		} else if (known === 'L') {
			L = value;
			C = 1 / (w * w * L);
			R = q * w * L;
		} else {
			R = value;
			C = q / (w * R);
			L = R / (w * q);
		}
	}
	return { R, L, C };
}

export function roundValues(v: Values, series: ESeries): Values {
	return { R: toESeries(v.R, series), L: toESeries(v.L, series), C: toESeries(v.C, series) };
}

// ---------------------------------------------------------------------------
// Schematics
// ---------------------------------------------------------------------------

const TOP = 50;
const BOT = 190;

export const SCHEMATIC_SIZE = { width: 470, height: 222 };

/** Schematic of a circuit, with the output element(s) drawn in the accent colour. */
export function circuitSchematic(id: CircuitId, v: Values): SchematicItem[] {
	const R = { name: 'R', value: formatSI(v.R, 'Ω', 3) };
	const L = { name: 'L', value: formatSI(v.L, 'H', 3) };
	const C = { name: 'C', value: formatSI(v.C, 'F', 3) };
	type P = typeof R & { kind: 'R' | 'L' | 'C' };
	const pR: P = { ...R, kind: 'R' };
	const pL: P = { ...L, kind: 'L' };
	const pC: P = { ...C, kind: 'C' };

	let series: P[];
	let shunt: P[];
	let stacked = false;
	switch (id) {
		case 'rc-lp':
			[series, shunt] = [[pR], [pC]];
			break;
		case 'rc-hp':
			[series, shunt] = [[pC], [pR]];
			break;
		case 'rl-lp':
			[series, shunt] = [[pL], [pR]];
			break;
		case 'rl-hp':
			[series, shunt] = [[pR], [pL]];
			break;
		case 'rlc-c':
			[series, shunt] = [[pR, pL], [pC]];
			break;
		case 'rlc-r':
			[series, shunt] = [[pL, pC], [pR]];
			break;
		case 'rlc-l':
			[series, shunt] = [[pR, pC], [pL]];
			break;
		case 'rlc-lc':
			[series, shunt] = [[pR], [pL, pC]];
			stacked = true;
			break;
		case 'tank':
			[series, shunt] = [[pR], [pL, pC]];
			break;
	}

	const items: SchematicItem[] = [];
	const xs = 40;
	// source and its connections
	items.push({ t: 'wire', pts: [[xs, TOP], [xs, 107]] });
	items.push({ t: 'wire', pts: [[xs, 133], [xs, BOT]] });
	items.push({ t: 'src', x: xs, y: 120, label: 'v_in' });

	// series chain along the top rail
	let x = 72;
	items.push({ t: 'wire', pts: [[xs, TOP], [x, TOP]] });
	for (const p of series) {
		items.push({ t: 'part', kind: p.kind, x1: x, y1: TOP, x2: x + 80, y2: TOP, name: p.name, value: p.value });
		x += 80;
	}
	const node = series.length === 1 ? 250 : 300;
	items.push({ t: 'wire', pts: [[x, TOP], [node, TOP]] });

	let xOut: number;
	if (id === 'tank') {
		const x2 = node + 70;
		items.push({ t: 'part', x1: node, y1: TOP, x2: node, y2: BOT, ...shunt[0], labels: 'left', accent: true });
		items.push({ t: 'part', x1: x2, y1: TOP, x2: x2, y2: BOT, ...shunt[1], accent: true });
		items.push({ t: 'wire', pts: [[node, TOP], [x2, TOP]] });
		items.push({ t: 'dot', x: node, y: TOP }, { t: 'dot', x: node, y: BOT }, { t: 'dot', x: x2, y: TOP }, { t: 'dot', x: x2, y: BOT });
		xOut = x2 + 100;
		items.push({ t: 'wire', pts: [[x2, TOP], [xOut, TOP]] });
	} else if (stacked) {
		const mid = (TOP + BOT) / 2;
		items.push({ t: 'part', x1: node, y1: TOP, x2: node, y2: mid, ...shunt[0], accent: true });
		items.push({ t: 'part', x1: node, y1: mid, x2: node, y2: BOT, ...shunt[1], accent: true });
		items.push({ t: 'dot', x: node, y: TOP }, { t: 'dot', x: node, y: BOT });
		xOut = node + 110;
		items.push({ t: 'wire', pts: [[node, TOP], [xOut, TOP]] });
	} else {
		items.push({ t: 'part', x1: node, y1: TOP, x2: node, y2: BOT, ...shunt[0], accent: true });
		items.push({ t: 'dot', x: node, y: TOP }, { t: 'dot', x: node, y: BOT });
		xOut = node + 110;
		items.push({ t: 'wire', pts: [[node, TOP], [xOut, TOP]] });
	}
	// ground rail
	items.push({ t: 'wire', pts: [[xs, BOT], [xOut, BOT]] });
	items.push({ t: 'wire', pts: [[xs, BOT], [xs, BOT + 8]] });
	items.push({ t: 'gnd', x: xs, y: BOT + 8 });
	// output port
	items.push({ t: 'term', x: xOut, y: TOP, accent: true }, { t: 'term', x: xOut, y: BOT, accent: true });
	items.push({ t: 'volt', x: xOut, y1: TOP, y2: BOT, label: 'v_out', accent: true });
	return items;
}

// ---------------------------------------------------------------------------
// TeX helpers
// ---------------------------------------------------------------------------

/** A number for TeX: plain for moderate magnitudes, mantissa × 10^n otherwise. */
export function texNum(v: number, digits = 4): string {
	if (!Number.isFinite(v)) return '\\infty';
	if (v === 0) return '0';
	const a = Math.abs(v);
	if (a >= 1e-2 && a < 1e4) return String(Number(v.toPrecision(digits)));
	const e = Math.floor(Math.log10(a));
	let m = Number((v / Math.pow(10, e)).toPrecision(digits));
	let ee = e;
	if (Math.abs(m) >= 10) {
		m /= 10;
		ee += 1;
	}
	if (m === 1) return `10^{${ee}}`;
	if (m === -1) return `-10^{${ee}}`;
	return `${m}\\times 10^{${ee}}`;
}
