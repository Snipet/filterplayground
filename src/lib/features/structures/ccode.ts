/** C implementations of each structure with the actual coefficients. */
import { num } from '$lib/export';
import type { SOS } from '$lib/dsp/types';
import type { FirLattice, LatticeLadder, ParallelForm } from './realize';
import { sectionOrder } from './realize';

const f = (v: number) => {
	const s = num(Object.is(v, -0) ? 0 : v, 10);
	return (/[.e]/i.test(s) ? s : `${s}.0`) + 'f';
};
const arr = (vs: readonly number[]) => `{ ${vs.map(f).join(', ')} }`;
const pad = (v: readonly number[], n: number) => [...v, ...new Array(Math.max(0, n - v.length)).fill(0)];

export function codeDf1(b: readonly number[], a: readonly number[]): string {
	const M = b.length - 1;
	const N = a.length - 1;
	return `/* Direct form I: y[n] = sum b[k] x[n-k] - sum a[k] y[n-k],  a[0] = 1.
 * ${M + N} delays (past inputs and past outputs kept separately). */
static const float b[${M + 1}] = ${arr(b)};
static const float a[${N + 1}] = ${arr(a)};
${M > 0 ? `static float xh[${M}];   /* x[n-1] ... x[n-${M}] */\n` : ''}${N > 0 ? `static float yh[${N}];   /* y[n-1] ... y[n-${N}] */\n` : ''}
float df1_process(float x)
{
    float y = b[0] * x;
${M > 0 ? `    for (int k = 1; k <= ${M}; k++) y += b[k] * xh[k - 1];\n` : ''}${N > 0 ? `    for (int k = 1; k <= ${N}; k++) y -= a[k] * yh[k - 1];\n` : ''}
    /* shift the delay lines */
${M > 1 ? `    for (int k = ${M - 1}; k > 0; k--) xh[k] = xh[k - 1];\n` : ''}${N > 1 ? `    for (int k = ${N - 1}; k > 0; k--) yh[k] = yh[k - 1];\n` : ''}${M > 0 ? '    xh[0] = x;\n' : ''}${N > 0 ? '    yh[0] = y;\n' : ''}    return y;
}`;
}

export function codeDf2(bIn: readonly number[], aIn: readonly number[]): string {
	const K = Math.max(bIn.length, aIn.length) - 1;
	const b = pad(bIn, K + 1);
	const a = pad(aIn, K + 1);
	return `/* Direct form II (canonical): one delay line w shared by poles and zeros.
 *   w[n] = x[n] - sum a[k] w[n-k]
 *   y[n] = sum b[k] w[n-k] */
static const float b[${K + 1}] = ${arr(b)};
static const float a[${K + 1}] = ${arr(a)};   /* a[0] = 1 */
static float w[${Math.max(1, K)}];   /* w[n-1] ... w[n-${K}] */

float df2_process(float x)
{
    float wn = x;
    for (int k = 1; k <= ${K}; k++) wn -= a[k] * w[k - 1];
    float y = b[0] * wn;
    for (int k = 1; k <= ${K}; k++) y += b[k] * w[k - 1];
${K > 1 ? `    for (int k = ${K - 1}; k > 0; k--) w[k] = w[k - 1];\n` : ''}    w[0] = wn;
    return y;
}`;
}

export function codeTdf2(bIn: readonly number[], aIn: readonly number[], name = 'tdf2', comment = true): string {
	const K = Math.max(bIn.length, aIn.length) - 1;
	const b = pad(bIn, K + 1);
	const a = pad(aIn, K + 1);
	return `${comment ? `/* Transposed direct form II: the state s[k] holds partial sums.
 *   y[n]   = b[0] x[n] + s[0]
 *   s[k]   = b[k+1] x[n] - a[k+1] y[n] + s[k+1]
 *   s[K-1] = b[K] x[n] - a[K] y[n] */\n` : ''}static const float b[${K + 1}] = ${arr(b)};
static const float a[${K + 1}] = ${arr(a)};   /* a[0] = 1 */
static float s[${Math.max(1, K)}];

float ${name}_process(float x)
{
    float y = b[0] * x + s[0];
${K > 1 ? `    for (int k = 0; k < ${K - 1}; k++) s[k] = b[k + 1] * x - a[k + 1] * y + s[k + 1];\n` : ''}    s[${K - 1}] = b[${K}] * x - a[${K}] * y;
    return y;
}`;
}

export function codeCascade(sos: SOS): string {
	const L = sos.length;
	const rows = sos.map((r) => {
		const a0 = r[3] || 1;
		const n = r.map((v) => v / a0);
		return `    { ${f(n[0])}, ${f(n[1])}, ${f(n[2])}, ${f(n[4])}, ${f(n[5])} },`;
	});
	const orders = sos.map((r) => sectionOrder(r));
	return `/* Cascade of ${L} second-order section${L > 1 ? 's' : ''} (transposed direct form II each).
 * Section orders: ${orders.join(', ')}. Row: { b0, b1, b2, a1, a2 }, a0 = 1. */
#define NSEC ${L}
static const float c[NSEC][5] = {
${rows.join('\n')}
};
static float s[NSEC][2];

float cascade_process(float x)
{
    for (int i = 0; i < NSEC; i++) {
        const float *k = c[i];
        float y = k[0] * x + s[i][0];
        s[i][0] = k[1] * x - k[3] * y + s[i][1];
        s[i][1] = k[2] * x - k[4] * y;
        x = y;               /* output of this section feeds the next */
    }
    return x;
}`;
}

export function codeParallel(form: ParallelForm): string {
	const L = form.sections.length;
	const rows = form.sections.map((s) => {
		const b = pad(s.b, 2);
		const a = pad(s.a, 3);
		return `    { ${f(b[0])}, ${f(b[1])}, ${f(a[1])}, ${f(a[2])} },`;
	});
	const D = form.direct.length;
	const directCode =
		D === 0
			? ''
			: D === 1
				? `    y += ${f(form.direct[0])} * x;   /* direct term */\n`
				: `    /* direct (FIR) part, ${D} taps */\n    static float xd[${D - 1}];\n    y += d[0] * x;\n    for (int k = 1; k < ${D}; k++) y += d[k] * xd[k - 1];\n    for (int k = ${D - 2}; k > 0; k--) xd[k] = xd[k - 1];\n    xd[0] = x;\n`;
	return `/* Parallel form: H(z) = sum_i (b0 + b1 z^-1) / (1 + a1 z^-1 + a2 z^-2)${D ? ' + direct terms' : ''}.
 * Every section sees the same input; their outputs are added. Row: { b0, b1, a1, a2 }. */
#define NSEC ${L}
static const float c[NSEC][4] = {
${rows.join('\n')}
};
${D > 1 ? `static const float d[${D}] = ${arr(form.direct)};\n` : ''}static float s[NSEC][2];

float parallel_process(float x)
{
    float y = 0.0f;
    for (int i = 0; i < NSEC; i++) {
        const float *k = c[i];
        float yi = k[0] * x + s[i][0];
        s[i][0] = k[1] * x - k[2] * yi + s[i][1];
        s[i][1] = -k[3] * yi;
        y += yi;
    }
${directCode}    return y;
}`;
}

export function codeLatticeLadder(ll: LatticeLadder): string {
	const N = ll.k.length;
	return `/* IIR lattice-ladder (Gray-Markel).
 *   f_N = x;  for m = N..1:  f_{m-1} = f_m - k_m g_{m-1}[n-1],  g_m = k_m f_{m-1} + g_{m-1}[n-1]
 *   g_0 = f_0;  y = sum v_m g_m
 * Stable if and only if every |k_m| < 1. */
#define N ${N}
static const float k[N] = ${arr(ll.k)};       /* k[m-1] = k_m */
static const float v[N + 1] = ${arr(ll.v)};   /* ladder taps v_0 ... v_N */
static float g[N];                               /* g[m] = g_m[n-1] */

float lattice_process(float x)
{
    float gn[N + 1];
    float f = x;
    for (int m = N; m >= 1; m--) {
        f -= k[m - 1] * g[m - 1];
        gn[m] = k[m - 1] * f + g[m - 1];
    }
    gn[0] = f;
    float y = 0.0f;
    for (int m = 0; m <= N; m++) y += v[m] * gn[m];
    for (int m = 0; m < N; m++) g[m] = gn[m];
    return y;
}`;
}

export function codeFirLattice(fl: FirLattice): string {
	const M = fl.k.length;
	return `/* FIR lattice: f_0 = g_0 = x;  for m = 1..M:
 *   f_m = f_{m-1} + k_m g_{m-1}[n-1],   g_m = k_m f_{m-1} + g_{m-1}[n-1]
 *   y = h0 * f_M */
#define M ${M}
static const float k[M] = ${arr(fl.k)};
static const float h0 = ${f(fl.h0)};
static float g[M];   /* g[m] = g_m[n-1] */

float fir_lattice_process(float x)
{
    float gn[M];
    float f = x;
    gn[0] = x;
    for (int m = 1; m <= M; m++) {
        float fm = f + k[m - 1] * g[m - 1];
        float gm = k[m - 1] * f + g[m - 1];
        f = fm;
        if (m < M) gn[m] = gm;
    }
    for (int m = 0; m < M; m++) g[m] = gn[m];
    return h0 * f;
}`;
}

export function codeFir(h: readonly number[]): string {
	const M = h.length - 1;
	return `/* FIR direct form (tapped delay line): y[n] = sum h[k] x[n-k].
 * A circular buffer avoids shifting the delay line every sample. */
#define NTAPS ${M + 1}
static const float h[NTAPS] = ${arr(h)};
static float xbuf[NTAPS];
static int pos = 0;

float fir_process(float x)
{
    xbuf[pos] = x;
    float y = 0.0f;
    int idx = pos;
    for (int k = 0; k < NTAPS; k++) {
        y += h[k] * xbuf[idx];
        idx = (idx == 0) ? NTAPS - 1 : idx - 1;
    }
    pos = (pos + 1) % NTAPS;
    return y;
}`;
}

export function codeFirTransposed(h: readonly number[]): string {
	const M = h.length - 1;
	return `/* FIR transposed form: the input is broadcast to all taps and the
 * partial sums move through the delays towards the output.
 *   y[n] = h[0] x[n] + s[0];   s[k] = h[k+1] x[n] + s[k+1];   s[M-1] = h[M] x[n] */
#define M ${M}
static const float h[M + 1] = ${arr(h)};
static float s[M];

float fir_transposed_process(float x)
{
    float y = h[0] * x + s[0];
    for (int k = 0; k < M - 1; k++) s[k] = h[k + 1] * x + s[k + 1];
    s[M - 1] = h[M] * x;
    return y;
}`;
}
