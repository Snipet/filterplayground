/**
 * Partial-fraction expansion (simple poles only), in the conventions of
 * scipy.signal.residuez (digital, powers of z⁻¹) and scipy.signal.residue
 * (analog, descending powers of s).
 */
import { type Complex, abs, c, div, mul, sub, add } from '$lib/dsp/complex';
import { cleanRealRoots, roots, trimLeading } from '$lib/dsp/poly';

export interface PartialFractions {
	/** Residue rᵢ belonging to pole pᵢ. */
	residues: Complex[];
	poles: Complex[];
	/**
	 * Direct terms. Digital: coefficients of z⁰, z⁻¹, … (an FIR part).
	 * Analog: polynomial in s, descending powers.
	 */
	direct: number[];
	/** True if two poles coincide (the simple-pole expansion does not apply). */
	repeated: boolean;
	/** Smallest relative distance between two poles. */
	minSeparation: number;
}

/** Polynomial long division with descending coefficient arrays: n = q·d + r, deg r < deg d. */
export function polydiv(n: readonly number[], d: readonly number[]): { q: number[]; r: number[] } {
	const dd = trimLeading(d);
	if (dd.length === 0 || dd[0] === 0) throw new Error('Division by the zero polynomial');
	const r = [...n];
	const nq = r.length - dd.length + 1;
	if (nq <= 0) return { q: [0], r };
	const q = new Array<number>(nq).fill(0);
	for (let i = 0; i < nq; i++) {
		const coef = r[i] / dd[0];
		q[i] = coef;
		for (let j = 0; j < dd.length; j++) r[i + j] -= coef * dd[j];
	}
	return { q, r: r.slice(nq) };
}

function separation(ps: readonly Complex[]): number {
	let min = Infinity;
	for (let i = 0; i < ps.length; i++)
		for (let j = i + 1; j < ps.length; j++) {
			const d = abs(sub(ps[i], ps[j])) / Math.max(1e-300, abs(ps[i]), abs(ps[j]));
			if (d < min) min = d;
		}
	return min;
}

/** Relative pole distance below which poles are treated as repeated. */
export const REPEATED_TOL = 1e-6;

/**
 * Digital partial fractions:
 *   H(z) = B(z)/A(z) = Σ rᵢ / (1 − pᵢ z⁻¹) + Σ kⱼ z⁻ʲ
 * `poles` may be passed in (e.g. from an accurate ZPK); otherwise A is rooted.
 */
export function residuez(
	bIn: readonly number[],
	aIn: readonly number[],
	poles?: readonly Complex[]
): PartialFractions {
	const a0 = aIn[0];
	if (!a0) throw new Error('a[0] must be non-zero');
	const b = bIn.map((v) => v / a0);
	let a = aIn.map((v) => v / a0);
	while (a.length > 1 && a[a.length - 1] === 0) a = a.slice(0, -1);
	const M = a.length - 1;
	if (M === 0)
		return { residues: [], poles: [], direct: [...b], repeated: false, minSeparation: Infinity };

	// direct terms: divide B(q) by A(q) in ascending powers of q = z⁻¹
	let R: number[] = [...b];
	let direct: number[] = [];
	if (b.length - 1 >= M) {
		const { q, r } = polydiv([...b].reverse(), [...a].reverse());
		direct = q.reverse();
		R = r.reverse();
	}
	while (R.length < M) R.push(0);

	let ps: Complex[] = poles ? poles.filter((p) => abs(p) > 0).map((p) => ({ ...p })) : [];
	if (ps.length !== M) ps = cleanRealRoots(roots(a));
	const minSep = separation(ps);
	if (minSep < REPEATED_TOL)
		return { residues: [], poles: ps, direct, repeated: true, minSeparation: minSep };

	const residues = ps.map((p, i) => {
		const qi = div(c(1), p);
		// R(qᵢ), ascending powers
		let num = c(0);
		let qp = c(1);
		for (const coef of R) {
			num = add(num, mul(qp, c(coef)));
			qp = mul(qp, qi);
		}
		let den = c(1);
		for (let j = 0; j < ps.length; j++) if (j !== i) den = mul(den, sub(c(1), div(ps[j], p)));
		return div(num, den);
	});
	return { residues, poles: ps, direct, repeated: false, minSeparation: minSep };
}

/**
 * Analog partial fractions:
 *   H(s) = B(s)/A(s) = Σ rᵢ / (s − pᵢ) + k(s)
 */
export function residue(
	bIn: readonly number[],
	aIn: readonly number[],
	poles?: readonly Complex[]
): PartialFractions {
	const aT = trimLeading(aIn);
	if (aT.length === 0 || aT[0] === 0) throw new Error('The denominator must be non-zero');
	const lead = aT[0];
	const a = aT.map((v) => v / lead);
	const b = trimLeading(bIn).map((v) => v / lead);
	const M = a.length - 1;
	if (M === 0)
		return { residues: [], poles: [], direct: b, repeated: false, minSeparation: Infinity };
	let R = [...b];
	let direct: number[] = [];
	if (b.length - 1 >= M) {
		const { q, r } = polydiv(b, a);
		direct = q;
		R = r;
	}
	let ps: Complex[] = poles ? poles.map((p) => ({ ...p })) : [];
	if (ps.length !== M) ps = cleanRealRoots(roots(a));
	const minSep = separation(ps);
	if (minSep < REPEATED_TOL)
		return { residues: [], poles: ps, direct, repeated: true, minSeparation: minSep };
	const residues = ps.map((p, i) => {
		let num = c(0);
		for (const coef of R) num = add(mul(num, p), c(coef));
		let den = c(1);
		for (let j = 0; j < ps.length; j++) if (j !== i) den = mul(den, sub(p, ps[j]));
		return div(num, den);
	});
	return { residues, poles: ps, direct, repeated: false, minSeparation: minSep };
}

/** h[n] reconstructed from a digital expansion: Σ rᵢ pᵢⁿ + k[n]. */
export function impulseFromResidues(pf: PartialFractions, n: number): number[] {
	const h = new Array<number>(n).fill(0);
	pf.residues.forEach((r, i) => {
		const p = pf.poles[i];
		let pn = c(1);
		for (let k = 0; k < n; k++) {
			h[k] += r.re * pn.re - r.im * pn.im;
			pn = mul(pn, p);
		}
	});
	pf.direct.forEach((v, k) => {
		if (k < n) h[k] += v;
	});
	return h;
}

/** H(s) reconstructed from an analog expansion at s. */
export function evalAnalogPfe(pf: PartialFractions, s: Complex): Complex {
	let h = c(0);
	for (const v of pf.direct) h = add(mul(h, s), c(v));
	pf.residues.forEach((r, i) => {
		h = add(h, div(r, sub(s, pf.poles[i])));
	});
	return h;
}
