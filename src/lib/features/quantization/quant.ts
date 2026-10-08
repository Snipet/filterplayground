/**
 * Fixed-point coefficient quantisation of IIR filters in different structures,
 * realisable pole grids and a limit-cycle simulation.
 */
import { type Complex, abs } from '$lib/dsp/complex';
import { cleanRealRoots, roots } from '$lib/dsp/poly';
import { sos2tf, tf2zpk } from '$lib/dsp/convert';
import type { SOS, TF, ZPK } from '$lib/dsp/types';

/** Signed fixed-point format Q{int}.{frac}: 1 sign bit + int + frac = bits. */
export interface QFormat {
	bits: number;
	int: number;
	frac: number;
}

export const qName = (f: QFormat): string => `Q${f.int}.${f.frac}`;
export const lsb = (f: QFormat): number => Math.pow(2, -f.frac);

/** Format with B bits and `int` integer bits. */
export function makeFormat(bits: number, int: number): QFormat {
	const i = Math.max(0, Math.min(bits - 1, Math.round(int)));
	return { bits, int: i, frac: bits - 1 - i };
}

/**
 * Smallest number of integer bits that represents every value after rounding
 * (so the largest coefficient does not saturate), then all remaining bits are
 * fractional.
 */
export function autoFormat(values: readonly number[], bits: number): QFormat {
	for (let int = 0; int < bits; int++) {
		const f = makeFormat(bits, int);
		if (values.every((v) => !quantize(v, f).saturated)) return f;
	}
	return makeFormat(bits, bits - 1);
}

/** Round to the nearest multiple of 2^−frac and saturate to the format's range. */
export function quantize(v: number, f: QFormat): { value: number; saturated: boolean } {
	const scale = Math.pow(2, f.frac);
	const maxInt = Math.pow(2, f.bits - 1) - 1;
	const minInt = -Math.pow(2, f.bits - 1);
	const r = Math.round(v * scale);
	const c = Math.max(minInt, Math.min(maxInt, r));
	return { value: c / scale, saturated: c !== r };
}

/** Integer code of v in format f (for export). */
export const toInt = (v: number, f: QFormat): number => Math.round(v * Math.pow(2, f.frac));

export interface QuantSet {
	name: string;
	format: QFormat;
	maxAbs: number;
	saturated: number;
	count: number;
}

function quantizeAll(values: readonly number[], f: QFormat): { q: number[]; saturated: number } {
	let saturated = 0;
	const q = values.map((v) => {
		const r = quantize(v, f);
		if (r.saturated) saturated++;
		return r.value;
	});
	return { q, saturated };
}

const firstNonZero = (v: readonly number[]) => v.find((x) => x !== 0) ?? 1;

export interface StructureResult {
	zpk: ZPK;
	maxRadius: number;
	stable: boolean;
	sets: QuantSet[];
}

export interface DirectResult extends StructureResult {
	tf: TF;
	/** Exact numerator gain g (b = g · b_q, not quantised). */
	gain: number;
	/** Quantised monic numerator b_q (on its Q grid; b_q[0] may have saturated). */
	bq: number[];
	/** Quantised a₁…a_N (a₀ = 1 is implicit and not quantised). */
	aq: number[];
}

export interface SosResult extends StructureResult {
	sos: SOS;
	/** Integer codes per section [b0 b1 b2 a1 a2] and the separate gain. */
	ints: number[][];
	gain: number;
}

function digitalRoots(p: readonly number[]): Complex[] {
	let q = [...p];
	while (q.length > 1 && q[q.length - 1] === 0) q = q.slice(0, -1);
	return cleanRealRoots(roots(q));
}

/** A numerator written as gain · monic polynomial; the gain stays exact. */
function splitGain(b: readonly number[]): { g: number; m: number[] } {
	const g = firstNonZero(b);
	return { g, m: b.map((v) => v / g) };
}

/**
 * Direct form: quantise the monic numerator and the denominator a₁…a_N
 * (a₀ = 1 is implicit), each with its own Q format.
 */
export function quantizeDirect(tf: TF, bits: number, manualInt: number | null): DirectResult {
	const a0 = tf.a[0];
	const a = tf.a.map((v) => v / a0);
	const b = tf.b.map((v) => v / a0);
	const { g, m } = splitGain(b);
	const fb = manualInt === null ? autoFormat(m, bits) : makeFormat(bits, manualInt);
	const fa = manualInt === null ? autoFormat(a.slice(1), bits) : makeFormat(bits, manualInt);
	const qb = quantizeAll(m, fb);
	const qa = quantizeAll(a.slice(1), fa);
	const tfq: TF = { b: qb.q.map((v) => v * g), a: [1, ...qa.q] };
	const zpk = tf2zpk(tfq);
	const maxRadius = Math.max(0, ...zpk.p.map(abs));
	return {
		tf: tfq,
		gain: g,
		bq: qb.q,
		aq: qa.q,
		zpk,
		maxRadius,
		stable: maxRadius < 1,
		sets: [
			{
				name: 'Numerator b (monic)',
				format: fb,
				maxAbs: Math.max(...m.map(Math.abs)),
				saturated: qb.saturated,
				count: m.length
			},
			{
				name: 'Denominator a₁…a_N',
				format: fa,
				maxAbs: Math.max(0, ...a.slice(1).map(Math.abs)),
				saturated: qa.saturated,
				count: a.length - 1
			}
		]
	};
}

/**
 * Cascade of second-order sections: every section's numerator is made monic
 * (the product of the gains is applied once, exactly); all numerators share
 * one Q format and all denominators another.
 */
export function quantizeSos(sos: SOS, bits: number, manualInt: number | null): SosResult {
	const norm = sos.map((r) => r.map((v) => v / (r[3] || 1)));
	let gain = 1;
	const nums = norm.map((r) => {
		const { g, m } = splitGain(r.slice(0, 3));
		gain *= g;
		return m;
	});
	const dens = norm.map((r) => [r[4], r[5]]);
	const fb = manualInt === null ? autoFormat(nums.flat(), bits) : makeFormat(bits, manualInt);
	const fa = manualInt === null ? autoFormat(dens.flat(), bits) : makeFormat(bits, manualInt);
	let satB = 0;
	let satA = 0;
	const out: SOS = [];
	const ints: number[][] = [];
	norm.forEach((_, i) => {
		const qb = quantizeAll(nums[i], fb);
		const qa = quantizeAll(dens[i], fa);
		satB += qb.saturated;
		satA += qa.saturated;
		out.push([...qb.q, 1, ...qa.q]);
		ints.push([
			...nums[i].map((v) => toInt(quantize(v, fb).value, fb)),
			...dens[i].map((v) => toInt(quantize(v, fa).value, fa))
		]);
	});
	out[0] = out[0].map((v, j) => (j < 3 ? v * gain : v));
	const z: Complex[] = [];
	const p: Complex[] = [];
	for (const r of out) {
		const zr = digitalRoots(r.slice(0, 3));
		const pr = digitalRoots(r.slice(3, 6));
		z.push(...zr);
		p.push(...pr);
	}
	const maxRadius = Math.max(0, ...p.map(abs));
	return {
		sos: out,
		ints,
		gain,
		zpk: { z, p, k: gain },
		maxRadius,
		stable: maxRadius < 1,
		sets: [
			{
				name: 'Section numerators (monic)',
				format: fb,
				maxAbs: Math.max(...nums.flat().map(Math.abs)),
				saturated: satB,
				count: nums.flat().length
			},
			{
				name: 'Section denominators a₁, a₂',
				format: fa,
				maxAbs: Math.max(...dens.flat().map(Math.abs)),
				saturated: satA,
				count: dens.flat().length
			}
		]
	};
}

/**
 * Coupled (Gold–Rader) form: each pole pair r·e^{±jθ} is realised through
 * σ = r cos θ and ω = r sin θ, which are quantised directly — a uniform grid of
 * pole positions. Real poles are quantised directly (first-order sections).
 * Zeros are taken from the quantised SOS numerators.
 */
export function quantizeCoupled(
	poles: readonly Complex[],
	zerosFromSos: readonly Complex[],
	gain: number,
	bits: number,
	manualInt: number | null
): StructureResult {
	const reps = poles.filter((p) => p.im >= 0);
	const vals = reps.flatMap((p) => (p.im > 0 ? [p.re, p.im] : [p.re]));
	const f = manualInt === null ? autoFormat(vals, bits) : makeFormat(bits, manualInt);
	let sat = 0;
	const q = (v: number) => {
		const r = quantize(v, f);
		if (r.saturated) sat++;
		return r.value;
	};
	const p: Complex[] = [];
	for (const r of reps) {
		if (r.im > 0) {
			const re = q(r.re);
			const im = q(r.im);
			p.push({ re, im }, { re, im: -im });
		} else p.push({ re: q(r.re), im: 0 });
	}
	const maxRadius = Math.max(0, ...p.map(abs));
	return {
		zpk: { z: [...zerosFromSos], p, k: gain },
		maxRadius,
		stable: maxRadius < 1,
		sets: [
			{
				name: 'Pole coordinates σ, ω',
				format: f,
				maxAbs: Math.max(0, ...vals.map(Math.abs)),
				saturated: sat,
				count: vals.length
			}
		]
	};
}

/** Exact poles of a cascade (per section, accurate). */
export function sosPoles(sos: SOS): Complex[] {
	return sos.flatMap((r) => digitalRoots(r.slice(3, 6).map((v) => v / (r[3] || 1))));
}

export function sosZeros(sos: SOS): Complex[] {
	return sos.flatMap((r) => digitalRoots(r.slice(0, 3)));
}

export const directTf = (sos: SOS): TF => sos2tf(sos);

// ---------------------------------------------------------------------------
// Realisable pole grids
// ---------------------------------------------------------------------------

/**
 * Upper-half-plane poles realisable by a 2nd-order direct-form section whose
 * a₁, a₂ use `bits` bits in Q1.(bits−2) (a₁ needs the range ±2).
 */
export function directFormGrid(bits: number): Complex[] {
	const d = Math.pow(2, -(bits - 2));
	const out: Complex[] = [];
	for (let ka = 1; ka * d < 1; ka++) {
		const a2 = ka * d;
		for (let m = -Math.pow(2, bits - 1); m < Math.pow(2, bits - 1); m++) {
			const a1 = m * d;
			const disc = a2 - (a1 * a1) / 4;
			if (disc > 0) out.push({ re: -a1 / 2, im: Math.sqrt(disc) });
		}
	}
	return out;
}

/** Upper-half-plane poles realisable by a coupled-form section, σ and ω in Q0.(bits−1). */
export function coupledGrid(bits: number): Complex[] {
	const d = Math.pow(2, -(bits - 1));
	const n = Math.pow(2, bits - 1);
	const out: Complex[] = [];
	for (let i = -n; i < n; i++)
		for (let k = 1; k < n; k++) {
			const re = i * d;
			const im = k * d;
			if (re * re + im * im < 1) out.push({ re, im });
		}
	return out;
}

// ---------------------------------------------------------------------------
// Limit cycles
// ---------------------------------------------------------------------------

export type RoundMode = 'round' | 'floor' | 'trunc';

export function roundTo(v: number, frac: number, mode: RoundMode): number {
	const s = Math.pow(2, frac);
	const x = v * s;
	const r = mode === 'round' ? Math.round(x) : mode === 'floor' ? Math.floor(x) : Math.trunc(x);
	return r / s;
}

export interface LimitCycleOptions {
	/**
	 * Saturate the output to the signal word Q0.frac, i.e. [−1, 1 − 2^−frac]
	 * (saturation arithmetic). Off: the integer range is unlimited and only the
	 * fractional resolution is modelled.
	 */
	saturate?: boolean;
}

/** One step of the quantised recursion: every product rounded, then (optionally) saturated. */
function lcStep(
	a1: number,
	a2: number,
	q1: number,
	q2: number,
	frac: number,
	mode: RoundMode,
	saturate: boolean
): number {
	// + 0 turns −0 (e.g. trunc(−0.3)) into 0
	const yq = roundTo(-a1 * q1, frac, mode) + roundTo(-a2 * q2, frac, mode) + 0;
	return saturate ? Math.min(1 - Math.pow(2, -frac), Math.max(-1, yq)) : yq;
}

/**
 * Zero-input response of y[n] = −a₁y[n−1] − a₂y[n−2] from y[−1] = y0, y[−2] = 0,
 * ideal (double) and with every product rounded to `frac` fractional bits (and the
 * sum saturated to Q0.frac with `opts.saturate`).
 */
export function zeroInputResponse(
	a1: number,
	a2: number,
	y0: number,
	frac: number,
	mode: RoundMode,
	n: number,
	opts: LimitCycleOptions = {}
): { ideal: number[]; quantized: number[] } {
	const sat = opts.saturate ?? false;
	const ideal: number[] = [];
	const quantized: number[] = [];
	let i1 = y0;
	let i2 = 0;
	const q0 = roundTo(y0, frac, 'round');
	let q1 = sat ? Math.min(1 - Math.pow(2, -frac), Math.max(-1, q0)) : q0;
	let q2 = 0;
	for (let k = 0; k < n; k++) {
		const yi = -a1 * i1 - a2 * i2;
		ideal.push(yi);
		i2 = i1;
		i1 = yi;
		const yq = lcStep(a1, a2, q1, q2, frac, mode, sat);
		quantized.push(yq);
		q2 = q1;
		q1 = yq;
	}
	return { ideal, quantized };
}

export interface LimitCycle {
	/** Largest |y| over the periodic steady state, in LSB (0 when the response dies out). */
	amplitude: number;
	/** Period of the steady state in samples (1 for a constant, including zero). */
	period: number;
	/** First output sample n from which y[n] is periodic. */
	onset: number;
	/** True if the step budget ran out before the state repeated (amplitude not exact). */
	capped: boolean;
	/** One period of the steady-state output y[onset…onset+period−1], in LSB. */
	samples: number[];
}

/**
 * Exact steady state of the quantised zero-input recursion of `zeroInputResponse`.
 * The state (y[n−1], y[n−2]) lives on the 2^−frac grid and the map is
 * deterministic, so the response must end up periodic; Brent's cycle detection
 * finds where (onset) and with which period, however slowly the transient decays.
 */
export function limitCycle(
	a1: number,
	a2: number,
	y0: number,
	frac: number,
	mode: RoundMode,
	opts: LimitCycleOptions & { maxSteps?: number } = {}
): LimitCycle {
	const sat = opts.saturate ?? false;
	const maxSteps = opts.maxSteps ?? 1_000_000;
	const q0 = roundTo(y0, frac, 'round');
	const x0: [number, number] = [sat ? Math.min(1 - Math.pow(2, -frac), Math.max(-1, q0)) : q0, 0];
	const f = (x: [number, number]): [number, number] => [
		lcStep(a1, a2, x[0], x[1], frac, mode, sat),
		x[0]
	];
	const same = (u: [number, number], v: [number, number]) => u[0] === v[0] && u[1] === v[1];
	// Brent: find the period λ
	let power = 1;
	let lam = 1;
	let steps = 0;
	let tortoise = x0;
	let hare = f(x0);
	while (!same(tortoise, hare)) {
		if (++steps > maxSteps) {
			// report the recent output range as a lower bound of what is still going on
			let amp = 0;
			for (let k = 0; k < 1000; k++) {
				hare = f(hare);
				amp = Math.max(amp, Math.abs(hare[0]));
			}
			return {
				amplitude: amp * Math.pow(2, frac),
				period: 0,
				onset: steps,
				capped: true,
				samples: []
			};
		}
		if (power === lam) {
			tortoise = hare;
			power *= 2;
			lam = 0;
		}
		hare = f(hare);
		lam++;
	}
	// first repeated state μ: states x_μ, x_μ+1, … are periodic
	tortoise = x0;
	hare = x0;
	for (let k = 0; k < lam; k++) hare = f(hare);
	let mu = 0;
	let prev = x0;
	while (!same(tortoise, hare)) {
		prev = tortoise;
		tortoise = f(tortoise);
		hare = f(hare);
		mu++;
	}
	// x_n = (y[n−1], y[n−2]): y[n] is periodic from n = μ − 1 on
	let onset = Math.max(0, mu - 1);
	let x = mu === 0 ? f(tortoise) : tortoise;
	const scale = Math.pow(2, frac);
	const samples: number[] = [];
	for (let k = 0; k < lam; k++) {
		samples.push(x[0] * scale);
		x = f(x);
	}
	// x_μ−1 is not in the cycle, but its newer entry y[μ−2] may still match y[μ−2+λ]
	if (mu >= 2 && prev[0] * scale === samples[lam - 1]) {
		onset = mu - 2;
		samples.unshift(samples.pop()!);
	}
	const amplitude = Math.max(...samples.map(Math.abs));
	return { amplitude, period: lam, onset, capped: false, samples };
}
