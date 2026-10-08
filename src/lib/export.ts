/** Coefficient formatting and code generation for exports. */
import type { Complex } from '$lib/dsp/complex';
import type { SOS, TF, ZPK } from '$lib/dsp/types';

/** Shortest round-trip representation, or fixed significant digits. */
export function num(v: number, digits?: number): string {
	if (!Number.isFinite(v)) return String(v);
	if (Object.is(v, -0)) v = 0;
	if (digits) return Number(v.toPrecision(digits)).toString();
	return String(v);
}

const indent = (s: string, n = 4) =>
	s
		.split('\n')
		.map((l) => ' '.repeat(n) + l)
		.join('\n');

const cplxPy = (z: Complex) => `${num(z.re)}${z.im < 0 ? '-' : '+'}${num(Math.abs(z.im))}j`;
const cplxM = (z: Complex) => `${num(z.re)}${z.im < 0 ? '-' : '+'}${num(Math.abs(z.im))}i`;

export type CType = 'double' | 'float';

// ---------------------------------------------------------------------------
// Plain data formats
// ---------------------------------------------------------------------------

export function sosToPython(sos: SOS, name = 'sos'): string {
	return `import numpy as np\n\n${name} = np.array([\n${sos.map((r) => `    [${r.map((v) => num(v)).join(', ')}],`).join('\n')}\n])`;
}

export function sosToMatlab(sos: SOS, name = 'sos'): string {
	return `${name} = [\n${sos.map((r) => `    ${r.map((v) => num(v)).join(', ')};`).join('\n')}\n];`;
}

export function sosToC(sos: SOS, name = 'sos', type: CType = 'double'): string {
	const suffix = type === 'float' ? 'f' : '';
	const f = (v: number) => {
		const s = num(v);
		return type === 'float' ? (/[.e]/i.test(s) ? s : `${s}.0`) + suffix : s;
	};
	return `/* ${sos.length} second-order section(s): { b0, b1, b2, a0, a1, a2 } */\nstatic const ${type} ${name}[${sos.length}][6] = {\n${sos.map((r) => `    { ${r.map(f).join(', ')} },`).join('\n')}\n};`;
}

export function sosToJson(sos: SOS): string {
	return JSON.stringify(
		sos.map((r) => r.map((v) => Number(num(v)))),
		null,
		2
	);
}

export function arrayToPython(name: string, a: readonly number[]): string {
	return `${name} = [${a.map((v) => num(v)).join(', ')}]`;
}

export function arrayToMatlab(name: string, a: readonly number[]): string {
	return `${name} = [${a.map((v) => num(v)).join(', ')}];`;
}

export function arrayToC(name: string, a: readonly number[], type: CType = 'double'): string {
	const f = (v: number) => {
		const s = num(v);
		return type === 'float' ? (/[.e]/i.test(s) ? s : `${s}.0`) + 'f' : s;
	};
	const rows: string[] = [];
	for (let i = 0; i < a.length; i += 4)
		rows.push(
			'    ' +
				a
					.slice(i, i + 4)
					.map(f)
					.join(', ') +
				','
		);
	return `static const ${type} ${name}[${a.length}] = {\n${rows.join('\n')}\n};`;
}

export function tfToPython(tf: TF): string {
	return `${arrayToPython('b', tf.b)}\n${arrayToPython('a', tf.a)}`;
}
export function tfToMatlab(tf: TF): string {
	return `${arrayToMatlab('b', tf.b)}\n${arrayToMatlab('a', tf.a)}`;
}
export function tfToC(tf: TF, type: CType = 'double'): string {
	return `${arrayToC('b', tf.b, type)}\n${arrayToC('a', tf.a, type)}`;
}

export function zpkToPython(zpk: ZPK): string {
	return `z = [${zpk.z.map(cplxPy).join(', ')}]\np = [${zpk.p.map(cplxPy).join(', ')}]\nk = ${num(zpk.k)}`;
}
export function zpkToMatlab(zpk: ZPK): string {
	return `z = [${zpk.z.map(cplxM).join('; ')}];\np = [${zpk.p.map(cplxM).join('; ')}];\nk = ${num(zpk.k)};`;
}

export function toCsv(rows: (string | number)[][]): string {
	return rows.map((r) => r.join(',')).join('\n');
}

// ---------------------------------------------------------------------------
// Fixed point
// ---------------------------------------------------------------------------

/** Quantise to signed fixed point with `frac` fractional bits and `bits` total bits. */
export function toFixed(v: number, bits: number, frac: number): number {
	const scale = Math.pow(2, frac);
	const max = Math.pow(2, bits - 1) - 1;
	const min = -Math.pow(2, bits - 1);
	return Math.max(min, Math.min(max, Math.round(v * scale)));
}

/** Word lengths accepted for fixed-point export (sign bit included). */
export const FIXED_BITS_MIN = 4;
export const FIXED_BITS_MAX = 32;

/**
 * Sanitise a fixed-point word length: an integer in [FIXED_BITS_MIN, FIXED_BITS_MAX], or
 * `fallback` when it is not a finite number (an empty number field binds as null).
 */
export function clampFixedBits(bits: number | null | undefined, fallback = 16): number {
	if (typeof bits !== 'number' || !Number.isFinite(bits)) return fallback;
	return Math.min(FIXED_BITS_MAX, Math.max(FIXED_BITS_MIN, Math.round(bits)));
}

export interface FixedFormat {
	/** Total word length, sign bit included. */
	bits: number;
	/** Integer bits besides the sign bit (Q intBits.frac, ARM notation). */
	intBits: number;
	/** Fractional bits: value = integer / 2^frac. */
	frac: number;
	/** Largest |h|. */
	maxAbs: number;
	/** Values that still saturate with frac = 0 (|h| beyond the integer range of the word). */
	clipped: number;
}

/**
 * Q format for a coefficient set: the most fractional bits for which no rounded value
 * saturates, i.e. Q0.(bits−1) when every |h| < 1, one integer bit per doubling beyond.
 */
export function fixedFormat(h: readonly number[], bits = 16): FixedFormat {
	const b = clampFixedBits(bits);
	const max = Math.pow(2, b - 1) - 1;
	const min = -Math.pow(2, b - 1);
	const saturated = (frac: number) =>
		h.filter((v) => {
			const r = Math.round(v * Math.pow(2, frac));
			return r > max || r < min;
		}).length;
	let intBits = 0;
	while (intBits < b - 1 && saturated(b - 1 - intBits) > 0) intBits++;
	const frac = b - 1 - intBits;
	const maxAbs = h.reduce((m, v) => (Number.isFinite(v) ? Math.max(m, Math.abs(v)) : m), 0);
	return { bits: b, intBits, frac, maxAbs, clipped: saturated(frac) };
}

export function firToFixedC(h: readonly number[], bits = 16, name = 'h'): string {
	const { bits: b, intBits, frac, maxAbs, clipped } = fixedFormat(h, bits);
	const ints = h.map((v) => toFixed(v, b, frac));
	const type = b <= 8 ? 'int8_t' : b <= 16 ? 'int16_t' : 'int32_t';
	const rows: string[] = [];
	for (let i = 0; i < ints.length; i += 8)
		rows.push('    ' + ints.slice(i, i + 8).join(', ') + ',');
	const notes = [`/* Q${intBits}.${frac} coefficients, ${b}-bit (value = integer / 2^${frac}) */`];
	if (intBits > 0)
		notes.push(
			`/* max |h| = ${num(maxAbs, 6)} does not fit Q0.${b - 1} [-1, 1), so ${intBits} integer bit${intBits > 1 ? 's are' : ' is'} used */`
		);
	if (clipped > 0)
		notes.push(
			`/* WARNING: ${clipped} tap${clipped > 1 ? 's exceed' : ' exceeds'} the ${b}-bit range even as integers and ${clipped > 1 ? 'were' : 'was'} clipped */`
		);
	return `${notes.join('\n')}\n#include <stdint.h>\nstatic const ${type} ${name}[${ints.length}] = {\n${rows.join('\n')}\n};`;
}

// ---------------------------------------------------------------------------
// Implementations
// ---------------------------------------------------------------------------

export function sosImplementationC(sos: SOS, type: CType = 'float', name = 'filter'): string {
	const n = sos.length;
	const norm = sos.map((r) => r.map((v) => v / (r[3] || 1)));
	const f = (v: number) => {
		const s = num(v);
		return type === 'float' ? (/[.e]/i.test(s) ? s : `${s}.0`) + 'f' : s;
	};
	return `/* Biquad cascade, transposed direct form II. Coefficients normalised so a0 = 1. */
#define ${name.toUpperCase()}_NSEC ${n}

typedef struct {
    ${type} b0, b1, b2, a1, a2; /* coefficients */
    ${type} z1, z2;             /* state */
} biquad_t;

static biquad_t ${name}_sections[${name.toUpperCase()}_NSEC] = {
${norm.map((r) => `    { ${f(r[0])}, ${f(r[1])}, ${f(r[2])}, ${f(r[4])}, ${f(r[5])}, 0, 0 },`).join('\n')}
};

static inline ${type} biquad_process(biquad_t *s, ${type} x)
{
    ${type} y = s->b0 * x + s->z1;
    s->z1 = s->b1 * x - s->a1 * y + s->z2;
    s->z2 = s->b2 * x - s->a2 * y;
    return y;
}

${type} ${name}_process(${type} x)
{
    for (int i = 0; i < ${name.toUpperCase()}_NSEC; i++)
        x = biquad_process(&${name}_sections[i], x);
    return x;
}

void ${name}_reset(void)
{
    for (int i = 0; i < ${name.toUpperCase()}_NSEC; i++)
        ${name}_sections[i].z1 = ${name}_sections[i].z2 = 0;
}`;
}

export function firImplementationC(
	h: readonly number[],
	type: CType = 'float',
	name = 'fir'
): string {
	return `${arrayToC(`${name}_taps`, h, type)}

#define ${name.toUpperCase()}_LEN ${h.length}
static ${type} ${name}_delay[${name.toUpperCase()}_LEN];
static int ${name}_pos = 0;

/* Direct-form FIR with a circular delay line. */
${type} ${name}_process(${type} x)
{
    ${name}_delay[${name}_pos] = x;
    ${type} acc = 0;
    int idx = ${name}_pos;
    for (int k = 0; k < ${name.toUpperCase()}_LEN; k++) {
        acc += ${name}_taps[k] * ${name}_delay[idx];
        idx = (idx == 0) ? ${name.toUpperCase()}_LEN - 1 : idx - 1;
    }
    ${name}_pos = (${name}_pos + 1) % ${name.toUpperCase()}_LEN;
    return acc;
}`;
}

export function sosImplementationJs(sos: SOS): string {
	const norm = sos.map((r) => r.map((v) => v / (r[3] || 1)));
	return `// Biquad cascade (transposed direct form II), a0 = 1
const sos = ${JSON.stringify(norm.map((r) => [r[0], r[1], r[2], r[4], r[5]]))}; // [b0, b1, b2, a1, a2]

export function makeFilter() {
  const state = sos.map(() => [0, 0]);
  return function process(x) {
    for (let i = 0; i < sos.length; i++) {
      const [b0, b1, b2, a1, a2] = sos[i];
      const z = state[i];
      const y = b0 * x + z[0];
      z[0] = b1 * x - a1 * y + z[1];
      z[1] = b2 * x - a2 * y;
      x = y;
    }
    return x;
  };
}`;
}

export function sosScipyUsage(sos: SOS, fs: number): string {
	return `${sosToPython(sos)}

from scipy import signal
fs = ${num(fs)}
y = signal.sosfilt(sos, x)                  # filter a signal x
w, h = signal.sosfreqz(sos, worN=4096, fs=fs)  # frequency response`;
}

export { indent };
