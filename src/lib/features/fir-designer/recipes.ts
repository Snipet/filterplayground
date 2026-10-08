/**
 * SciPy and MATLAB code that reproduces a design from the FIR designer.
 */
import type { WindowSpec } from '$lib/dsp/fir';
import { kaiserOrder, windowInfo } from '$lib/dsp/windows';
import type { BandType } from '$lib/dsp/types';
import { type Band, type FirConfig, type FirDesign, kaiserAttenuation, transitionWidth } from './design';

const n = (v: number, d = 10) => {
	if (!Number.isFinite(v)) return String(v);
	const s = String(Number(v.toPrecision(d)));
	return s === '-0' ? '0' : s;
};
const list = (a: readonly number[], d = 10) => `[${a.map((v) => n(v, d)).join(', ')}]`;
const mlist = (a: readonly number[], d = 10) => `[${a.map((v) => n(v, d)).join(' ')}]`;

/** SciPy window argument for firwin/firwin2 (symmetric windows), or null if SciPy has no equivalent. */
export function scipyWindow(w: WindowSpec, N: number): string | null {
	const p = w.param ?? windowInfo(w.type).param?.default ?? 0;
	switch (w.type) {
		case 'rectangular':
			return "'boxcar'";
		case 'triangular':
			return "'triang'";
		case 'bartlett':
		case 'hann':
		case 'hamming':
		case 'blackman':
		case 'blackmanharris':
		case 'flattop':
		case 'bohman':
		case 'parzen':
		case 'cosine':
		case 'lanczos':
			return `'${w.type}'`;
		case 'blackmannuttall':
			// SciPy's 'nuttall' is the minimum 4-term Blackman–Nuttall window
			return "'nuttall'";
		case 'nuttall':
			return "('general_cosine', [0.355768, 0.487396, 0.144232, 0.012604])";
		case 'kaiser':
			return `('kaiser', ${n(p, 6)})`;
		case 'gaussian':
			return `('gaussian', ${n((p * (N - 1)) / 2, 8)})`; // std in samples
		case 'tukey':
			return `('tukey', ${n(p, 6)})`;
		case 'chebyshev':
			return `('chebwin', ${n(p, 6)})`;
		case 'dpss':
			return `('dpss', ${n(p, 6)})`;
		case 'welch':
			return null;
	}
}

/** MATLAB expression for a length-N symmetric window, or null. */
export function matlabWindow(w: WindowSpec, N: number): string | null {
	const p = w.param ?? windowInfo(w.type).param?.default ?? 0;
	switch (w.type) {
		case 'rectangular':
			return `rectwin(${N})`;
		case 'triangular':
			return `triang(${N})`;
		case 'bartlett':
			return `bartlett(${N})`;
		case 'hann':
			return `hann(${N})`;
		case 'hamming':
			return `hamming(${N})`;
		case 'blackman':
			return `blackman(${N})`;
		case 'blackmanharris':
			return `blackmanharris(${N})`;
		case 'blackmannuttall':
			return `nuttallwin(${N})`;
		case 'flattop':
			return `flattopwin(${N})`;
		case 'bohman':
			return `bohmanwin(${N})`;
		case 'parzen':
			return `parzenwin(${N})`;
		case 'kaiser':
			return `kaiser(${N}, ${n(p, 6)})`;
		case 'gaussian':
			return `gausswin(${N}, ${n(1 / p, 6)})`; // alpha = 1/σ_rel
		case 'tukey':
			return `tukeywin(${N}, ${n(p, 6)})`;
		case 'chebyshev':
			return `chebwin(${N}, ${n(p, 6)})`;
		case 'dpss': {
			return `dpss(${N}, ${n(p, 6)}, 1) / max(abs(dpss(${N}, ${n(p, 6)}, 1)))`;
		}
		case 'cosine':
			return `sin(pi * ((0:${N - 1})' + 0.5) / ${N})`;
		default:
			return null;
	}
}

const passZeroStr: Record<BandType, string> = { lowpass: "'lowpass'", highpass: "'highpass'", bandpass: "'bandpass'", bandstop: "'bandstop'" };
const fir1Type: Record<BandType, string> = { lowpass: "'low'", highpass: "'high'", bandpass: "'bandpass'", bandstop: "'stop'" };

function bandEdges(bands: Band[]): number[] {
	return bands.flatMap((b) => [b.f1, b.f2]);
}

/** True if every band is a straight line through the origin (D = slope·f). */
function rampsThroughOrigin(bands: Band[]): boolean {
	return bands.every((b) => Math.abs(b.d1 * b.f2 - b.d2 * b.f1) <= 1e-9 * Math.max(1, Math.abs(b.d2 * b.f1)));
}
const constantBands = (bands: Band[]) => bands.every((b) => b.d1 === b.d2);

export function scipyRecipe(cfg: FirConfig, d: FirDesign): string {
	const N = d.numtaps;
	const fs = cfg.fs;
	const head = `import numpy as np\nfrom scipy import signal\n\nfs = ${n(fs)}\nnumtaps = ${N}\n`;
	const tail = `\n\nw, H = signal.freqz(h, worN=8192, fs=fs)  # frequency response\n# y = signal.lfilter(h, 1.0, x)            # filter a signal`;
	switch (cfg.method) {
		case 'window': {
			const win = scipyWindow(cfg.window, N);
			const cut = d.cutoffs!.length === 1 ? n(d.cutoffs![0]) : list(d.cutoffs!);
			if (!win) {
				const M = N - 1;
				return `${head}# SciPy has no Welch window: build it and apply it to the ideal (rectangular) design.\nh = signal.firwin(numtaps, ${cut}, window='boxcar', pass_zero=${passZeroStr[cfg.spec.band]}, scale=False, fs=fs)\nn = np.arange(numtaps)\nh = h * (1 - ((n - ${M / 2}) / ${M / 2 + 1}) ** 2)\n# re-normalise like firwin(scale=True): unit gain at DC / centre of the first passband / fs/2\n${scaleSnippet(cfg.spec.band, d.cutoffs!, fs)}${tail}`;
			}
			return `${head}h = signal.firwin(numtaps, ${cut}, window=${win}, pass_zero=${passZeroStr[cfg.spec.band]}, fs=fs)${tail}`;
		}
		case 'kaiser': {
			const A = kaiserAttenuation(cfg.spec);
			const tw = transitionWidth(cfg.spec);
			const est = kaiserOrder(A, tw / fs).numtaps;
			const cut = d.cutoffs!.length === 1 ? n(d.cutoffs![0]) : list(d.cutoffs!);
			const why = N === est ? '' : cfg.auto ? `  # kaiserord says ${est}; bumped to odd: a ${cfg.spec.band} needs gain at fs/2` : `  # kaiserord would give ${est}`;
			return `import numpy as np\nfrom scipy import signal\n\nfs = ${n(fs)}\n# Kaiser's formulas: A = ${n(A, 5)} dB, narrowest transition = ${n(tw)} Hz\n# numtaps, beta = signal.kaiserord(${n(A, 6)}, ${n(tw)} / (fs / 2))   # → ${est}, ${n(d.beta!, 6)}\nnumtaps, beta = ${N}, ${n(d.beta!, 8)}${why}\nh = signal.firwin(numtaps, ${cut}, window=('kaiser', beta), pass_zero=${passZeroStr[cfg.spec.band]}, fs=fs)${tail}`;
		}
		case 'ls': {
			const edges = bandEdges(d.bands);
			const desired = d.bands.flatMap((b) => [b.d1, b.d2]);
			const weight = d.bands.map((b) => b.weight);
			return `${head}h = signal.firls(numtaps, ${list(edges)},\n                 ${list(desired)},\n                 weight=${list(weight, 6)}, fs=fs)${tail}`;
		}
		case 'fsamp': {
			const win = scipyWindow(cfg.window, N);
			const p = d.points!;
			const winArg = win ?? 'None';
			const note = win ? '' : '\n# SciPy has no Welch window: designed without a window here; multiply by your own window to match.';
			return `${head}h = signal.firwin2(numtaps, ${list(p.freq)},\n                  ${list(p.gain)},\n                  window=${winArg}, fs=fs)${note}${tail}`;
		}
		case 'pm': {
			const edges = bandEdges(d.bands);
			const weight = d.bands.map((b) => b.weight);
			if (d.symmetry === 'even') {
				if (!constantBands(d.bands))
					return `${head}# signal.remez only supports a constant desired value per band, so this sloped design\n# cannot be reproduced exactly with SciPy. Use the exported taps (or MATLAB's firpm, which accepts ramps).\nbands = ${list(edges)}${tail.replace('w, H', '# w, H')}`;
				return `${head}h = signal.remez(numtaps, ${list(edges)},\n                 ${list(d.bands.map((b) => b.d1))},\n                 weight=${list(weight, 6)}, fs=fs)${tail}`;
			}
			if (constantBands(d.bands))
				return `${head}# antisymmetric (type ${N % 2 ? 'III' : 'IV'}): H = j·A(ω)·e^(−jωM)\nh = signal.remez(numtaps, ${list(edges)},\n                 ${list(d.bands.map((b) => b.d1))},\n                 weight=${list(weight, 6)}, type='hilbert', fs=fs)${tail}`;
			if (rampsThroughOrigin(d.bands) && cfg.relWeight) {
				// SciPy's differentiator: D(f) = desired·f (f in cycles/sample), weight/f
				const slopes = d.bands.map((b) => (b.f2 > 0 ? b.d2 / (b.f2 / fs) : 0));
				return `${head}# antisymmetric differentiator: desired = slope per (cycles/sample), weight ∝ 1/f\nh = signal.remez(numtaps, ${list(edges)},\n                 ${list(slopes)},\n                 weight=${list(weight, 6)}, type='differentiator', fs=fs)${tail}`;
			}
			return `${head}# This antisymmetric design uses sloped bands that signal.remez cannot express\n# (it only offers constant 'hilbert' bands or 'differentiator' ramps with 1/f weighting).\n# Use the exported taps instead.${tail.replace('w, H', '# w, H')}`;
		}
	}
}

function scaleSnippet(band: BandType, cutoffs: number[], fs: number): string {
	const nyq = fs / 2;
	let f0: string;
	if (band === 'lowpass' || band === 'bandstop') f0 = '0';
	else if (band === 'highpass') f0 = n(nyq);
	else f0 = n((cutoffs[0] + cutoffs[1]) / 2);
	return `f0 = ${f0}\nh /= np.sum(h * np.cos(2 * np.pi * f0 / fs * (np.arange(numtaps) - (numtaps - 1) / 2)))`;
}

export function matlabRecipe(cfg: FirConfig, d: FirDesign): string {
	const N = d.numtaps;
	const fs = cfg.fs;
	const head = `fs = ${n(fs)};\nN  = ${N};                 % number of taps (order N-1)\n`;
	const tail = `\n\n[H, f] = freqz(h, 1, 8192, fs);   % frequency response\n% y = filter(h, 1, x);`;
	switch (cfg.method) {
		case 'window':
		case 'kaiser': {
			const w: WindowSpec = cfg.method === 'kaiser' ? { type: 'kaiser', param: d.beta } : cfg.window;
			const win = matlabWindow(w, N);
			const Wn = d.cutoffs!.length === 1 ? `${n(d.cutoffs![0])} / (fs/2)` : `${mlist(d.cutoffs!)} / (fs/2)`;
			const winExpr = win ?? `(1 - (((0:N-1)' - (N-1)/2) / ((N-1)/2 + 1)).^2)   % Welch window`;
			const kai = cfg.method === 'kaiser' ? `% beta = ${n(d.beta!, 6)} from Kaiser's formula (kaiserord gives the same within ±1 tap)\n` : '';
			return `${head}${kai}h = fir1(N-1, ${Wn}, ${fir1Type[cfg.spec.band]}, ${winExpr});${tail}`;
		}
		case 'ls': {
			const f = bandEdges(d.bands);
			const a = d.bands.flatMap((b) => [b.d1, b.d2]);
			return `${head}f = ${mlist(f)} / (fs/2);\na = ${mlist(a)};\nw = ${mlist(d.bands.map((b) => b.weight), 6)};\nh = firls(N-1, f, a, w);${tail}`;
		}
		case 'fsamp': {
			const p = d.points!;
			const win = matlabWindow(cfg.window, N) ?? `(1 - (((0:N-1)' - (N-1)/2) / ((N-1)/2 + 1)).^2)`;
			const nf = 1 + Math.pow(2, Math.ceil(Math.log2(N)));
			return `${head}f = ${mlist(p.freq)} / (fs/2);\nm = ${mlist(p.gain)};\n% fir2 interpolates its grid slightly differently from SciPy's firwin2: expect tiny differences\nh = fir2(N-1, f, m, ${nf}, ${win});${tail}`;
		}
		case 'pm': {
			const f = bandEdges(d.bands);
			const a = d.bands.flatMap((b) => [b.d1, b.d2]);
			const w = mlist(d.bands.map((b) => b.weight), 6);
			const flag = d.symmetry === 'odd' ? (cfg.relWeight ? ", 'differentiator'" : ", 'hilbert'") : '';
			return `${head}f = ${mlist(f)} / (fs/2);\na = ${mlist(a)};\nw = ${w};\nh = firpm(N-1, f, a, w${flag});${tail}`;
		}
	}
}
