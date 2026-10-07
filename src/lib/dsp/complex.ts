/**
 * Minimal complex-number toolkit. Values are plain `{ re, im }` objects so they
 * can be stored in Svelte state, serialised to JSON and compared cheaply.
 */
export interface Complex {
	re: number;
	im: number;
}

export const c = (re: number, im = 0): Complex => ({ re, im });
export const ZERO: Complex = Object.freeze({ re: 0, im: 0 }) as Complex;
export const ONE: Complex = Object.freeze({ re: 1, im: 0 }) as Complex;
export const J: Complex = Object.freeze({ re: 0, im: 1 }) as Complex;

export const add = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im });
export const sub = (a: Complex, b: Complex): Complex => ({ re: a.re - b.re, im: a.im - b.im });
export const mul = (a: Complex, b: Complex): Complex => ({
	re: a.re * b.re - a.im * b.im,
	im: a.re * b.im + a.im * b.re
});
export const scale = (a: Complex, s: number): Complex => ({ re: a.re * s, im: a.im * s });
export const neg = (a: Complex): Complex => ({ re: -a.re, im: -a.im });
export const conj = (a: Complex): Complex => ({ re: a.re, im: -a.im });

export function div(a: Complex, b: Complex): Complex {
	// Smith's algorithm for robustness against overflow.
	if (Math.abs(b.re) >= Math.abs(b.im)) {
		if (b.re === 0 && b.im === 0) return { re: a.re / 0, im: a.im / 0 };
		const r = b.im / b.re;
		const d = b.re + b.im * r;
		return { re: (a.re + a.im * r) / d, im: (a.im - a.re * r) / d };
	}
	const r = b.re / b.im;
	const d = b.re * r + b.im;
	return { re: (a.re * r + a.im) / d, im: (a.im * r - a.re) / d };
}

export const inv = (a: Complex): Complex => div(ONE, a);
export const abs = (a: Complex): number => Math.hypot(a.re, a.im);
export const abs2 = (a: Complex): number => a.re * a.re + a.im * a.im;
export const arg = (a: Complex): number => Math.atan2(a.im, a.re);
export const polar = (r: number, theta: number): Complex => ({
	re: r * Math.cos(theta),
	im: r * Math.sin(theta)
});

export function exp(a: Complex): Complex {
	const m = Math.exp(a.re);
	return { re: m * Math.cos(a.im), im: m * Math.sin(a.im) };
}

export function log(a: Complex): Complex {
	return { re: Math.log(abs(a)), im: arg(a) };
}

/** Principal square root (branch cut on the negative real axis). */
export function sqrt(a: Complex): Complex {
	if (a.im === 0) {
		return a.re >= 0 ? { re: Math.sqrt(a.re), im: 0 } : { re: 0, im: Math.sqrt(-a.re) };
	}
	const m = abs(a);
	const re = Math.sqrt((m + a.re) / 2);
	const im = Math.sign(a.im) * Math.sqrt((m - a.re) / 2);
	return { re, im };
}

export function pow(a: Complex, n: number): Complex {
	if (Number.isInteger(n) && Math.abs(n) <= 64) {
		let result = ONE;
		let base = n < 0 ? inv(a) : a;
		let k = Math.abs(n);
		while (k > 0) {
			if (k & 1) result = mul(result, base);
			base = mul(base, base);
			k >>= 1;
		}
		return result;
	}
	if (a.re === 0 && a.im === 0) return ZERO;
	return exp(scale(log(a), n));
}

export function sin(a: Complex): Complex {
	return { re: Math.sin(a.re) * Math.cosh(a.im), im: Math.cos(a.re) * Math.sinh(a.im) };
}

export function cos(a: Complex): Complex {
	return { re: Math.cos(a.re) * Math.cosh(a.im), im: -Math.sin(a.re) * Math.sinh(a.im) };
}

/** Principal complex arcsine: asin(w) = -j·log(j·w + sqrt(1 − w²)). */
export function asin(w: Complex): Complex {
	const s = sqrt(sub(ONE, mul(w, w)));
	const t = log(add(mul(J, w), s));
	return { re: t.im, im: -t.re };
}

/** Principal complex arccosine: acos(w) = π/2 − asin(w). */
export function acos(w: Complex): Complex {
	const a = asin(w);
	return { re: Math.PI / 2 - a.re, im: -a.im };
}

export const isReal = (a: Complex, tol = 1e-9): boolean =>
	Math.abs(a.im) <= tol * Math.max(1, Math.abs(a.re));

export const equals = (a: Complex, b: Complex, tol = 1e-9): boolean =>
	abs(sub(a, b)) <= tol * Math.max(1, abs(a), abs(b));

export function format(a: Complex, digits = 4): string {
	const re = Number(a.re.toPrecision(digits));
	const im = Number(Math.abs(a.im).toPrecision(digits));
	if (Math.abs(a.im) < 1e-12 * Math.max(1, Math.abs(a.re))) return `${re}`;
	if (Math.abs(a.re) < 1e-12 * Math.max(1, Math.abs(a.im))) return `${a.im < 0 ? '−' : ''}${im}j`;
	return `${re} ${a.im < 0 ? '−' : '+'} ${im}j`;
}
