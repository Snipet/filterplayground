import { describe, expect, it } from 'vitest';
import {
	ampToDb,
	dbToAmp,
	powToDb,
	dbToPow,
	DBU_REF,
	levelToVrms,
	levelsFromVrms,
	qToZeta,
	zetaToQ,
	qToOctaves,
	octavesToQ,
	bandEdges,
	overshoot,
	lowpassPeak,
	rcCutoff,
	rcOther,
	rlCutoff,
	rlR,
	rlL,
	lcResonance,
	lcOther,
	characteristicImpedance,
	reactanceC,
	reactanceL,
	rippleToEps,
	epsToRipple,
	rippleToDeltaSym,
	deltaSymToRipple,
	rippleToDeltaOne,
	deltaOneToRipple,
	attenToDelta,
	deltaToAtten,
	rippleToRho,
	rhoToRipple,
	rhoToReturnLoss,
	returnLossToRho,
	rhoToVswr,
	vswrToRho,
	aliasFrequency,
	interval,
	octaveBand,
	octaveBandIndex,
	octaveBands,
	eSeriesNeighbours,
	settledFraction,
	timeToFraction,
	riseTime1090,
	tauFromCutoff,
	prewarpHz,
	unwarpHz,
	delayToPhaseDeg,
	phaseDegToDelay,
	phaseDelayToFreq,
	sPoleInfo,
	sPolesFromF0Q,
	zPoleInfo,
	zPoleFromF0Q
} from '../src/lib/features/calculators/math';
import { passbandRippleToDelta, stopbandAttenToDelta } from '../src/lib/dsp/fir';
import { bwToQ, qToBw } from '../src/lib/dsp/biquad';
import { prewarp } from '../src/lib/dsp/transforms';

describe('decibels', () => {
	it('amplitude and power ratios', () => {
		expect(ampToDb(10)).toBeCloseTo(20, 12);
		expect(ampToDb(2)).toBeCloseTo(6.0206, 4);
		expect(powToDb(2)).toBeCloseTo(3.0103, 4);
		expect(dbToAmp(-6.0206)).toBeCloseTo(0.5, 4);
		expect(dbToPow(30)).toBeCloseTo(1000, 9);
		expect(dbToAmp(ampToDb(0.37))).toBeCloseTo(0.37, 12);
	});
	it('reference levels', () => {
		expect(DBU_REF).toBeCloseTo(0.774597, 6);
		expect(levelToVrms(0, 'dBV')).toBeCloseTo(1, 12);
		expect(levelToVrms(0, 'dBu')).toBeCloseTo(0.774597, 6);
		// +4 dBu professional line level ≈ 1.228 V rms
		expect(levelToVrms(4, 'dBu')).toBeCloseTo(1.2277, 4);
		// −10 dBV consumer line level ≈ 0.316 V rms
		expect(levelToVrms(-10, 'dBV')).toBeCloseTo(0.31623, 5);
		// 0 dBm into 50 Ω = 223.6 mV rms; into 600 Ω = 774.6 mV
		expect(levelToVrms(0, 'dBm50')).toBeCloseTo(0.223607, 6);
		expect(levelToVrms(0, 'dBm600')).toBeCloseTo(DBU_REF, 12);
		expect(levelToVrms(Math.SQRT2, 'Vpk')).toBeCloseTo(1, 12);
		expect(levelToVrms(2 * Math.SQRT2, 'Vpp')).toBeCloseTo(1, 12);
	});
	it('levels from Vrms round-trip', () => {
		const l = levelsFromVrms(1);
		expect(l.dBV).toBeCloseTo(0, 12);
		expect(l.dBu).toBeCloseTo(2.2185, 4);
		expect(l.dBm600).toBeCloseTo(2.2185, 4);
		expect(l.dBm50).toBeCloseTo(13.0103, 4); // 20 mW
		expect(l.p50).toBeCloseTo(0.02, 12);
		expect(l.vpp).toBeCloseTo(2.828427, 6);
		for (const u of ['dBV', 'dBu', 'dBm50', 'dBm600'] as const) {
			const v = levelToVrms(-17.3, u);
			const back = levelsFromVrms(v)[u];
			expect(back).toBeCloseTo(-17.3, 10);
		}
	});
});

describe('Q, bandwidth and damping', () => {
	it('Q ↔ ζ', () => {
		expect(qToZeta(Math.SQRT1_2)).toBeCloseTo(Math.SQRT1_2, 12);
		expect(zetaToQ(0.5)).toBe(1);
	});
	it('Q ↔ octaves (and agrees with the biquad module)', () => {
		// 1 octave ↔ Q = √2 ≈ 1.4142; 1/3 octave ↔ Q ≈ 4.318
		expect(octavesToQ(1)).toBeCloseTo(Math.SQRT2, 12);
		expect(octavesToQ(1 / 3)).toBeCloseTo(4.3185, 4);
		expect(qToOctaves(Math.SQRT2)).toBeCloseTo(1, 12);
		for (const q of [0.3, 0.707, 2, 10]) {
			expect(octavesToQ(qToOctaves(q))).toBeCloseTo(q, 10);
			expect(qToOctaves(q)).toBeCloseTo(qToBw(q), 12);
			expect(octavesToQ(qToOctaves(q))).toBeCloseTo(bwToQ(qToBw(q)), 10);
		}
	});
	it('band edges are geometric-symmetric with width f0/Q', () => {
		for (const q of [0.5, 1, 4.3]) {
			const [fl, fh] = bandEdges(1000, q);
			expect(fl * fh).toBeCloseTo(1e6, 6);
			expect(fh - fl).toBeCloseTo(1000 / q, 9);
			expect(Math.log2(fh / fl)).toBeCloseTo(qToOctaves(q), 10);
		}
	});
	it('band edges are the −3 dB points of a second-order band-pass', () => {
		const f0 = 1000;
		const q = 3;
		const H = (f: number) => {
			const s = f / f0; // jω/ω0
			// H(jω) = (jω/(Qω0)) / (1 − (ω/ω0)² + jω/(Qω0))
			const re = 1 - s * s;
			const im = s / q;
			return Math.abs(im) / Math.hypot(re, im);
		};
		const [fl, fh] = bandEdges(f0, q);
		expect(H(fl)).toBeCloseTo(Math.SQRT1_2, 12);
		expect(H(fh)).toBeCloseTo(Math.SQRT1_2, 12);
	});
	it('overshoot', () => {
		expect(overshoot(0)).toBe(1);
		expect(overshoot(1)).toBe(0);
		expect(overshoot(Math.SQRT1_2)).toBeCloseTo(0.04321, 5); // Butterworth 2nd order: 4.3 %
		expect(overshoot(0.5)).toBeCloseTo(0.16303, 5);
	});
	it('low-pass resonant peak', () => {
		expect(lowpassPeak(1000, 0.7)).toBeNull();
		const pk = lowpassPeak(1000, 2)!;
		// brute-force maximum of |ω0²/(ω0² − ω² + jωω0/Q)|
		let best = 0;
		let fbest = 0;
		for (let f = 500; f < 1500; f += 0.01) {
			const s = f / 1000;
			const m = 1 / Math.hypot(1 - s * s, s / 2);
			if (m > best) {
				best = m;
				fbest = f;
			}
		}
		expect(pk.gain).toBeCloseTo(best, 6);
		expect(pk.fr).toBeCloseTo(fbest, 1);
	});
});

describe('RC / RL / LC / reactance', () => {
	it('RC', () => {
		expect(rcCutoff(10e3, 10e-9)).toBeCloseTo(1591.549, 3);
		expect(rcOther(10e-9, 1591.549430918953)).toBeCloseTo(10e3, 6);
	});
	it('RL', () => {
		expect(rlCutoff(100, 10e-3)).toBeCloseTo(1591.549, 3);
		expect(rlR(10e-3, 1591.549430918953)).toBeCloseTo(100, 9);
		expect(rlL(100, 1591.549430918953)).toBeCloseTo(10e-3, 12);
	});
	it('LC', () => {
		expect(lcResonance(1e-3, 1e-6)).toBeCloseTo(5032.92, 2);
		expect(lcOther(1e-6, 5032.921210448704)).toBeCloseTo(1e-3, 12);
		expect(characteristicImpedance(1e-3, 1e-6)).toBeCloseTo(31.6228, 4);
		// at resonance both reactances equal Z0
		const f0 = lcResonance(1e-3, 1e-6);
		expect(reactanceL(f0, 1e-3)).toBeCloseTo(characteristicImpedance(1e-3, 1e-6), 9);
		expect(reactanceC(f0, 1e-6)).toBeCloseTo(characteristicImpedance(1e-3, 1e-6), 9);
	});
	it('reactance', () => {
		expect(reactanceC(1000, 1e-6)).toBeCloseTo(159.155, 3);
		expect(reactanceL(1000, 1e-3)).toBeCloseTo(6.28319, 5);
	});
});

describe('ripple', () => {
	it('ε', () => {
		expect(rippleToEps(3.0103)).toBeCloseTo(1, 4);
		expect(rippleToEps(1)).toBeCloseTo(0.50885, 5);
		expect(rippleToEps(0.5)).toBeCloseTo(0.34931, 5);
		expect(epsToRipple(rippleToEps(0.17))).toBeCloseTo(0.17, 12);
	});
	it('δp conventions', () => {
		expect(rippleToDeltaSym(1)).toBeCloseTo(passbandRippleToDelta(1), 14);
		expect(rippleToDeltaSym(1)).toBeCloseTo(0.05750, 5);
		expect(deltaSymToRipple(rippleToDeltaSym(0.25))).toBeCloseTo(0.25, 12);
		expect(rippleToDeltaOne(1)).toBeCloseTo(0.10875, 5);
		expect(deltaOneToRipple(rippleToDeltaOne(0.25))).toBeCloseTo(0.25, 12);
	});
	it('δs', () => {
		expect(attenToDelta(60)).toBeCloseTo(1e-3, 15);
		expect(attenToDelta(40)).toBeCloseTo(stopbandAttenToDelta(40), 15);
		expect(deltaToAtten(0.01)).toBeCloseTo(40, 12);
	});
	it('return loss and VSWR (known table values)', () => {
		// 0.1 dB ripple ↔ RL ≈ 16.43 dB, VSWR ≈ 1.355; 0.01 dB ↔ RL ≈ 26.38 dB, VSWR ≈ 1.10
		const r1 = rippleToRho(0.1);
		expect(rhoToReturnLoss(r1)).toBeCloseTo(16.43, 2);
		expect(rhoToVswr(r1)).toBeCloseTo(1.355, 3);
		const r2 = rippleToRho(0.01);
		expect(rhoToReturnLoss(r2)).toBeCloseTo(26.38, 2);
		expect(rhoToVswr(r2)).toBeCloseTo(1.1, 2);
		// |ρ| = ε/√(1+ε²)
		const eps = rippleToEps(0.5);
		expect(rippleToRho(0.5)).toBeCloseTo(eps / Math.sqrt(1 + eps * eps), 12);
		expect(rhoToRipple(returnLossToRho(rhoToReturnLoss(r1)))).toBeCloseTo(0.1, 12);
		expect(vswrToRho(rhoToVswr(0.2))).toBeCloseTo(0.2, 12);
	});
});

describe('sampling and frequency', () => {
	it('aliases', () => {
		expect(aliasFrequency(1000, 48000)).toBe(1000);
		expect(aliasFrequency(30000, 48000)).toBe(18000);
		expect(aliasFrequency(50000, 48000)).toBe(2000);
		expect(aliasFrequency(24000, 48000)).toBe(24000);
		expect(aliasFrequency(96000, 48000)).toBe(0);
	});
	it('intervals', () => {
		const iv = interval(440, 880);
		expect(iv.octaves).toBeCloseTo(1, 12);
		expect(iv.cents).toBeCloseTo(1200, 9);
		expect(iv.semitones).toBeCloseTo(12, 9);
		expect(interval(20, 20000).decades).toBeCloseTo(3, 12);
		expect(interval(20, 20000).octaves).toBeCloseTo(9.9658, 4);
	});
});

describe('fractional-octave bands', () => {
	it('base-10 one-third-octave centres and nominal values', () => {
		const b = octaveBand(0, 3, 10);
		expect(b.centre).toBeCloseTo(1000, 9);
		expect(b.nominal).toBe(1000);
		expect(octaveBand(1, 3, 10).centre).toBeCloseTo(1258.925, 3);
		expect(octaveBand(1, 3, 10).nominal).toBe(1250);
		expect(octaveBand(-17, 3, 10).nominal).toBe(20);
		expect(octaveBand(13, 3, 10).nominal).toBe(20000);
		expect(octaveBand(-5, 3, 10).nominal).toBe(315);
		// edges of the 1 kHz third-octave band: 891.25 … 1122.0 Hz
		expect(b.lower).toBeCloseTo(891.251, 3);
		expect(b.upper).toBeCloseTo(1122.018, 3);
	});
	it('octave bands', () => {
		const nominal = octaveBands(1, 10, 20, 20000).map((b) => b.nominal);
		expect(nominal).toEqual([16, 31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]);
		const b = octaveBand(0, 1, 2);
		expect(b.lower).toBeCloseTo(707.107, 3);
		expect(b.upper).toBeCloseTo(1414.214, 3);
	});
	it('even fractions straddle 1 kHz', () => {
		const b = octaveBand(0, 6, 2);
		expect(b.lower).toBeCloseTo(1000, 9);
		expect(b.centre).toBeCloseTo(1000 * Math.pow(2, 1 / 12), 9);
		expect(b.nominal).toBeUndefined();
		expect(octaveBand(-1, 6, 2).upper).toBeCloseTo(1000, 9);
	});
	it('band index contains the frequency', () => {
		for (const bb of [1, 3, 6, 12]) {
			for (const base of [2, 10] as const) {
				for (const f of [17, 99.9, 1000, 1001, 7777, 19999]) {
					const band = octaveBand(octaveBandIndex(f, bb, base), bb, base);
					expect(f).toBeGreaterThanOrEqual(band.lower * (1 - 1e-9));
					expect(f).toBeLessThanOrEqual(band.upper * (1 + 1e-9));
				}
			}
		}
	});
});

describe('E-series lookup', () => {
	it('neighbours and errors', () => {
		const n = eSeriesNeighbours(5000, 'E12');
		expect(n.below).toBe(4700);
		expect(n.above).toBe(5600);
		expect(n.nearest).toBe(4700);
		expect(n.errBelow).toBeCloseTo(-6, 9);
		expect(n.errAbove).toBeCloseTo(12, 9);
		const e = eSeriesNeighbours(4700, 'E24');
		expect(e.below).toBe(4700);
		expect(e.above).toBe(4700);
		expect(e.errNearest).toBe(0);
		const f = eSeriesNeighbours(1.591549e-9, 'E96');
		expect(f.below).toBeCloseTo(1.58e-9, 20);
		expect(f.above).toBeCloseTo(1.62e-9, 20);
		// decade boundaries
		const g = eSeriesNeighbours(9.9, 'E6');
		expect(g.below).toBe(6.8);
		expect(g.above).toBe(10);
		const h = eSeriesNeighbours(0.00101, 'E6');
		expect(h.below).toBeCloseTo(0.001, 15);
		expect(h.above).toBeCloseTo(0.0015, 15);
	});
});

describe('time constant', () => {
	it('settling', () => {
		expect(settledFraction(1, 1)).toBeCloseTo(0.63212, 5);
		expect(settledFraction(5, 1)).toBeCloseTo(0.99326, 5);
		expect(timeToFraction(0.99, 1)).toBeCloseTo(4.60517, 5);
		expect(timeToFraction(0.5, 2)).toBeCloseTo(2 * Math.LN2, 12);
		expect(riseTime1090(1)).toBeCloseTo(2.1972, 4);
		// 0.35/f−3dB rule of thumb
		expect(riseTime1090(tauFromCutoff(1000))).toBeCloseTo(0.35 / 1000, 5);
		expect(riseTime1090(1)).toBeCloseTo(timeToFraction(0.9, 1) - timeToFraction(0.1, 1), 12);
	});
});

describe('bilinear prewarp', () => {
	it('agrees with transforms.prewarp and inverts', () => {
		const fs = 48000;
		for (const f of [100, 1000, 10000, 20000]) {
			expect(2 * Math.PI * prewarpHz(f, fs)).toBeCloseTo(prewarp(f, fs), 6);
			expect(unwarpHz(prewarpHz(f, fs), fs)).toBeCloseTo(f, 8);
		}
		expect(prewarpHz(12000, 48000)).toBeCloseTo(48000 / Math.PI, 6); // tan(π/4) = 1
	});
});

describe('phase and delay', () => {
	it('round trips', () => {
		expect(delayToPhaseDeg(1e-3, 250)).toBeCloseTo(90, 12);
		expect(phaseDegToDelay(180, 1000)).toBeCloseTo(0.5e-3, 15);
		expect(phaseDelayToFreq(360, 1e-3)).toBeCloseTo(1000, 9);
	});
});

describe('pole positions', () => {
	it('s-plane', () => {
		const [p] = sPolesFromF0Q(1000, Math.SQRT1_2);
		const info = sPoleInfo(p.re, p.im);
		expect(info.f0).toBeCloseTo(1000, 9);
		expect(info.q).toBeCloseTo(Math.SQRT1_2, 12);
		expect(info.zeta).toBeCloseTo(Math.SQRT1_2, 12);
		// Butterworth poles at 45°
		expect(Math.abs(p.re)).toBeCloseTo(p.im, 6);
		// overdamped: two real poles whose product is ω0²
		const [a, b] = sPolesFromF0Q(1000, 0.3);
		expect(a.im).toBe(0);
		expect(a.re * b.re).toBeCloseTo(Math.pow(2 * Math.PI * 1000, 2), 3);
		expect(-(a.re + b.re)).toBeCloseTo((2 * Math.PI * 1000) / 0.3, 6);
	});
	it('z-plane via z = e^{sT}', () => {
		const fs = 48000;
		const zp = zPoleFromF0Q(1000, 5, fs)!;
		const back = zPoleInfo(zp.r, zp.theta, fs);
		expect(back.f0).toBeCloseTo(1000, 6);
		expect(back.q).toBeCloseTo(5, 9);
		expect(zPoleFromF0Q(1000, 0.4, fs)).toBeNull();
	});
});
