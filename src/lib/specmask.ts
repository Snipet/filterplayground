import type { Region } from '$lib/components/plot/Plot.svelte';
import type { BandType } from '$lib/dsp/types';

const BIG = 1e4;

/**
 * Forbidden regions (in dB) for a magnitude spec: passband must stay above −rp,
 * stopband must stay below −rs. Edges in Hz.
 */
export function specRegions(
	band: BandType,
	fp: number | [number, number],
	fstop: number | [number, number],
	rp: number,
	rs: number
): Region[] {
	const p = Array.isArray(fp) ? fp : [fp, fp];
	const s = Array.isArray(fstop) ? fstop : [fstop, fstop];
	const pass = (x0: number, x1: number): Region => ({
		x0,
		x1,
		y0: -rp,
		y1: -BIG,
		kind: 'forbidden',
		label: `Passband: must stay above −${rp} dB`
	});
	const stop = (x0: number, x1: number): Region => ({
		x0,
		x1,
		y0: -rs,
		y1: BIG,
		kind: 'forbidden',
		label: `Stopband: must stay below −${rs} dB`
	});
	switch (band) {
		case 'lowpass':
			return [pass(0, p[0]), stop(s[0], 1e12)];
		case 'highpass':
			return [stop(0, s[0]), pass(p[0], 1e12)];
		case 'bandpass':
			return [stop(0, s[0]), pass(p[0], p[1]), stop(s[1], 1e12)];
		case 'bandstop':
			return [pass(0, p[0]), stop(s[0], s[1]), pass(p[1], 1e12)];
	}
}
