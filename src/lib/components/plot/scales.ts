/** Scale and tick helpers for the SVG plot components. */
import { formatFreqTick, trimNumber } from '$lib/dsp/units';

export type ScaleType = 'linear' | 'log';

export interface Scale {
	type: ScaleType;
	domain: [number, number];
	range: [number, number];
	(v: number): number;
	invert(px: number): number;
}

export function makeScale(
	type: ScaleType,
	domain: [number, number],
	range: [number, number]
): Scale {
	const [d0, d1] = domain;
	const [r0, r1] = range;
	let fn: (v: number) => number;
	let inv: (px: number) => number;
	if (type === 'log') {
		const l0 = Math.log10(Math.max(d0, 1e-300));
		const l1 = Math.log10(Math.max(d1, 1e-300));
		const k = (r1 - r0) / (l1 - l0 || 1);
		fn = (v) => r0 + (Math.log10(v) - l0) * k;
		inv = (px) => Math.pow(10, l0 + (px - r0) / k);
	} else {
		const k = (r1 - r0) / (d1 - d0 || 1);
		fn = (v) => r0 + (v - d0) * k;
		inv = (px) => d0 + (px - r0) / k;
	}
	const s = fn as Scale;
	s.type = type;
	s.domain = domain;
	s.range = range;
	s.invert = inv;
	return s;
}

export function niceStep(span: number, count: number): number {
	const raw = span / Math.max(1, count);
	const mag = Math.pow(10, Math.floor(Math.log10(raw)));
	const norm = raw / mag;
	const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
	return step * mag;
}

export function linearTicks(d0: number, d1: number, count: number): number[] {
	if (!(d1 > d0)) return [d0];
	const step = niceStep(d1 - d0, count);
	const start = Math.ceil(d0 / step - 1e-9) * step;
	const ticks: number[] = [];
	for (let v = start; v <= d1 + step * 1e-9; v += step)
		ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
	return ticks;
}

export interface LogTicks {
	major: number[];
	minor: number[];
	labelled: number[];
}

export function logTicks(d0: number, d1: number, pixelWidth: number): LogTicks {
	const major: number[] = [];
	const minor: number[] = [];
	const k0 = Math.floor(Math.log10(d0));
	const k1 = Math.ceil(Math.log10(d1));
	const decades = Math.log10(d1 / d0);
	const pxPerDecade = pixelWidth / Math.max(decades, 1e-9);
	for (let k = k0; k <= k1; k++) {
		const base = Math.pow(10, k);
		for (let m = 1; m <= 9; m++) {
			const v = m * base;
			if (v < d0 * (1 - 1e-9) || v > d1 * (1 + 1e-9)) continue;
			(m === 1 ? major : minor).push(v);
		}
	}
	let labelled = [...major];
	if (pxPerDecade > 220) labelled = [...major, ...minor.filter((v) => [2, 5].includes(leading(v)))];
	else if (pxPerDecade > 130) labelled = [...major, ...minor.filter((v) => leading(v) === 3)];
	// thin out labels when decades are cramped
	if (pxPerDecade < 40) labelled = major.filter((_, i) => i % Math.ceil(40 / pxPerDecade) === 0);
	// with less than one decade visible, fall back to linear-style labels
	if (major.length + labelled.length < 2) {
		labelled = linearTicks(d0, d1, Math.max(2, Math.floor(pixelWidth / 80)));
		minor.length = 0;
		minor.push(...labelled);
	}
	return { major, minor, labelled: labelled.sort((a, b) => a - b) };
}

const leading = (v: number) => Math.round(v / Math.pow(10, Math.floor(Math.log10(v) + 1e-9)));

export const defaultFormat = (v: number): string => trimNumber(v, 4);
export const freqFormat = (v: number): string => formatFreqTick(v);

/** Index of the element of a sorted array nearest to v. */
export function nearestIndex(xs: ArrayLike<number>, v: number): number {
	let lo = 0;
	let hi = xs.length - 1;
	if (hi < 0) return -1;
	if (xs[0] > xs[hi]) {
		// descending: linear search fallback
		let best = 0;
		for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - v) < Math.abs(xs[best] - v)) best = i;
		return best;
	}
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (xs[mid] < v) lo = mid;
		else hi = mid;
	}
	return Math.abs(xs[lo] - v) <= Math.abs(xs[hi] - v) ? lo : hi;
}

/** Categorical colours in fixed order (CSS variables, theme-aware). */
export const SERIES_COLORS = [
	'var(--s1)',
	'var(--s2)',
	'var(--s3)',
	'var(--s4)',
	'var(--s5)',
	'var(--s6)',
	'var(--s7)',
	'var(--s8)'
];
export const seriesColor = (i: number): string => SERIES_COLORS[i % SERIES_COLORS.length];
