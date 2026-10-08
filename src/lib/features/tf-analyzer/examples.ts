/** Example filters for the Transfer Function Analyzer, as the text a user would paste. */
import { designDigital, designAnalog } from '$lib/dsp/design';
import { sos2tf } from '$lib/dsp/convert';
import { abs, c, mul, polar, sub } from '$lib/dsp/complex';
import type { Domain, InputForm } from './analyze';

export interface ExampleTexts {
	b?: string;
	a?: string;
	sos?: string;
	z?: string;
	p?: string;
	k?: string;
	taps?: string;
}

export interface Example {
	id: string;
	label: string;
	domain: Domain;
	fs?: number;
	form: InputForm;
	texts: ExampleTexts;
	description: string;
}

const fmt = (v: number, d = 10) => (v === 0 ? '0' : String(Number(v.toPrecision(d))));
const list = (vs: number[], d = 10) => vs.map((v) => fmt(v, d)).join(', ');
const rows = (sos: number[][], d = 10) =>
	sos.map((r) => r.map((v) => fmt(v, d)).join(', ')).join('\n');

function butterBiquad() {
	const { sos } = designDigital({
		family: 'butter',
		band: 'lowpass',
		order: 2,
		f1: 1000,
		fs: 48000
	});
	const tf = sos2tf(sos);
	return { b: list(tf.b), a: list(tf.a) };
}

const ellip = designDigital({
	family: 'ellip',
	band: 'lowpass',
	order: 6,
	f1: 1000,
	rp: 0.5,
	rs: 60,
	fs: 48000
});
const ellipTf = sos2tf(ellip.sos);

function notchGain() {
	const th = (2 * Math.PI * 1000) / 48000;
	const one = c(1);
	const num = mul(sub(one, polar(1, th)), sub(one, polar(1, -th)));
	const den = mul(sub(one, polar(0.98, th)), sub(one, polar(0.98, -th)));
	return abs(den) / abs(num);
}

const butterAnalog = designAnalog({ family: 'butter', band: 'lowpass', order: 4, f1: 1000 });

export const EXAMPLES: Example[] = [
	{
		id: 'butter-biquad',
		label: 'Butterworth low-pass biquad (b/a)',
		domain: 'digital',
		fs: 48000,
		form: 'ba',
		texts: butterBiquad(),
		description:
			'2nd-order Butterworth low-pass, fc = 1 kHz at fs = 48 kHz: two zeros at z = −1 and a pole pair with Q = 0.707.'
	},
	{
		id: 'unstable',
		label: 'Unstable resonator (sign error in a₂)',
		domain: 'digital',
		fs: 48000,
		form: 'ba',
		texts: { b: '1', a: '1, -1.6, -0.81' },
		description:
			'A resonator meant to have a = [1, −1.6, +0.81] (poles at 0.9∠±27°). With the sign of a₂ flipped, one pole lands at z ≈ 2. Change −0.81 to 0.81 to fix it.'
	},
	{
		id: 'moving-average',
		label: 'Moving average, 5 taps (FIR)',
		domain: 'digital',
		fs: 48000,
		form: 'fir',
		texts: { taps: '1/5, 1/5, 1/5, 1/5, 1/5' },
		description:
			'The simplest low-pass: zeros evenly spaced on the unit circle (except at z = 1), linear phase with a 2-sample delay.'
	},
	{
		id: 'notch',
		label: 'Notch at 1 kHz (poles & zeros, polar form)',
		domain: 'digital',
		fs: 48000,
		form: 'zpk',
		texts: { z: '1∠±7.5°', p: '0.98∠±7.5°', k: fmt(notchGain(), 12) },
		description:
			'Zeros on the unit circle at ±7.5° (= 1 kHz at 48 kHz) and poles just inside at radius 0.98. The pole radius sets the notch width. k normalises the DC gain to 1.'
	},
	{
		id: 'ellip-ba',
		label: '6th-order elliptic as b/a, 7 digits',
		domain: 'digital',
		fs: 48000,
		form: 'ba',
		texts: {
			b: list(ellipTf.b, 7).replace(/, /g, ',\n'),
			a: list(ellipTf.a, 7).replace(/, /g, ',\n')
		},
		description:
			'An elliptic low-pass (fc = 1 kHz, 0.5 dB / 60 dB) whose b/a coefficients were printed with 7 significant digits — a perfectly ordinary amount. The poles are so sensitive that the result is unstable.'
	},
	{
		id: 'ellip-sos',
		label: 'Same elliptic as SOS, 7 digits',
		domain: 'digital',
		fs: 48000,
		form: 'sos',
		texts: { sos: rows(ellip.sos, 7) },
		description:
			'Exactly the same filter, also rounded to 7 digits, but as second-order sections. Each section only has to place two poles, so the rounding is harmless.'
	},
	{
		id: 'allpass',
		label: '2nd-order all-pass (b/a)',
		domain: 'digital',
		fs: 48000,
		form: 'ba',
		texts: { b: '0.81, -1.6, 1', a: '1, -1.6, 0.81' },
		description:
			'The numerator is the denominator reversed, so every zero is the reciprocal of a pole: |H| = 1 at all frequencies while the phase rotates by 360°.'
	},
	{
		id: 'nonmin',
		label: 'Linear-phase but not minimum-phase FIR',
		domain: 'digital',
		fs: 48000,
		form: 'fir',
		texts: { taps: '1, -2.5, 1' },
		description:
			'Symmetric taps → linear phase. Its zeros are at z = 2 and z = 0.5: a reciprocal pair, so it cannot be minimum phase.'
	},
	{
		id: 'differentiator',
		label: 'Central-difference differentiator (FIR)',
		domain: 'digital',
		fs: 48000,
		form: 'fir',
		texts: { taps: '0.5, 0, -0.5' },
		description:
			'Antisymmetric taps (type III): zero gain at DC and at Nyquist, a 90° phase shift plus one sample of delay.'
	},
	{
		id: 'rlc',
		label: 'Series RLC band-pass (analog b/a)',
		domain: 'analog',
		form: 'ba',
		texts: { b: '1e4, 0', a: '1, 1e4, 1e9' },
		description:
			'Voltage across R in a series RLC (R = 100 Ω, L = 10 mH, C = 100 nF): H(s) = (R/L)s / (s² + (R/L)s + 1/LC). f₀ = 5.03 kHz, Q = 3.16. Coefficients in descending powers of s.'
	},
	{
		id: 'butter-analog',
		label: '4th-order Butterworth (analog poles)',
		domain: 'analog',
		form: 'zpk',
		texts: {
			z: '',
			p: butterAnalog.p
				.filter((p) => p.im >= 0)
				.map((p) => `${fmt(p.re, 10)}±${fmt(p.im, 10)}j`)
				.join('\n'),
			k: fmt(butterAnalog.k, 10)
		},
		description:
			'Four poles on a circle of radius 2π·1000 rad/s, at 22.5° and 67.5° from the negative real axis; the ± shorthand enters each conjugate pair at once.'
	}
];
