/**
 * Test-signal generators for the Signal Lab. Everything is deterministic
 * (seeded noise) so that re-renders do not change the signal.
 */
import { fftInPlace, nextPow2 } from '$lib/dsp/fft';

export type SignalType =
	| 'white'
	| 'pink'
	| 'sine'
	| 'square'
	| 'saw'
	| 'chirp'
	| 'impulses'
	| 'twotone'
	| 'drums'
	| 'file';

export interface SignalInfo {
	id: SignalType;
	name: string;
	description: string;
	/** Which frequency parameter the signal uses. */
	freq?: 'tone' | 'rate';
}

export const SIGNALS: SignalInfo[] = [
	{
		id: 'white',
		name: 'White noise',
		description:
			'Equal power per hertz: sounds bright and hissy. Its spectrum is flat, so the output spectrum is simply |H|².'
	},
	{
		id: 'pink',
		name: 'Pink noise',
		description:
			'Equal power per octave (−3 dB/octave). Sounds balanced to the ear; used for loudspeaker and room measurements.'
	},
	{
		id: 'sine',
		name: 'Sine',
		description:
			'A single frequency: a filter can only change its level and phase, never its shape.',
		freq: 'tone'
	},
	{
		id: 'square',
		name: 'Square (band-limited)',
		description:
			'Odd harmonics falling at 1/k (−6 dB/octave). Low-pass filtering rounds the edges and adds ringing; high-pass makes the flat tops sag.',
		freq: 'tone'
	},
	{
		id: 'saw',
		name: 'Sawtooth (band-limited)',
		description: 'All harmonics falling at 1/k. The classic subtractive-synthesiser source.',
		freq: 'tone'
	},
	{
		id: 'chirp',
		name: 'Log sweep 20 Hz → 20 kHz',
		description:
			'A logarithmic sine sweep: the output envelope traces the magnitude response over time.'
	},
	{
		id: 'impulses',
		name: 'Impulse train',
		description:
			'Single-sample clicks. Each click is the filter’s impulse response — listen to the ringing of high-Q filters.',
		freq: 'rate'
	},
	{
		id: 'twotone',
		name: 'Two tones',
		description:
			'A low and a high sine at equal level. Shows how much of each the filter lets through.',
		freq: 'tone'
	},
	{
		id: 'drums',
		name: 'Drum-like transients',
		description:
			'Kick (decaying low sweep), snare (noise burst + tone) and hi-hat clicks: sharp transients that reveal smearing and pre-/post-ringing.'
	},
	{
		id: 'file',
		name: 'Your audio file',
		description: 'Decoded and mixed to mono in your browser. Nothing is uploaded.'
	}
];

/** Small fast seeded PRNG (mulberry32). */
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

/** Standard normal samples (Box–Muller). */
function gaussian(n: number, rnd: () => number): Float64Array {
	const out = new Float64Array(n);
	for (let i = 0; i < n; i += 2) {
		const u = Math.max(rnd(), 1e-12);
		const v = rnd();
		const r = Math.sqrt(-2 * Math.log(u));
		out[i] = r * Math.cos(2 * Math.PI * v);
		if (i + 1 < n) out[i + 1] = r * Math.sin(2 * Math.PI * v);
	}
	return out;
}

export function whiteNoise(n: number, seed = 1): Float64Array {
	return gaussian(n, mulberry32(seed));
}

/**
 * Pink noise by spectral shaping: white Gaussian noise is transformed, every
 * bin is scaled by 1/√f (power ∝ 1/f, −3 dB per octave), and transformed back.
 */
export function pinkNoise(n: number, seed = 2): Float64Array {
	const N = nextPow2(n);
	const re = gaussian(N, mulberry32(seed));
	const im = new Float64Array(N);
	fftInPlace(re, im);
	re[0] = 0;
	im[0] = 0;
	for (let k = 1; k <= N / 2; k++) {
		const g = 1 / Math.sqrt(k);
		re[k] *= g;
		im[k] *= g;
		if (k < N / 2) {
			re[N - k] *= g;
			im[N - k] *= g;
		}
	}
	fftInPlace(re, im, true);
	return re.slice(0, n);
}

export function sine(n: number, fs: number, f: number): Float64Array {
	const out = new Float64Array(n);
	const w = (2 * Math.PI * f) / fs;
	for (let i = 0; i < n; i++) out[i] = Math.sin(w * i);
	return out;
}

/**
 * Band-limited periodic wave by additive synthesis: Σ c_k sin(k ω n) for every
 * harmonic below fs/2. Each harmonic is generated with a complex rotation.
 */
function additive(n: number, fs: number, f: number, coef: (k: number) => number): Float64Array {
	const out = new Float64Array(n);
	const kmax = Math.floor((fs / 2 - 1) / f);
	for (let k = 1; k <= kmax; k++) {
		const c = coef(k);
		if (c === 0) continue;
		const w = (2 * Math.PI * k * f) / fs;
		const cr = Math.cos(w);
		const ci = Math.sin(w);
		let re = 1;
		let im = 0;
		for (let i = 0; i < n; i++) {
			out[i] += c * im;
			const nre = re * cr - im * ci;
			im = re * ci + im * cr;
			re = nre;
			// renormalise occasionally to stop the rotation drifting
			if ((i & 4095) === 4095) {
				const m = Math.hypot(re, im);
				re /= m;
				im /= m;
			}
		}
	}
	return out;
}

export const square = (n: number, fs: number, f: number) =>
	additive(n, fs, f, (k) => (k % 2 === 1 ? 4 / (Math.PI * k) : 0));
export const sawtooth = (n: number, fs: number, f: number) =>
	additive(n, fs, f, (k) => ((k % 2 === 1 ? 1 : -1) * 2) / (Math.PI * k));

/** Logarithmic sweep from f0 to f1 over the whole signal. */
export function logChirp(n: number, fs: number, f0: number, f1: number): Float64Array {
	const out = new Float64Array(n);
	const T = n / fs;
	const L = Math.log(f1 / f0);
	const K = (2 * Math.PI * f0 * T) / L;
	for (let i = 0; i < n; i++) {
		const t = i / fs;
		out[i] = Math.sin(K * (Math.exp((t * L) / T) - 1));
	}
	return out;
}

export function impulseTrain(n: number, fs: number, rate: number): Float64Array {
	const out = new Float64Array(n);
	const period = Math.max(1, Math.round(fs / rate));
	for (let i = 0; i < n; i += period) out[i] = 1;
	return out;
}

export function twoTone(n: number, fs: number, fa: number, fb: number): Float64Array {
	const a = sine(n, fs, fa);
	const b = sine(n, fs, fb);
	for (let i = 0; i < n; i++) a[i] = 0.5 * (a[i] + b[i]);
	return a;
}

/** A simple drum pattern at 120 BPM: kick, snare and closed hi-hats. */
export function drums(n: number, fs: number, seed = 3): Float64Array {
	const out = new Float64Array(n);
	const rnd = mulberry32(seed);
	const beat = Math.round(fs * 0.5);
	const add = (start: number, len: number, f: (t: number) => number) => {
		for (let i = 0; i < len && start + i < n; i++) out[start + i] += f(i / fs);
	};
	for (let b = 0; b * beat < n; b++) {
		const s = b * beat;
		if (b % 2 === 0) {
			// kick: pitch sweep 150 → 50 Hz, 0.35 s
			let ph = 0;
			add(s, Math.round(0.35 * fs), (t) => {
				const f = 50 + 100 * Math.exp(-t / 0.04);
				ph += (2 * Math.PI * f) / fs;
				return 0.9 * Math.exp(-t / 0.12) * Math.sin(ph);
			});
		} else {
			// snare: noise burst plus a 190 Hz body
			add(
				s,
				Math.round(0.25 * fs),
				(t) =>
					0.55 * Math.exp(-t / 0.05) * (2 * rnd() - 1) +
					0.35 * Math.exp(-t / 0.07) * Math.sin(2 * Math.PI * 190 * t)
			);
		}
		// hi-hats on every half beat
		for (const off of [0, 0.5]) {
			const hs = s + Math.round(off * beat);
			let prev = 0;
			add(hs, Math.round(0.05 * fs), (t) => {
				const w = 2 * rnd() - 1;
				const hp = w - prev; // crude high-pass for a brighter hat
				prev = w;
				return 0.22 * Math.exp(-t / 0.012) * hp;
			});
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// Levels and display helpers
// ---------------------------------------------------------------------------

export function peakOf(x: ArrayLike<number>): number {
	let m = 0;
	for (let i = 0; i < x.length; i++) {
		const a = Math.abs(x[i]);
		if (a > m || Number.isNaN(a)) m = Number.isNaN(a) ? Infinity : a;
	}
	return m;
}

export function rmsOf(x: ArrayLike<number>): number {
	let s = 0;
	for (let i = 0; i < x.length; i++) s += x[i] * x[i];
	return Math.sqrt(s / Math.max(1, x.length));
}

export const dbfs = (v: number): number => 20 * Math.log10(Math.max(v, 1e-12));

/**
 * One playback gain for input and output (so that their level difference stays real),
 * small enough that no played peak exceeds `safePeak`. `match` is the loudness-matching
 * gain on the output. A muted output is not played, so it does not count.
 */
export function playbackGain(
	pin: number,
	pout: number,
	match: number,
	outputMuted: boolean,
	safePeak: number
): number {
	const peak = outputMuted ? pin : Math.max(pin, pout * match);
	return peak > safePeak ? safePeak / peak : 1;
}

/** Length of the linear-phase FIR low-pass actually built: an even count is rounded up to odd (type I). */
export const oddTaps = (n: number): number => (n % 2 === 0 ? n + 1 : n);

/** Scale in place so that the peak equals `peak`. */
export function normalizePeak(x: Float64Array, peak: number): Float64Array {
	const p = peakOf(x);
	if (p > 0 && Number.isFinite(p)) for (let i = 0; i < x.length; i++) x[i] *= peak / p;
	return x;
}

/** Short raised-cosine fades at both ends to avoid clicks when looping. */
export function fadeEdges(x: Float64Array, len: number): Float64Array {
	const L = Math.min(len, Math.floor(x.length / 2));
	for (let i = 0; i < L; i++) {
		const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / L);
		x[i] *= g;
		x[x.length - 1 - i] *= g;
	}
	return x;
}

/**
 * Samples of x[start … start+len) for plotting, reduced to at most `maxPts`
 * points with a min/max envelope so that peaks are never lost.
 */
export function windowed(
	x: ArrayLike<number>,
	start: number,
	len: number,
	fs: number,
	maxPts = 1400
): { t: number[]; y: number[] } {
	const s = Math.max(0, Math.min(x.length - 1, Math.floor(start)));
	const e = Math.min(x.length, s + Math.max(1, Math.floor(len)));
	const n = e - s;
	const t: number[] = [];
	const y: number[] = [];
	if (n <= maxPts) {
		for (let i = s; i < e; i++) {
			t.push((i / fs) * 1000);
			y.push(x[i]);
		}
		return { t, y };
	}
	const buckets = Math.floor(maxPts / 2);
	const per = n / buckets;
	for (let b = 0; b < buckets; b++) {
		const i0 = s + Math.floor(b * per);
		const i1 = Math.min(e, s + Math.floor((b + 1) * per));
		let mn = Infinity;
		let mx = -Infinity;
		let imn = i0;
		let imx = i0;
		for (let i = i0; i < i1; i++) {
			if (x[i] < mn) {
				mn = x[i];
				imn = i;
			}
			if (x[i] > mx) {
				mx = x[i];
				imx = i;
			}
		}
		const first = Math.min(imn, imx);
		const second = Math.max(imn, imx);
		t.push((first / fs) * 1000, (second / fs) * 1000);
		y.push(x[first], x[second]);
	}
	return { t, y };
}

/** Index of the largest jump in level (a good place to look at a transient). */
export function transientIndex(x: ArrayLike<number>, fs: number): number {
	const hop = Math.max(1, Math.round(fs * 0.002));
	let best = 0;
	let bestJump = -Infinity;
	let prev = 0;
	for (let i = 0; i + hop <= x.length; i += hop) {
		let e = 0;
		for (let k = i; k < i + hop; k++) e += x[k] * x[k];
		const jump = e - prev;
		if (jump > bestJump && i > 0) {
			bestJump = jump;
			best = i;
		}
		prev = e;
	}
	return best;
}
