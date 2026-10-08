import { describe, expect, it } from 'vitest';
import { type Complex, abs, add, c, div, mul, sub } from '../src/lib/dsp/complex';
import { designAnalog } from '../src/lib/dsp/design';
import { logspace } from '../src/lib/dsp/response';
import {
	TOPOLOGIES,
	designStage,
	fillNote,
	monteCarlo,
	stageSpecs,
	tfParams,
	type DesignOptions,
	type StageDesign
} from '../src/lib/features/active-filters/design';
import {
	ladderPrototype,
	scaleLadder,
	simulateLadder,
	spiceNetlist,
	synthesizeLadder
} from '../src/lib/features/lc-ladder/ladder';

const TWO_PI = 2 * Math.PI;
const opts = (o: Partial<DesignOptions> = {}): DesignOptions => ({
	topology: 'sk-unity',
	gain: 1,
	baseC: 10e-9,
	rSeries: 'E24',
	cSeries: 'E12',
	optimize: true,
	...o
});
const part = (st: StageDesign, role: string) => st.parts.find((p) => p.role === role);

describe('#19 equal-component Sallen–Key at Q = 0.5 (K = 1)', () => {
	it('every critically damped LP/HP design builds with valid parts', () => {
		for (const band of ['lowpass', 'highpass'] as const)
			for (let N = 2; N <= 10; N++)
				for (const optimize of [false, true]) {
					const zpk = designAnalog({ family: 'critical', band, order: N, f1: 1000 });
					for (const spec of stageSpecs(zpk, band)) {
						const st = designStage(spec, opts({ topology: 'sk-equal', optimize }));
						for (const p of st.parts) {
							expect(p.exact).toBeGreaterThan(0);
							expect(Number.isFinite(p.exact)).toBe(true);
						}
						if (spec.order === 2) {
							// K = 1 is the unity-gain circuit (without the optimiser's capacitor
							// steps it is exactly the equal-component one: equal C, equal R)
							expect(st.topology).toBe('sk-unity');
							expect(st.gain).toBe(1);
							if (!optimize) {
								expect(part(st, 'C1')!.exact).toBe(part(st, 'C2')!.exact);
								expect(part(st, 'R1')!.exact / part(st, 'R2')!.exact).toBeCloseTo(1, 6);
							}
							expect(tfParams(st.exactTf, band).q).toBeCloseTo(0.5, 9);
							expect(tfParams(st.exactTf, band).w0 / spec.w0).toBeCloseTo(1, 9);
							expect(st.notes.join(' ')).toMatch(/K = 3 − 1\/Q = 1\.000/);
						}
					}
				}
	});

	it('single stage at and just above Q = 0.5 never asks for a micro-ohm R4', () => {
		for (const q of [0.5, 0.5000000001, 0.50001, 0.5002])
			for (const band of ['lowpass', 'highpass'] as const) {
				const st = designStage(
					{ band, order: 2, w0: TWO_PI * 1000, q },
					opts({ topology: 'sk-equal' })
				);
				expect(st.topology).toBe('sk-unity');
				expect(st.parts.every((p) => p.exact > 0 && p.value > 0)).toBe(true);
				expect(tfParams(st.exactTf, band).q / q).toBeCloseTo(1, 8);
			}
	});

	it('a tiny R4 just above the cut-off gets a note about K, not about the base capacitor', () => {
		const st = designStage(
			{ band: 'lowpass', order: 2, w0: TWO_PI * 1000, q: 0.5005 },
			opts({ topology: 'sk-equal' })
		);
		expect(st.topology).toBe('sk-equal');
		expect(part(st, 'R4')!.value).toBeLessThan(100);
		expect(st.notes.some((n) => /^R4 = below 100 Ω: K = 1\.002 is barely above 1/.test(n))).toBe(
			true
		);
		expect(st.notes.some((n) => n.includes('base capacitor'))).toBe(false);
	});

	it('Q comfortably above 0.5 still uses the equal-component circuit', () => {
		const st = designStage(
			{ band: 'lowpass', order: 2, w0: TWO_PI * 1000, q: 0.6 },
			opts({ topology: 'sk-equal' })
		);
		expect(st.topology).toBe('sk-equal');
		expect(st.gain).toBeCloseTo(3 - 1 / 0.6, 12);
		expect(part(st, 'R4')!.exact).toBeGreaterThan(1000);
	});
});

describe('#20 band-pass optimiser keeps a reachable centre gain', () => {
	it('default page band-pass (Butterworth N = 4, 500 Hz–2 kHz) keeps |H0| = 1', () => {
		const zpk = designAnalog({ family: 'butter', band: 'bandpass', order: 4, f1: 500, f2: 2000 });
		for (const spec of stageSpecs(zpk, 'bandpass')) {
			const st = designStage(spec, opts());
			expect(st.gain).toBe(-1);
			expect(st.notes).toEqual([]);
			expect(Number.isFinite(part(st, 'R3')!.exact)).toBe(true);
			// the built gain stays near the request (the old clamp gave −0.947)
			expect(Math.abs(st.realizedParams.gain)).toBeGreaterThan(0.97);
		}
	});

	it('never cuts a gain below 2Q², and the limit note quotes 2Q² itself', () => {
		for (let q = 0.72; q <= 3; q += 0.01)
			for (const gain of [0.5, 1, 1.5, 2, 3, 4]) {
				const spec = { band: 'bandpass' as const, order: 2 as const, w0: TWO_PI * 1000, q };
				const st = designStage(spec, opts({ gain }));
				const lim = 2 * q * q;
				expect(st.gain).toBeCloseTo(-Math.min(gain, lim), 9);
				if (gain < lim) expect(st.notes).toEqual([]);
				else if (gain > lim * (1 + 1e-9)) {
					expect(st.notes).toEqual([
						`Centre gain limited to 2Q² = ${lim.toPrecision(3)} (shunt resistor left open).`
					]);
					expect(part(st, 'R3')!.exact).toBe(Infinity);
					expect(part(st, 'C1')!.value).toBe(part(st, 'C2')!.value);
				}
			}
	});
});

describe('#72 stage warnings can name parts by their global designators', () => {
	it('fillNote resolves {role} placeholders and keeps unknown roles', () => {
		expect(fillNote('Capacitor ratio {C1}/{C2} = 330', { C1: 'C5', C2: 'C6' })).toBe(
			'Capacitor ratio C5/C6 = 330'
		);
		expect(fillNote('{R4} = below 100 Ω', {})).toBe('R4 = below 100 Ω');
		expect(fillNote('no parts here, 2Q² = 1.19', { C1: 'C9' })).toBe('no parts here, 2Q² = 1.19');
	});

	it('6th-order 1 dB Chebyshev, base C 100 pF: stage 3 warning names its own capacitors', () => {
		const zpk = designAnalog({ family: 'cheby1', band: 'lowpass', order: 6, f1: 1000, rp: 1 });
		const stages = stageSpecs(zpk, 'lowpass').map((s) => designStage(s, opts({ baseC: 1e-10 })));
		// the page numbers parts through the cascade: stage 3 holds C5 and C6
		const t = stages[2].noteTemplates.find((n) => n.startsWith('Capacitor ratio'))!;
		expect(t).toMatch(/^Capacitor ratio \{C1\}\/\{C2\} = 330 /);
		expect(fillNote(t, { C1: 'C5', C2: 'C6' })).toMatch(/^Capacitor ratio C5\/C6 = 330 /);
		// plain notes keep the local role names
		expect(stages[2].notes).toContain(fillNote(t));
		expect(stages[2].notes.length).toBe(stages[2].noteTemplates.length);
		// resistor-range warnings use placeholders too
		expect(stages[0].noteTemplates.some((n) => /^\{R\d\} = above 2 MΩ/.test(n))).toBe(true);
	});
});

describe('#75 share-link topologies', () => {
	it('only the three user-selectable topologies are accepted', () => {
		expect([...TOPOLOGIES]).toEqual(['sk-unity', 'sk-equal', 'mfb']);
		for (const bad of ['rc1', 'mfb-bp', 'toString', 'constructor'])
			expect(TOPOLOGIES.find((t) => t === bad)).toBeUndefined();
	});
});

describe('#76 Monte-Carlo spread at exactly fRef', () => {
	it('the runs at a single frequency are the same builds as on the plot grid', () => {
		const zpk = designAnalog({ family: 'cheby1', band: 'lowpass', order: 6, f1: 1000, rp: 1 });
		const stages = stageSpecs(zpk, 'lowpass').map((s) => designStage(s, opts()));
		const grid = [...logspace(125, 8000, 199)];
		expect(grid[99]).toBeCloseTo(1000, 6); // odd grid: centre point is fRef
		const onGrid = monteCarlo(stages, 0.05, grid, 40).map((r) => r[99]);
		const atRef = monteCarlo(stages, 0.05, [1000], 40).map((r) => r[0]);
		for (let i = 0; i < 40; i++) expect(atRef[i]).toBeCloseTo(onGrid[i], 9);
		const spread = Math.max(...atRef) - Math.min(...atRef);
		expect(spread).toBeCloseTo(3.9645, 3); // the 200-point grid's 989.6 Hz gave 3.662 dB
	});
});

// ---------------------------------------------------------------------------
// LC ladder
// ---------------------------------------------------------------------------

/** Solve a SPICE netlist (V/R/L/C only) by nodal analysis; returns V(node)/1 at f. */
function solveNetlist(text: string, f: number, probe: string): Complex {
	const lines = text.split('\n').filter((l) => l && !l.startsWith('*') && !l.startsWith('.'));
	const val = (s: string) => Number(s);
	let src = { node: '', amp: 0 };
	const els: { a: string; b: string; y: Complex }[] = [];
	const w = TWO_PI * f;
	for (const l of lines) {
		const [name, a, b, ...rest] = l.split(/\s+/);
		if (name[0] === 'V') {
			expect(b).toBe('0');
			expect(rest[0]).toBe('AC');
			src = { node: a, amp: val(rest[1]) };
		} else if (name[0] === 'R') els.push({ a, b, y: c(1 / val(rest[0])) });
		else if (name[0] === 'L') els.push({ a, b, y: c(0, -1 / (w * val(rest[0]))) });
		else if (name[0] === 'C') els.push({ a, b, y: c(0, w * val(rest[0])) });
	}
	const nodes = [...new Set(els.flatMap((e) => [e.a, e.b]))].filter(
		(n) => n !== '0' && n !== src.node
	);
	const idx = new Map(nodes.map((n, i) => [n, i]));
	const n = nodes.length;
	const A: Complex[][] = Array.from({ length: n }, () => Array.from({ length: n + 1 }, () => c(0)));
	const volt = (node: string) => (node === src.node ? c(src.amp) : c(0));
	for (const e of els) {
		for (const [p, q] of [
			[e.a, e.b],
			[e.b, e.a]
		]) {
			const i = idx.get(p);
			if (i === undefined) continue;
			A[i][i] = add(A[i][i], e.y);
			const j = idx.get(q);
			if (j !== undefined) A[i][j] = sub(A[i][j], e.y);
			else A[i][n] = add(A[i][n], mul(e.y, volt(q)));
		}
	}
	for (let col = 0; col < n; col++) {
		let piv = col;
		for (let r = col + 1; r < n; r++) if (abs(A[r][col]) > abs(A[piv][col])) piv = r;
		[A[col], A[piv]] = [A[piv], A[col]];
		for (let r = 0; r < n; r++) {
			if (r === col) continue;
			const k = div(A[r][col], A[col][col]);
			for (let m = col; m <= n; m++) A[r][m] = sub(A[r][m], mul(k, A[col][m]));
		}
	}
	const i = idx.get(probe)!;
	return div(A[i][n], A[i][i]);
}

describe('#69 SPICE netlist reads |S21| for any terminations', () => {
	const cases: [string, number, number][] = [
		['cheby1', 4, 0.5], // RL ≠ RS
		['cheby1', 6, 3],
		['cheby1', 5, 0.5], // RL = RS
		['butter', 4, 0]
	];
	for (const [family, N, rp] of cases)
		for (const form of ['shunt', 'series'] as const)
			for (const band of ['lowpass', 'bandpass'] as const)
				it(`${family} N=${N} ${form} ${band}`, () => {
					const syn = synthesizeLadder(ladderPrototype(family as 'cheby1', N, rp));
					const net = scaleLadder(syn, { form, band, r0: 50, f0: 1e6, bw: 3e5 });
					const text = spiceNetlist(net, 'test', 1e4, 1e8);
					expect(text).toContain(`AC ${Number((2 * Math.sqrt(net.rs / net.rl)).toPrecision(6))}`);
					const probe = text.match(/\.print ac vdb\((\w+)\)/)![1];
					const fs = band === 'lowpass' ? [1e5, 5e5, 9e5, 1.3e6] : [0.9e6, 1e6, 1.1e6, 2e6];
					const sim = simulateLadder(net, fs);
					fs.forEach((f, k) => {
						const vdb = 20 * Math.log10(abs(solveNetlist(text, f, probe)));
						// (the netlist prints 6 digits, so allow 0.005 dB deep in the stopband)
						expect(vdb).toBeCloseTo(20 * Math.log10(abs(sim.s21[k])), 2);
					});
				});

	it('the even-order Chebyshev passband peaks read 0 dB in SPICE (was ±2.98 dB)', () => {
		for (const form of ['shunt', 'series'] as const) {
			const net = scaleLadder(synthesizeLadder(ladderPrototype('cheby1', 4, 0.5)), {
				form,
				band: 'lowpass',
				r0: 50,
				f0: 1e6
			});
			const text = spiceNetlist(net, 'test', 1e4, 1e8);
			const probe = text.match(/\.print ac vdb\((\w+)\)/)![1];
			const peak = Math.max(
				...[...logspace(1e5, 1e6, 400)].map(
					(f) => 20 * Math.log10(abs(solveNetlist(text, f, probe)))
				)
			);
			expect(Math.abs(peak)).toBeLessThan(1e-3);
		}
	});
});

describe('content checks', () => {
	it('#71 Q sensitivity of the equal-component Sallen–Key at Q = 10', () => {
		const Q = (r: number) => 1 / (2 - r); // K = 1 + r, Q = 1/(3 − K)
		const r = 1.9; // Q = 10
		const h = 1e-7;
		const sR = (r * (Q(r * (1 + h)) - Q(r * (1 - h)))) / (2 * h * r) / Q(r);
		expect(sR).toBeCloseTo(2 * 10 - 1, 4); // ≈ 19 % per 1 % of R4/R3
		const QK = (K: number) => 1 / (3 - K);
		const K = 2.9;
		const sK = (K * (QK(K * (1 + h)) - QK(K * (1 - h)))) / (2 * h * K) / QK(K);
		expect(sK).toBeCloseTo(3 * 10 - 1, 4); // ≈ 29 % per 1 % of K
	});

	it('#70 the 2Q² limit appears for a wide band-pass, not a narrow one', () => {
		const limited = (f1: number, f2: number, gain: number) =>
			stageSpecs(
				designAnalog({ family: 'butter', band: 'bandpass', order: 4, f1, f2 }),
				'bandpass'
			).some((s) => designStage(s, opts({ gain })).notes.some((n) => n.includes('limited')));
		expect(limited(200, 5000, 1)).toBe(true);
		expect(limited(900, 1100, 10)).toBe(false);
	});

	it('#77 narrow band-pass: series L up / C down, shunt L down / C up', () => {
		const syn = synthesizeLadder(ladderPrototype('cheby1', 5, 0.1));
		const at = (bw: number) =>
			scaleLadder(syn, { form: 'shunt', band: 'bandpass', r0: 50, f0: 30e6, bw });
		const wide = at(6e6);
		const narrow = at(0.6e6);
		wide.branches.forEach((b, i) => {
			const nb = narrow.branches[i];
			const up = b.pos === 'series' ? 10 : 0.1;
			expect(nb.L! / b.L!).toBeCloseTo(up, 9);
			expect(nb.C! / b.C!).toBeCloseTo(1 / up, 9);
		});
	});
});
