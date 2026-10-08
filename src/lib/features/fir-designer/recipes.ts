/**
 * SciPy and MATLAB code that reproduces a design from the FIR designer.
 */
import type { WindowSpec } from '$lib/dsp/fir';
import { kaiserOrder, windowParamAt } from '$lib/dsp/windows';
import type { BandType } from '$lib/dsp/types';
import {
	type Band,
	type FirConfig,
	type FirDesign,
	kaiserAttenuation,
	needsOdd,
	passZero,
	transitionWidth
} from './design';

const n = (v: number, d = 10) => {
	if (!Number.isFinite(v)) return String(v);
	const s = String(Number(v.toPrecision(d)));
	return s === '-0' ? '0' : s;
};
const list = (a: readonly number[], d = 10) => `[${a.map((v) => n(v, d)).join(', ')}]`;
/**
 * Python float list. SciPy's firwin2 splits a repeated frequency by ±eps in place,
 * which an integer array truncates (6000 − eps → 5999), so the break points must be floats.
 */
const flist = (a: readonly number[], d = 10) =>
	`[${a
		.map((v) => {
			const s = n(v, d);
			return /^-?\d+$/.test(s) ? `${s}.0` : s;
		})
		.join(', ')}]`;
const mlist = (a: readonly number[], d = 10) => `[${a.map((v) => n(v, d)).join(' ')}]`;

/**
 * SciPy window argument for get_window (symmetric windows), or null if SciPy has no equivalent.
 * firwin/firwin2 accept it too, except where scipyWindowArray gives an explicit window.
 */
export function scipyWindow(w: WindowSpec, N: number): string | null {
	const p = windowParamAt(w.type, N, w.param) ?? 0;
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

const NUTTALL = '[0.355768, 0.487396, 0.144232, 0.012604]';

/**
 * Python expression for the symmetric window of length `len` (a Python expression) as an array,
 * for the windows that cannot be passed to firwin/firwin2 by name: SciPy has no Welch window,
 * and current firwin/firwin2 (SciPy 1.18) reject ('general_cosine', …) because they call
 * get_window with xp/device set. Null for every other window.
 *
 * Pass the length `N` where the window's scale matters (it is not normalised away afterwards):
 * SciPy scales an even-length DPSS to a peak of N²/(N² + NW) rather than 1, so that one is
 * then written out, rescaled to peak 1 as this site uses it.
 */
export function scipyWindowArray(w: WindowSpec, len = 'numtaps', N?: number): string | null {
	switch (w.type) {
		case 'welch': // same expression as windowValues('welch')
			return `(1 - ((np.arange(${len}) - (${len} - 1) / 2) / ((${len} - 1) / 2 + 1)) ** 2)`;
		case 'nuttall':
			return `signal.windows.general_cosine(${len}, ${NUTTALL}, sym=True)`;
		case 'dpss': {
			if (N === undefined || N % 2 === 1) return null;
			const dp = `signal.windows.dpss(${len}, ${n(windowParamAt('dpss', N, w.param)!, 6)})`;
			return `(${dp} / np.max(${dp}))`;
		}
		default:
			return null;
	}
}

/** MATLAB expression for a length-N symmetric window (every window type has one). */
export function matlabWindow(w: WindowSpec, N: number): string | null {
	const p = windowParamAt(w.type, N, w.param) ?? 0;
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
		case 'nuttall': {
			const x = `(0:${N - 1})'/${N - 1}`;
			return `0.355768 - 0.487396*cos(2*pi*${x}) + 0.144232*cos(4*pi*${x}) - 0.012604*cos(6*pi*${x})`;
		}
		case 'lanczos':
			return `sinc(2*(0:${N - 1})'/${N - 1} - 1)`;
		case 'welch': // same expression as windowValues('welch')
			return `1 - (((0:${N - 1})' - ${n((N - 1) / 2)}) / ${n((N - 1) / 2 + 1)}).^2`;
	}
}

const passZeroStr: Record<BandType, string> = {
	lowpass: "'lowpass'",
	highpass: "'highpass'",
	bandpass: "'bandpass'",
	bandstop: "'bandstop'"
};
const fir1Type: Record<BandType, string> = {
	lowpass: "'low'",
	highpass: "'high'",
	bandpass: "'bandpass'",
	bandstop: "'stop'"
};

function bandEdges(bands: Band[]): number[] {
	return bands.flatMap((b) => [b.f1, b.f2]);
}

/** True if every band is a straight line through the origin (D = slope·f). */
function rampsThroughOrigin(bands: Band[]): boolean {
	return bands.every(
		(b) => Math.abs(b.d1 * b.f2 - b.d2 * b.f1) <= 1e-9 * Math.max(1, Math.abs(b.d2 * b.f1))
	);
}
const constantBands = (bands: Band[]) => bands.every((b) => b.d1 === b.d2);

/**
 * Per-band weights for a 1/f-weighted 'differentiator' design (SciPy remez, MATLAB firpm) that
 * reproduce the page's W/|D| weighting. Both tools weight a ramp band by w/f with f in
 * cycles/sample (firpm's "2/f" on its fs/2-normalised grid is the same thing, as in McClellan's
 * original program), so dividing its weight by the slope per cycle/sample gives
 * w/(slope·f) = w/|D|. Stop bands keep w. Null when a band is neither a stop band nor a rising
 * ramp through the origin.
 */
function differentiatorWeights(bands: Band[], fs: number): number[] | null {
	if (!rampsThroughOrigin(bands)) return null;
	const out: number[] = [];
	for (const b of bands) {
		if (b.d1 === 0 && b.d2 === 0) out.push(b.weight);
		else if (b.d2 > 0 && b.f2 > 0) out.push(b.weight / (b.d2 / (b.f2 / fs)));
		else return null;
	}
	return out;
}

/** Comment explaining why a window is applied by hand rather than named in firwin/firwin2. */
const explicitWindowNote = (w: WindowSpec) =>
	w.type === 'welch'
		? '# SciPy has no Welch window: build it and apply it to the unwindowed design.'
		: w.type === 'dpss'
			? '# SciPy scales an even-length DPSS window below peak 1: apply it by hand, at peak 1.'
			: "# firwin/firwin2 reject ('general_cosine', …) in current SciPy: apply the Nuttall window by hand.";

/** Pass-band edge pairs in Hz (0 … fs/2), as firwin builds them from the cutoffs. */
function firwinEdges(band: BandType, cutoffs: number[], fs: number): number[] {
	return [...(passZero(band) ? [0] : []), ...cutoffs, ...(needsOdd(band) ? [fs / 2] : [])];
}

/**
 * The firwin call for the window and Kaiser methods. SciPy refuses an even length whose
 * response must pass fs/2, so that type II design is built explicitly, exactly as firwin
 * (and the page) would: unscaled for a high-pass, whose gain to normalise at fs/2 is zero.
 */
function scipyFirwin(
	cfg: FirConfig,
	d: FirDesign,
	winArg: string,
	winArray: string | null
): string {
	const band = cfg.spec.band;
	const cutoffs = d.cutoffs!;
	const cut = cutoffs.length === 1 ? n(cutoffs[0]) : list(cutoffs);
	const pz = `pass_zero=${passZeroStr[band]}`;
	const rescale = `# re-normalise like firwin(scale=True): unit gain at DC / centre of the first passband / fs/2\n${scaleSnippet(band, cutoffs, cfg.fs)}`;
	if (d.numtaps % 2 === 0 && needsOdd(band)) {
		const win = winArray ?? `signal.get_window(${winArg}, numtaps, fftbins=False)`;
		return `# SciPy's firwin refuses an even numtaps whose passband reaches fs/2 (type II has a zero there),\n# so build the windowed ideal response the way firwin does\ne = np.array(${list(firwinEdges(band, cutoffs, cfg.fs))}) / (fs / 2)   # passband edge pairs, in units of fs/2\nm = np.arange(numtaps) - (numtaps - 1) / 2\nh = sum(r * np.sinc(r * m) - l * np.sinc(l * m) for l, r in zip(e[::2], e[1::2]))\nh = h * ${win}\n${
			band === 'highpass'
				? '# no re-normalisation: firwin would scale to unit gain at fs/2, where this gain is zero'
				: rescale
		}`;
	}
	if (winArray)
		return `${explicitWindowNote(cfg.window)}\nh = signal.firwin(numtaps, ${cut}, window='boxcar', ${pz}, scale=False, fs=fs)\nh = h * ${winArray}\n${rescale}`;
	return `h = signal.firwin(numtaps, ${cut}, window=${winArg}, ${pz}, fs=fs)`;
}

export function scipyRecipe(cfg: FirConfig, d: FirDesign): string {
	const N = d.numtaps;
	const fs = cfg.fs;
	const head = `import numpy as np\nfrom scipy import signal\n\nfs = ${n(fs)}\nnumtaps = ${N}\n`;
	const tail = `\n\nw, H = signal.freqz(h, worN=8192, fs=fs)  # frequency response\n# y = signal.lfilter(h, 1.0, x)            # filter a signal`;
	switch (cfg.method) {
		case 'window': {
			const winArray = scipyWindowArray(cfg.window);
			const win = scipyWindow(cfg.window, N) ?? "'boxcar'";
			return `${head}${scipyFirwin(cfg, d, win, winArray)}${tail}`;
		}
		case 'kaiser': {
			const A = kaiserAttenuation(cfg.spec);
			const tw = transitionWidth(cfg.spec);
			const est = kaiserOrder(A, tw / fs).numtaps;
			const why =
				N === est
					? ''
					: cfg.auto && N < est
						? `  # capped at this page's limit (kaiserord says ${est})`
						: cfg.auto && N === est + 1 && needsOdd(cfg.spec.band)
							? `  # kaiserord says ${est}; bumped to odd: a ${cfg.spec.band} needs gain at fs/2`
							: `  # kaiserord would give ${est}`;
			return `import numpy as np\nfrom scipy import signal\n\nfs = ${n(fs)}\n# Kaiser's formulas: A = ${n(A, 5)} dB, narrowest transition = ${n(tw)} Hz\n# numtaps, beta = signal.kaiserord(${n(A, 6)}, ${n(tw)} / (fs / 2))   # → ${est}, ${n(d.beta!, 6)}\nnumtaps, beta = ${N}, ${n(d.beta!, 8)}${why}\n${scipyFirwin(cfg, d, "('kaiser', beta)", null)}${tail}`;
		}
		case 'ls': {
			const edges = bandEdges(d.bands);
			const desired = d.bands.flatMap((b) => [b.d1, b.d2]);
			const weight = d.bands.map((b) => b.weight);
			return `${head}h = signal.firls(numtaps, ${list(edges)},\n                 ${list(desired)},\n                 weight=${list(weight, 6)}, fs=fs)${tail}`;
		}
		case 'fsamp': {
			const p = d.points!;
			const winArray = scipyWindowArray(cfg.window, 'numtaps', N);
			const winArg = winArray ? 'None' : (scipyWindow(cfg.window, N) ?? 'None');
			const pre = winArray ? `${explicitWindowNote(cfg.window)}\n` : '';
			const post = winArray ? `\nh = h * ${winArray}` : '';
			const note =
				N % 2 === 0 && p.gain[p.gain.length - 1] !== 0
					? "\n# Note: SciPy's firwin2 raises ValueError here: an even numtaps (type II) forces H(fs/2) = 0,\n# but the desired response has gain at fs/2. Use an odd numtaps, or the exported taps."
					: '';
			return `${head}${pre}h = signal.firwin2(numtaps, ${flist(p.freq)},\n                  ${list(p.gain)},\n                  window=${winArg}, fs=fs)${post}${note}${tail}`;
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
			const dw = cfg.relWeight ? differentiatorWeights(d.bands, fs) : null;
			if (dw) {
				// SciPy's differentiator: D(f) = desired·f (f in cycles/sample), weight/f
				const slopes = d.bands.map((b) => (b.f2 > 0 ? b.d2 / (b.f2 / fs) : 0));
				return `${head}# antisymmetric differentiator: desired = slope per (cycles/sample); SciPy divides each\n# ramp band's weight by f, so weight = W / slope gives the page's W/|D| weighting\nh = signal.remez(numtaps, ${list(edges)},\n                 ${list(slopes)},\n                 weight=${list(dw, 6)}, type='differentiator', fs=fs)${tail}`;
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
			const band = cfg.spec.band;
			const w: WindowSpec =
				cfg.method === 'kaiser' ? { type: 'kaiser', param: d.beta } : cfg.window;
			const win = matlabWindow(w, N);
			const Wn =
				d.cutoffs!.length === 1 ? `${n(d.cutoffs![0])} / (fs/2)` : `${mlist(d.cutoffs!)} / (fs/2)`;
			let kai = '';
			if (cfg.method === 'kaiser') {
				const est = kaiserOrder(
					kaiserAttenuation(cfg.spec),
					transitionWidth(cfg.spec) / fs
				).numtaps;
				kai =
					Math.abs(N - est) <= 1
						? `% beta = ${n(d.beta!, 6)} and N from Kaiser's formulas (kaiserord gives the same within ±1 tap)\n`
						: `% beta = ${n(d.beta!, 6)} from Kaiser's formula; kaiserord would give about ${est} taps${cfg.auto && N < est ? ", above this page's limit" : ''}\n`;
			}
			// fir1 raises an odd order (even N) to even for a high-pass or band-stop, which no longer
			// fits the window, so that type II design is built explicitly, as fir1 would build it
			const body =
				N % 2 === 0 && needsOdd(band)
					? `% fir1 would raise the order of this even-length ${band} (type II has a zero at fs/2),\n% so build the windowed ideal response the way fir1 does\ne = ${mlist(firwinEdges(band, d.cutoffs!, fs))} / (fs/2);   % passband edge pairs, in units of fs/2\nm = (0:N-1)' - (N-1)/2;\nh = zeros(N, 1);\nfor k = 1:2:numel(e)\n    h = h + e(k+1)*sinc(e(k+1)*m) - e(k)*sinc(e(k)*m);\nend\nh = (h .* (${win})).';\n${
							band === 'highpass'
								? '% no re-normalisation: fir1 would scale to unit gain at fs/2, where this gain is zero'
								: 'h = h / sum(h);   % unit gain at DC, as fir1 scales'
						}`
					: `h = fir1(N-1, ${Wn}, ${fir1Type[band]}, ${win});`;
			return `${head}${kai}${body}${tail}`;
		}
		case 'ls': {
			const f = bandEdges(d.bands);
			const a = d.bands.flatMap((b) => [b.d1, b.d2]);
			return `${head}f = ${mlist(f)} / (fs/2);\na = ${mlist(a)};\nw = ${mlist(
				d.bands.map((b) => b.weight),
				6
			)};\nh = firls(N-1, f, a, w);${tail}`;
		}
		case 'fsamp': {
			const p = d.points!;
			const win = matlabWindow(cfg.window, N);
			const nf = 1 + Math.pow(2, Math.ceil(Math.log2(N)));
			const note =
				N % 2 === 0 && p.gain[p.gain.length - 1] !== 0
					? '\n% Note: an even N (type II) forces H(fs/2) = 0 but the desired response has gain there;\n% fir2 then raises the order, which no longer fits the window. Use an odd N, or the exported taps.'
					: '';
			return `${head}f = ${mlist(p.freq)} / (fs/2);\nm = ${mlist(p.gain)};\n% fir2 interpolates its grid slightly differently from SciPy's firwin2: expect tiny differences\nh = fir2(N-1, f, m, ${nf}, ${win});${note}${tail}`;
		}
		case 'pm': {
			const f = bandEdges(d.bands);
			const a = d.bands.flatMap((b) => [b.d1, b.d2]);
			const diff = d.symmetry === 'odd' && cfg.relWeight;
			const dw = diff ? differentiatorWeights(d.bands, fs) : null;
			const w = mlist(dw ?? d.bands.map((b) => b.weight), 6);
			const flag = d.symmetry === 'odd' ? (diff ? ", 'differentiator'" : ", 'hilbert'") : '';
			const note = !diff
				? ''
				: dw
					? "% 'differentiator' divides each ramp band's weight by f (in cycles/sample), so\n% w = W / (slope per cycle/sample) gives the page's W/|D| weighting\n"
					: "% 'differentiator' weights nonzero bands by 1/f, which cannot express this design's W/|D|\n% weighting: expect different taps (or use the exported ones)\n";
			return `${head}f = ${mlist(f)} / (fs/2);\na = ${mlist(a)};\nw = ${w};\n${note}h = firpm(N-1, f, a, w${flag});${tail}`;
		}
	}
}
