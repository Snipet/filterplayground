/**
 * Op-amp active filter stages: Sallen–Key (unity gain / equal component),
 * multiple feedback (MFB) low-pass, high-pass and band-pass, and buffered
 * first-order RC sections.
 *
 * Component naming follows the stage schematics (see schematics.ts):
 *
 *   Sallen–Key LP   Vin–R1–A–R2–B(+),  C1: A→out,  C2: B→gnd,  K = 1 + R4/R3
 *   Sallen–Key HP   Vin–C1–A–C2–B(+),  R1: A→out,  R2: B→gnd,  K = 1 + R4/R3
 *   MFB LP          Vin–R1–A, R2: A→out, R3: A→(−), C1: A→gnd, C2: (−)→out
 *   MFB HP          Vin–C1–A, C2: A→out, C3: A→(−), R1: A→gnd, R2: (−)→out
 *   MFB BP          Vin–R1–A, C2: A→out, C1: A→(−), R3: A→gnd, R2: (−)→out
 *   RC + buffer     LP: Vin–R1–(+), C1 to gnd;  HP: Vin–C1–(+), R1 to gnd
 *
 * Every realised transfer function below was derived by nodal analysis with an
 * ideal op-amp and is cross-checked against a numerical MNA solver in
 * tests/active-filters.test.ts.
 */
import { type Complex, c, mul, div, add } from '$lib/dsp/complex';
import { roots } from '$lib/dsp/poly';
import { analogStages } from '$lib/dsp/convert';
import type { ZPK } from '$lib/dsp/types';
import { E_SERIES, toESeries, type ESeries } from '$lib/dsp/units';

export type StageBand = 'lowpass' | 'highpass' | 'bandpass';
/** User-selectable topology for second-order LP/HP stages. */
export type Topology = 'sk-unity' | 'sk-equal' | 'mfb';
/** What a stage is actually built with. */
export type StageTopology = Topology | 'mfb-bp' | 'rc1';

export const TOPOLOGY_NAMES: Record<StageTopology, string> = {
	'sk-unity': 'Sallen–Key, unity gain',
	'sk-equal': 'Sallen–Key, equal components',
	mfb: 'Multiple feedback (inverting)',
	'mfb-bp': 'Multiple-feedback band-pass',
	rc1: 'RC + buffer (first order)'
};

export interface StageSpec {
	band: StageBand;
	order: 1 | 2;
	/** Natural frequency, rad/s. */
	w0: number;
	q: number;
}

export interface DesignOptions {
	topology: Topology;
	/** MFB LP/HP passband gain magnitude, or the MFB band-pass centre gain. */
	gain: number;
	/** Base capacitor (F) — rounded to the capacitor series before use. */
	baseC: number;
	rSeries: ESeries;
	cSeries: ESeries;
	/** Gain-setting resistor R3 of the equal-component Sallen–Key (Ω). */
	rGain?: number;
	/**
	 * Search nearby values of the free capacitor and round each resistor down
	 * or up, keeping the combination with the smallest f₀ / Q error.
	 */
	optimize?: boolean;
}

export interface Part {
	/** Local role name, e.g. "R1" (matches the design equations). */
	role: string;
	kind: 'R' | 'C';
	/** Ideal value for the chosen capacitors (Ω or F); Infinity = open. */
	exact: number;
	/** Standard value actually used. */
	value: number;
	/** Where it sits in the circuit. */
	desc: string;
}

/** s-domain transfer function, descending powers, monic denominator. */
export interface StageTf {
	num: number[];
	den: number[];
}

export interface StageDesign {
	spec: StageSpec;
	topology: StageTopology;
	parts: Part[];
	/** Signed nominal passband gain (DC for LP, ∞ for HP, centre for BP). */
	gain: number;
	target: StageTf;
	/** Built from the exact (unrounded) resistor values. */
	exactTf: StageTf;
	/** Built from the standard values. */
	realized: StageTf;
	realizedParams: { w0: number; q: number; gain: number };
	notes: string[];
	/** Rough minimum op-amp gain–bandwidth product (Hz). */
	gbw: number;
	gbwRule: string;
}

// ---------------------------------------------------------------------------
// E-series helpers
// ---------------------------------------------------------------------------

/** Smallest preferred value ≥ v. */
export function ceilToSeries(v: number, s: ESeries): number {
	if (s === 'exact' || !(v > 0) || !Number.isFinite(v)) return v;
	const vals = E_SERIES[s];
	const d0 = Math.floor(Math.log10(v));
	for (let d = d0 - 1; d <= d0 + 2; d++) {
		for (const m of vals) {
			const cand = Number((m * Math.pow(10, d)).toPrecision(3));
			if (cand >= v * (1 - 1e-9)) return cand;
		}
	}
	return v;
}

/** Largest preferred value ≤ v. */
export function floorToSeries(v: number, s: ESeries): number {
	if (s === 'exact' || !(v > 0) || !Number.isFinite(v)) return v;
	const vals = E_SERIES[s];
	const d0 = Math.floor(Math.log10(v));
	for (let d = d0 + 1; d >= d0 - 2; d--) {
		for (let i = vals.length - 1; i >= 0; i--) {
			const cand = Number((vals[i] * Math.pow(10, d)).toPrecision(3));
			if (cand <= v * (1 + 1e-9)) return cand;
		}
	}
	return v;
}

/** The k-th preferred value at or above v (k = 0 → ceilToSeries). */
export function stepUpSeries(v: number, s: ESeries, k: number): number {
	let out = ceilToSeries(v, s);
	if (s === 'exact') return out;
	for (let i = 0; i < k; i++) out = ceilToSeries(out * (1 + 1e-6), s);
	return out;
}

/** The preferred values bracketing v (one value if v is already preferred). */
export function seriesNeighbours(v: number, s: ESeries): number[] {
	if (s === 'exact' || !Number.isFinite(v) || !(v > 0)) return [v];
	const lo = floorToSeries(v, s);
	const hi = ceilToSeries(v, s);
	return lo === hi ? [lo] : [lo, hi];
}

const roundR = (v: number, s: ESeries) => (Number.isFinite(v) ? toESeries(v, s) : v);

// ---------------------------------------------------------------------------
// Realised transfer functions from component values
// ---------------------------------------------------------------------------

export type Values = Record<string, number>;

/** Transfer function of a stage from its component values (ideal op-amp). */
export function stageTf(topology: StageTopology, band: StageBand, v: Values): StageTf {
	switch (topology) {
		case 'rc1': {
			const w = 1 / (v.R1 * v.C1);
			return band === 'lowpass' ? { num: [0, w], den: [1, w] } : { num: [1, 0], den: [1, w] };
		}
		case 'sk-unity':
		case 'sk-equal': {
			const K = topology === 'sk-equal' ? 1 + v.R4 / v.R3 : 1;
			const P = v.R1 * v.R2 * v.C1 * v.C2;
			if (band === 'lowpass') {
				const a1 = ((v.R1 + v.R2) * v.C2 + v.R1 * v.C1 * (1 - K)) / P;
				return { num: [0, 0, K / P], den: [1, a1, 1 / P] };
			}
			const a1 = (v.R1 * (v.C1 + v.C2) + (1 - K) * v.R2 * v.C2) / P;
			return { num: [K, 0, 0], den: [1, a1, 1 / P] };
		}
		case 'mfb': {
			if (band === 'lowpass') {
				const a1 = (1 / v.R1 + 1 / v.R2 + 1 / v.R3) / v.C1;
				const a0 = 1 / (v.R2 * v.R3 * v.C1 * v.C2);
				return { num: [0, 0, -1 / (v.R1 * v.R3 * v.C1 * v.C2)], den: [1, a1, a0] };
			}
			const a1 = (v.C1 + v.C2 + v.C3) / (v.C2 * v.C3 * v.R2);
			const a0 = 1 / (v.R1 * v.R2 * v.C2 * v.C3);
			return { num: [-v.C1 / v.C2, 0, 0], den: [1, a1, a0] };
		}
		case 'mfb-bp': {
			const g3 = Number.isFinite(v.R3) ? 1 / v.R3 : 0;
			const a1 = (v.C1 + v.C2) / (v.C1 * v.C2 * v.R2);
			const a0 = (1 / v.R1 + g3) / (v.C1 * v.C2 * v.R2);
			return { num: [0, -1 / (v.R1 * v.C2), 0], den: [1, a1, a0] };
		}
	}
}

/** Natural frequency, Q and nominal passband gain of a stage transfer function. */
export function tfParams(tf: StageTf, band: StageBand): { w0: number; q: number; gain: number } {
	if (tf.den.length === 2) {
		const w0 = tf.den[1];
		return { w0, q: 0.5, gain: band === 'lowpass' ? tf.num[1] / tf.den[1] : tf.num[0] };
	}
	const w0 = Math.sqrt(tf.den[2]);
	const q = w0 / tf.den[1];
	const gain = band === 'lowpass' ? tf.num[2] / tf.den[2] : band === 'highpass' ? tf.num[0] : tf.num[1] / tf.den[1];
	return { w0, q, gain };
}

/** Ideal stage transfer function with a given signed passband gain. */
export function targetTf(spec: StageSpec, gain: number): StageTf {
	const { w0, q } = spec;
	if (spec.order === 1) return spec.band === 'lowpass' ? { num: [0, gain * w0], den: [1, w0] } : { num: [gain, 0], den: [1, w0] };
	const den = [1, w0 / q, w0 * w0];
	if (spec.band === 'lowpass') return { num: [0, 0, gain * w0 * w0], den };
	if (spec.band === 'highpass') return { num: [gain, 0, 0], den };
	return { num: [0, (gain * w0) / q, 0], den };
}

// ---------------------------------------------------------------------------
// Design equations
// ---------------------------------------------------------------------------

interface Raw {
	topology: StageTopology;
	parts: Omit<Part, 'value'>[];
	/** Values to use for the parts already fixed (capacitors). */
	fixed: Record<string, number>;
	gain: number;
	notes: string[];
}

/** Move v by k steps through a preferred-value series (k < 0 steps down). */
export function seriesStep(v: number, s: ESeries, k: number): number {
	if (s === 'exact') return v;
	let out = toESeries(v, s);
	for (let i = 0; i < Math.abs(k); i++) out = k > 0 ? ceilToSeries(out * (1 + 1e-6), s) : floorToSeries(out * (1 - 1e-6), s);
	return out;
}

/**
 * Design freedom the optimiser may use, as a list of "variant" steps:
 *  - LP Sallen–Key / MFB: the ratio capacitor C1 (k-th preferred value above its minimum)
 *  - SK HP, MFB HP, MFB BP: the second capacitor (k steps around the base value)
 *  - equal-component SK: the gain resistor R3 (k steps around 10 kΩ)
 */
function variants(spec: StageSpec, o: DesignOptions): number[] {
	if (spec.order === 1) return [0];
	const around = (n: number) => [0, ...Array.from({ length: n }, (_, i) => [i + 1, -(i + 1)]).flat()];
	if (spec.band !== 'bandpass' && o.topology === 'sk-equal' && spec.q >= 0.5) return o.rSeries === 'exact' ? [0] : around(6);
	if (o.cSeries === 'exact') return [0];
	if (spec.band === 'lowpass') return [0, 1, 2, 3];
	return around(3);
}

/** @param variant  optimiser step, see {@link variants} */
function designRaw(spec: StageSpec, o: DesignOptions, variant = 0): Raw {
	const { w0, q, band } = spec;
	const C = toESeries(o.baseC, o.cSeries);
	const notes: string[] = [];

	if (spec.order === 1) {
		const R1 = 1 / (w0 * C);
		return {
			topology: 'rc1',
			parts:
				band === 'lowpass'
					? [
							{ role: 'R1', kind: 'R', exact: R1, desc: 'series' },
							{ role: 'C1', kind: 'C', exact: C, desc: 'to ground' }
						]
					: [
							{ role: 'R1', kind: 'R', exact: R1, desc: 'to ground' },
							{ role: 'C1', kind: 'C', exact: C, desc: 'series' }
						],
			fixed: { C1: C },
			gain: 1,
			notes
		};
	}

	if (band === 'bandpass') {
		// MFB band-pass (C1 = C2 = C by default): R2 = Q(C1+C2)/(ω0C1C2), R1 from |H0|, R3 sets ω0
		const C1 = seriesStep(C, o.cSeries, variant);
		const C2 = C;
		let H0 = Math.abs(o.gain);
		// R3 ≥ 0 requires |H0| ≤ Q²(C1 + C2)/C2 (= 2Q² for equal capacitors)
		const hmax = (q * q * (C1 + C2)) / C2;
		let open = false;
		if (H0 >= hmax * (1 - 1e-9)) {
			if (H0 > hmax * (1 + 1e-9)) notes.push(`Centre gain limited to 2Q² = ${hmax.toPrecision(3)} (R3 omitted).`);
			H0 = hmax;
			open = true;
		}
		const R2 = (q * (C1 + C2)) / (w0 * C1 * C2);
		const R1 = (R2 * C1) / (H0 * (C1 + C2));
		const g3 = w0 * w0 * C1 * C2 * R2 - 1 / R1;
		const R3 = open || g3 <= 0 ? Infinity : 1 / g3;
		return {
			topology: 'mfb-bp',
			parts: [
				{ role: 'R1', kind: 'R', exact: R1, desc: 'input' },
				{ role: 'R2', kind: 'R', exact: R2, desc: 'feedback (−) → out' },
				{ role: 'R3', kind: 'R', exact: R3, desc: 'shunt to ground' },
				{ role: 'C1', kind: 'C', exact: C1, desc: 'node → (−)' },
				{ role: 'C2', kind: 'C', exact: C2, desc: 'feedback node → out' }
			],
			fixed: { C1, C2 },
			gain: -H0,
			notes
		};
	}

	let topology: StageTopology = o.topology;
	if (topology === 'sk-equal' && q < 0.5 - 1e-12) {
		notes.push('Equal-component Sallen–Key needs Q ≥ 0.5 (gain K = 3 − 1/Q ≥ 1); built as unity gain instead.');
		topology = 'sk-unity';
	}

	if (topology === 'sk-unity') {
		if (band === 'lowpass') {
			// C2 = base, C1 ≥ 4Q²C2; R1 + R2 = 1/(ω0 Q C2), R1R2 = 1/(ω0² C1 C2)
			const C2 = C;
			const C1 = stepUpSeries(4 * q * q * C2, o.cSeries, variant);
			const S = 1 / (w0 * q * C2);
			const P = 1 / (w0 * w0 * C1 * C2);
			const disc = Math.sqrt(Math.max(0, S * S - 4 * P));
			const R1 = (S - disc) / 2;
			const R2 = (S + disc) / 2;
			if (C1 / C2 > 100) notes.push(`Capacitor ratio C1/C2 = ${(C1 / C2).toPrecision(3)} is large — consider MFB or a different base value.`);
			return {
				topology,
				parts: [
					{ role: 'R1', kind: 'R', exact: R1, desc: 'input' },
					{ role: 'R2', kind: 'R', exact: R2, desc: 'series' },
					{ role: 'C1', kind: 'C', exact: C1, desc: 'feedback to out' },
					{ role: 'C2', kind: 'C', exact: C2, desc: '(+) to ground' }
				],
				fixed: { C1, C2 },
				gain: 1,
				notes
			};
		}
		// HP (C1 = C2 = C by default): R1 = 1/(Qω0(C1+C2)), R2 = 1/(ω0² R1 C1 C2)
		const C1 = C;
		const C2 = seriesStep(C, o.cSeries, variant);
		const R1 = 1 / (q * w0 * (C1 + C2));
		const R2 = 1 / (w0 * w0 * R1 * C1 * C2);
		return {
			topology,
			parts: [
				{ role: 'R1', kind: 'R', exact: R1, desc: 'feedback to out' },
				{ role: 'R2', kind: 'R', exact: R2, desc: '(+) to ground' },
				{ role: 'C1', kind: 'C', exact: C1, desc: 'input' },
				{ role: 'C2', kind: 'C', exact: C2, desc: 'series' }
			],
			fixed: { C1, C2 },
			gain: 1,
			notes
		};
	}

	if (topology === 'sk-equal') {
		const K = 3 - 1 / q;
		const R = 1 / (w0 * C);
		const R3 = seriesStep(o.rGain ?? 10e3, o.rSeries, variant);
		const R4 = (K - 1) * R3;
		if (q > 5) notes.push(`Q = ${q.toPrecision(3)}: the gain K must hit ${K.toPrecision(4)} very precisely — Q is extremely sensitive to R3/R4.`);
		const isLp = band === 'lowpass';
		return {
			topology,
			parts: [
				{ role: 'R1', kind: 'R', exact: R, desc: isLp ? 'input' : 'feedback to out' },
				{ role: 'R2', kind: 'R', exact: R, desc: isLp ? 'series' : '(+) to ground' },
				{ role: 'R3', kind: 'R', exact: R3, desc: 'gain set, (−) to ground' },
				{ role: 'R4', kind: 'R', exact: R4, desc: 'gain set, (−) to out' },
				{ role: 'C1', kind: 'C', exact: C, desc: isLp ? 'feedback to out' : 'input' },
				{ role: 'C2', kind: 'C', exact: C, desc: isLp ? '(+) to ground' : 'series' }
			],
			fixed: { C1: C, C2: C, R3 },
			gain: K,
			notes
		};
	}

	// ---- MFB (inverting) ----
	const G = Math.max(1e-6, Math.abs(o.gain));
	if (band === 'lowpass') {
		// C2 = base (feedback), C1 ≥ 4Q²(1+G)C2
		const C2 = C;
		const C1 = stepUpSeries(4 * q * q * (1 + G) * C2, o.cSeries, variant);
		const disc = Math.sqrt(Math.max(0, 1 / (q * q) - (4 * (1 + G) * C2) / C1));
		const R2 = (1 / q - disc) / (2 * w0 * C2);
		const R3 = 1 / (w0 * w0 * C1 * C2 * R2);
		const R1 = R2 / G;
		if (C1 / C2 > 100) notes.push(`Capacitor ratio C1/C2 = ${(C1 / C2).toPrecision(3)} is large — lower the gain or the Q.`);
		return {
			topology,
			parts: [
				{ role: 'R1', kind: 'R', exact: R1, desc: 'input' },
				{ role: 'R2', kind: 'R', exact: R2, desc: 'feedback node → out' },
				{ role: 'R3', kind: 'R', exact: R3, desc: 'node → (−)' },
				{ role: 'C1', kind: 'C', exact: C1, desc: 'node to ground' },
				{ role: 'C2', kind: 'C', exact: C2, desc: 'feedback (−) → out' }
			],
			fixed: { C1, C2 },
			gain: -G,
			notes
		};
	}
	// HP: C1 = C3 = C, C2 = C1/G; R2 = Q(C1+C2+C3)/(ω0 C2 C3), R1 = 1/(ω0² R2 C2 C3)
	const C1 = C;
	const C3 = seriesStep(C, o.cSeries, variant);
	const C2 = toESeries(C1 / G, o.cSeries);
	const R2 = (q * (C1 + C2 + C3)) / (w0 * C2 * C3);
	const R1 = 1 / (w0 * w0 * R2 * C2 * C3);
	return {
		topology,
		parts: [
			{ role: 'R1', kind: 'R', exact: R1, desc: 'node to ground' },
			{ role: 'R2', kind: 'R', exact: R2, desc: 'feedback (−) → out' },
			{ role: 'C1', kind: 'C', exact: C1, desc: 'input' },
			{ role: 'C2', kind: 'C', exact: C2, desc: 'feedback node → out' },
			{ role: 'C3', kind: 'C', exact: C3, desc: 'node → (−)' }
		],
		fixed: { C1, C2, C3 },
		gain: -G,
		notes
	};
}

/** Error score of a realised stage: log errors of ω₀ and Q, plus a little of the gain. */
function score(tf: StageTf, spec: StageSpec, gain: number): number {
	const p = tfParams(tf, spec.band);
	const e = Math.abs(Math.log(p.w0 / spec.w0)) + (spec.order === 2 ? Math.abs(Math.log(p.q / spec.q)) : 0) + 0.25 * Math.abs(Math.log(Math.abs(p.gain / gain)));
	return Number.isFinite(e) ? e : Infinity;
}

/** Design one stage: exact values, rounded values and the realised response. */
export function designStage(spec: StageSpec, o: DesignOptions): StageDesign {
	const optimize = (o.optimize ?? false) && o.rSeries !== 'exact';
	let best: { raw: Raw; values: number[]; score: number } | null = null;
	for (const k of optimize ? variants(spec, o) : [0]) {
		const raw = designRaw(spec, o, k);
		// candidate standard values for each part
		const choices = raw.parts.map((p) =>
			p.role in raw.fixed
				? [raw.fixed[p.role]]
				: p.kind === 'R'
					? optimize
						? seriesNeighbours(p.exact, o.rSeries)
						: [roundR(p.exact, o.rSeries)]
					: [toESeries(p.exact, o.cSeries)]
		);
		const n = choices.reduce((m, c) => m * c.length, 1);
		for (let idx = 0; idx < n; idx++) {
			let rem = idx;
			const values = choices.map((c) => {
				const v = c[rem % c.length];
				rem = Math.floor(rem / c.length);
				return v;
			});
			const tf = stageTf(raw.topology, spec.band, Object.fromEntries(raw.parts.map((p, i) => [p.role, values[i]])));
			const sc = score(tf, spec, raw.gain);
			if (!best || sc < best.score - 1e-12) best = { raw, values, score: sc };
		}
	}
	const raw = best!.raw;
	const parts: Part[] = raw.parts.map((p, i) => ({ ...p, value: best!.values[i] }));
	const exactVals: Values = Object.fromEntries(parts.map((p) => [p.role, p.exact]));
	const vals: Values = Object.fromEntries(parts.map((p) => [p.role, p.value]));
	const exactTf = stageTf(raw.topology, spec.band, exactVals);
	const realized = stageTf(raw.topology, spec.band, vals);
	const realizedParams = tfParams(realized, spec.band);
	const notes = [...raw.notes];
	for (const p of parts) {
		if (p.kind === 'R' && Number.isFinite(p.value) && (p.value < 100 || p.value > 2e6))
			notes.push(`${p.role} = ${p.value < 100 ? 'below 100 Ω (loads the op-amp)' : 'above 2 MΩ (noise, bias currents)'} — try a ${p.value < 100 ? 'smaller' : 'larger'} base capacitor.`);
	}
	const f0 = spec.w0 / (2 * Math.PI);
	let gbw: number;
	let gbwRule: string;
	switch (raw.topology) {
		case 'rc1':
			gbw = 100 * f0;
			gbwRule = '100·f₀ (unity-gain follower)';
			break;
		case 'sk-unity':
			gbw = 100 * spec.q * f0;
			gbwRule = '100·Q·f₀';
			break;
		case 'sk-equal':
			gbw = 100 * raw.gain * spec.q * f0;
			gbwRule = '100·K·Q·f₀';
			break;
		case 'mfb':
			gbw = 100 * (1 + Math.abs(raw.gain)) * spec.q * f0;
			gbwRule = '100·(1+|G|)·Q·f₀';
			break;
		case 'mfb-bp':
			gbw = 100 * (1 + 2 * spec.q * spec.q) * f0;
			gbwRule = '100·(1+2Q²)·f₀';
			break;
	}
	return {
		spec,
		topology: raw.topology,
		parts,
		gain: raw.gain,
		target: targetTf(spec, raw.gain),
		exactTf,
		realized,
		realizedParams,
		notes,
		gbw,
		gbwRule
	};
}

// ---------------------------------------------------------------------------
// Cascades, evaluation, Monte-Carlo
// ---------------------------------------------------------------------------

/** Evaluate a stage transfer function at s = jω. */
export function tfAt(tf: StageTf, w: number): Complex {
	const s = c(0, w);
	const ev = (p: number[]) => p.reduce<Complex>((acc, k) => add(mul(acc, s), c(k)), c(0));
	return div(ev(tf.num), ev(tf.den));
}

/** Cascade of stage transfer functions → ZPK (rad/s). */
export function cascadeZpk(tfs: StageTf[]): ZPK {
	const z: Complex[] = [];
	const p: Complex[] = [];
	let k = 1;
	for (const tf of tfs) {
		const num = [...tf.num];
		while (num.length > 1 && num[0] === 0) num.shift();
		k *= num[0] / tf.den[0];
		z.push(...roots(num));
		p.push(...roots(tf.den));
	}
	return { z, p, k };
}

/** Deterministic 32-bit PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Monte-Carlo magnitude responses (dB) with every component scattered
 * uniformly within ±tol. Seeded, so the result is stable while dragging.
 */
export function monteCarlo(stages: StageDesign[], tol: number, fHz: number[], runs = 40, seed = 20240229): number[][] {
	const rnd = mulberry32(seed);
	const out: number[][] = [];
	for (let r = 0; r < runs; r++) {
		const tfs = stages.map((st) => {
			const v: Values = {};
			for (const p of st.parts) v[p.role] = Number.isFinite(p.value) ? p.value * (1 + tol * (2 * rnd() - 1)) : p.value;
			return stageTf(st.topology, st.spec.band, v);
		});
		out.push(fHz.map((f) => 20 * Math.log10(Math.max(1e-300, tfs.reduce((m, tf) => m * Math.hypot(...complexParts(tfAt(tf, 2 * Math.PI * f))), 1)))));
	}
	return out;
}

const complexParts = (z: Complex): [number, number] => [z.re, z.im];

/**
 * Split an all-pole analog LP/HP/BP filter into stage specifications, ordered
 * by increasing Q (first-order section first). LP stages get no zeros, HP
 * stages zeros at the origin of their own order and BP stages one zero each.
 */
export function stageSpecs(zpk: ZPK, band: StageBand): StageSpec[] {
	return analogStages({ z: [], p: zpk.p, k: 1 }).map((st) => ({
		band: band === 'bandpass' && st.order === 1 ? 'lowpass' : band,
		order: st.order,
		w0: st.w0,
		q: st.q
	}));
}
