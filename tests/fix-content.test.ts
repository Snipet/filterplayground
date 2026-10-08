/**
 * Regression tests for the glossary and formula-reference content fixes: each block checks the
 * corrected statement numerically with the DSP core and guards the wording that was wrong.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { abs, arg, c, type Complex } from '../src/lib/dsp/complex';
import { besselap, buttap, cheb1ap, cheb2ap, ellipap } from '../src/lib/dsp/analog';
import { freqsZpk, freqzTf, freqzZpk, groupDelayTf, unwrap } from '../src/lib/dsp/response';
import { bilinear, prewarp, lp2lp } from '../src/lib/dsp/transforms';
import { firwin, raisedCosine, rootRaisedCosine } from '../src/lib/dsp/fir';
import { windowSpectrum, windowValues, type WindowType } from '../src/lib/dsp/windows';
import { overshoot, rhoToVswr, vswrToRho } from '../src/lib/features/calculators/math';
import {
	TERMS,
	foldDashes,
	highlightRuns,
	matchTerm,
	termByName
} from '../src/lib/features/glossary/terms';

const def = (name: string) => termByName(name)!.def;
const find = (q: string) => TERMS.filter((t) => matchTerm(t, q)).map((t) => t.term);
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const deg = (r: number) => (r * 180) / Math.PI;

describe('#10 roll-off: 20(N − M) dB/decade, 20N only for all-pole low-passes', () => {
	const slope = (zpk: { z: Complex[]; p: Complex[]; k: number }) => {
		const [h1, h2] = freqsZpk(zpk, [1e3, 1e4]);
		return 20 * Math.log10(abs(h2) / abs(h1));
	};
	it('the asymptotic slope is −20(N − M) dB/decade with M finite zeros', () => {
		const cases = [
			{ name: 'butter 4', zpk: buttap(4), allPoleSlope: -80 },
			{ name: 'cheby1 4', zpk: cheb1ap(4, 1), allPoleSlope: -80 },
			{ name: 'bessel 4', zpk: besselap(4), allPoleSlope: -80 },
			{ name: 'cheby2 4', zpk: cheb2ap(4, 40) },
			{ name: 'cheby2 5', zpk: cheb2ap(5, 40) },
			{ name: 'ellip 4', zpk: ellipap(4, 1, 40) },
			{ name: 'ellip 5', zpk: ellipap(5, 1, 40) }
		];
		for (const { name, zpk, allPoleSlope } of cases) {
			const N = zpk.p.length;
			const M = zpk.z.length;
			expect(slope(zpk), name).toBeCloseTo(-20 * (N - M), 1);
			if (allPoleSlope !== undefined) expect(slope(zpk), name).toBeCloseTo(allPoleSlope, 1);
		}
		// even-order Chebyshev II / elliptic: flat stopband floor; odd order: only 20 dB/decade
		expect(slope(cheb2ap(4, 40))).toBeCloseTo(0, 1);
		expect(slope(ellipap(5, 1, 40))).toBeCloseTo(-20, 1);
	});
	it('Decade and Roll-off qualify the 20N rule', () => {
		expect(def('Decade')).toMatch(/all-pole N-th-order low-pass/);
		expect(def('Roll-off')).toMatch(/all-pole N-th-order low-pass/);
		expect(def('Roll-off')).toContain('20(N − M) dB/decade');
		expect(def('Roll-off')).not.toMatch(/an N-pole low-pass falls/);
	});
});

describe('#11 glossary search ignores the kind of dash', () => {
	it('ASCII hyphens find en-dash and minus-sign spellings', () => {
		expect(find('Linkwitz-Riley')).toContain('Linkwitz–Riley filter');
		expect(find('Sallen-Key')).toContain('Sallen–Key topology');
		expect(find('Parks-McClellan')).toContain('Parks–McClellan algorithm');
		expect(find('Savitzky-Golay')).toContain('Savitzky–Golay filter');
		expect(find('Dolph-Chebyshev')).toContain('Dolph–Chebyshev window');
		expect(find('pole-zero')).toContain('Pole–zero plot');
		expect(find('Nyquist-Shannon')).toContain('Sampling theorem');
		expect(find('forward-backward')).toContain('Zero-phase filtering');
		expect(find('cascaded integrator-comb')).toContain('CIC filter');
		expect(find('-3 dB').length).toBeGreaterThan(0);
		expect(find('-3 dB')).toEqual(find('−3 dB'));
		expect(find('Cutoff –3 dB')).toContain('Cutoff frequency');
		// the other way round: a typed en dash finds ASCII-hyphen data
		expect(find('low–pass')).toEqual(find('low-pass'));
	});
	it('folding keeps the string length', () => {
		const s = 'a‐b‑c‒d–e—f―g−h';
		expect(foldDashes(s)).toBe('a-b-c-d-e-f-g-h');
		expect(foldDashes(s)).toHaveLength(s.length);
	});
	it('highlighting marks the original text for a hyphenated query', () => {
		const runs = highlightRuns('Linkwitz–Riley filter', 'linkwitz-riley');
		expect(runs).toEqual([
			{ s: 'Linkwitz–Riley', hit: true },
			{ s: ' filter', hit: false }
		]);
		const minus = highlightRuns('gain at −3 dB here', '-3 dB');
		expect(minus.filter((r) => r.hit).map((r) => r.s)).toEqual(['−3', 'dB']);
		expect(highlightRuns('a (b) c', '(b)')).toEqual([
			{ s: 'a ', hit: false },
			{ s: '(b)', hit: true },
			{ s: ' c', hit: false }
		]);
		expect(highlightRuns('plain', '  ')).toEqual([{ s: 'plain', hit: false }]);
	});
});

describe('#62 window FIR stopband vs peak window sidelobe', () => {
	/** Highest window sidelobe (dB): the maximum after the first null of the spectrum. */
	const peakSidelobe = (w: number[]) => {
		const { db } = windowSpectrum(w);
		let i = 1;
		while (i < db.length - 1 && !(db[i] < db[i - 1] && db[i] <= db[i + 1])) i++;
		return Math.max(...db.slice(i));
	};
	/** Highest stopband lobe of firwin(101, 0.3·Nyquist): the maximum after the first null past fc. */
	const stopbandPeak = (type: WindowType) => {
		const h = firwin(101, [0.3], { type }, true, 2);
		const w = Array.from({ length: 4001 }, (_, i) => (Math.PI * i) / 4000);
		const db = freqzTf({ b: h, a: [1] }, w).map((z) => 20 * Math.log10(abs(z)));
		let i = w.findIndex((x, j) => x > 0.3 * Math.PI && db[j] < -6);
		while (db[i + 1] < db[i]) i++;
		return Math.max(...db.slice(i));
	};
	it('attenuation is 8–17 dB better than the peak sidelobe (Hann ≈ 44 dB)', () => {
		for (const type of ['rectangular', 'hann', 'hamming', 'blackman'] as WindowType[]) {
			const gap = peakSidelobe(windowValues(type, 101)) - stopbandPeak(type);
			expect(gap, type).toBeGreaterThan(7.5);
			expect(gap, type).toBeLessThan(17.5);
		}
		expect(-stopbandPeak('hann')).toBeGreaterThan(43);
		expect(-stopbandPeak('hann')).toBeLessThan(45);
	});
	it('the Sidelobe entry no longer equates the two', () => {
		expect(def('Sidelobe')).not.toMatch(/sets leakage in spectral analysis and the stopband/);
		expect(def('Sidelobe')).toContain('8–17 dB better than the peak sidelobe');
	});
});

describe('#63 distinct quantities are not listed as synonyms', () => {
	it('RRC, VSWR and the reflection coefficient have their own entries', () => {
		expect(termByName('Raised-cosine filter')!.aka ?? []).not.toContain('RRC');
		expect(termByName('Raised-cosine filter')!.aka ?? []).not.toContain('root-raised-cosine');
		expect(termByName('Return loss')!.aka ?? []).not.toContain('VSWR');
		expect(termByName('Return loss')!.aka ?? []).not.toContain('reflection coefficient');
		expect(find('RRC')).toContain('Root-raised-cosine filter');
		expect(find('VSWR')).toContain('VSWR');
		expect(find('reflection coefficient')).toContain('Reflection coefficient');
		expect(termByName('Raised-cosine filter')!.see).toContain('Root-raised-cosine filter');
		expect(termByName('Return loss')!.see).toEqual(
			expect.arrayContaining(['Reflection coefficient', 'VSWR'])
		);
	});
	it('a single RRC pulse is not ISI-free, RC and RRC∗RRC are', () => {
		const sps = 8;
		const span = 16;
		const rc = raisedCosine(sps, 0.35, span);
		const rrc = rootRaisedCosine(sps, 0.35, span);
		const mid = (rc.length - 1) / 2;
		const conv = new Array(2 * rrc.length - 1).fill(0);
		rrc.forEach((a, i) => rrc.forEach((b, j) => (conv[i + j] += a * b)));
		const cmid = (conv.length - 1) / 2;
		for (const k of [1, 2, 3]) {
			expect(Math.abs(rc[mid + k * sps] / rc[mid])).toBeLessThan(1e-12);
			expect(Math.abs(conv[cmid + k * sps] / conv[cmid])).toBeLessThan(5e-3);
		}
		expect(rrc[mid + sps] / rrc[mid]).toBeCloseTo(-0.0773, 3);
		expect(rrc[mid + 2 * sps] / rrc[mid]).toBeCloseTo(0.0521, 3);
	});
	it('VSWR and return loss are different functions of |ρ|', () => {
		for (const rho of [0.05, 0.2, 0.5]) {
			expect(rhoToVswr(rho)).toBeCloseTo((1 + rho) / (1 - rho), 12);
			expect(vswrToRho(rhoToVswr(rho))).toBeCloseTo(rho, 12);
			expect(-20 * Math.log10(rho)).not.toBeCloseTo(rhoToVswr(rho), 1);
		}
	});
});

describe('#64 pole–zero geometry includes the gain constant k', () => {
	it('|H| = |k|·Π|x − zᵢ|/Π|x − pᵢ| (2nd-order Butterworth low-pass, Wn = 0.1)', () => {
		const fs = 2;
		const digital = bilinear(lp2lp(buttap(2), prewarp(0.1, fs)), fs);
		expect(digital.k).toBeCloseTo(0.020083365564, 9);
		for (const w of [0, 0.1 * Math.PI, 0.7]) {
			const x: Complex = { re: Math.cos(w), im: Math.sin(w) };
			const dz = digital.z.reduce((s, z) => s * Math.hypot(x.re - z.re, x.im - z.im), 1);
			const dp = digital.p.reduce((s, p) => s * Math.hypot(x.re - p.re, x.im - p.im), 1);
			const h = abs(freqzZpk(digital, [w])[0]);
			expect(Math.abs(digital.k) * (dz / dp)).toBeCloseTo(h, 10);
			if (w === 0) {
				expect(dz / dp).toBeCloseTo(49.792, 2); // the distance ratio alone: +34 dB
				expect(h).toBeCloseTo(1, 10);
			}
		}
		expect(def('Pole–zero plot')).toContain('|k| times the product of the distances');
	});
});

describe('#65 / #60 antisymmetric FIRs: generalised linear phase, τp ≠ τg', () => {
	it('h = [1, 0, −1] has φ = π/2 − ω, τg = 1 and a frequency-dependent phase delay', () => {
		const w = [0.3, Math.PI / 4, 1, 2];
		const ph = freqzTf({ b: [1, 0, -1], a: [1] }, w).map(arg);
		const gd = groupDelayTf({ b: [1, 0, -1], a: [1] }, w);
		w.forEach((x, i) => {
			expect(ph[i]).toBeCloseTo(Math.PI / 2 - x, 10);
			expect(gd[i]).toBeCloseTo(1, 8);
			// Misc.svelte: τp = M/2 − β/ω with β = π/2, M = 2
			expect(-ph[i] / x).toBeCloseTo(1 - Math.PI / 2 / x, 10);
		});
		expect(-ph[1] / w[1]).toBeCloseTo(-1, 10); // phase delay −1 sample at ω = π/4
	});
	it('a sign change of A(ω) adds a π step (h = [1, 1, 1] above 2π/3)', () => {
		const w = Array.from({ length: 1000 }, (_, i) => 0.01 + (i * (Math.PI - 0.02)) / 999);
		const ph = unwrap(freqzTf({ b: [1, 1, 1], a: [1] }, w).map(arg));
		const gd = groupDelayTf({ b: [1, 1, 1], a: [1] }, w);
		w.forEach((x, i) => {
			if (Math.abs(x - (2 * Math.PI) / 3) < 0.02) return;
			expect(gd[i]).toBeCloseTo(1, 6);
			const beta = ph[i] + x; // φ = β − ωM/2, M = 2
			if (x < (2 * Math.PI) / 3) expect(beta).toBeCloseTo(0, 8);
			else expect(Math.abs(beta)).toBeCloseTo(Math.PI, 8);
		});
	});
	it('the texts say so', () => {
		expect(def('Linear phase')).toContain('π/2 − ωτ');
		expect(def('Linear phase')).not.toMatch(/Symmetric or antisymmetric FIR filters have exactly/);
		const misc = src('src/lib/features/formulas/sections/Misc.svelte');
		expect(misc).not.toMatch(/for a pure delay and for linear-phase FIRs/);
		expect(misc).toContain('\\tau_p=M/2-\\beta/\\omega');
	});
});

describe('#66 overshoot formula gives a fraction', () => {
	it('second-order step response peaks at 1 + Mp', () => {
		for (const zeta of [0.2, 0.5, 0.8]) {
			const wd = Math.sqrt(1 - zeta * zeta);
			const step = (t: number) =>
				1 - Math.exp(-zeta * t) * (Math.cos(wd * t) + (zeta / wd) * Math.sin(wd * t));
			let peak = 0;
			for (let t = 0; t < 30; t += 1e-4) peak = Math.max(peak, step(t));
			const mp = Math.exp((-Math.PI * zeta) / wd);
			expect(peak - 1).toBeCloseTo(mp, 6);
			expect(overshoot(zeta)).toBeCloseTo(mp, 12);
		}
		expect(Math.exp((-Math.PI * 0.5) / Math.sqrt(0.75))).toBeCloseTo(0.16303, 5);
		expect(def('Overshoot')).toMatch(/as a fraction of that value/);
		expect(def('Overshoot')).not.toMatch(/final value, in percent/);
	});
});

describe('#67 glossary anchors clear the measured sticky finder', () => {
	it('scroll-margin follows --finder-h instead of a fixed 190px', () => {
		const page = src('src/routes/glossary/+page.svelte');
		expect(page).not.toMatch(/scroll-margin-top:\s*190px/);
		expect(page.match(/scroll-margin-top: calc\(60px \+ var\(--finder-h/g)).toHaveLength(2);
		expect(page).toMatch(/bind:offsetHeight=\{finderH\}/);
	});
});

describe('#61 Bessel norm="phase": asymptote match, phase only ≈ −Nπ/4 at ω = 1', () => {
	const phaseAt1 = (N: number) => {
		const w = Array.from({ length: 2001 }, (_, i) => (i + 1) / 2001);
		return deg(unwrap(freqsZpk(besselap(N, 'phase'), w).map(arg))[2000]);
	};
	it('exact only for N ≤ 2', () => {
		expect(phaseAt1(1)).toBeCloseTo(-45, 8);
		expect(phaseAt1(2)).toBeCloseTo(-90, 8);
		expect(phaseAt1(3)).toBeCloseTo(-134.34, 2);
		expect(phaseAt1(4)).toBeCloseTo(-178.15, 2);
		expect(Math.abs(phaseAt1(10) + 450)).toBeGreaterThan(14);
	});
	it('denominator s^N + … + 1: |H(jω)|·ω^N → 1 like a Butterworth at the cutoff', () => {
		for (const N of [2, 3, 5, 8]) {
			const zpk = besselap(N, 'phase');
			const prod0 = zpk.p.reduce((s, p) => s * abs(p), 1); // constant term of the monic denominator
			expect(prod0, `N=${N}`).toBeCloseTo(1, 10);
			const w = 1e4;
			expect(abs(freqsZpk(zpk, [w])[0]) * Math.pow(w, N), `N=${N}`).toBeCloseTo(1, 6);
		}
	});
	it("norm='mag' divides the delay-normalised poles by ω−3dB (s → ω−3dB·s)", () => {
		const w3 = [1.0, 1.3617, 1.7557, 2.1139];
		for (let N = 1; N <= 4; N++) {
			const delay = besselap(N, 'delay');
			const scaled = { z: [], p: delay.p.map((p) => c(p.re / w3[N - 1], p.im / w3[N - 1])), k: 1 };
			scaled.k = scaled.p.reduce((s, p) => s * abs(p), 1);
			expect(abs(freqsZpk(scaled, [1])[0]), `N=${N}`).toBeCloseTo(Math.SQRT1_2, 3);
		}
		const proto = src('src/lib/features/formulas/sections/Prototypes.svelte');
		expect(proto).not.toMatch(/places the phase midpoint/);
		expect(proto).toContain('Divide the poles by ω<sub>−3 dB</sub>');
	});
});

describe('sidebar tool search folds dashes', () => {
	it('finds en-dash titles from ASCII hyphens', async () => {
		const { searchTools } = await import('../src/lib/tools');
		expect(searchTools('pole-zero').map((t) => t.slug)).toContain('pole-zero');
		expect(searchTools('sallen-key').length).toBeGreaterThan(0);
		expect(searchTools('parks-mcclellan').map((t) => t.slug)).toContain('fir-designer');
	});
});
