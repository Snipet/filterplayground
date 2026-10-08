/**
 * Coefficients and sample-by-sample implementations of the classic filter
 * structures. Every structure exposes the contents of its delay elements so
 * the page can step through it.
 *
 * Conventions: b, a are coefficients of z⁰, z⁻¹, … with a₀ = 1.
 */
import { type Complex, abs } from '$lib/dsp/complex';
import { residuez } from '$lib/features/tf-analyzer/pfe';
import type { SOS } from '$lib/dsp/types';

export type StructureId =
	'df1' | 'df2' | 'tdf2' | 'cascade' | 'parallel' | 'lattice' | 'fir' | 'firt';

/** Fixed display order (also fixes each structure's series colour). */
export const STRUCTURE_IDS: StructureId[] = [
	'df1',
	'df2',
	'tdf2',
	'cascade',
	'parallel',
	'lattice',
	'fir',
	'firt'
];

export const STRUCTURE_NAMES: Record<StructureId, string> = {
	df1: 'Direct form I',
	df2: 'Direct form II',
	tdf2: 'Transposed direct form II',
	cascade: 'Cascade of SOS',
	parallel: 'Parallel form',
	lattice: 'Lattice',
	fir: 'FIR direct form',
	firt: 'FIR transposed form'
};

export interface Processor {
	/** Process one sample. */
	step(x: number): number;
	/** Delay-element contents (what the z⁻¹ boxes currently output). */
	state(): number[];
	reset(): void;
}

export interface Ops {
	mul: number;
	add: number;
	delay: number;
}

/** Normalise and trim: a₀ = 1, trailing exact zeros removed from a. */
export function normalizeTf(
	b: readonly number[],
	a: readonly number[]
): { b: number[]; a: number[] } {
	const a0 = a[0];
	if (!a0) throw new Error('a₀ must be non-zero');
	const bn = b.map((v) => v / a0);
	let an = a.map((v) => v / a0);
	while (an.length > 1 && an[an.length - 1] === 0) an = an.slice(0, -1);
	let bt = [...bn];
	while (bt.length > 1 && bt[bt.length - 1] === 0) bt = bt.slice(0, -1);
	return { b: bt, a: an };
}

const pad = (v: readonly number[], n: number) => [
	...v,
	...new Array(Math.max(0, n - v.length)).fill(0)
];

// ---------------------------------------------------------------------------
// Direct forms
// ---------------------------------------------------------------------------

export function df1(b: readonly number[], a: readonly number[]): Processor {
	const M = b.length - 1;
	const N = a.length - 1;
	const xs = new Array<number>(M).fill(0);
	const ys = new Array<number>(N).fill(0);
	return {
		step(x) {
			let y = b[0] * x;
			for (let k = 1; k <= M; k++) y += b[k] * xs[k - 1];
			for (let k = 1; k <= N; k++) y -= a[k] * ys[k - 1];
			for (let k = M - 1; k > 0; k--) xs[k] = xs[k - 1];
			for (let k = N - 1; k > 0; k--) ys[k] = ys[k - 1];
			if (M > 0) xs[0] = x;
			if (N > 0) ys[0] = y;
			return y;
		},
		state: () => [...xs, ...ys],
		reset() {
			xs.fill(0);
			ys.fill(0);
		}
	};
}

export function df2(bIn: readonly number[], aIn: readonly number[]): Processor {
	const K = Math.max(bIn.length, aIn.length) - 1;
	const b = pad(bIn, K + 1);
	const a = pad(aIn, K + 1);
	const w = new Array<number>(K).fill(0);
	return {
		step(x) {
			let wn = x;
			for (let k = 1; k <= K; k++) wn -= a[k] * w[k - 1];
			let y = b[0] * wn;
			for (let k = 1; k <= K; k++) y += b[k] * w[k - 1];
			for (let k = K - 1; k > 0; k--) w[k] = w[k - 1];
			if (K > 0) w[0] = wn;
			return y;
		},
		state: () => [...w],
		reset: () => w.fill(0)
	};
}

export function tdf2(bIn: readonly number[], aIn: readonly number[]): Processor {
	const K = Math.max(bIn.length, aIn.length) - 1;
	const b = pad(bIn, K + 1);
	const a = pad(aIn, K + 1);
	const s = new Array<number>(K).fill(0);
	return {
		step(x) {
			const y = b[0] * x + (K > 0 ? s[0] : 0);
			for (let k = 0; k < K - 1; k++) s[k] = b[k + 1] * x - a[k + 1] * y + s[k + 1];
			if (K > 0) s[K - 1] = b[K] * x - a[K] * y;
			return y;
		},
		state: () => [...s],
		reset: () => s.fill(0)
	};
}

// ---------------------------------------------------------------------------
// Cascade
// ---------------------------------------------------------------------------

/** Order of a section: highest power of z⁻¹ present in b or a. */
export function sectionOrder(row: readonly number[]): number {
	return row[2] !== 0 || row[5] !== 0 ? 2 : row[1] !== 0 || row[4] !== 0 ? 1 : 0;
}

/** Cascade of TDF-II sections with a₀ = 1 (as scipy.signal.sosfilt). */
export function cascade(sos: SOS): Processor {
	const secs = sos.map((r) => {
		const a0 = r[3] || 1;
		const n = r.map((v) => v / a0);
		const K = sectionOrder(n);
		return {
			b: n.slice(0, K + 1),
			a: [1, ...n.slice(4, 4 + K)],
			proc: tdf2(n.slice(0, K + 1), [1, ...n.slice(4, 4 + K)])
		};
	});
	return {
		step(x) {
			let v = x;
			for (const s of secs) v = s.proc.step(v);
			return v;
		},
		state: () => secs.flatMap((s) => s.proc.state()),
		reset: () => secs.forEach((s) => s.proc.reset())
	};
}

// ---------------------------------------------------------------------------
// Parallel form
// ---------------------------------------------------------------------------

export interface ParallelForm {
	/** Sections: numerator [β0, β1] (first order: [β0]), denominator [1, a1, a2] (first order: [1, a1]). */
	sections: { b: number[]; a: number[] }[];
	/** Direct (FIR) terms c₀ + c₁z⁻¹ + … */
	direct: number[];
}

/**
 * Partial-fraction expansion grouped into real first/second-order sections.
 * Throws if the poles are repeated.
 */
export function parallelForm(b: readonly number[], a: readonly number[]): ParallelForm {
	const pf = residuez(b, a);
	if (pf.repeated)
		throw new Error('The parallel form needs distinct poles; this filter has repeated poles.');
	const items = pf.poles.map((p, i) => ({ p, r: pf.residues[i] }));
	const sections: ParallelForm['sections'] = [];
	const used = new Array(items.length).fill(false);
	const realOnes: { p: number; r: number }[] = [];
	for (let i = 0; i < items.length; i++) {
		if (used[i]) continue;
		const { p, r } = items[i];
		const tol = 1e-9 * Math.max(1, abs(p));
		if (Math.abs(p.im) <= tol) {
			used[i] = true;
			realOnes.push({ p: p.re, r: r.re });
			continue;
		}
		// find the conjugate partner
		let j = -1;
		let best = Infinity;
		for (let k = i + 1; k < items.length; k++) {
			if (used[k]) continue;
			const d = Math.hypot(items[k].p.re - p.re, items[k].p.im + p.im);
			if (d < best) {
				best = d;
				j = k;
			}
		}
		used[i] = true;
		if (j >= 0) used[j] = true;
		const pp: Complex = p.im > 0 ? p : { re: p.re, im: -p.im };
		const rr: Complex = p.im > 0 ? r : { re: r.re, im: -r.im };
		// r/(1 − p q) + r*/(1 − p* q) = (2Re r − 2Re(r p*) q) / (1 − 2Re p q + |p|² q²)
		const b0 = 2 * rr.re;
		const b1 = -2 * (rr.re * pp.re + rr.im * pp.im);
		sections.push({ b: [b0, b1], a: [1, -2 * pp.re, pp.re * pp.re + pp.im * pp.im] });
	}
	realOnes.sort((x, y) => y.p - x.p);
	for (let i = 0; i + 1 < realOnes.length; i += 2) {
		const { p: p1, r: r1 } = realOnes[i];
		const { p: p2, r: r2 } = realOnes[i + 1];
		sections.push({ b: [r1 + r2, -(r1 * p2 + r2 * p1)], a: [1, -(p1 + p2), p1 * p2] });
	}
	if (realOnes.length % 2 === 1) {
		const { p, r } = realOnes[realOnes.length - 1];
		sections.push({ b: [r], a: [1, -p] });
	}
	let direct = [...pf.direct];
	while (direct.length > 1 && direct[direct.length - 1] === 0) direct = direct.slice(0, -1);
	return { sections, direct };
}

export function parallel(form: ParallelForm): Processor {
	const secs = form.sections.map((s) => tdf2(s.b, s.a));
	const fir = form.direct.length > 0 ? tdf2(form.direct, [1]) : null;
	return {
		step(x) {
			let y = 0;
			for (const s of secs) y += s.step(x);
			if (fir) y += fir.step(x);
			return y;
		},
		state: () => [...secs.flatMap((s) => s.state()), ...(fir ? fir.state() : [])],
		reset() {
			secs.forEach((s) => s.reset());
			fir?.reset();
		}
	};
}

// ---------------------------------------------------------------------------
// Lattice
// ---------------------------------------------------------------------------

/**
 * Step-down (backward Levinson) recursion: reflection coefficients k₁…k_N of a
 * monic polynomial A(z) = 1 + a₁z⁻¹ + … + a_N z⁻ᴺ. Also returns the
 * intermediate polynomials A_m (index m, length m + 1).
 */
export function reflectionCoefficients(aIn: readonly number[]): { k: number[]; polys: number[][] } {
	const a0 = aIn[0];
	const N = aIn.length - 1;
	const polys: number[][] = new Array(N + 1);
	let cur = aIn.map((v) => v / a0);
	polys[N] = cur;
	const k = new Array<number>(N).fill(0);
	for (let m = N; m >= 1; m--) {
		const km = cur[m];
		k[m - 1] = km;
		const den = 1 - km * km;
		if (Math.abs(den) < 1e-14)
			throw new Error(
				`|k${sub(m)}| = 1: the step-down recursion breaks down (a zero or pole lies exactly on the unit circle, or the taps are symmetric).`
			);
		const next = new Array<number>(m);
		for (let i = 0; i < m; i++) next[i] = (cur[i] - km * cur[m - i]) / den;
		cur = next;
		polys[m - 1] = cur;
	}
	return { k, polys };
}

const SUBS = '₀₁₂₃₄₅₆₇₈₉';
export const sub = (n: number) =>
	String(n)
		.split('')
		.map((d) => SUBS[Number(d)] ?? d)
		.join('');

export interface LatticeLadder {
	/** Reflection coefficients k₁…k_N. */
	k: number[];
	/** Ladder (tap) coefficients ν₀…ν_N. */
	v: number[];
}

/** Gray–Markel lattice–ladder coefficients for H(z) = B(z)/A(z). */
export function latticeLadder(bIn: readonly number[], aIn: readonly number[]): LatticeLadder {
	const N = Math.max(aIn.length, bIn.length) - 1;
	const a = pad(
		aIn.map((v) => v / aIn[0]),
		N + 1
	);
	const c = pad(
		bIn.map((v) => v / aIn[0]),
		N + 1
	);
	const { k, polys } = reflectionCoefficients(a);
	const v = new Array<number>(N + 1).fill(0);
	for (let m = N; m >= 0; m--) {
		v[m] = c[m];
		// subtract ν_m·B_m(z), where B_m has coefficients β_m(i) = α_m(m − i)
		const am = polys[m];
		for (let i = 0; i <= m; i++) c[i] -= v[m] * am[m - i];
	}
	return { k, v };
}

export function latticeLadderProc(ll: LatticeLadder): Processor {
	const N = ll.k.length;
	const g = new Array<number>(N).fill(0);
	const gn = new Array<number>(N + 1).fill(0);
	return {
		step(x) {
			let f = x;
			for (let m = N; m >= 1; m--) {
				f -= ll.k[m - 1] * g[m - 1];
				gn[m] = ll.k[m - 1] * f + g[m - 1];
			}
			gn[0] = f;
			let y = 0;
			for (let m = 0; m <= N; m++) y += ll.v[m] * gn[m];
			for (let m = 0; m < N; m++) g[m] = gn[m];
			return y;
		},
		state: () => [...g],
		reset: () => g.fill(0)
	};
}

export interface FirLattice {
	/** Overall gain h[0]. */
	h0: number;
	/** Reflection coefficients k₁…k_M. */
	k: number[];
}

export function firLattice(h: readonly number[]): FirLattice {
	if (h[0] === 0)
		throw new Error(
			'h[0] = 0: the FIR lattice needs a non-zero first tap (remove leading zeros, i.e. the pure delay, first).'
		);
	const { k } = reflectionCoefficients(h.map((v) => v / h[0]));
	return { h0: h[0], k };
}

export function firLatticeProc(fl: FirLattice): Processor {
	const M = fl.k.length;
	const g = new Array<number>(M).fill(0);
	const gn = new Array<number>(M).fill(0);
	return {
		step(x) {
			let f = x;
			if (M > 0) gn[0] = x;
			for (let m = 1; m <= M; m++) {
				const fm = f + fl.k[m - 1] * g[m - 1];
				const gm = fl.k[m - 1] * f + g[m - 1];
				f = fm;
				if (m < M) gn[m] = gm;
			}
			for (let m = 0; m < M; m++) g[m] = gn[m];
			return fl.h0 * f;
		},
		state: () => [...g],
		reset: () => g.fill(0)
	};
}

// ---------------------------------------------------------------------------
// FIR
// ---------------------------------------------------------------------------

export function firDirect(h: readonly number[]): Processor {
	const M = h.length - 1;
	const xs = new Array<number>(M).fill(0);
	return {
		step(x) {
			let y = h[0] * x;
			for (let k = 1; k <= M; k++) y += h[k] * xs[k - 1];
			for (let k = M - 1; k > 0; k--) xs[k] = xs[k - 1];
			if (M > 0) xs[0] = x;
			return y;
		},
		state: () => [...xs],
		reset: () => xs.fill(0)
	};
}

export function firTransposed(h: readonly number[]): Processor {
	return tdf2(h, [1]);
}

/** Run a processor over an input sequence (starting from rest). */
export function runProcessor(p: Processor, x: ArrayLike<number>): number[] {
	p.reset();
	const y: number[] = [];
	for (let n = 0; n < x.length; n++) y.push(p.step(x[n]));
	return y;
}

/** Record pre-update state, input and output for n = 0..len−1. */
export function trace(
	p: Processor,
	x: ArrayLike<number>
): { x: number; state: number[]; y: number }[] {
	p.reset();
	const rows: { x: number; state: number[]; y: number }[] = [];
	for (let n = 0; n < x.length; n++) {
		const state = p.state();
		const y = p.step(x[n]);
		rows.push({ x: x[n], state, y });
	}
	return rows;
}
