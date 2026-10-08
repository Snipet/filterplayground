import { describe, expect, it } from 'vitest';
import { remez, type RemezBand, type RemezResult } from '../src/lib/dsp/remez';
import { hilbertFir } from '../src/lib/dsp/fir';
import { windowValues } from '../src/lib/dsp/windows';
import {
	equirippleHilbert,
	hilbertRipple,
	hilbertWindowRecipe
} from '../src/lib/features/special-fir/HilbertPanel.svelte';

/** Amplitude A(f) of a linear-phase FIR (remez convention), f in cycles/sample. */
function amp(h: number[], f: number, anti: boolean): number {
	const M = (h.length - 1) / 2;
	let s = 0;
	for (let n = 0; n < h.length; n++) {
		const a = 2 * Math.PI * f * (n - M);
		s += h[n] * (anti ? Math.sin(a) : Math.cos(a));
	}
	return s;
}

/** Peak weighted error of taps h, measured densely in every band (constant desired values). */
function peakError(h: number[], bands: RemezBand[], fs: number, points = 1500): number {
	let worst = 0;
	for (const b of bands)
		for (let i = 0; i <= points; i++) {
			const f = b.f1 + ((b.f2 - b.f1) * i) / points;
			worst = Math.max(worst, b.weight * Math.abs(amp(h, f / fs, false) - b.d1));
		}
	return worst;
}

const tryRemez = (...a: Parameters<typeof remez>): RemezResult | null => {
	try {
		return remez(...a);
	} catch {
		return null;
	}
};

const fs = 48000;
const deltas = (rp: number, rs: number) => {
	const g = Math.pow(10, rp / 20);
	return { dp: (g - 1) / (g + 1), ds: Math.pow(10, -rs / 20) };
};
const P = (f1: number, f2: number): RemezBand => ({ f1, f2, d1: 1, d2: 1, weight: 1 });
const S = (f1: number, f2: number, weight: number): RemezBand => ({
	f1,
	f2,
	d1: 0,
	d2: 0,
	weight
});

describe('remez: multiband exchange (finding #4)', () => {
	// FIR designer: band-pass 4/5/8/9 kHz, Rp = 1 dB, Rs = 60 dB, manual length
	const { dp, ds } = deltas(1, 60);
	const w = dp / ds;
	const bp = [S(0, 4000, w), P(5000, 8000), S(9000, 24000, w)];

	it('48 kHz band-pass at N = 61 and 63 converges to the SciPy optimum', () => {
		// scipy.signal.remez peak weighted errors (dense): 0.232 (N = 61), 0.2315 (N = 63)
		for (const [N, scipy] of [
			[61, 0.232],
			[63, 0.2315]
		]) {
			const r = remez(N, bp, fs);
			expect(r.converged, `N=${N}`).toBe(true);
			const e = peakError(r.h, bp, fs);
			expect(e, `N=${N}`).toBeLessThan(scipy * 1.005);
			// δ describes the taps: the real peak error is within grid resolution of it
			expect(e / r.delta, `N=${N}`).toBeLessThan(1.02);
			// ~48 dB of stopband attenuation (the old exchange left +50 dB of gain here)
			let stop = 0;
			for (let f = 0; f <= 4000; f += 10) stop = Math.max(stop, Math.abs(amp(r.h, f / fs, false)));
			for (let f = 9000; f <= 24000; f += 10)
				stop = Math.max(stop, Math.abs(amp(r.h, f / fs, false)));
			expect(-20 * Math.log10(stop), `N=${N}`).toBeGreaterThan(47.5);
		}
	});

	it('4-band design at N = 121 matches SciPy (peak error 0.00279)', () => {
		const bands = [
			{ f1: 0, f2: 0.1044, d1: 1, d2: 1, weight: 1 },
			{ f1: 0.1268, f2: 0.1997, d1: 0, d2: 0, weight: 1 },
			{ f1: 0.222, f2: 0.3435, d1: 1, d2: 1, weight: 1 },
			{ f1: 0.3658, f2: 0.5, d1: 0, d2: 0, weight: 1 }
		];
		const r = remez(121, bands, 1);
		expect(r.converged).toBe(true);
		expect(r.delta).toBeCloseTo(0.002767, 5);
		// the old exchange reported δ = 0.00274 for taps whose real error was 10.35 at f = 0.481
		expect(peakError(r.h, bands, 1)).toBeLessThan(0.0028);
	});

	it('matches SciPy on the FIR designer defaults that used to fail', () => {
		const d = deltas(0.5, 60);
		const defBp = [S(0, 4000, d.dp / d.ds), P(6000, 10000), S(12000, 24000, d.dp / d.ds)];
		const custom: RemezBand[] = [
			{ f1: 0, f2: 3600, d1: 1, d2: 1, weight: 1 },
			{ f1: 4800, f2: 8400, d1: 0, d2: 0, weight: 10 },
			{ f1: 9600, f2: 14400, d1: 0.5, d2: 0.5, weight: 1 },
			{ f1: 15600, f2: 24000, d1: 0, d2: 0, weight: 10 }
		];
		// [bands, N, scipy.signal.remez peak weighted error]
		const cases: [RemezBand[], number, number][] = [
			[defBp, 38, 0.09907],
			[defBp, 72, 0.01005],
			[custom, 107, 0.008518]
		];
		for (const [bands, N, scipy] of cases) {
			const r = remez(N, bands, fs);
			expect(r.converged, `N=${N}`).toBe(true);
			// (dense errors differ by grid resolution only)
			expect(peakError(r.h, bands, fs), `N=${N}`).toBeLessThan(scipy * 1.02);
		}
	});

	it('converges on every length of the default band-pass, band-stop and custom designs', () => {
		const d = deltas(0.5, 60);
		const ws = d.dp / d.ds;
		const sets: [string, RemezBand[], boolean][] = [
			['bp', [S(0, 4000, ws), P(6000, 10000), S(12000, 24000, ws)], false],
			['bs', [P(0, 4000), S(6000, 10000, ws), P(12000, 24000)], true],
			[
				'custom',
				[
					{ f1: 0, f2: 3600, d1: 1, d2: 1, weight: 1 },
					{ f1: 4800, f2: 8400, d1: 0, d2: 0, weight: 10 },
					{ f1: 9600, f2: 14400, d1: 0.5, d2: 0.5, weight: 1 },
					{ f1: 15600, f2: 24000, d1: 0, d2: 0, weight: 10 }
				],
				false
			]
		];
		for (const [name, bands, oddOnly] of sets)
			for (let N = 15; N <= 175; N += oddOnly ? 4 : 3) {
				const r = remez(N, bands, fs);
				expect(r.converged, `${name} N=${N}`).toBe(true);
				expect(peakError(r.h, bands, fs, 400) / r.delta, `${name} N=${N}`).toBeLessThan(1.2);
			}
	});

	it('never reports a ripple below the real error of the returned taps', () => {
		const d = deltas(0.5, 60);
		const ws = d.dp / d.ds;
		const bands = [S(0, 4000, ws), P(6000, 10000), S(12000, 24000, ws)];
		// lengths where the optimum approaches double precision: either a usable design whose
		// δ bounds its error, or an error, but never taps with a far larger error than δ
		for (let N = 230; N <= 260; N += 3) {
			const r = tryRemez(N, bands, fs);
			if (!r) continue;
			// equiripple to 0.1 % when converged; otherwise δ is the taps' own peak error
			expect(r.maxError!, `N=${N}`).toBeLessThanOrEqual(r.delta * (r.converged ? 1.001 : 1));
			expect(r.deltaBound!, `N=${N}`).toBeLessThanOrEqual(r.delta);
			expect(peakError(r.h, bands, fs, 400), `N=${N}`).toBeLessThan(1.2 * r.delta);
		}
	});

	it('throws instead of returning taps from a collapsed exchange', () => {
		// a 0.37-wide transition band at N = 37: the optimal ripple (~4e-13) is out of reach
		const bands = [
			{ f1: 0, f2: 0.0592, d1: 1, d2: 1, weight: 1 },
			{ f1: 0.4314, f2: 0.5, d1: 0, d2: 0, weight: 100 }
		];
		expect(() => remez(37, bands, 1)).toThrow(/Remez exchange/);
	});
});

describe('Hilbert transformer at long lengths (finding #54)', () => {
	const band = (edge: number): RemezBand[] => [
		{ f1: edge, f2: fs / 2 - edge, d1: 1, d2: 1, weight: 1 }
	];

	it('edge 1.2 kHz, N = 211: near-optimal taps or an error, never a broken filter', () => {
		// SciPy: ripple 1.3e-8 with every even tap zero; the old exchange returned ripple 3.2
		const r = tryRemez(211, band(1200), fs, { symmetry: 'odd' });
		if (r) {
			expect(hilbertRipple(r.h, 1200, fs)).toBeLessThan(1e-6);
			const peak = Math.max(...r.h.map(Math.abs));
			r.h.forEach((v, i) => {
				if ((i - 105) % 2 === 0) expect(Math.abs(v)).toBeLessThan(1e-6 * peak);
			});
		}
	});

	it('the panel keeps equiripple taps only when they beat the window design', () => {
		for (const edge of [1200, 3000]) {
			for (let n = 7; n <= 255; n += 4) {
				const hw = hilbertFir(n, { type: 'hamming' });
				const eq = equirippleHilbert(n, edge, fs, hw);
				const tag = `edge ${edge} N ${n}`;
				if (!eq.h) {
					expect(eq.error, tag).toMatch(/window design is shown instead/);
					continue;
				}
				const rip = hilbertRipple(eq.h, edge, fs);
				expect(rip, tag).toBeLessThan(hilbertRipple(hw, edge, fs));
				// every even offset is exactly zero (so the multiply count is ~N/4)
				eq.h.forEach((v, i) => {
					if ((i - (n - 1) / 2) % 2 === 0) expect(v, tag).toBe(0);
				});
				if (!eq.converged) {
					expect(eq.kind, tag).toBeDefined();
					expect(eq.error, tag).toBeTruthy();
				}
			}
		}
	});

	it('reports the reporter’s broken cases as failures with the window fallback', () => {
		// edge 3 kHz, N = 135: the old code returned |A − 1| = 137 as "not optimal" taps
		const hw = hilbertFir(135, { type: 'hamming' });
		const eq = equirippleHilbert(135, 3000, fs, hw);
		if (eq.h) expect(hilbertRipple(eq.h, 3000, fs)).toBeLessThan(1e-6);
		else expect(eq.error).toMatch(/window design is shown instead/);
	});
});

describe('Hilbert SciPy recipe (finding #55)', () => {
	it('builds the Welch window explicitly instead of substituting Hamming', () => {
		const code = hilbertWindowRecipe(31, { type: 'welch' });
		expect(code).not.toMatch(/get_window/);
		expect(code).not.toMatch(/hamming/);
		expect(code).toContain('h *= (1 - ((np.arange(N) - (N - 1) / 2) / ((N - 1) / 2 + 1)) ** 2)');
		// that Python expression is the app's Welch window
		for (const N of [21, 22, 31]) {
			const w = windowValues('welch', N);
			for (let n = 0; n < N; n++)
				expect(1 - ((n - (N - 1) / 2) / ((N - 1) / 2 + 1)) ** 2).toBeCloseTo(w[n], 14);
		}
	});

	it('keeps signal.get_window for windows SciPy has', () => {
		expect(hilbertWindowRecipe(31, { type: 'hamming' })).toContain(
			"h *= signal.get_window('hamming', N, fftbins=False)"
		);
		expect(hilbertWindowRecipe(31, { type: 'kaiser', param: 6 })).toContain(
			"signal.get_window(('kaiser', 6), N, fftbins=False)"
		);
	});
});
