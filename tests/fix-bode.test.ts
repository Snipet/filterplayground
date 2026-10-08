import { describe, expect, it } from 'vitest';
import {
	PRESETS,
	autoRange,
	closedLoopPoles,
	closedLoopStability,
	dcGainDb,
	gainMargins,
	loopMargins,
	makeFactor,
	marginRange,
	margins,
	nyquistRhpCount,
	slopes,
	totalExact,
	type Factor,
	type FactorType
} from '../src/lib/features/bode/factors';

const R2D = 180 / Math.PI;

describe('#21 margin search reaches crossovers far beyond the corners', () => {
	it('70 dB with a pole at 5 Hz crosses 0 dB at 5·√(10⁷ − 1) ≈ 15.8 kHz with PM ≈ 90°', () => {
		const fs = [makeFactor('gain', 0, { gainDb: 70 }), makeFactor('realPole', 1, { f: 5 })];
		// the corner-based range alone stops at 10 kHz
		const [lo, hi] = autoRange(fs);
		expect(margins(fs, lo / 100, hi * 100).pm).toBeNull();
		const m = loopMargins(fs);
		const fgc = 5 * Math.sqrt(1e7 - 1);
		expect(m.pm!.f).toBeCloseTo(fgc, 3);
		expect(m.pm!.margin).toBeCloseTo(180 - Math.atan(fgc / 5) * R2D, 6);
		expect(m.gm).toBeNull();
		expect(closedLoopStability(fs, m).stable).toBe(true);
	});

	it.each([
		[80, 2],
		[80, 20]
	])('%s dB with a pole at %s Hz', (gainDb, fp) => {
		const fs = [makeFactor('gain', 0, { gainDb }), makeFactor('realPole', 1, { f: fp })];
		const K = Math.pow(10, gainDb / 20);
		const m = loopMargins(fs);
		expect(m.pm!.f / (fp * Math.sqrt(K * K - 1))).toBeCloseTo(1, 9);
		expect(totalExact(fs, m.pm!.f).db).toBeCloseTo(0, 9);
	});

	it('also widens the low end (an integrator with very little gain)', () => {
		// |L| = 10⁻⁴·(0.1 Hz / f) → 0 dB at 10 µHz, far below the corner-based range
		const fs = [
			makeFactor('gain', 0, { gainDb: -40 }),
			makeFactor('gain', 1, { gainDb: -40 }),
			makeFactor('power', 2, { n: -1, f: 0.1 }),
			makeFactor('realPole', 3, { f: 1000 })
		];
		const [lo] = autoRange(fs);
		expect(lo / 100).toBeGreaterThan(1e-5);
		expect(marginRange(fs, lo / 100, 1e7)[0]).toBeLessThan(1e-5);
		const m = loopMargins(fs);
		expect(m.pm!.f).toBeCloseTo(1e-5, 9);
		expect(m.pm!.margin).toBeCloseTo(90, 4);
	});

	it('keeps the range unchanged when every crossover is already inside', () => {
		const fs = PRESETS.find((p) => p.id === 'loop')!.build();
		expect(marginRange(fs, 1e-3, 1e6)).toEqual([1e-3, 1e6]);
	});
});

describe('#22 stability is decided exactly, not from the sign of the worst gain margin', () => {
	const condLoop = (gainDb: number): Factor[] => [
		makeFactor('gain', 0, { gainDb }),
		makeFactor('power', 1, { n: -2, f: 10 }),
		makeFactor('power', 2, { n: -1, f: 10 }),
		makeFactor('realZero', 3, { f: 1 }),
		makeFactor('realZero', 4, { f: 1 }),
		makeFactor('realPole', 5, { f: 100 }),
		makeFactor('realPole', 6, { f: 100 })
	];

	it('the conditionally stable loop is stable, with GM +25.7 dB up and −25.7 dB down', () => {
		const fs = condLoop(-40);
		const m = loopMargins(fs);
		expect(m.gm!.margin).toBeCloseTo(-25.667, 2); // the worst margin is negative…
		const st = closedLoopStability(fs, m);
		expect(st).toMatchObject({ stable: true, rhp: 0, openRhp: 0, method: 'poles' }); // …yet stable
		const g = gainMargins(m);
		expect(g.up!.f).toBeCloseTo(97.979, 2);
		expect(g.up!.margin).toBeCloseTo(25.667, 2);
		expect(g.down!.f).toBeCloseTo(1.0206, 3);
		expect(g.down!.margin).toBeCloseTo(-25.667, 2);
		// roots of s³(1 + s/ω₁₀₀)² + 0.01·ω₁₀³(1 + s/ω₁)² (numpy)
		const re = closedLoopPoles(fs)!
			.map((p) => p.re)
			.sort((a, b) => a - b);
		const ref = [-802.7, -375.6, -62.83, -10.51, -4.918];
		re.forEach((v, i) => expect(v / ref[i]).toBeCloseTo(1, 3));
	});

	it('is stable exactly between the two critical gains (−65.67 dB … −14.33 dB)', () => {
		for (const [g, ok] of [
			[-80, false],
			[-66, false],
			[-65, true],
			[-50, true],
			[-30, true],
			[-15, true],
			[-14, false],
			[-10, false]
		] as const)
			expect(closedLoopStability(condLoop(g)).stable).toBe(ok);
	});

	it('a servo loop with a resonance / anti-resonance pair is stable despite negative GMs', () => {
		const fs = [
			makeFactor('power', 0, { n: -1, f: 1000 }),
			makeFactor('complexZero', 1, { f: 120, zeta: 0.05 }),
			makeFactor('complexPole', 2, { f: 100, zeta: 0.05 }),
			makeFactor('realPole', 3, { f: 5000 })
		];
		const m = loopMargins(fs);
		expect(m.phaseCrossovers.map((c) => c.margin).every((v) => v < 0)).toBe(true);
		expect(closedLoopStability(fs, m).stable).toBe(true);
		const maxRe = Math.max(...closedLoopPoles(fs)!.map((p) => p.re));
		expect(maxRe).toBeCloseTo(-17.97, 1);
		expect(gainMargins(m).down!.margin).toBeCloseTo(-6.3, 1);
	});

	it('an unstable L is judged by its closed-loop poles', () => {
		// K/(1 − s/ω): closed-loop pole at s = ω(1 + K) — unstable for any K > 0
		const rhp = makeFactor('realPole', 1, { f: 10, rhp: true });
		expect(closedLoopStability([makeFactor('gain', 0, { gainDb: 6 }), rhp]).rhp).toBe(1);
		// −K/(1 − s/ω), K > 1: pole at ω(1 − K) < 0 — stable although no margin is positive
		const neg = [makeFactor('gain', 0, { gainDb: 6, sign: -1 }), rhp];
		expect(closedLoopStability(neg)).toMatchObject({ stable: true, openRhp: 1 });
	});

	it('a double integrator alone is on the edge (closed-loop poles on the jω axis)', () => {
		expect(closedLoopStability([makeFactor('power', 0, { n: -2, f: 10 })]).stable).toBeNull();
	});

	it('delay loops use the Nyquist count: (ω_u/s)·e^(−sT) is stable iff f_u·T < 1/4', () => {
		const loop = (T: number) => [
			makeFactor('power', 0, { n: -1, f: 100 }),
			makeFactor('delay', 1, { T })
		];
		expect(closedLoopStability(loop(2.4e-3))).toMatchObject({ stable: true, method: 'nyquist' });
		expect(closedLoopStability(loop(2.6e-3))).toMatchObject({ stable: false, rhp: 2 });
	});

	it('first order plus dead time: unstable just above the critical gain', () => {
		// K e^(−sT)/(1 + s/ω_p): ∠L = −180° where atan(ω/ω_p) + ωT = π; K_crit = √(1 + (ω/ω_p)²)
		const fp = 10;
		const T = 0.01;
		// the phase lag is increasing in ω, so bisect for the −180° point
		let a = 0;
		let b = Math.PI / T;
		for (let i = 0; i < 200; i++) {
			const m = (a + b) / 2;
			if (Math.atan(m / (2 * Math.PI * fp)) + m * T < Math.PI) a = m;
			else b = m;
		}
		const w = (a + b) / 2;
		const kc = 20 * Math.log10(Math.sqrt(1 + (w / (2 * Math.PI * fp)) ** 2));
		const fopdt = (gainDb: number) => [
			makeFactor('gain', 0, { gainDb }),
			makeFactor('realPole', 1, { f: fp }),
			makeFactor('delay', 2, { T })
		];
		expect(loopMargins(fopdt(kc - 1)).gm!.margin).toBeCloseTo(1, 6);
		expect(closedLoopStability(fopdt(kc - 0.01)).stable).toBe(true);
		expect(closedLoopStability(fopdt(kc + 0.01))).toMatchObject({ stable: false, rhp: 2 });
	});

	it('an unstable pole with a delay: k·e^(−sT)/(s/ω_p − 1) is stable for 1 < k < k_max', () => {
		const sys = (gainDb: number) => [
			makeFactor('gain', 0, { gainDb, sign: -1 }),
			makeFactor('realPole', 1, { f: 1, rhp: true }),
			makeFactor('delay', 2, { T: 0.01 })
		];
		expect(closedLoopStability(sys(6))).toMatchObject({ stable: true, openRhp: 1 });
		expect(closedLoopStability(sys(-6))).toMatchObject({ stable: false, rhp: 1 });
	});

	it('a delay with |L(j∞)| ≥ 1 has infinitely many right-half-plane poles', () => {
		const st = closedLoopStability([
			makeFactor('gain', 0, { gainDb: 6 }),
			makeFactor('delay', 1, { T: 1e-3 })
		]);
		expect(st).toMatchObject({ stable: false, rhp: Infinity });
		// |L| < 1 everywhere: small-gain stable
		expect(
			closedLoopStability([
				makeFactor('gain', 0, { gainDb: -6 }),
				makeFactor('delay', 1, { T: 1e-3 })
			]).stable
		).toBe(true);
	});

	it('the Nyquist count matches the closed-loop poles on random strictly proper loops', () => {
		let seed = 12345;
		const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
		const types: FactorType[] = [
			'gain',
			'power',
			'realPole',
			'realPole',
			'complexPole',
			'realZero',
			'complexZero'
		];
		let checked = 0;
		for (let t = 0; t < 400; t++) {
			const n = 1 + Math.floor(rnd() * 6);
			const fs: Factor[] = [];
			for (let i = 0; i < n; i++)
				fs.push(
					makeFactor(types[Math.floor(rnd() * types.length)], i, {
						gainDb: -40 + rnd() * 120,
						sign: rnd() < 0.2 ? -1 : 1,
						n: [-2, -1, 1, 2][Math.floor(rnd() * 4)],
						f: Math.pow(10, -1 + rnd() * 7),
						zeta: Math.pow(10, -2.3 + rnd() * 2.6),
						rhp: rnd() < 0.2
					})
				);
			if (slopes(fs).high >= 0) continue;
			const z = nyquistRhpCount(
				fs,
				loopMargins(fs).gainCrossovers.map((c) => c.f)
			);
			if (z === null) continue; // e.g. a pure double integrator, exactly on −1
			const zr = closedLoopPoles(fs)!.filter((p) => p.re > 1e-9 * Math.hypot(p.re, p.im)).length;
			expect(z).toBe(zr);
			checked++;
		}
		expect(checked).toBeGreaterThan(150);
	}, 30000);
});

describe('#78 DC gain includes the constant left by cancelling powers of s', () => {
	it.each([
		[
			[
				[1, 10],
				[-1, 100]
			],
			20
		],
		[
			[
				[2, 10],
				[-2, 100]
			],
			40
		],
		[
			[
				[2, 10],
				[-1, 100],
				[-1, 1000]
			],
			60
		]
	])('powers %j → %s dB', (powers, db) => {
		const fs = (powers as [number, number][]).map(([n, f], i) => makeFactor('power', i, { n, f }));
		expect(slopes(fs).low).toBe(0);
		expect(dcGainDb(fs)).toBeCloseTo(db, 9);
		expect(totalExact(fs, 1e-3).db).toBeCloseTo(db, 9);
	});

	it('with a pole and a gain it equals the exact low-frequency plateau', () => {
		const fs = [
			makeFactor('gain', 0, { gainDb: 6 }),
			makeFactor('power', 1, { n: 1, f: 10 }),
			makeFactor('power', 2, { n: -1, f: 100 }),
			makeFactor('realPole', 3, { f: 1000 })
		];
		expect(dcGainDb(fs)).toBeCloseTo(26, 9);
		expect(totalExact(fs, 1e-4).db).toBeCloseTo(26, 6);
	});

	it('is ±∞ with a net integrator or differentiator', () => {
		expect(dcGainDb([makeFactor('power', 0, { n: -1 })])).toBe(Infinity);
		expect(dcGainDb([makeFactor('power', 0, { n: 1 })])).toBe(-Infinity);
		expect(dcGainDb([makeFactor('gain', 0, { gainDb: 12 })])).toBe(12);
	});
});

describe('#79 the loop presets match their descriptions', () => {
	const loop = PRESETS.find((p) => p.id === 'loop')!;
	const delay = PRESETS.find((p) => p.id === 'delay')!;

	it("'Integrator + two poles' really has two poles", () => {
		expect(loop.label).toMatch(/two poles/);
		expect(loop.description).toMatch(/ω_p1.*ω_p2/);
		const fs = loop.build();
		expect(fs.map((f) => f.type)).toEqual(['power', 'realPole', 'realPole']);
		// finite gain margin because the second pole takes the phase past −180°
		const m = loopMargins(fs);
		expect(m.gm!.f).toBeCloseTo(Math.sqrt(200 * 2000), 3);
	});

	it("'Loop with time delay' is the same loop plus a 1 ms delay, with the margins it quotes", () => {
		const base = loop.build();
		const fs = delay.build();
		expect(fs.filter((f) => f.type !== 'delay').map(({ type, n, f }) => ({ type, n, f }))).toEqual(
			base.map(({ type, n, f }) => ({ type, n, f }))
		);
		expect(fs.find((f) => f.type === 'delay')!.T).toBe(1e-3);
		const a = loopMargins(base);
		const b = loopMargins(fs);
		// same magnitude → same gain crossover
		expect(b.pm!.f).toBeCloseTo(a.pm!.f, 6);
		const d = delay.description;
		expect(d).toContain(`${Math.round(a.pm!.margin)}°`);
		expect(d).toContain(`${Math.round(b.pm!.margin)}°`);
		expect(d).toContain(`${a.gm!.margin.toFixed(1)} dB`);
		expect(d).toContain(`${b.gm!.margin.toFixed(1)} dB`);
		expect(closedLoopStability(fs, b).stable).toBe(true);
	});
});
