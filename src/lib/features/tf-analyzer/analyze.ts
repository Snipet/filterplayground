/**
 * Build a filter model from any input representation and derive the
 * properties shown by the Transfer Function Analyzer.
 */
import { type Complex, abs, c, isReal } from '$lib/dsp/complex';
import {
	sos2tf,
	sos2tfAnalog,
	sos2zpk,
	tf2zpk,
	tf2zpkAnalog,
	zpk2sos,
	zpk2sosAnalog,
	zpk2tf,
	zpk2tfAnalog
} from '$lib/dsp/convert';
import { cleanRealRoots, roots, trimLeading } from '$lib/dsp/poly';
import { evaluate, linspace, logspace } from '$lib/dsp/response';
import { characteristicFrequency } from '$lib/dsp/time';
import type { DigitalFilter, Filter, SOS, TF, ZPK } from '$lib/dsp/types';

export type Domain = 'analog' | 'digital';
export type InputForm = 'ba' | 'sos' | 'zpk' | 'fir';

export interface Model {
	domain: Domain;
	fs: number;
	form: InputForm;
	zpk: ZPK;
	/** Digital: powers of z⁻¹. Analog: descending powers of s. */
	tf: TF;
	sos: SOS;
	/** FIR taps when the filter has no poles away from the origin. */
	fir: number[] | null;
	/** The filter in the representation that was entered (used for plots). */
	filter: Filter;
	notes: string[];
}

export interface RawInput {
	b?: number[];
	a?: number[];
	sos?: number[][];
	z?: Complex[];
	p?: Complex[];
	k?: number;
	taps?: number[];
}

/** Analog SOS (descending powers of s per row) → ZPK. */
export function sos2zpkAnalog(sos: SOS): ZPK {
	const z: Complex[] = [];
	const p: Complex[] = [];
	let k = 1;
	for (const row of sos) {
		const b = trimLeading(row.slice(0, 3));
		const a = trimLeading(row.slice(3, 6));
		if (a.length === 0 || a[0] === 0) throw new Error('A section has an all-zero denominator.');
		if (b.length === 0 || b[0] === 0) {
			k = 0;
			continue;
		}
		z.push(...cleanRealRoots(roots(b)));
		p.push(...cleanRealRoots(roots(a)));
		k *= b[0] / a[0];
	}
	return { z, p, k };
}

function firFromTf(tf: TF): number[] | null {
	const a0 = tf.a[0];
	if (!a0) return null;
	for (let i = 1; i < tf.a.length; i++) if (tf.a[i] !== 0) return null;
	return tf.b.map((v) => v / a0);
}

export function buildModel(domain: Domain, fs: number, form: InputForm, raw: RawInput): Model {
	const notes: string[] = [];
	if (domain === 'digital') {
		let zpk: ZPK;
		let tf: TF;
		let sos: SOS;
		let filter: DigitalFilter;
		switch (form) {
			case 'ba': {
				const b = raw.b!;
				const a = raw.a!;
				if (a[0] === 0)
					throw new Error(
						'a₀ must be non-zero — with a₀ = 0 the difference equation cannot be solved for y[n] (the filter would not be causal).'
					);
				if (b.every((v) => v === 0)) throw new Error('The numerator is all zeros: H(z) = 0.');
				tf = { b: [...b], a: [...a] };
				zpk = tf2zpk(tf);
				sos = zpk2sos(zpk);
				filter = { kind: 'digital', fs, tf };
				break;
			}
			case 'sos': {
				const rows = raw.sos!;
				rows.forEach((r, i) => {
					if (r[3] === 0) throw new Error(`Section ${i + 1}: a₀ must be non-zero.`);
				});
				sos = rows.map((r) => [...r]);
				tf = sos2tf(sos);
				zpk = sos2zpk(sos);
				filter = { kind: 'digital', fs, sos };
				break;
			}
			case 'zpk': {
				zpk = { z: raw.z!, p: raw.p!, k: raw.k! };
				if (zpk.z.length > zpk.p.length)
					notes.push(
						`More zeros than poles: H(z) would be non-causal, so ${zpk.z.length - zpk.p.length} pole(s) at z = 0 were added (a delay that makes it causal).`
					);
				if (zpk.k === 0) throw new Error('The gain k is zero: H(z) = 0.');
				tf = zpk2tf(zpk);
				sos = zpk2sos(zpk);
				const p = [...zpk.p];
				while (p.length < zpk.z.length) p.push(c(0));
				zpk = { ...zpk, p };
				filter = { kind: 'digital', fs, zpk };
				break;
			}
			case 'fir': {
				const taps = raw.taps!;
				if (taps.every((v) => v === 0)) throw new Error('All taps are zero.');
				if (taps.length > 400)
					throw new Error(
						'Please keep FIR filters to at most 400 taps here (the roots of very long polynomials are not meaningful to tabulate).'
					);
				tf = { b: [...taps], a: [1] };
				zpk = tf2zpk(tf);
				sos = zpk2sos(zpk);
				filter = { kind: 'digital', fs, fir: [...taps] };
				break;
			}
		}
		return { domain, fs, form, zpk, tf, sos, fir: firFromTf(tf), filter, notes };
	}

	// analog
	let zpk: ZPK;
	let tf: TF;
	let sos: SOS;
	switch (form) {
		case 'ba': {
			const b = trimLeading(raw.b!);
			const a = trimLeading(raw.a!);
			if (a.length === 0 || a.every((v) => v === 0))
				throw new Error('The denominator is all zeros.');
			if (b.every((v) => v === 0)) throw new Error('The numerator is all zeros: H(s) = 0.');
			tf = { b, a };
			zpk = tf2zpkAnalog(tf);
			sos = zpk2sosAnalog(zpk);
			break;
		}
		case 'sos': {
			sos = raw.sos!.map((r) => [...r]);
			zpk = sos2zpkAnalog(sos);
			tf = sos2tfAnalog(sos);
			break;
		}
		case 'zpk':
		default: {
			zpk = { z: raw.z!, p: raw.p!, k: raw.k! };
			if (zpk.k === 0) throw new Error('The gain k is zero: H(s) = 0.');
			tf = zpk2tfAnalog(zpk);
			sos = zpk2sosAnalog(zpk);
			break;
		}
	}
	if (zpk.z.length > zpk.p.length)
		notes.push(
			`H(s) is improper (${zpk.z.length} zeros, ${zpk.p.length} poles): its gain grows without bound at high frequencies, so it is not physically realisable on its own.`
		);
	return { domain, fs, form, zpk, tf, sos, fir: null, filter: { kind: 'analog', zpk }, notes };
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

export type Tri = 'yes' | 'no' | 'boundary';

export interface Properties {
	order: number;
	stability: 'stable' | 'marginal' | 'unstable';
	/** Digital: max |p|. Analog: max Re p. */
	worstPole: number | null;
	minPhase: { status: Tri; delay: number; reason: string };
	allPass: { status: boolean; rippleDb: number };
	linearPhase: { status: 'yes' | 'no' | 'n/a'; type?: 'I' | 'II' | 'III' | 'IV'; reason: string };
	dcGain: number;
	nyquistGain: number | null;
	peak: { f: number; mag: number; atInfinity?: boolean };
	minus3: number[];
	sections: number;
}

const unitTol = 1e-9;

function magAt(model: Model, f: number): number {
	return evaluate(model.filter, [f]).mag[0];
}

/**
 * |H| of a digital filter at exactly z = 1 (DC) or z = −1 (fs/2), in real arithmetic.
 * e^{jπ} from cos/sin is −1 + 1.2e-16j, just off the unit circle, which turns a pole at
 * z = −1 into a huge finite gain, and a complex 1/0 times another factor gives NaN.
 */
function magAtUnit(f: DigitalFilter, z: 1 | -1): number {
	// Horner in z⁻¹ = z
	const at = (p: readonly number[]) => p.reduceRight((s, v) => s * z + v, 0);
	if (f.sos)
		return Math.abs(f.sos.reduce((h, s) => h * (at(s.slice(0, 3)) / at(s.slice(3, 6))), 1));
	if (f.zpk) {
		let h = Math.abs(f.zpk.k);
		for (const q of f.zpk.z) h *= Math.hypot(z - q.re, q.im);
		for (const p of f.zpk.p) h /= Math.hypot(z - p.re, p.im);
		return h;
	}
	const tf = f.fir ? { b: f.fir, a: [1] } : f.tf!;
	return Math.abs(at(tf.b) / at(tf.a));
}

/** Frequency grid that resolves both very narrow low-frequency features and the full band. */
export function analysisGrid(model: Model): number[] {
	if (model.domain === 'digital') {
		const nyq = model.fs / 2;
		const g = [...linspace(0, nyq, 3001), ...logspace(nyq * 1e-6, nyq, 3000)];
		return g.sort((x, y) => x - y);
	}
	const fc = characteristicFrequency(model.zpk) / (2 * Math.PI);
	return logspace(fc * 1e-5, fc * 1e5, 6000);
}

function refineMax(model: Model, lo: number, hi: number): { f: number; mag: number } {
	const g = (Math.sqrt(5) - 1) / 2;
	let a = lo;
	let b = hi;
	let x1 = b - g * (b - a);
	let x2 = a + g * (b - a);
	let f1 = magAt(model, x1);
	let f2 = magAt(model, x2);
	for (let i = 0; i < 80 && b - a > 1e-12 * Math.max(1, Math.abs(b)); i++) {
		if (f1 < f2) {
			a = x1;
			x1 = x2;
			f1 = f2;
			x2 = a + g * (b - a);
			f2 = magAt(model, x2);
		} else {
			b = x2;
			x2 = x1;
			f2 = f1;
			x1 = b - g * (b - a);
			f1 = magAt(model, x1);
		}
	}
	const f = (a + b) / 2;
	return { f, mag: magAt(model, f) };
}

function refineCrossing(model: Model, lo: number, hi: number, levelDb: number): number {
	const v = (f: number) => 20 * Math.log10(Math.max(magAt(model, f), 1e-300)) - levelDb;
	let a = lo;
	let b = hi;
	let fa = v(a);
	for (let i = 0; i < 70; i++) {
		const m = (a + b) / 2;
		const fm = v(m);
		if (fa * fm <= 0) b = m;
		else {
			a = m;
			fa = fm;
		}
	}
	return (a + b) / 2;
}

export function linearPhaseOf(h: readonly number[]): {
	kind: 'symmetric' | 'antisymmetric' | null;
	type?: 'I' | 'II' | 'III' | 'IV';
} {
	let s = 0;
	let e = h.length - 1;
	while (s < e && h[s] === 0) s++;
	while (e > s && h[e] === 0) e--;
	const t = h.slice(s, e + 1);
	const N = t.length;
	const max = Math.max(...t.map(Math.abs));
	if (N <= 1) return { kind: 'symmetric', type: 'I' };
	const tol = 1e-9 * max;
	let sym = true;
	let anti = true;
	for (let n = 0; n < N; n++) {
		if (Math.abs(t[n] - t[N - 1 - n]) > tol) sym = false;
		if (Math.abs(t[n] + t[N - 1 - n]) > tol) anti = false;
	}
	if (sym) return { kind: 'symmetric', type: N % 2 === 1 ? 'I' : 'II' };
	if (anti) return { kind: 'antisymmetric', type: N % 2 === 1 ? 'III' : 'IV' };
	return { kind: null };
}

export function analyze(model: Model): Properties {
	const { zpk, domain } = model;
	const digital = domain === 'digital';

	// order: number of poles of the causal realisation (digital) / degree of A(s)
	const order = digital ? Math.max(zpk.p.length, zpk.z.length) : zpk.p.length;

	// stability
	let stability: Properties['stability'] = 'stable';
	let worstPole: number | null = null;
	if (zpk.p.length) {
		if (digital) {
			worstPole = Math.max(...zpk.p.map(abs));
			if (worstPole > 1 + unitTol) stability = 'unstable';
			else if (worstPole >= 1 - unitTol) {
				// repeated poles on the unit circle are unstable, simple ones marginal
				const onCircle = zpk.p.filter((p) => Math.abs(abs(p) - 1) < unitTol);
				const repeated = onCircle.some((p, i) =>
					onCircle.some((q, j) => j !== i && Math.hypot(p.re - q.re, p.im - q.im) < 1e-6)
				);
				stability = repeated ? 'unstable' : 'marginal';
			}
		} else {
			worstPole = Math.max(...zpk.p.map((p) => p.re));
			const scale = Math.max(1e-300, ...zpk.p.map(abs));
			if (worstPole > unitTol * scale) stability = 'unstable';
			else if (worstPole >= -unitTol * scale) {
				const onAxis = zpk.p.filter((p) => Math.abs(p.re) <= unitTol * scale);
				const repeated = onAxis.some((p, i) =>
					onAxis.some((q, j) => j !== i && Math.hypot(p.re - q.re, p.im - q.im) < 1e-6 * scale)
				);
				stability = repeated ? 'unstable' : 'marginal';
			}
		}
	}
	if (!digital && zpk.z.length > zpk.p.length) stability = 'unstable';

	// minimum phase
	let minPhase: Properties['minPhase'];
	{
		const delay = digital ? Math.max(0, zpk.p.length - zpk.z.length) : 0;
		let outside = 0;
		let on = 0;
		for (const z of zpk.z) {
			if (digital) {
				const m = abs(z);
				if (m > 1 + unitTol) outside++;
				else if (m >= 1 - unitTol) on++;
			} else {
				const sc = Math.max(1, abs(z));
				if (z.re > unitTol * sc) outside++;
				else if (z.re >= -unitTol * sc) on++;
			}
		}
		const where = digital ? 'outside the unit circle' : 'in the right half-plane';
		const onWhere = digital ? 'on the unit circle' : 'on the jω axis';
		if (outside > 0)
			minPhase = {
				status: 'no',
				delay,
				reason: `${outside} zero${outside > 1 ? 's' : ''} ${where}`
			};
		else if (on > 0)
			minPhase = {
				status: 'boundary',
				delay,
				reason: `${on} zero${on > 1 ? 's' : ''} ${onWhere} (not strictly minimum phase)`
			};
		else if (delay > 0)
			minPhase = {
				status: 'boundary',
				delay,
				reason: `minimum phase apart from a pure delay of ${delay} sample${delay > 1 ? 's' : ''}`
			};
		else
			minPhase = {
				status: 'yes',
				delay,
				reason: digital ? 'all zeros inside the unit circle' : 'all zeros in the left half-plane'
			};
		if (stability !== 'stable' && minPhase.status === 'yes')
			minPhase = {
				...minPhase,
				status: 'boundary',
				reason: 'zeros are fine, but the filter is not stable'
			};
	}

	// frequency scan
	const grid = analysisGrid(model);
	const r = evaluate(model.filter, grid);
	const mags = r.mag;

	// all-pass
	let lo = Infinity;
	let hi = -Infinity;
	for (const v of r.magDb) {
		if (!Number.isFinite(v)) {
			lo = -Infinity;
			hi = Infinity;
			break;
		}
		lo = Math.min(lo, v);
		hi = Math.max(hi, v);
	}
	const rippleDb = hi - lo;
	const allPass = { status: Number.isFinite(rippleDb) && rippleDb < 0.01, rippleDb };

	// linear phase
	let linearPhase: Properties['linearPhase'];
	if (!digital)
		linearPhase = {
			status: 'n/a',
			reason: 'A rational H(s) cannot have exactly linear phase (only approximately, e.g. Bessel).'
		};
	else if (model.fir) {
		const lp = linearPhaseOf(model.fir);
		if (lp.kind)
			linearPhase = {
				status: 'yes',
				type: lp.type,
				reason: `${lp.kind === 'symmetric' ? 'Symmetric' : 'Antisymmetric'} impulse response → type ${lp.type}`
			};
		else
			linearPhase = {
				status: 'no',
				reason: 'FIR, but the impulse response is neither symmetric nor antisymmetric'
			};
	} else
		linearPhase = {
			status: 'no',
			reason: 'IIR: poles away from the origin rule out exact linear phase'
		};

	// DC / Nyquist
	const dcGain = digital ? magAtUnit(model.filter as DigitalFilter, 1) : dcAnalog(zpk);
	const nyquistGain = digital ? magAtUnit(model.filter as DigitalFilter, -1) : null;

	// peak: the first infinite sample (a pole on the unit circle / jω axis) wins;
	// NaN samples (0/0 where a zero sits on a pole) are skipped
	let peak: Properties['peak'];
	let imax = 0;
	for (let i = 1; i < mags.length; i++)
		if (mags[i] > mags[imax] || Number.isNaN(mags[imax])) imax = i;
	if (mags[imax] === Infinity) peak = { f: grid[imax], mag: Infinity };
	else {
		const loF = grid[Math.max(0, imax - 1)];
		const hiF = grid[Math.min(grid.length - 1, imax + 1)];
		peak = hiF > loF ? refineMax(model, loF, hiF) : { f: grid[imax], mag: mags[imax] };
		if (peak.mag < mags[imax]) peak = { f: grid[imax], mag: mags[imax] };
		// A maximum at an end of the band (a low-pass at DC, a high-pass at fs/2 or f → ∞)
		// is exact there; the search above only follows rounding noise in the flat top.
		if (digital) {
			if (dcGain >= peak.mag * (1 - 1e-12)) peak = { f: 0, mag: dcGain };
			else if (nyquistGain! >= peak.mag * (1 - 1e-12))
				peak = { f: model.fs / 2, mag: nyquistGain! };
		} else {
			if (dcGain >= peak.mag * (1 - 1e-12)) peak = { f: 0, mag: dcGain };
			const hf = highFreqLimit(zpk);
			if (hf >= peak.mag * (1 - 1e-9)) peak = { f: Infinity, mag: hf, atInfinity: true };
		}
	}

	// −3 dB points relative to the peak
	const minus3: number[] = [];
	if (Number.isFinite(peak.mag) && peak.mag > 0 && !allPass.status) {
		const level = 20 * Math.log10(peak.mag) - 3.0103;
		for (let i = 1; i < grid.length && minus3.length < 8; i++) {
			const a = r.magDb[i - 1] - level;
			const b = r.magDb[i] - level;
			if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
			if (a === 0 && i === 1) minus3.push(grid[0]);
			if (a * b < 0 || (b === 0 && a !== 0)) {
				if (grid[i] === grid[i - 1]) continue;
				const f = refineCrossing(model, grid[i - 1], grid[i], level);
				if (!minus3.some((m) => Math.abs(m - f) <= 1e-9 * Math.max(1, f))) minus3.push(f);
			}
		}
	}

	return {
		order,
		stability,
		worstPole,
		minPhase,
		allPass,
		linearPhase,
		dcGain,
		nyquistGain,
		peak,
		minus3,
		sections: model.sos.length
	};
}

function dcAnalog(zpk: ZPK): number {
	if (zpk.z.some((z) => abs(z) === 0)) return 0;
	if (zpk.p.some((p) => abs(p) === 0)) return Infinity;
	let h = Math.abs(zpk.k);
	for (const z of zpk.z) h *= abs(z);
	for (const p of zpk.p) h /= abs(p);
	return h;
}

function highFreqLimit(zpk: ZPK): number {
	const d = zpk.z.length - zpk.p.length;
	if (d > 0) return Infinity;
	if (d < 0) return 0;
	return Math.abs(zpk.k);
}

// ---------------------------------------------------------------------------
// Pole / zero table
// ---------------------------------------------------------------------------

export interface RootRow {
	kind: 'pole' | 'zero';
	value: Complex;
	/** True if this row stands for a conjugate pair ± im. */
	pair: boolean;
	multiplicity: number;
	mag: number;
	/** Angle in degrees (digital) or natural frequency in Hz (analog). */
	angleDeg: number;
	freqHz: number;
	q: number | null;
	/** Time for the mode to decay by 60 dB (poles only), seconds. */
	t60: number | null;
}

export function rootRows(model: Model): RootRow[] {
	const rows: RootRow[] = [];
	const digital = model.domain === 'digital';
	const add = (list: Complex[], kind: 'pole' | 'zero') => {
		const groups: { v: Complex; count: number; pair: boolean }[] = [];
		for (const r of list) {
			if (
				r.im < -1e-12 * Math.max(1, abs(r)) &&
				list.some(
					(s) =>
						Math.abs(s.re - r.re) < 1e-9 * Math.max(1, abs(r)) &&
						Math.abs(s.im + r.im) < 1e-9 * Math.max(1, abs(r))
				)
			)
				continue;
			const pair = !isReal(r, 1e-12);
			const v = pair ? { re: r.re, im: Math.abs(r.im) } : { re: r.re, im: 0 };
			const tol = 1e-7 * Math.max(1, abs(v));
			const g = groups.find((x) => Math.abs(x.v.re - v.re) < tol && Math.abs(x.v.im - v.im) < tol);
			if (g) g.count++;
			else groups.push({ v, count: 1, pair });
		}
		for (const g of groups) {
			const m = abs(g.v);
			let angleDeg: number;
			let freqHz: number;
			let q: number | null = null;
			let t60: number | null = null;
			if (digital) {
				const th = Math.atan2(g.v.im, g.v.re);
				angleDeg = (th * 180) / Math.PI;
				freqHz = (Math.abs(th) * model.fs) / (2 * Math.PI);
				if (m > 0) {
					const lr = Math.log(m);
					if (g.pair) q = Math.abs(lr) < 1e-10 ? Infinity : Math.hypot(lr, th) / (2 * Math.abs(lr));
					if (kind === 'pole' && m < 1) t60 = (-3 * Math.LN10) / lr / model.fs;
				}
			} else {
				angleDeg = (Math.atan2(g.v.im, g.v.re) * 180) / Math.PI;
				freqHz = m / (2 * Math.PI);
				if (g.pair) q = Math.abs(g.v.re) <= 1e-12 * m ? Infinity : m / (2 * Math.abs(g.v.re));
				if (kind === 'pole' && g.v.re < 0) t60 = (3 * Math.LN10) / -g.v.re;
			}
			rows.push({
				kind,
				value: g.v,
				pair: g.pair,
				multiplicity: g.count,
				mag: m,
				angleDeg,
				freqHz,
				q,
				t60
			});
		}
	};
	add(model.zpk.p, 'pole');
	add(model.zpk.z, 'zero');
	return rows;
}

// ---------------------------------------------------------------------------
// Coefficient sensitivity: what printing the coefficients with d digits does
// ---------------------------------------------------------------------------

export interface SensitivityRow {
	digits: number;
	ba: { maxRadius: number; shift: number };
	sos: { maxRadius: number; shift: number };
}

const roundSig = (v: number, d: number) => (v === 0 ? 0 : Number(v.toPrecision(d)));

/** Largest distance from each reference root to its (greedily matched) counterpart. */
export function maxRootShift(ref: readonly Complex[], moved: readonly Complex[]): number {
	const used = new Array(moved.length).fill(false);
	let worst = 0;
	for (const r of ref) {
		let best = -1;
		let bestD = Infinity;
		moved.forEach((m, i) => {
			if (used[i]) return;
			const d = Math.hypot(m.re - r.re, m.im - r.im);
			if (d < bestD) {
				bestD = d;
				best = i;
			}
		});
		if (best >= 0) used[best] = true;
		worst = Math.max(worst, bestD);
	}
	return worst;
}

/**
 * Round the denominator coefficients to `digits` significant digits — once as
 * a single polynomial (b/a) and once per second-order section — and report how
 * far the poles move.
 */
export function sensitivity(model: Model, digitsList = [4, 6, 8, 10, 12]): SensitivityRow[] {
	const ref = model.zpk.p.filter((p) => abs(p) > 0);
	if (model.domain !== 'digital' || ref.length < 2) return [];
	const a0 = model.tf.a[0];
	const a = model.tf.a.map((v) => v / a0);
	return digitsList.map((d) => {
		const ar = a.map((v) => roundSig(v, d));
		const pBa = cleanRealRoots(roots(ar)).filter((p) => abs(p) > 0);
		const pSos: Complex[] = [];
		for (const row of model.sos) {
			const den = row.slice(3, 6).map((v) => roundSig(v / row[3], d));
			pSos.push(...cleanRealRoots(roots(trimTrailingZeros(den))));
		}
		const sosNz = pSos.filter((p) => abs(p) > 0);
		return {
			digits: d,
			ba: { maxRadius: Math.max(...pBa.map(abs)), shift: maxRootShift(ref, pBa) },
			sos: { maxRadius: Math.max(...sosNz.map(abs)), shift: maxRootShift(ref, sosNz) }
		};
	});
}

function trimTrailingZeros(p: number[]): number[] {
	const out = [...p];
	while (out.length > 1 && out[out.length - 1] === 0) out.pop();
	return out;
}
