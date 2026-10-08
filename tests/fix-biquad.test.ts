import { describe, expect, it } from 'vitest';
import {
	BIQUAD_TYPES,
	biquad,
	biquadBandEdges,
	bwToQ,
	qToBw,
	type BiquadType
} from '../src/lib/dsp/biquad';
import { sos2zpk } from '../src/lib/dsp/convert';
import { clampF0, maxF0, restoreState, type BiquadState } from '../src/lib/features/biquad/params';

const FS = 48000;

/** |H(e^{jω})| in dB of one SOS row at f Hz. */
function magDb(sec: number[], f: number, fs = FS): number {
	const w = (2 * Math.PI * f) / fs;
	const c1 = Math.cos(w);
	const s1 = Math.sin(w);
	const c2 = Math.cos(2 * w);
	const s2 = Math.sin(2 * w);
	const nr = sec[0] + sec[1] * c1 + sec[2] * c2;
	const ni = -sec[1] * s1 - sec[2] * s2;
	const dr = sec[3] + sec[4] * c1 + sec[5] * c2;
	const di = -sec[4] * s1 - sec[5] * s2;
	return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}

function bisect(g: (f: number) => number, lo: number, hi: number): number {
	let glo = g(lo);
	for (let i = 0; i < 200; i++) {
		const m = (lo + hi) / 2;
		const gm = g(m);
		if (Math.sign(gm) === Math.sign(glo)) {
			lo = m;
			glo = gm;
		} else hi = m;
	}
	return (lo + hi) / 2;
}

/** Measured band edges (Hz): −3 dB below the peak (BPF), −3 dB (notch), half-gain dB (peaking). */
function measuredEdges(type: BiquadType, f0: number, q: number, gainDb = 0): [number, number] {
	const sec = biquad({ type, f0, fs: FS, q, gainDb });
	const ref =
		type === 'peaking'
			? gainDb / 2
			: type === 'notch'
				? -10 * Math.log10(2)
				: magDb(sec, f0) - 10 * Math.log10(2);
	const g = (f: number) => magDb(sec, f) - ref;
	return [bisect(g, 1e-9, f0), bisect(g, f0, FS / 2 - 1e-9)];
}

describe('#17/#39 digital Q ↔ bandwidth (bilinear-warped, exact)', () => {
	it('keeps the analog relation when no ω₀ is given', () => {
		expect(qToBw(Math.SQRT2)).toBeCloseTo(1, 3);
		expect(bwToQ(1)).toBeCloseTo(Math.SQRT2, 12);
		expect(qToBw(1)).toBeCloseTo(1.388, 3);
	});

	it('reported scenario: band-pass f₀ = 12 kHz, Q = 1.414 is 0.634 oct wide, not 1 oct', () => {
		const w0 = (2 * Math.PI * 12000) / FS;
		const [lo, hi] = measuredEdges('bandpass', 12000, 1.414);
		expect(Math.log2(hi / lo)).toBeCloseTo(0.634, 3);
		expect(qToBw(1.414, w0)).toBeCloseTo(Math.log2(hi / lo), 9);
		// f₀ = 18 kHz, Q = 2: 0.216 oct (the analog relation said 0.714)
		expect(qToBw(2, (2 * Math.PI * 18000) / FS)).toBeCloseTo(0.216, 3);
		// #39: Q = 1 at 10 kHz → 1.012 oct (6766 – 13640 Hz); at 15 kHz → 0.660 oct
		expect(qToBw(1, (2 * Math.PI * 10000) / FS)).toBeCloseTo(1.012, 3);
		const [l, h] = biquadBandEdges(10000, 1, FS);
		expect(l).toBeCloseTo(6766, -1);
		expect(h).toBeCloseTo(13640, -1);
		expect(qToBw(1, (2 * Math.PI * 15000) / FS)).toBeCloseTo(0.66, 2);
	});

	it('matches the measured −3 dB / half-gain bandwidth of every bandwidth type', () => {
		const cases: [BiquadType, number][] = [
			['bandpass', 0],
			['bandpass-peak', 0],
			['notch', 0],
			['peaking', 12],
			['peaking', -18]
		];
		for (const [type, gainDb] of cases)
			for (const f0 of [100, 1000, 6000, 12000, 18000, 22000, 23520])
				for (const q of [0.1, 0.5, 1, Math.SQRT2, 4, 20]) {
					const [lo, hi] = measuredEdges(type, f0, q, gainDb);
					const w0 = (2 * Math.PI * f0) / FS;
					const [el, eh] = biquadBandEdges(f0, q, FS);
					expect(el / lo).toBeCloseTo(1, 6);
					expect(eh / hi).toBeCloseTo(1, 6);
					expect(qToBw(q, w0)).toBeCloseTo(Math.log2(hi / lo), 6);
				}
	});

	it('bwToQ(N, ω₀) designs a filter that really is N octaves wide', () => {
		for (const f0 of [50, 1000, 12000, 20000, 23520])
			for (const n of [0.01, 0.1, 1 / 3, 1, 2, 6]) {
				const w0 = (2 * Math.PI * f0) / FS;
				const q = bwToQ(n, w0);
				expect(q).toBeGreaterThan(0);
				const [lo, hi] = measuredEdges('bandpass', f0, q);
				expect(Math.log2(hi / lo)).toBeCloseTo(n, 6);
				expect(qToBw(q, w0)).toBeCloseTo(n, 9);
			}
		// 1 oct at 12 kHz needs Q ≈ 0.85, not the analog √2
		expect(bwToQ(1, (2 * Math.PI * 12000) / FS)).toBeLessThan(1);
	});

	it('round-trips Q → N → Q and tends to the analog relation at low f₀', () => {
		for (const w0 of [1e-4, 0.01, 0.5, 1.5, 3])
			for (const q of [0.1, 0.3, 0.707, 2, 10, 50])
				expect(bwToQ(qToBw(q, w0), w0) / q).toBeCloseTo(1, 9);
		expect(qToBw(1, 1e-5)).toBeCloseTo(qToBw(1), 8);
		expect(bwToQ(1, 1e-5)).toBeCloseTo(bwToQ(1), 8);
	});

	it('theory example: the cookbook ω₀/sin ω₀ approximation vs the exact edges', () => {
		const w0 = (2 * Math.PI * 18000) / FS;
		const cookbook = qToBw(0.5) * (Math.sin(w0) / w0);
		expect(cookbook).toBeCloseTo(0.763, 3);
		expect(qToBw(0.5, w0)).toBeCloseTo(0.835, 3);
	});

	it('only band-pass, notch and peaking types report a bandwidth', () => {
		const withBw = BIQUAD_TYPES.filter((t) => t.usesBw).map((t) => t.id);
		expect(withBw.sort()).toEqual(['bandpass', 'bandpass-peak', 'notch', 'peaking']);
		for (const t of BIQUAD_TYPES) if (t.usesBw) expect(t.usesQ).toBe(true);
	});
});

describe('#38 f₀ stays below Nyquist when fs changes or a link is restored', () => {
	const base: BiquadState = { type: 'peaking', fs: 48000, f0: 1000, q: 1, gainDb: 6 };

	it('clamps f₀ to 0.98·fs/2', () => {
		expect(maxF0(8000)).toBe(3920);
		expect(clampF0(10000, 8000)).toBe(3920);
		expect(clampF0(1000, 8000)).toBe(1000);
		expect(clampF0(3, 8000)).toBe(10);
	});

	it('a shared link with f₀ above the restored Nyquist is clamped, giving a real low-pass', () => {
		const r = restoreState(base, { type: 'lowpass', fs: 8000, f0: 10000, q: 1, gainDb: 0 });
		expect(r).toEqual({ type: 'lowpass', fs: 8000, f0: 3920, q: 1, gainDb: 0 });
		const sec = biquad({ type: r.type, f0: r.f0, fs: r.fs, q: r.q });
		const z = sos2zpk([sec]);
		for (const p of z.p) expect(Math.hypot(p.re, p.im)).toBeLessThan(0.99);
		// low-pass: unity at DC, strongly attenuated near Nyquist
		expect(magDb(sec, 1, r.fs)).toBeCloseTo(0, 6);
		expect(magDb(sec, 3990, r.fs)).toBeLessThan(-30);
	});

	it('an existing f₀ is clamped when only fs comes from the link; bad fields are ignored', () => {
		expect(restoreState({ ...base, f0: 20000 }, { fs: 16000 }).f0).toBe(7840);
		const r = restoreState(base, { fs: 12345, f0: -5, q: 0, type: 'nope' as BiquadType });
		expect(r).toEqual(base);
		expect(restoreState(base, null)).toEqual(base);
	});
});

describe('#40 which RBJ types share poles', () => {
	const f0 = 1000;
	const q = 1;
	const den = (type: BiquadType, gainDb = 0) => biquad({ type, f0, fs: FS, q, gainDb }).slice(3);

	it('LP, HP, both BP, notch and all-pass share one denominator', () => {
		const ref = den('notch');
		for (const t of ['lowpass', 'highpass', 'bandpass', 'bandpass-peak', 'allpass'] as const)
			den(t).forEach((v, i) => expect(v).toBeCloseTo(ref[i], 14));
		// complex pair (Q > ½) at r = √((1−α)/(1+α)), cos θ = cos ω₀/√(1−α²)
		const w0 = (2 * Math.PI * f0) / FS;
		const alpha = Math.sin(w0) / (2 * q);
		const p = sos2zpk([biquad({ type: 'notch', f0, fs: FS, q })]).p;
		expect(Math.hypot(p[0].re, p[0].im)).toBeCloseTo(Math.sqrt((1 - alpha) / (1 + alpha)), 12);
		expect(Math.abs(Math.atan2(p[0].im, p[0].re))).toBeCloseTo(
			Math.acos(Math.cos(w0) / Math.sqrt(1 - alpha * alpha)),
			12
		);
	});

	it('peaking and shelf poles differ; a −30 dB peaking cut has two real poles', () => {
		const ref = den('notch');
		for (const [t, g] of [
			['peaking', -30],
			['peaking', 6],
			['lowshelf', 6],
			['highshelf', 6]
		] as const)
			expect(Math.abs(den(t, g)[1] - ref[1]) + Math.abs(den(t, g)[2] - ref[2])).toBeGreaterThan(
				1e-3
			);
		const p = sos2zpk([biquad({ type: 'peaking', f0, fs: FS, q, gainDb: -30 })]).p;
		for (const r of p) expect(Math.abs(r.im)).toBeLessThan(1e-12);
		// at 0 dB the peaking denominator coincides with the shared one
		den('peaking', 0).forEach((v, i) => expect(v).toBeCloseTo(ref[i], 14));
	});

	it('peaking +G and −G are exact inverses (poles of one = zeros of the other)', () => {
		const up = biquad({ type: 'peaking', f0, fs: FS, q, gainDb: 6 });
		const dn = biquad({ type: 'peaking', f0, fs: FS, q, gainDb: -6 });
		const k = up[0];
		// numerator of +G (normalised) equals denominator of −G and vice versa
		[up[0], up[1], up[2]].forEach((v, i) => expect(v / k).toBeCloseTo(dn[3 + i], 12));
		for (const f of [20, 500, 1000, 3000, 20000])
			expect(magDb(up, f) + magDb(dn, f)).toBeCloseTo(0, 9);
	});
});
