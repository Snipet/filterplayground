/**
 * Regression tests for elliptic design at extreme moduli: the discrimination
 * modulus k1 = εp/εs is ~1e-8 at Rp 0.01 dB / Rs 140 dB, and the selectivity k
 * rounds to 1 for high orders with loose specs (Rp 6 dB / Rs 10 dB). Forming
 * √(1−k²) there used to give NaN prototypes, wrong orders and missed stopbands.
 * Reference values from SciPy 1.18 (scipy.special.ellipk/ellipkm1, scipy.signal.ellipap/ellipord).
 */
import { describe, expect, it } from 'vitest';
import { abs, c } from '../src/lib/dsp/complex';
import { ellipap, ellipSelectivity, estimateOrder } from '../src/lib/dsp/analog';
import { designDigital } from '../src/lib/dsp/design';
import { cde, ellipdeg, ellipdegPair, ellipk, ellipkp, kprime, sne } from '../src/lib/dsp/elliptic';
import { freqsZpk, freqzSos } from '../src/lib/dsp/response';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const geom = (a: number, b: number, n: number) =>
	Array.from({ length: n }, (_, i) => a * Math.pow(b / a, i / (n - 1)));
const attDb = (zpk: ReturnType<typeof ellipap>, w: number[]) =>
	freqsZpk(zpk, w).map((h) => -20 * Math.log10(abs(h)));

describe('complete elliptic integrals near k = 0 and k = 1', () => {
	it("K'(k) is finite and accurate for tiny k (SciPy ellipkm1)", () => {
		expect(rel(ellipkp(1e-12), 29.017315477048438)).toBeLessThan(1e-14);
		expect(rel(ellipkp(1e-8), 19.806975105072254)).toBeLessThan(1e-14);
		expect(rel(ellipkp(1e-3), 8.294051463615439)).toBeLessThan(1e-14);
		expect(rel(ellipkp(0.5), 2.156515647499643)).toBeLessThan(1e-14);
		expect(rel(ellipkp(0.9), 1.654616667522527)).toBeLessThan(1e-14);
		expect(ellipkp(0)).toBe(Infinity);
	});

	it('K(k) accepts the complementary modulus when k rounds to 1', () => {
		for (const [kp, K] of [
			[1e-12, 29.017315477048438],
			[1e-8, 19.806975105072254],
			[1e-4, 10.596634757087662]
		]) {
			expect(rel(ellipk(kprime(kp), kp), K)).toBeLessThan(1e-14);
		}
		expect(rel(ellipk(0.5), 1.685750354812596)).toBeLessThan(1e-14);
		expect(rel(ellipk(0.9), 2.2805491384227703)).toBeLessThan(1e-14);
		expect(ellipk(1)).toBe(Infinity);
	});

	it("sn(K/2, k) = cd(K/2, k) = 1/√(1+k') with k' carried explicitly", () => {
		for (const kp of [1e-14, 1e-10, 1e-6, 0.3, 0.9]) {
			const k = kprime(kp); // rounds to exactly 1 for kp ≤ 1e-8
			const exact = 1 / Math.sqrt(1 + kp);
			expect(sne(c(0.5), k, kp).re).toBeCloseTo(exact, 15);
			expect(cde(c(0.5), k, kp).re).toBeCloseTo(exact, 15);
		}
	});
});

describe('degree equation (ellipdeg)', () => {
	it("satisfies N·K'/K = K'1/K1 in both the k → 0 and the k → 1 regime", () => {
		for (const [N, k1] of [
			[2, 1e-9],
			[6, 1e-8],
			[13, 1e-8],
			[4, 0.1],
			[18, 0.576],
			[20, 0.576]
		]) {
			const { k, kp } = ellipdegPair(N, k1);
			expect(k * k + kp * kp).toBeCloseTo(1, 14);
			const lhs = (N * ellipkp(k)) / ellipk(k, kp);
			const rhs = ellipkp(k1) / ellipk(k1);
			expect(rel(lhs, rhs)).toBeLessThan(1e-12);
		}
		// k rounds to 1 here; the complement keeps the information
		const hi = ellipdegPair(18, 0.576);
		expect(hi.k).toBe(1);
		expect(hi.kp).toBeGreaterThan(1e-11);
		expect(hi.kp).toBeLessThan(1e-9);
	});

	it('matches SciPy selectivities for Rp 0.01 dB and Rs up to 140 dB', () => {
		expect(rel(ellipSelectivity(6, 0.01, 140), 0.12984733966310225)).toBeLessThan(1e-12);
		expect(rel(ellipSelectivity(12, 0.01, 134), 0.6660416172292613)).toBeLessThan(1e-12);
		expect(rel(ellipSelectivity(2, 0.01, 140), 0.00013858267489361026)).toBeLessThan(1e-12);
		expect(rel(ellipSelectivity(7, 0.05, 140), 0.23528441744524473)).toBeLessThan(1e-12);
		expect(rel(ellipSelectivity(4, 1, 40), 0.6598551690140828)).toBeLessThan(1e-12);
		// Rs 130…134 used to collapse onto one design
		const ks = [130, 131, 132, 133, 134].map((rs) => ellipSelectivity(6, 0.01, rs));
		for (let i = 1; i < ks.length; i++) expect(ks[i]).toBeLessThan(ks[i - 1]);
		expect(ellipdeg(6, 1e-8)).toBe(ellipdegPair(6, 1e-8).k);
	});
});

describe('ellipap at tight specs (k1 ≈ 1e-8)', () => {
	it('Rp 0.01 / Rs 140, N = 6 is finite and matches SciPy', () => {
		const z = ellipap(6, 0.01, 140);
		for (const r of [...z.z, ...z.p]) {
			expect(Number.isFinite(r.re) && Number.isFinite(r.im)).toBe(true);
		}
		expect(rel(z.k, 9.999999999999985e-8)).toBeLessThan(1e-10);
		expect(rel(Math.min(...z.z.map((q) => Math.abs(q.im))), 7.970762529427805)).toBeLessThan(1e-12);
		const p = z.p.find((q) => q.im > 0 && Math.abs(q.re + 0.6429681456473753) < 1e-6)!;
		expect(p).toBeDefined();
		expect(p.im).toBeCloseTo(0.31328954922937735, 12);
		expect(p.re).toBeCloseTo(-0.6429681456473753, 12);
	});

	it('odd order: N = 7, Rp 0.05 / Rs 140 real pole and gain match SciPy', () => {
		const z = ellipap(7, 0.05, 140);
		const real = z.p.filter((q) => q.im === 0);
		expect(real).toHaveLength(1);
		expect(real[0].re).toBeCloseTo(-0.43747190690245474, 12);
		expect(rel(z.k, 2.9332130496341748e-6)).toBeLessThan(1e-10);
	});

	it('meets Rp exactly in the passband and Rs exactly from ωs = 1/k on', () => {
		for (const rs of [120, 125, 130, 131, 133, 134, 140]) {
			for (const N of [2, 3, 6, 7, 12]) {
				const z = ellipap(N, 0.01, rs);
				const pass = attDb(
					z,
					Array.from({ length: 2001 }, (_, i) => i / 2000)
				);
				expect(Math.max(...pass)).toBeLessThan(0.01 + 1e-7);
				const k = ellipSelectivity(N, 0.01, rs);
				const stop = attDb(z, geom(1 / k, 1e4 / k, 8001));
				expect(Math.min(...stop)).toBeGreaterThan(rs - 1e-6);
				expect(Math.min(...stop)).toBeLessThan(rs + 1e-6);
			}
		}
	});

	it('even order: high-frequency gain k = 10^(−Rs/20)', () => {
		for (const rs of [120, 134, 140]) {
			expect(rel(ellipap(6, 0.01, rs).k, Math.pow(10, -rs / 20))).toBeLessThan(1e-10);
		}
	});
});

describe('ellipap with selectivity k → 1 (Rp 6 / Rs 10, high order)', () => {
	it('keeps the passband ripple at Rp and the stopband at Rs', () => {
		for (const N of [12, 15, 16, 18, 20]) {
			const z = ellipap(N, 6, 10);
			for (const p of z.p) {
				expect(Number.isFinite(p.re) && Number.isFinite(p.im)).toBe(true);
				expect(p.re).toBeLessThan(0); // strictly stable, however close to the axis
			}
			// dense near the edge, where the ripples crowd together as k → 1
			const wPass = [
				...Array.from({ length: 2001 }, (_, i) => (i / 2000) * 0.999),
				...Array.from({ length: 33 }, (_, j) => 1 - Math.pow(10, -3 - j / 4))
			];
			const pass = attDb(z, wPass);
			expect(Math.max(...pass)).toBeLessThan(6 + 1e-5);
			expect(Math.max(...pass)).toBeGreaterThan(6 - 1e-5);
			const stop = attDb(z, [
				...Array.from({ length: 33 }, (_, j) => 1 + Math.pow(10, -3 - j / 4)),
				...geom(1.001, 1e4, 4001)
			]);
			expect(Math.min(...stop)).toBeGreaterThan(10 - 1e-5);
		}
	});
});

describe('elliptic order estimate (SciPy ellipord)', () => {
	it('matches SciPy at tight specs and narrow transitions', () => {
		for (const [ws, rp, rs, N] of [
			[1.5, 0.01, 140, 13],
			[1.5, 0.01, 134, 13],
			[1.5, 0.01, 130, 12],
			[1.5, 0.01, 120, 12],
			[2, 0.0001, 200, 15],
			[1.0001, 0.1, 80, 29],
			[1.01, 6, 10, 3],
			[1.2, 1, 60, 7]
		]) {
			const r = estimateOrder('ellip', ws, rp, rs);
			expect(r.N).toBe(N);
			expect(r.capped).toBeUndefined();
		}
	});
});

describe('digital elliptic design at Rp 0.01 / Rs 140', () => {
	it('designs a stable filter meeting the specs instead of throwing', () => {
		const fs = 48000;
		const f1 = 1000;
		const r = designDigital({
			family: 'ellip',
			band: 'lowpass',
			order: 6,
			f1,
			fs,
			rp: 0.01,
			rs: 140
		});
		for (const s of r.sos) for (const v of s) expect(Number.isFinite(v)).toBe(true);
		for (const p of r.zpk.p) expect(abs(p)).toBeLessThan(1);
		// analog stopband edge Ωp/k mapped back through the (prewarped) bilinear transform
		const k = ellipSelectivity(6, 0.01, 140);
		const fStop = (fs / Math.PI) * Math.atan(Math.tan((Math.PI * f1) / fs) / k);
		const w = (f: number) => (2 * Math.PI * f) / fs;
		const pass = freqzSos(
			r.sos,
			Array.from({ length: 501 }, (_, i) => w((f1 * i) / 500))
		).map((h) => -20 * Math.log10(abs(h)));
		expect(Math.max(...pass)).toBeLessThan(0.01 + 1e-6);
		const stop = freqzSos(
			r.sos,
			Array.from({ length: 2001 }, (_, i) => w(fStop + ((fs / 2 - fStop) * i) / 2000))
		).map((h) => -20 * Math.log10(abs(h)));
		expect(Math.min(...stop)).toBeGreaterThan(140 - 1e-3);
	});
});
