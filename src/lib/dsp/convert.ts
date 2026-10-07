/**
 * Conversions between ZPK, TF and SOS representations.
 */
import { type Complex, abs, c, conj, isReal } from './complex';
import { cleanRealRoots, polyFromRoots, polymul, roots, trimLeading } from './poly';
import type { DigitalFilter, SOS, TF, ZPK } from './types';

const cloneRoots = (rs: readonly Complex[]) => rs.map((r) => ({ re: r.re, im: r.im }));

// ---------------------------------------------------------------------------
// ZPK ↔ TF
// ---------------------------------------------------------------------------

/** Analog ZPK → TF (descending powers of s). */
export function zpk2tfAnalog(zpk: ZPK): TF {
	const b = polyFromRoots(zpk.z).map((v) => v * zpk.k);
	const a = polyFromRoots(zpk.p);
	return { b, a };
}

/**
 * Digital ZPK → TF in powers of z⁻¹. Zeros at infinity (fewer zeros than poles)
 * become leading zero coefficients in b (a pure delay), keeping H(z) exact.
 * Extra zeros (more zeros than poles) are treated as poles at the origin (causal).
 */
export function zpk2tf(zpk: ZPK): TF {
	const nz = zpk.z.length;
	const np = zpk.p.length;
	const n = Math.max(nz, np);
	const bz = polyFromRoots(zpk.z).map((v) => v * zpk.k);
	const ap = polyFromRoots(zpk.p);
	const b = [...new Array(n - nz).fill(0), ...bz];
	const a = [...ap, ...new Array(n - np).fill(0)];
	return { b, a };
}

/** Analog TF → ZPK. */
export function tf2zpkAnalog(tf: TF): ZPK {
	const b = trimLeading(tf.b);
	const a = trimLeading(tf.a);
	const z = cleanRealRoots(roots(b));
	const p = cleanRealRoots(roots(a));
	return { z, p, k: b[0] / a[0] };
}

/** Digital TF (powers of z⁻¹) → ZPK. */
export function tf2zpk(tf: TF): ZPK {
	// Strip trailing zeros of each polynomial (they correspond to roots at the origin
	// of the z-polynomial that cancel with the z^-n normalisation) and leading zeros.
	let b = [...tf.b];
	let a = [...tf.a];
	// leading zeros of b → delay → zeros at infinity
	let lead = 0;
	while (lead < b.length - 1 && b[lead] === 0) lead++;
	const k0 = b[lead];
	b = b.slice(lead);
	while (a.length > 1 && a[0] === 0) a = a.slice(1);
	// Express both as polynomials in z with a common power: multiply by z^N where N = max(len)-1
	const N = Math.max(tf.b.length, tf.a.length) - 1;
	// b: Σ b_k z^{-(k+lead)} → z^{N} · ... = poly in z of degree N - lead with coefficients b (descending)
	// followed by (N - lead - (len(b)-1)) trailing zeros (roots at the origin)
	const bPoly = [...b, ...new Array(Math.max(0, N - lead - (b.length - 1))).fill(0)];
	const aPoly = [...a, ...new Array(Math.max(0, N - (a.length - 1))).fill(0)];
	const z = cleanRealRoots(roots(bPoly));
	const p = cleanRealRoots(roots(aPoly));
	// remove common roots at the origin
	const zz = [...z];
	const pp = [...p];
	for (let i = zz.length - 1; i >= 0; i--) {
		if (abs(zz[i]) === 0) {
			const j = pp.findIndex((r) => abs(r) === 0);
			if (j >= 0) {
				zz.splice(i, 1);
				pp.splice(j, 1);
			}
		}
	}
	return { z: zz, p: pp, k: k0 / a[0] };
}

// ---------------------------------------------------------------------------
// SOS
// ---------------------------------------------------------------------------

/** Multiply out a cascade of digital sections into a single TF (powers of z⁻¹). */
export function sos2tf(sos: SOS): TF {
	let b = [1];
	let a = [1];
	for (const s of sos) {
		b = polymul(b, s.slice(0, 3));
		a = polymul(a, s.slice(3, 6));
	}
	// trim trailing zeros that appear in both (from first-order sections)
	while (b.length > 1 && a.length > 1 && b[b.length - 1] === 0 && a[a.length - 1] === 0) {
		b.pop();
		a.pop();
	}
	return { b, a };
}

/** Multiply out a cascade of analog sections (descending powers of s). */
export function sos2tfAnalog(sos: SOS): TF {
	let b = [1];
	let a = [1];
	for (const s of sos) {
		b = polymul(b, s.slice(0, 3));
		a = polymul(a, s.slice(3, 6));
	}
	return { b: trimLeading(b), a: trimLeading(a) };
}

export function sos2zpk(sos: SOS): ZPK {
	const z: Complex[] = [];
	const p: Complex[] = [];
	let k = 1;
	for (const s of sos) {
		const sec = tf2zpk({ b: s.slice(0, 3), a: s.slice(3, 6) });
		z.push(...sec.z);
		p.push(...sec.p);
		k *= sec.k;
	}
	return { z, p, k };
}

interface Split {
	cplx: Complex[]; // one representative (im > 0) of each conjugate pair
	real: number[];
}

function splitConj(rs: readonly Complex[]): Split {
	const cleaned = cleanRealRoots(rs);
	const cplx: Complex[] = [];
	const real: number[] = [];
	for (const r of cleaned) {
		if (isReal(r, 1e-10)) real.push(r.re);
		else if (r.im > 0) cplx.push(r);
	}
	return { cplx, real };
}

type Root = { v: Complex; real: boolean };

function nearestIndex(list: Root[], target: Complex, onlyReal: boolean): number {
	let best = -1;
	let bestD = Infinity;
	for (let i = 0; i < list.length; i++) {
		if (onlyReal && !list[i].real) continue;
		const d = Math.hypot(list[i].v.re - target.re, list[i].v.im - target.im);
		if (d < bestD) {
			bestD = d;
			best = i;
		}
	}
	return best;
}

/** Real polynomial (ascending z⁻¹ / descending s, length m+1) from a section's roots. */
function sectionPoly(rootsIn: Complex[]): number[] {
	return polyFromRoots(rootsIn);
}

/**
 * Digital ZPK → SOS using "nearest" pole/zero pairing (SciPy-style). Sections are
 * ordered so that the poles closest to the unit circle come last; all gain is in
 * the first section.
 */
export function zpk2sos(zpkIn: ZPK): SOS {
	const zs = cloneRoots(zpkIn.z);
	const ps = cloneRoots(zpkIn.p);
	// causal: extra zeros imply poles at the origin
	while (ps.length < zs.length) ps.push(c(0));
	if (ps.length === 0) return [[zpkIn.k, 0, 0, 1, 0, 0]];
	if (ps.length % 2 === 1) {
		ps.push(c(0));
		zs.push(c(0));
	}
	const pSplit = splitConj(ps);
	const zSplit = splitConj(zs);
	const poles: Root[] = [
		...pSplit.cplx.map((v) => ({ v, real: false })),
		...pSplit.real.map((r) => ({ v: c(r), real: true }))
	];
	const zeros: Root[] = [
		...zSplit.cplx.map((v) => ({ v, real: false })),
		...zSplit.real.map((r) => ({ v: c(r), real: true }))
	];
	const sections: { p: Complex[]; z: Complex[] }[] = [];
	while (poles.length > 0) {
		// pole closest to the unit circle
		let idx = 0;
		for (let i = 1; i < poles.length; i++)
			if (Math.abs(1 - abs(poles[i].v)) < Math.abs(1 - abs(poles[idx].v))) idx = i;
		const p1 = poles.splice(idx, 1)[0];
		let secP: Complex[];
		if (p1.real) {
			const j = nearestIndex(poles, p1.v, true);
			if (j >= 0) {
				const p2 = poles.splice(j, 1)[0];
				secP = [p1.v, p2.v];
			} else secP = [p1.v];
		} else secP = [p1.v, conj(p1.v)];

		const secZ: Complex[] = [];
		if (zeros.length > 0) {
			const zi = nearestIndex(zeros, p1.v, false);
			const z1 = zeros.splice(zi, 1)[0];
			if (!z1.real) secZ.push(z1.v, conj(z1.v));
			else {
				secZ.push(z1.v);
				const zj = nearestIndex(zeros, p1.v, true);
				if (zj >= 0 && secZ.length < secP.length) secZ.push(zeros.splice(zj, 1)[0].v);
			}
		}
		sections.push({ p: secP, z: secZ });
	}
	sections.reverse();
	const sos: SOS = sections.map(({ p, z }) => {
		const a = sectionPoly(p);
		const bz = sectionPoly(z);
		const a3 = [...a, ...new Array(3 - a.length).fill(0)];
		// zeros at infinity → delay: right-align numerator relative to the pole count
		const delay = p.length - z.length;
		const b3 = [...new Array(Math.max(0, delay)).fill(0), ...bz];
		while (b3.length < 3) b3.push(0);
		return [b3[0], b3[1], b3[2], a3[0], a3[1], a3[2]];
	});
	sos[0][0] *= zpkIn.k;
	sos[0][1] *= zpkIn.k;
	sos[0][2] *= zpkIn.k;
	return sos;
}

/** A first- or second-order analog stage produced by {@link analogStages}. */
export interface AnalogStage {
	poles: Complex[];
	zeros: Complex[];
	/** Natural frequency |p| in rad/s. */
	w0: number;
	/** Quality factor (0.5 for real poles; Infinity on the jω axis). */
	q: number;
	order: 1 | 2;
}

function poleQ(p: Complex): number {
	if (Math.abs(p.im) < 1e-12 * Math.max(1, abs(p))) return 0.5;
	return abs(p) / (2 * Math.abs(p.re));
}

/**
 * Split an analog ZPK into first/second-order stages ordered by increasing Q
 * (the usual ordering for active-filter cascades). Each stage is proper.
 */
export function analogStages(zpk: ZPK): AnalogStage[] {
	const pSplit = splitConj(zpk.p);
	const zSplit = splitConj(zpk.z);
	const groups: { poles: Complex[]; zeros: Complex[] }[] = [];
	for (const p of pSplit.cplx) groups.push({ poles: [p, conj(p)], zeros: [] });
	const reals = [...pSplit.real].sort((a, b) => b - a);
	for (let i = 0; i + 1 < reals.length; i += 2)
		groups.push({ poles: [c(reals[i]), c(reals[i + 1])], zeros: [] });
	if (reals.length % 2 === 1) groups.push({ poles: [c(reals[reals.length - 1])], zeros: [] });

	// complex zero pairs → nearest 2-pole stage with no zeros
	const cz = [...zSplit.cplx].sort((a, b) => abs(b) - abs(a));
	for (const z of cz) {
		let best = -1;
		let bestD = Infinity;
		groups.forEach((g, i) => {
			if (g.poles.length !== 2 || g.zeros.length !== 0) return;
			const d = Math.hypot(g.poles[0].re - z.re, Math.abs(g.poles[0].im) - z.im);
			if (d < bestD) {
				bestD = d;
				best = i;
			}
		});
		if (best < 0) {
			// improper: create a dummy group so information isn't lost
			groups.push({ poles: [], zeros: [z, conj(z)] });
		} else groups[best].zeros.push(z, conj(z));
	}
	for (const r of zSplit.real) {
		const z = c(r);
		let best = -1;
		let bestD = Infinity;
		groups.forEach((g, i) => {
			if (g.zeros.length >= g.poles.length) return;
			const d = Math.min(...g.poles.map((p) => Math.hypot(p.re - z.re, p.im - z.im)));
			if (d < bestD) {
				bestD = d;
				best = i;
			}
		});
		if (best < 0) groups.push({ poles: [], zeros: [z] });
		else groups[best].zeros.push(z);
	}
	const stages: AnalogStage[] = groups
		.filter((g) => g.poles.length > 0)
		.map((g) => {
			const order = g.poles.length as 1 | 2;
			const w0 = order === 2 ? Math.sqrt(abs(g.poles[0]) * abs(g.poles[1])) : abs(g.poles[0]);
			const q =
				order === 2
					? isReal(g.poles[0], 1e-10)
						? w0 / Math.abs(g.poles[0].re + g.poles[1].re)
						: poleQ(g.poles[0])
					: 0.5;
			return { poles: g.poles, zeros: g.zeros, w0, q, order };
		});
	stages.sort((a, b) => (a.order !== b.order ? a.order - b.order : a.q - b.q));
	return stages;
}

/**
 * Analog ZPK → SOS (descending powers of s). First-order stages use a0 = 0.
 * The overall gain is placed in the first section.
 */
export function zpk2sosAnalog(zpk: ZPK): SOS {
	const stages = analogStages(zpk);
	if (stages.length === 0) return [[0, 0, zpk.k, 0, 0, 1]];
	const sos = stages.map((st) => {
		const a = sectionPoly(st.poles);
		const b = sectionPoly(st.zeros);
		const a3 = [...new Array(3 - a.length).fill(0), ...a];
		const b3 = [...new Array(3 - b.length).fill(0), ...b];
		return [...b3, ...a3];
	});
	for (let i = 0; i < 3; i++) sos[0][i] *= zpk.k;
	return sos;
}

// ---------------------------------------------------------------------------
// Convenience accessors for DigitalFilter
// ---------------------------------------------------------------------------

export function digitalZpk(f: DigitalFilter): ZPK {
	if (f.zpk) return f.zpk;
	if (f.sos) return sos2zpk(f.sos);
	if (f.tf) return tf2zpk(f.tf);
	if (f.fir) return tf2zpk({ b: f.fir, a: [1] });
	return { z: [], p: [], k: 1 };
}

export function digitalSos(f: DigitalFilter): SOS {
	if (f.sos) return f.sos;
	return zpk2sos(digitalZpk(f));
}

export function digitalTf(f: DigitalFilter): TF {
	if (f.tf) return f.tf;
	if (f.fir) return { b: f.fir, a: [1] };
	if (f.sos) return sos2tf(f.sos);
	if (f.zpk) return zpk2tf(f.zpk);
	return { b: [1], a: [1] };
}

/** True if every pole is strictly inside the unit circle (digital) / left half-plane (analog). */
export function isStable(zpk: ZPK, kind: 'analog' | 'digital'): boolean {
	return zpk.p.every((p) => (kind === 'analog' ? p.re < 0 : abs(p) < 1));
}

/** Gain-normalise a digital SOS so that each section's numerator has unit leading magnitude. */
export function normalizeSos(sos: SOS): SOS {
	return sos.map((s) => {
		const a0 = s[3] || 1;
		return s.map((v) => v / a0);
	});
}
