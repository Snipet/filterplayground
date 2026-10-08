/**
 * Summary numbers and formatting for the analog designer page, kept out of the
 * .svelte file so they can be unit-tested.
 */
import { familyInfo, type AnalogFamily } from '$lib/dsp/analog';
import { abs, format as fmtC, type Complex } from '$lib/dsp/complex';
import { evaluate, findCrossing, freqsZpk, toDb } from '$lib/dsp/response';
import { analogTimeResponse } from '$lib/dsp/time';
import type { ZPK } from '$lib/dsp/types';

/** Order limited to 1 … the family's maximum (higher orders are not reliable). */
export function clampOrder(order: number, family: AnalogFamily): number {
	return Math.min(familyInfo(family).maxOrder, Math.max(1, Math.round(order)));
}

/**
 * The −3 dB frequency of a low-pass or high-pass response (`relDb` relative to
 * its peak, on an ascending grid `f`). The grid is scanned in from the stopband
 * so the band-edge crossing is found: when Rp > 3 dB the passband ripple dips
 * below −3 dB as well, but the stopband never rises above it.
 *
 * Pass the design's `zpk` to get the exact crossing rather than a grid-limited
 * one. Next to a lightly damped pole (σ = −Re p) the response can rise above
 * −3 dB and fall back within a few σ, far less than a grid step (the last
 * elliptic ripple before the band edge is such a peak), so a coarse scan steps
 * over it and stops at a ripple crossing deeper in the passband. Samples are
 * therefore added around every pole, spaced at 10 % of the distance to it out
 * to where the grid is that fine; the scan then runs on the exact response,
 * relative to its refined peak, and the crossing is polished by bisection.
 */
export function bandEdge3dB(
	f: readonly number[],
	relDb: readonly number[],
	band: 'lowpass' | 'highpass',
	zpk?: ZPK
): number | null {
	const level = 10 * Math.log10(0.5); // half power, −3.0103 dB
	if (!zpk) {
		return band === 'lowpass'
			? findCrossing([...f].reverse(), [...relDb].reverse(), level)
			: findCrossing(f, relDb, level);
	}
	const n = f.length;
	if (n < 2) return null;
	const pts = [...f];
	for (const p of zpk.p) {
		if (!(p.im > 0 && p.re < 0)) continue;
		const fp = p.im / (2 * Math.PI);
		const sigma = -p.re / (2 * Math.PI);
		let i = 1;
		while (i < n - 1 && f[i] < fp) i++;
		const reach = 10 * (f[i] - f[i - 1]); // from here on the grid step is ≤ 10 % of the distance
		for (let j = 0, d = 0; d < reach; j++) {
			d = sigma * Math.sinh(0.1 * j); // spacing ≈ 0.1·√(d² + σ²)
			for (const x of d ? [fp - d, fp + d] : [fp]) if (x > f[0] && x < f[n - 1]) pts.push(x);
		}
	}
	pts.sort((a, b) => a - b);
	const magDb = (x: readonly number[]) =>
		freqsZpk(
			zpk,
			x.map((v) => 2 * Math.PI * v)
		).map((h) => toDb(abs(h)));
	const db = magDb(pts);
	// peak: the highest sample, refined by golden-section search between its
	// neighbours, or the gain at DC or at infinity (a low-pass peaks at f = 0)
	let top = 0;
	for (let k = 1; k < db.length; k++) if (db[k] > db[top]) top = k;
	let peak = Math.max(
		db[top],
		magDb([0])[0],
		zpk.z.length === zpk.p.length ? toDb(Math.abs(zpk.k)) : -Infinity
	);
	let [a, b] = [pts[Math.max(0, top - 1)], pts[Math.min(db.length - 1, top + 1)]];
	for (let it = 0; it < 80; it++) {
		const x1 = b - 0.618034 * (b - a);
		const x2 = a + 0.618034 * (b - a);
		const [d1, d2] = magDb([x1, x2]);
		peak = Math.max(peak, d1, d2);
		if (d1 > d2) b = x2;
		else a = x1;
	}
	// scan in from the stopband for the first sign change, then bisect
	const g = (v: number) => v - peak - level;
	const idx = (k: number) => (band === 'lowpass' ? db.length - 1 - k : k);
	for (let k = 1; k < db.length; k++) {
		let ga = g(db[idx(k - 1)]);
		if (ga === 0) return pts[idx(k - 1)];
		if (!(ga * g(db[idx(k)]) < 0)) continue;
		[a, b] = [pts[idx(k - 1)], pts[idx(k)]];
		while (Math.abs(b - a) > 1e-13 * Math.abs(b)) {
			const m = 0.5 * (a + b);
			const gm = g(magDb([m])[0]);
			if (gm === 0 || m === a || m === b) return m;
			if (gm < 0 === ga < 0) [a, ga] = [m, gm];
			else b = m;
		}
		return 0.5 * (a + b);
	}
	return null;
}

/**
 * Step-response overshoot (%) of an analog low-pass, measured against its exact
 * final value — the DC gain — rather than the last simulated sample, which has
 * not settled yet when far-away stopband zeros shorten the simulated window.
 */
export function stepOvershoot(zpk: ZPK, points = 800): number | null {
	const dc = evaluate({ kind: 'analog', zpk }, [0]).H[0].re;
	if (!(Math.abs(dc) > 1e-6)) return null;
	const step = analogTimeResponse(zpk, 'step', undefined, points);
	return Math.max(0, (Math.max(...step.y) / dc - 1) * 100);
}

/**
 * Format a root for a table that lists one root per conjugate pair: a complex
 * root stands for both, as `a ± bj`, or `±bj` when it lies on the jω axis.
 */
export function formatRoot(r: Complex, digits = 5): string {
	const isReal = Math.abs(r.im) < 1e-12 * Math.max(1, Math.abs(r.re));
	if (isReal) return fmtC(r, digits);
	const im = Number(Math.abs(r.im).toPrecision(digits));
	const onAxis = Math.abs(r.re) < 1e-12 * Math.max(1, Math.abs(r.im));
	return onAxis ? `±${im}j` : `${Number(r.re.toPrecision(digits))} ± ${im}j`;
}
