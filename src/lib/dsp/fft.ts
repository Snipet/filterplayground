/** Radix-2 FFT and spectrum helpers. */

export const nextPow2 = (n: number): number => Math.pow(2, Math.ceil(Math.log2(Math.max(1, n))));

/** In-place iterative radix-2 FFT. `re` and `im` must have power-of-two length. */
export function fftInPlace(re: Float64Array, im: Float64Array, inverse = false): void {
	const n = re.length;
	if (n <= 1) return;
	// bit reversal
	for (let i = 1, j = 0; i < n; i++) {
		let bit = n >> 1;
		for (; j & bit; bit >>= 1) j ^= bit;
		j ^= bit;
		if (i < j) {
			[re[i], re[j]] = [re[j], re[i]];
			[im[i], im[j]] = [im[j], im[i]];
		}
	}
	for (let len = 2; len <= n; len <<= 1) {
		const ang = ((inverse ? 2 : -2) * Math.PI) / len;
		const wr = Math.cos(ang);
		const wi = Math.sin(ang);
		for (let i = 0; i < n; i += len) {
			let cr = 1;
			let ci = 0;
			const half = len >> 1;
			for (let k = 0; k < half; k++) {
				const a = i + k;
				const b = a + half;
				const tr = re[b] * cr - im[b] * ci;
				const ti = re[b] * ci + im[b] * cr;
				re[b] = re[a] - tr;
				im[b] = im[a] - ti;
				re[a] += tr;
				im[a] += ti;
				const ncr = cr * wr - ci * wi;
				ci = cr * wi + ci * wr;
				cr = ncr;
			}
		}
	}
	if (inverse) {
		for (let i = 0; i < n; i++) {
			re[i] /= n;
			im[i] /= n;
		}
	}
}

/** FFT of a real sequence zero-padded to `n` (power of two). */
export function fftReal(x: ArrayLike<number>, n = nextPow2(x.length)): { re: Float64Array; im: Float64Array } {
	const re = new Float64Array(n);
	const im = new Float64Array(n);
	for (let i = 0; i < Math.min(n, x.length); i++) re[i] = x[i];
	fftInPlace(re, im);
	return { re, im };
}

/**
 * Magnitude spectrum (one-sided, 0..fs/2) of a real sequence, zero padded to n.
 * Returns frequencies normalised to cycles/sample (0..0.5) and linear magnitudes.
 */
export function magnitudeSpectrum(x: ArrayLike<number>, n = nextPow2(Math.max(1024, x.length * 8))): { f: number[]; mag: number[] } {
	const { re, im } = fftReal(x, n);
	const half = n / 2;
	const f: number[] = [];
	const mag: number[] = [];
	for (let k = 0; k <= half; k++) {
		f.push(k / n);
		mag.push(Math.hypot(re[k], im[k]));
	}
	return { f, mag };
}

/** Welch power spectral density estimate (Hann window, 50 % overlap). Returns dB/bin. */
export function welchPsd(x: ArrayLike<number>, segment = 1024): { f: number[]; psdDb: number[] } {
	const n = nextPow2(segment);
	const hop = n / 2;
	const w = new Float64Array(n);
	let wsum = 0;
	for (let i = 0; i < n; i++) {
		w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
		wsum += w[i] * w[i];
	}
	const acc = new Float64Array(n / 2 + 1);
	let count = 0;
	for (let start = 0; start + n <= x.length; start += hop) {
		const re = new Float64Array(n);
		const im = new Float64Array(n);
		for (let i = 0; i < n; i++) re[i] = x[start + i] * w[i];
		fftInPlace(re, im);
		for (let k = 0; k <= n / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
		count++;
	}
	const f: number[] = [];
	const psdDb: number[] = [];
	for (let k = 0; k <= n / 2; k++) {
		f.push(k / n);
		const p = count ? acc[k] / (count * wsum) : 0;
		psdDb.push(10 * Math.log10(Math.max(p, 1e-30)));
	}
	return { f, psdDb };
}
