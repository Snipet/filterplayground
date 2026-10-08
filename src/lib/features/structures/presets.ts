/** Example filters for the Filter Structures page. */
import { biquad, type BiquadType } from '$lib/dsp/biquad';
import { designDigital } from '$lib/dsp/design';
import { sos2tf, zpk2sos, tf2zpk } from '$lib/dsp/convert';
import { firwin } from '$lib/dsp/fir';
import type { SOS } from '$lib/dsp/types';
import { normalizeTf } from './realize';

export type PresetId = 'biquad' | 'butter4' | 'ellip3' | 'fir7' | 'firmin';

export const PRESETS: { id: PresetId; label: string; description: string }[] = [
	{ id: 'biquad', label: 'RBJ biquad (adjustable)', description: 'A single second-order section from the Audio EQ Cookbook — change its type, frequency and Q below.' },
	{ id: 'butter4', label: '4th-order Butterworth low-pass', description: 'fc = 2 kHz at fs = 48 kHz: four poles, four zeros at z = −1, two sections.' },
	{ id: 'ellip3', label: '3rd-order elliptic low-pass', description: 'fc = 3 kHz, 1 dB ripple, 40 dB stopband: an odd order, so one section is first order.' },
	{ id: 'fir7', label: '7-tap linear-phase FIR low-pass', description: 'Hamming-windowed sinc, fc = 6 kHz. Symmetric taps — note what that does to the lattice.' },
	{ id: 'firmin', label: '8-tap minimum-phase FIR', description: 'A causal half-Gaussian smoother. Its taps decrease monotonically, which puts every zero inside the unit circle: minimum phase, and a lattice with every |k| < 1.' }
];

export interface BiquadSettings {
	type: BiquadType;
	f0: number;
	q: number;
	gainDb: number;
}

export interface PresetFilter {
	b: number[];
	a: number[];
	sos: SOS;
	fs: number;
}

const FS = 48000;

export function presetFilter(id: PresetId, bq: BiquadSettings): PresetFilter {
	switch (id) {
		case 'biquad': {
			const row = biquad({ type: bq.type, f0: bq.f0, fs: FS, q: bq.q, gainDb: bq.gainDb });
			const { b, a } = normalizeTf(row.slice(0, 3), row.slice(3, 6));
			return { b, a, sos: [row], fs: FS };
		}
		case 'butter4':
		case 'ellip3': {
			const { sos } =
				id === 'butter4'
					? designDigital({ family: 'butter', band: 'lowpass', order: 4, f1: 2000, fs: FS })
					: designDigital({ family: 'ellip', band: 'lowpass', order: 3, f1: 3000, rp: 1, rs: 40, fs: FS });
			const tf = sos2tf(sos);
			const { b, a } = normalizeTf(tf.b, tf.a);
			return { b, a, sos, fs: FS };
		}
		case 'fir7':
		case 'firmin': {
			let h: number[];
			if (id === 'fir7') h = firwin(7, [6000], { type: 'hamming' }, true, FS);
			else {
				const g = Array.from({ length: 8 }, (_, k) => Math.exp(-((k / 3) ** 2)));
				const s = g.reduce((acc, v) => acc + v, 0);
				h = g.map((v) => v / s);
			}
			return { b: h, a: [1], sos: zpk2sos(tf2zpk({ b: h, a: [1] })), fs: FS };
		}
	}
}
