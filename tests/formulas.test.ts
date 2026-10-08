/**
 * Numerical checks of the less obvious statements on the Formula Reference page
 * (src/lib/features/formulas). Each block names the formula it verifies.
 */
import { describe, expect, it } from 'vitest';
import { type Complex, abs, add, c, div, exp, mul, sub } from '../src/lib/dsp/complex';
import { cde, ellipk, sne } from '../src/lib/dsp/elliptic';
import { besselap, buttap, cheb1ap, cheb2ap, ellipap } from '../src/lib/dsp/analog';
import { freqsZpk } from '../src/lib/dsp/response';
import { biquad } from '../src/lib/dsp/biquad';

/** Bisection for f(x) = 0 on [a, b]. */
function bisect(f: (x: number) => number, a: number, b: number): number {
	let fa = f(a);
	for (let i = 0; i < 200; i++) {
		const m = (a + b) / 2;
		const fm = f(m);
		if (fa * fm <= 0) b = m;
		else {
			a = m;
			fa = fm;
		}
	}
	return (a + b) / 2;
}

/** Composite Simpson integration. */
function simpson(f: (x: number) => number, a: number, b: number, n = 20000): number {
	const h = (b - a) / n;
	let s = f(a) + f(b);
	for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
	return (s * h) / 3;
}

const matchRoots = (a: Complex[], b: Complex[], tol: number) => {
	expect(a.length).toBe(b.length);
	const used = new Array(b.length).fill(false);
	for (const r of a) {
		let best = -1;
		let bd = Infinity;
		b.forEach((s, i) => {
			if (used[i]) return;
			const d = abs(sub(r, s));
			if (d < bd) {
				bd = d;
				best = i;
			}
		});
		used[best] = true;
		expect(bd).toBeLessThan(tol);
	}
};

describe('analog prototypes', () => {
	it('Bessel θN coefficients and −3 dB frequencies (delay-normalised)', () => {
		const table = [1.0, 1.3617, 1.7557, 2.1139, 2.4274, 2.7034];
		const fact = (n: number): number => (n <= 1 ? 1 : n * fact(n - 1));
		for (let N = 1; N <= 6; N++) {
			const a = Array.from(
				{ length: N + 1 },
				(_, k) => fact(2 * N - k) / (Math.pow(2, N - k) * fact(k) * fact(N - k))
			);
			// recurrence θN = (2N−1)θN−1 + s²θN−2 reproduces the closed form
			const mag = (w: number) => {
				let re = 0;
				let im = 0;
				for (let k = 0; k <= N; k++) {
					// (jw)^k
					const pk = Math.pow(w, k);
					const ph = k % 4;
					if (ph === 0) re += a[k] * pk;
					else if (ph === 1) im += a[k] * pk;
					else if (ph === 2) re -= a[k] * pk;
					else im -= a[k] * pk;
				}
				return a[0] / Math.hypot(re, im);
			};
			const w3 = bisect((w) => mag(w) - Math.SQRT1_2, 0.1, 10);
			expect(w3).toBeCloseTo(table[N - 1], 4);
			// matches the library's delay-normalised Bessel prototype
			const proto = besselap(N, 'delay');
			const h = abs(freqsZpk(proto, [w3])[0]) / abs(freqsZpk(proto, [0])[0]);
			expect(h).toBeCloseTo(Math.SQRT1_2, 6);
		}
	});

	it('Bessel recurrence', () => {
		// θ2 = 3θ1 + s²θ0 → s² + 3s + 3; θ3 = 5θ2 + s²θ1
		const t1 = [1, 1];
		const t2 = [1, 3, 3];
		const t3 = [1, 6, 15, 15];
		const rec = (prev: number[], prev2: number[], N: number) => {
			const a = prev.map((v) => v * (2 * N - 1));
			const b = [...prev2, 0, 0];
			const out = new Array(b.length).fill(0);
			for (let i = 0; i < b.length; i++) out[i] = b[i] + (a[i - (b.length - a.length)] ?? 0);
			return out;
		};
		expect(rec(t1, [1], 2)).toEqual(t2);
		expect(rec(t2, t1, 3)).toEqual(t3);
		expect(rec(t3, t2, 4)).toEqual([1, 10, 45, 105, 105]);
	});

	it('Butterworth pole formula and per-pair Q', () => {
		const N = 5;
		const p: Complex[] = [];
		for (let k = 1; k <= N; k++) p.push(exp(c(0, (Math.PI * (2 * k + N - 1)) / (2 * N))));
		matchRoots(p, buttap(N).p, 1e-12);
		const th = ((2 * 1 - 1) * Math.PI) / (2 * N);
		expect(1 / (2 * Math.sin(th))).toBeCloseTo(1.618, 3); // N=5 highest Q pair
	});

	it('Chebyshev I poles and −3 dB frequency', () => {
		const N = 5;
		const rp = 1;
		const eps = Math.sqrt(Math.pow(10, rp / 10) - 1);
		const mu = Math.asinh(1 / eps) / N;
		const p: Complex[] = [];
		for (let k = 1; k <= N; k++) {
			const th = ((2 * k - 1) * Math.PI) / (2 * N);
			p.push(c(-Math.sinh(mu) * Math.sin(th), Math.cosh(mu) * Math.cos(th)));
		}
		const proto = cheb1ap(N, rp);
		matchRoots(p, proto.p, 1e-10);
		const w3 = Math.cosh(Math.acosh(1 / eps) / N);
		expect(20 * Math.log10(abs(freqsZpk(proto, [w3])[0]))).toBeCloseTo(-3.0103, 4);
	});

	it('Chebyshev II zeros at ±j·sec θk and reciprocal poles', () => {
		const N = 5;
		const rs = 40;
		const eps = 1 / Math.sqrt(Math.pow(10, rs / 10) - 1);
		const mu = Math.asinh(1 / eps) / N;
		const zeros: Complex[] = [];
		const poles: Complex[] = [];
		for (let k = 1; k <= N; k++) {
			const th = ((2 * k - 1) * Math.PI) / (2 * N);
			if (Math.abs(Math.cos(th)) > 1e-9) zeros.push(c(0, 1 / Math.cos(th)));
			poles.push(div(c(1), c(-Math.sinh(mu) * Math.sin(th), Math.cosh(mu) * Math.cos(th))));
		}
		const proto = cheb2ap(N, rs);
		matchRoots(zeros, proto.z, 1e-9);
		matchRoots(poles, proto.p, 1e-9);
		// exactly Rs at ω = 1
		expect(20 * Math.log10(abs(freqsZpk(proto, [1])[0]))).toBeCloseTo(-rs, 6);
	});

	it('elliptic zeros, poles and v0 = F(arctan(1/εp), k1′)/(N·K(k1))', () => {
		for (const [N, rp, rs] of [
			[4, 1, 40],
			[5, 0.5, 60],
			[6, 0.1, 80]
		]) {
			const ep = Math.sqrt(Math.pow(10, rp / 10) - 1);
			const es = Math.sqrt(Math.pow(10, rs / 10) - 1);
			const k1 = ep / es;
			const k1p = Math.sqrt(1 - k1 * k1);
			// incomplete elliptic integral of the first kind by quadrature
			const phi = Math.atan(1 / ep);
			const F = simpson((x) => 1 / Math.sqrt(1 - k1p * k1p * Math.sin(x) ** 2), 0, phi);
			const v0 = F / (N * ellipk(k1));
			const proto = ellipap(N, rp, rs);
			// recover the selectivity k from the zeros: smallest zero magnitude is 1/(k·cd(K/N))
			// instead, use the degree equation via ellipdeg-equivalent: search k so that zeros match
			const zerosFor = (k: number) => {
				const out: Complex[] = [];
				for (let i = 1; i <= Math.floor(N / 2); i++) {
					const zi = div(c(0, 1), c(k * cde(c((2 * i - 1) / N), k).re));
					out.push(zi, c(0, -zi.im));
				}
				return out;
			};
			const minZero = Math.min(...proto.z.map((z) => Math.abs(z.im)));
			const k = bisect(
				(kk) => Math.min(...zerosFor(kk).map((z) => Math.abs(z.im))) - minZero,
				0.01,
				0.999999
			);
			matchRoots(zerosFor(k), proto.z, 1e-6);
			const poles: Complex[] = [];
			for (let i = 1; i <= Math.floor(N / 2); i++) {
				const u = (2 * i - 1) / N;
				const p = mul(c(0, 1), cde(c(u, -v0), k));
				poles.push(p, c(p.re, -p.im));
			}
			if (N % 2) poles.push(mul(c(0, 1), sne(c(0, v0), k)));
			matchRoots(poles, proto.p, 1e-6);
		}
	});
});

describe('second-order sections', () => {
	const w0 = 1;
	const H = (num: (s: Complex) => Complex, q: number) => (w: number) => {
		const s = c(0, w);
		const den = add(add(mul(s, s), mul(c(w0 / q), s)), c(w0 * w0));
		return div(num(s), den);
	};
	it('low-pass −3 dB frequency formula', () => {
		for (const q of [0.5, 0.7071, 1, 3]) {
			const z = 1 / (2 * q);
			const w3 = w0 * Math.sqrt(1 - 2 * z * z + Math.sqrt((1 - 2 * z * z) ** 2 + 1));
			const lp = H(() => c(w0 * w0), q);
			expect(abs(lp(w3))).toBeCloseTo(Math.SQRT1_2, 10);
		}
	});
	it('all-pass group delay 4Q/ω0 at ω0', () => {
		const q = 2.5;
		const ap = H((s) => add(sub(mul(s, s), mul(c(w0 / q), s)), c(w0 * w0)), q);
		const ph = (w: number) => Math.atan2(ap(w).im, ap(w).re);
		const d = 1e-6;
		let dphi = ph(w0 + d) - ph(w0 - d);
		if (dphi > Math.PI) dphi -= 2 * Math.PI;
		if (dphi < -Math.PI) dphi += 2 * Math.PI;
		expect(-dphi / (2 * d)).toBeCloseTo((4 * q) / w0, 5);
		expect(Math.abs(ph(w0))).toBeCloseTo(Math.PI, 6);
	});
	it('peaking section gain A² at ω0', () => {
		const A = 2;
		const q = 1.3;
		const s = c(0, w0);
		const num = add(add(mul(s, s), mul(c((A * w0) / q), s)), c(w0 * w0));
		const den = add(add(mul(s, s), mul(c(w0 / (A * q)), s)), c(w0 * w0));
		expect(abs(div(num, den))).toBeCloseTo(A * A, 12);
	});
});

describe('digital formulas', () => {
	it('Constantinides LP→LP maps ωp onto θp', () => {
		const thetaP = 0.3 * Math.PI;
		const omegaP = 0.55 * Math.PI;
		const alpha = Math.sin((thetaP - omegaP) / 2) / Math.sin((thetaP + omegaP) / 2);
		const zi = exp(c(0, -omegaP));
		const Z = div(sub(zi, c(alpha)), sub(c(1), mul(c(alpha), zi)));
		expect(abs(Z)).toBeCloseTo(1, 12);
		expect(-Math.atan2(Z.im, Z.re)).toBeCloseTo(thetaP, 10);
	});
	it('Constantinides LP→HP maps ωp onto ±θp (and Nyquist onto DC)', () => {
		const thetaP = 0.3 * Math.PI;
		const omegaP = 0.6 * Math.PI;
		const alpha = -Math.cos((thetaP + omegaP) / 2) / Math.cos((thetaP - omegaP) / 2);
		const map = (w: number) => {
			const zi = exp(c(0, -w));
			const Z = mul(c(-1), div(add(zi, c(alpha)), add(c(1), mul(c(alpha), zi))));
			return Math.abs(Math.atan2(Z.im, Z.re));
		};
		expect(map(omegaP)).toBeCloseTo(thetaP, 10);
		expect(map(Math.PI - 1e-9)).toBeCloseTo(0, 6);
	});
	it('group delay of a zero factor (1 − r e^{jθ} z⁻¹)', () => {
		const r = 0.8;
		const th = 0.7;
		const phase = (w: number) => {
			const v = sub(c(1), mul(c(r * Math.cos(th), r * Math.sin(th)), exp(c(0, -w))));
			return Math.atan2(v.im, v.re);
		};
		for (const w of [0.2, 0.7, 2]) {
			const num = -(phase(w + 1e-6) - phase(w - 1e-6)) / 2e-6;
			const x = w - th;
			expect(num).toBeCloseTo((r * r - r * Math.cos(x)) / (1 - 2 * r * Math.cos(x) + r * r), 6);
		}
	});
	it('RBJ shelf/peaking gains and BPF peak = Q', () => {
		const fs = 48000;
		const ev = (sec: number[], f: number) => {
			const zi = exp(c(0, (-2 * Math.PI * f) / fs));
			const z2 = mul(zi, zi);
			const num = add(add(c(sec[0]), mul(c(sec[1]), zi)), mul(c(sec[2]), z2));
			const den = add(add(c(sec[3]), mul(c(sec[4]), zi)), mul(c(sec[5]), z2));
			return abs(div(num, den));
		};
		expect(
			20 * Math.log10(ev(biquad({ type: 'peaking', f0: 1000, fs, q: 2, gainDb: 9 }), 1000))
		).toBeCloseTo(9, 9);
		expect(
			20 * Math.log10(ev(biquad({ type: 'lowshelf', f0: 1000, fs, q: 0.7, gainDb: 6 }), 0))
		).toBeCloseTo(6, 9);
		expect(
			20 * Math.log10(ev(biquad({ type: 'highshelf', f0: 1000, fs, q: 0.7, gainDb: -6 }), fs / 2))
		).toBeCloseTo(-6, 9);
		expect(ev(biquad({ type: 'bandpass-peak', f0: 1000, fs, q: 4 }), 1000)).toBeCloseTo(4, 9);
	});
});

describe('misc', () => {
	it('Butterworth noise bandwidth', () => {
		for (const N of [1, 2, 3, 4]) {
			const integral =
				simpson((x) => 1 / (1 + Math.pow(x, 2 * N)), 0, 2000, 400000) +
				1 / ((2 * N - 1) * Math.pow(2000, 2 * N - 1));
			expect(integral).toBeCloseTo(Math.PI / (2 * N) / Math.sin(Math.PI / (2 * N)), 4);
		}
	});
	it('ZOH droop at Nyquist and quantisation SNR', () => {
		expect(20 * Math.log10(Math.sin(Math.PI / 2) / (Math.PI / 2))).toBeCloseTo(-3.92, 2);
		// full-scale sine power A²/2 over q²/12 with q = 2A/2^B
		const B = 16;
		const snr = 10 * Math.log10((0.5 * 12 * Math.pow(2, 2 * B)) / 4);
		expect(snr).toBeCloseTo(6.0206 * B + 1.7609, 3);
	});
});
