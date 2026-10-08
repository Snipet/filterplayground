<script lang="ts">
	import { onMount } from 'svelte';
	import ToolLayout from '$lib/components/layout/ToolLayout.svelte';
	import ControlGroup from '$lib/components/layout/ControlGroup.svelte';
	import Card from '$lib/components/layout/Card.svelte';
	import Select from '$lib/components/controls/Select.svelte';
	import Segmented from '$lib/components/controls/Segmented.svelte';
	import Slider from '$lib/components/controls/Slider.svelte';
	import NumberInput from '$lib/components/controls/NumberInput.svelte';
	import ResponseView from '$lib/components/plot/ResponseView.svelte';
	import Plot, { type Series } from '$lib/components/plot/Plot.svelte';
	import StatGrid, { type Stat } from '$lib/components/content/StatGrid.svelte';
	import Callout from '$lib/components/content/Callout.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import Schematic from '$lib/features/rlc/schematic/Schematic.svelte';
	import {
		CIRCUITS,
		SCHEMATIC_SIZE,
		bandEdges,
		circuitInfo,
		circuitSchematic,
		circuitZpk,
		dampingClass,
		firstOrderW,
		roundValues,
		secondOrder,
		solveFirstOrder,
		solveSecondOrder,
		stateZpks,
		texNum,
		type CircuitId,
		type Known,
		type Values
	} from '$lib/features/rlc/circuits';
	import { evaluate, logspace } from '$lib/dsp/response';
	import { analogTimeResponse, suggestAnalogDuration } from '$lib/dsp/time';
	import { formatSI, trimNumber, type ESeries } from '$lib/dsp/units';
	import { readSharedState } from '$lib/share';

	let circuit = $state<CircuitId>('rlc-c');
	let R = $state(470);
	let L = $state(0.1);
	let C = $state(100e-9);

	const shared = $derived({ circuit, R, L, C });
	onMount(() => {
		const st = readSharedState<typeof shared>();
		if (!st) return;
		if (st.circuit && CIRCUITS.some((c) => c.id === st.circuit)) circuit = st.circuit;
		const ok = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && v >= lo && v <= hi;
		if (ok(st.R, 1e-3, 1e9)) R = st.R;
		if (ok(st.L, 1e-12, 1e3)) L = st.L;
		if (ok(st.C, 1e-15, 1)) C = st.C;
	});

	const info = $derived(circuitInfo(circuit));
	const isSecond = $derived(info.order === 2);

	const model = $derived.by(() => {
		try {
			if (!(R > 0 && L > 0 && C > 0)) throw new Error('Component values must be positive.');
			const zpk = circuitZpk(circuit, R, L, C);
			if (![...zpk.p, ...zpk.z].every((p) => Number.isFinite(p.re) && Number.isFinite(p.im)) || !Number.isFinite(zpk.k))
				throw new Error('These component values overflow the numeric range.');
			return { zpk, error: null };
		} catch (e) {
			return { zpk: null, error: (e as Error).message };
		}
	});
	const filter = $derived(model.zpk ? { kind: 'analog' as const, zpk: model.zpk } : null);

	const w1 = $derived(firstOrderW(circuit, R, L, C));
	const so = $derived(secondOrder(circuit, R, L, C));
	const damping = $derived(dampingClass(so.zeta));
	const edges = $derived(bandEdges(so.w0, so.q));
	const TWO_PI = 2 * Math.PI;

	const vlines = $derived.by(() => {
		if (!isSecond) return [{ value: w1 / TWO_PI, label: 'fc' }];
		if (info.band === 'bandpass' || info.band === 'bandstop')
			return [
				{ value: edges[0] / TWO_PI, label: 'f₋' },
				{ value: so.w0 / TWO_PI, label: 'f₀' },
				{ value: edges[1] / TWO_PI, label: 'f₊' }
			];
		return [{ value: so.w0 / TWO_PI, label: 'f₀' }];
	});

	const dampingLabel = $derived(
		{ underdamped: 'Underdamped', critical: 'Critically damped', overdamped: 'Overdamped' }[damping]
	);

	const stats = $derived.by((): Stat[] => {
		if (!filter) return [];
		if (!isSecond) {
			const tau = 1 / w1;
			return [
				{ label: 'Corner frequency fc', value: formatSI(w1 / TWO_PI, 'Hz', 4), hint: info.family === 'rc' ? 'fc = 1/(2πRC)' : 'fc = R/(2πL)' },
				{ label: 'Time constant τ', value: formatSI(tau, 's', 4), hint: info.family === 'rc' ? 'τ = RC' : 'τ = L/R' },
				info.band === 'lowpass'
					? { label: 'Rise time 10–90 %', value: formatSI(tau * Math.log(9), 's', 3), hint: 'τ·ln 9 ≈ 2.2 τ' }
					: { label: 'Step decays to 10 %', value: formatSI(tau * Math.log(10), 's', 3), hint: 'The high-pass step response is e^(−t/τ): τ·ln 10 ≈ 2.3 τ' },
				{ label: info.band === 'lowpass' ? 'Settling to 1 %' : 'Decays to 1 %', value: formatSI(tau * Math.log(100), 's', 3), hint: 'τ·ln 100 ≈ 4.6 τ' },
				{ label: 'Gain / phase at fc', value: `−3.01 dB / ${info.band === 'lowpass' ? '−45°' : '+45°'}` },
				{ label: 'Roll-off', value: '20 dB/decade', hint: '6 dB per octave — one pole' }
			];
		}
		const f0 = so.w0 / TWO_PI;
		const out: Stat[] = [
			{ label: 'Resonance f₀', value: formatSI(f0, 'Hz', 4), hint: 'f₀ = 1/(2π√(LC))' },
			{ label: 'Quality factor Q', value: trimNumber(so.q, 4), hint: info.family === 'parallel' ? 'Q = R·√(C/L)' : 'Q = (1/R)·√(L/C)' },
			{ label: 'Damping ratio ζ', value: trimNumber(so.zeta, 4), hint: 'ζ = 1/(2Q)' },
			{ label: 'Damping', value: dampingLabel, hint: 'ζ < 1 underdamped, ζ = 1 critical, ζ > 1 overdamped' },
			{ label: 'Bandwidth f₀/Q', value: formatSI(f0 / so.q, 'Hz', 4), hint: 'Width of the resonance between the −3 dB points' },
			{ label: 'Char. impedance √(L/C)', value: formatSI(so.z0, 'Ω', 4), hint: 'Impedance of L (and of C) at resonance' },
			{
				label: 'Decay time constant',
				value: formatSI(1 / (so.zeta * so.w0), 's', 4),
				hint: info.family === 'parallel' ? 'Envelope e^(−t/τ) with τ = 2RC' : 'Envelope e^(−t/τ) with τ = 2L/R'
			}
		];
		if (damping === 'underdamped')
			out.push({ label: 'Ringing frequency fd', value: formatSI(f0 * Math.sqrt(1 - so.zeta * so.zeta), 'Hz', 4), hint: 'Damped natural frequency f₀√(1 − ζ²)' });
		if (info.band === 'lowpass' || info.band === 'highpass') {
			const grid = logspace(f0 / 100, f0 * 100, 1500);
			const r = evaluate(filter, grid);
			let best = 0;
			for (let i = 1; i < r.magDb.length; i++) if (r.magDb[i] > r.magDb[best]) best = i;
			const peak = r.magDb[best];
			out.push({
				label: 'Resonance peak',
				value: peak > 0.005 && best > 0 && best < grid.length - 1 ? `${trimNumber(peak, 3)} dB @ ${formatSI(grid[best], 'Hz', 3)}` : 'none',
				hint: 'Peaking appears for Q > 1/√2'
			});
		}
		if (info.band === 'lowpass') {
			const st = analogTimeResponse(filter.zpk, 'step', undefined, 800);
			const fin = st.y[st.y.length - 1];
			const over = (Math.max(...st.y) / fin - 1) * 100;
			out.push({ label: 'Step overshoot', value: `${trimNumber(Math.max(0, over), 3)} %`, hint: 'e^(−πζ/√(1−ζ²)) for ζ < 1' });
		}
		return out;
	});

	// ---------------- transfer-function text ----------------
	const tex = $derived.by(() => {
		const id = circuit;
		const D2 = (a1: string, a0: string) => `s^2 + ${a1}\\,s + ${a0}`;
		const sym: Record<CircuitId, [string, string, string]> = {
			'rc-lp': ['\\frac{Z_C}{Z_R + Z_C}', '\\frac{1}{1 + sRC}', '\\frac{\\omega_c}{s + \\omega_c},\\quad \\omega_c = \\frac{1}{RC}'],
			'rc-hp': ['\\frac{Z_R}{Z_C + Z_R}', '\\frac{sRC}{1 + sRC}', '\\frac{s}{s + \\omega_c},\\quad \\omega_c = \\frac{1}{RC}'],
			'rl-lp': ['\\frac{Z_R}{Z_L + Z_R}', '\\frac{R}{R + sL}', '\\frac{\\omega_c}{s + \\omega_c},\\quad \\omega_c = \\frac{R}{L}'],
			'rl-hp': ['\\frac{Z_L}{Z_R + Z_L}', '\\frac{sL}{R + sL}', '\\frac{s}{s + \\omega_c},\\quad \\omega_c = \\frac{R}{L}'],
			'rlc-c': ['\\frac{Z_C}{Z_R + Z_L + Z_C}', `\\frac{1/LC}{${D2('\\frac{R}{L}', '\\frac{1}{LC}')}}`, `\\frac{\\omega_0^2}{${D2('\\frac{\\omega_0}{Q}', '\\omega_0^2')}}`],
			'rlc-r': ['\\frac{Z_R}{Z_R + Z_L + Z_C}', `\\frac{\\frac{R}{L}\\,s}{${D2('\\frac{R}{L}', '\\frac{1}{LC}')}}`, `\\frac{\\frac{\\omega_0}{Q}\\,s}{${D2('\\frac{\\omega_0}{Q}', '\\omega_0^2')}}`],
			'rlc-l': ['\\frac{Z_L}{Z_R + Z_L + Z_C}', `\\frac{s^2}{${D2('\\frac{R}{L}', '\\frac{1}{LC}')}}`, `\\frac{s^2}{${D2('\\frac{\\omega_0}{Q}', '\\omega_0^2')}}`],
			'rlc-lc': ['\\frac{Z_L + Z_C}{Z_R + Z_L + Z_C}', `\\frac{s^2 + \\frac{1}{LC}}{${D2('\\frac{R}{L}', '\\frac{1}{LC}')}}`, `\\frac{s^2 + \\omega_0^2}{${D2('\\frac{\\omega_0}{Q}', '\\omega_0^2')}}`],
			tank: ['\\frac{Z_L \\parallel Z_C}{Z_R + Z_L \\parallel Z_C}', `\\frac{\\frac{1}{RC}\\,s}{${D2('\\frac{1}{RC}', '\\frac{1}{LC}')}}`, `\\frac{\\frac{\\omega_0}{Q}\\,s}{${D2('\\frac{\\omega_0}{Q}', '\\omega_0^2')}}`]
		};
		const [div, comp, std] = sym[id];
		let numeric: string;
		if (!isSecond) {
			const w = texNum(w1);
			numeric = info.band === 'lowpass' ? `\\frac{${w}}{s + ${w}}` : `\\frac{s}{s + ${w}}`;
		} else {
			const a1 = texNum(so.w0 / so.q);
			const a0 = texNum(so.w0 * so.w0);
			const den = D2(a1, a0);
			const num = { 'rlc-c': a0, 'rlc-r': `${a1}\\,s`, tank: `${a1}\\,s`, 'rlc-l': 's^2', 'rlc-lc': `s^2 + ${a0}` }[id as 'rlc-c'];
			numeric = `\\frac{${num}}{${den}}`;
		}
		return { div, comp, std, numeric };
	});

	const schematic = $derived(circuitSchematic(circuit, { R, L, C }));

	// ---------------- energy bookkeeping after a step ----------------
	const energy = $derived.by(() => {
		if (!isSecond || !model.zpk) return null;
		const dur = suggestAnalogDuration(model.zpk);
		const n = 500;
		const zs = stateZpks(circuit, R, L, C);
		const vc = analogTimeResponse(zs.vC, 'step', dur, n);
		const il = analogTimeResponse(zs.iL, 'step', dur, n);
		const t = vc.t;
		const eC = vc.y.map((v) => 0.5 * C * v * v);
		const eL = il.y.map((i) => 0.5 * L * i * i);
		// resistor current: the loop current (series) or (v_in − v_tank)/R (parallel)
		const iR = info.family === 'parallel' ? vc.y.map((v) => (1 - v) / R) : il.y;
		const eR: number[] = [0];
		for (let k = 1; k < n; k++) {
			const p0 = R * iR[k - 1] * iR[k - 1];
			const p1 = R * iR[k] * iR[k];
			eR.push(eR[k - 1] + 0.5 * (p0 + p1) * (t[k] - t[k - 1]));
		}
		const fmt = (v: number) => formatSI(v, 'J', 4);
		const series: Series[] = [
			{ x: t, y: eC, label: 'Stored in C  (½Cv²)', format: fmt },
			{ x: t, y: eL, label: 'Stored in L  (½Li²)', format: fmt },
			{ x: t, y: eR, label: 'Dissipated in R', format: fmt }
		];
		return { series };
	});

	// ---------------- component solver ----------------
	let solveFc = $state(1000);
	let solveF0 = $state(1000);
	let solveQ = $state(0.707);
	let known = $state<Known>('C');
	let knownValue = $state(100e-9);
	let eSeries = $state<ESeries>('E24');

	const knownOptions = $derived(
		(['R', 'L', 'C'] as Known[]).filter((k) => info.uses[k]).map((k) => ({ value: k, label: { R: 'R', L: 'L', C: 'C' }[k] }))
	);
	const knownEff = $derived<Known>(info.uses[known] ? known : info.uses.C ? 'C' : 'L');
	const knownUnit = $derived({ R: 'Ω', L: 'H', C: 'F' }[knownEff]);

	const solved = $derived.by(() => {
		try {
			if (!(knownValue > 0)) throw new Error('The known component must be positive.');
			let exact: Values;
			if (!isSecond) {
				if (!(solveFc > 0)) throw new Error('Target frequency must be positive.');
				exact = solveFirstOrder(info.family as 'rc' | 'rl', solveFc, knownEff, knownValue, { R, L, C });
			} else {
				if (!(solveF0 > 0 && solveQ > 0)) throw new Error('f₀ and Q must be positive.');
				exact = solveSecondOrder(info.family as 'series' | 'parallel', solveF0, solveQ, knownEff, knownValue);
			}
			const rounded = roundValues(exact, eSeries);
			const achieved = (v: Values) =>
				isSecond ? { f: secondOrder(circuit, v.R, v.L, v.C).w0 / TWO_PI, q: secondOrder(circuit, v.R, v.L, v.C).q } : { f: firstOrderW(circuit, v.R, v.L, v.C) / TWO_PI, q: NaN };
			const a = achieved(rounded);
			const target = isSecond ? solveF0 : solveFc;
			return {
				exact,
				rounded,
				f: a.f,
				q: a.q,
				fErr: (a.f / target - 1) * 100,
				qErr: isSecond ? (a.q / solveQ - 1) * 100 : NaN,
				error: null
			};
		} catch (e) {
			return { error: (e as Error).message };
		}
	});

	function apply(v: Values) {
		if (info.uses.R) R = Number(v.R.toPrecision(6));
		if (info.uses.L) L = Number(v.L.toPrecision(6));
		if (info.uses.C) C = Number(v.C.toPrecision(6));
	}

	const units: Record<Known, string> = { R: 'Ω', L: 'H', C: 'F' };
	const circuitOptions = CIRCUITS.map((c) => ({ value: c.id, label: c.name, group: c.group }));
	const seriesOptions = (['E6', 'E12', 'E24', 'E96'] as ESeries[]).map((s) => ({ value: s, label: s }));
	function texFree(v: number): string {
		return Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-2 && v !== 0) ? v.toExponential(3).replace(/\.?0+e/, 'e') : trimNumber(v, 4);
	}
	const presets = [
		{ label: 'Q = 0.5 (critical)', q: 0.5 },
		{ label: 'Q = 0.707 (Butterworth)', q: Math.SQRT1_2 },
		{ label: 'Q = 5', q: 5 }
	];
	function setQ(q: number) {
		const z0 = Math.sqrt(L / C);
		R = Number((info.family === 'parallel' ? q * z0 : z0 / q).toPrecision(4));
	}
	const pct = (v: number) => `${v >= 0 ? '+' : '−'}${trimNumber(Math.abs(v), 3)} %`;
</script>

<ToolLayout slug="rlc" share={shared} related={['bode', 'pole-zero', 'analog-designer', 'active-filters', 'lc-ladder']}>
	{#snippet controls()}
		<ControlGroup title="Circuit">
			<Select label="Topology" bind:value={circuit} options={circuitOptions} />
			<p class="small muted note">Output taken {info.output} (highlighted in the schematic).</p>
		</ControlGroup>
		<ControlGroup title="Components">
			{#if info.uses.R}
				<Slider label="Resistance R" bind:value={R} min={1} max={10e6} log si unit="Ω" />
			{/if}
			{#if info.uses.L}
				<Slider label="Inductance L" bind:value={L} min={1e-9} max={10} log si unit="H" />
			{/if}
			{#if info.uses.C}
				<Slider label="Capacitance C" bind:value={C} min={1e-12} max={1e-3} log si unit="F" />
			{/if}
			<p class="small muted note">Type values like <code>4k7</code>, <code>220n</code> or <code>10m</code> into the boxes.</p>
		</ControlGroup>
		{#if isSecond}
			<ControlGroup title="Quick damping presets">
				<div class="presets">
					{#each presets as p (p.label)}
						<button type="button" class="btn small" onclick={() => setQ(p.q)}>{p.label}</button>
					{/each}
				</div>
				<p class="small muted note">Presets change R only, keeping f₀.</p>
			</ControlGroup>
		{/if}
	{/snippet}

	{#if model.error}
		<Callout kind="danger">{model.error}</Callout>
	{/if}

	<StatGrid {stats} />

	<Card title="Circuit and transfer function" subtitle="The output is drawn in the accent colour. H(s) = Vout / Vin is a voltage divider of impedances.">
		<div class="circuit">
			<div class="schem-wrap">
				<Schematic items={schematic} width={SCHEMATIC_SIZE.width} height={SCHEMATIC_SIZE.height} title="{info.name} schematic" />
			</div>
			<div class="tf">
				<div class="tf-row"><span class="tf-lbl">Divider</span><Tex display math={`H(s) = ${tex.div}`} /></div>
				<div class="tf-row"><span class="tf-lbl">Components</span><Tex display math={`H(s) = ${tex.comp}`} /></div>
				<div class="tf-row"><span class="tf-lbl">Standard form</span><Tex display math={`H(s) = ${tex.std}`} /></div>
				<div class="tf-row"><span class="tf-lbl">With numbers</span><Tex display math={`H(s) = ${tex.numeric}`} /></div>
				<p class="small muted">s in rad/s. Poles: {model.zpk?.p.map((p) => (Math.abs(p.im) > 0 ? `${texFree(p.re)} ${p.im >= 0 ? '+' : '−'} j${texFree(Math.abs(p.im))}` : texFree(p.re))).join(', ')}</p>
			</div>
		</div>
	</Card>

	{#if filter}
		<ResponseView filters={[{ filter }]} {vlines} views={['phase', 'pz', 'impulse', 'step']} />
	{/if}

	{#if energy}
		<Card title="Where the energy goes after a 1 V step" subtitle="Energy sloshes between the inductor's magnetic field and the capacitor's electric field; the resistor burns a little on every swing.">
			<Plot series={energy.series} xLabel="Time (s)" yLabel="Energy (J)" xFormat={(v) => formatSI(v, 's', 3)} yFormat={(v) => formatSI(v, '', 3)} height={250} exportName="rlc-energy" />
			<p class="small muted">
				{#if info.family === 'series'}
					The source delivers a total charge C·1 V, i.e. C·V² = {formatSI(C, 'J', 3)} of energy. Half ends up stored in C and half is
					dissipated in R — independent of R, which only decides how long the exchange rings.
				{:else}
					In the tank, the inductor finally shorts the DC input: a steady current 1 V / R flows through R and L, so the dissipated energy
					keeps growing while the capacitor discharges.
				{/if}
			</p>
		</Card>
	{/if}

	<Card title="Component solver" subtitle="Pick a target and one component you already have; the others follow, rounded to a standard E-series.">
		<div class="solver">
			<div class="solver-in">
				{#if isSecond}
					<NumberInput label="Target f₀" bind:value={solveF0} unit="Hz" si min={1e-3} logStep={1.05} />
					<NumberInput label="Target Q" bind:value={solveQ} min={1e-3} max={1e4} logStep={1.05} />
				{:else}
					<NumberInput label="Target fc" bind:value={solveFc} unit="Hz" si min={1e-3} logStep={1.05} />
				{/if}
				<Segmented
					label="Known component"
					value={knownEff}
					options={knownOptions}
					onchange={(k) => {
						known = k;
						knownValue = { R, L, C }[k];
					}}
				/>
				<NumberInput label="Known {knownEff}" bind:value={knownValue} unit={knownUnit} si min={1e-15} logStep={1.1} />
				<Select label="Round to" bind:value={eSeries} options={seriesOptions} />
			</div>
			<div class="solver-out">
				{#if solved.error}
					<Callout kind="danger">{solved.error}</Callout>
				{:else if 'exact' in solved && solved.exact && solved.rounded}
					<div class="table-wrap">
						<table>
							<thead>
								<tr><th>Part</th><th class="num">Exact</th><th class="num">{eSeries}</th></tr>
							</thead>
							<tbody>
								{#each ['R', 'L', 'C'] as k (k)}
									{#if info.uses[k as Known]}
										<tr>
											<td>{k}{k === knownEff ? ' (given)' : ''}</td>
											<td class="num">{formatSI(solved.exact[k as Known], units[k as Known], 4)}</td>
											<td class="num">{formatSI(solved.rounded[k as Known], units[k as Known], 3)}</td>
										</tr>
									{/if}
								{/each}
							</tbody>
						</table>
					</div>
					<p class="small result">
						With {eSeries} parts: {isSecond ? 'f₀' : 'fc'} = <strong>{formatSI(solved.f ?? NaN, 'Hz', 4)}</strong> ({pct(solved.fErr ?? 0)}){#if isSecond}, Q = <strong>{trimNumber(solved.q ?? NaN, 4)}</strong> ({pct(solved.qErr ?? 0)}){/if}.
					</p>
					<div class="btns">
						<button type="button" class="btn small" onclick={() => solved.exact && apply(solved.exact)}>Use exact values</button>
						<button type="button" class="btn small primary" onclick={() => solved.rounded && apply(solved.rounded)}>Use {eSeries} values</button>
					</div>
				{/if}
			</div>
		</div>
	</Card>

	{#snippet theory()}
		<h2>Circuits as voltage dividers</h2>
		<p>
			In the Laplace domain every passive part is just an impedance, so any of these circuits is a voltage divider of
			complex impedances:
		</p>
		<Tex display math={'Z_R = R,\\qquad Z_L = sL,\\qquad Z_C = \\frac{1}{sC},\\qquad H(s)=\\frac{V_{out}}{V_{in}} = \\frac{Z_{shunt}}{Z_{series}+Z_{shunt}}'} />
		<p>
			On the jω axis an inductor's impedance rises with frequency (it blocks highs) and a capacitor's falls (it passes highs). Whichever
			element sits across the output decides the response type: a capacitor to ground makes a low-pass, an inductor to ground a high-pass.
		</p>

		<h3>First order: one pole, one time constant</h3>
		<p>The RC and RL circuits each store energy in a single element, giving one real pole at <Tex math={'s=-1/\\tau'} />:</p>
		<Tex display math={'\\tau_{RC} = RC,\\qquad \\tau_{RL} = \\frac{L}{R},\\qquad f_c = \\frac{1}{2\\pi\\tau}'} />
		<p>
			A step input makes the low-pass output rise as <Tex math={'v(t) = 1 - e^{-t/\\tau}'} />. After one time constant it has
			covered <Tex math={'1 - e^{-1} \\approx 63.2\\,\\%'} /> of the way (the <em>63 % rule</em>); after 5τ it is within 1 %. At
			fc the magnitude is −3 dB (1/√2) and the phase is ∓45°; far above (or below) fc the response falls at 20 dB/decade.
		</p>

		<h3>Second order: resonance</h3>
		<p>
			With both an L and a C, energy can move back and forth between the capacitor's electric field (½Cv²) and the inductor's magnetic
			field (½Li²). The exchange happens at the resonant frequency where the two reactances cancel:
		</p>
		<Tex display math={'\\omega_0 L = \\frac{1}{\\omega_0 C}\\;\\Rightarrow\\; \\omega_0 = \\frac{1}{\\sqrt{LC}},\\qquad Z_0 = \\sqrt{\\frac{L}{C}}'} />
		<p>
			All series-RLC outputs share the denominator <Tex math={'s^2 + \\frac{R}{L}s + \\frac{1}{LC} = s^2 + \\frac{\\omega_0}{Q}s + \\omega_0^2'} />, so they
			have the same poles — only the zeros (the numerator) differ. The quality factor compares reactive and resistive impedance:
		</p>
		<Tex display math={'Q_{series} = \\frac{1}{R}\\sqrt{\\frac{L}{C}} = \\frac{Z_0}{R},\\qquad Q_{parallel} = R\\sqrt{\\frac{C}{L}} = \\frac{R}{Z_0},\\qquad \\zeta = \\frac{1}{2Q},\\qquad B = \\frac{f_0}{Q}'} />
		<p>
			Equivalently, <Tex math={'Q = 2\\pi \\cdot \\frac{\\text{energy stored}}{\\text{energy lost per cycle}}'} />: a high-Q circuit rings
			for about Q/π cycles before its envelope <Tex math={'e^{-\\zeta\\omega_0 t}'} /> has decayed to 1/e, and its resonance is sharp.
			Note how a series circuit's Q <em>falls</em> with R (R is in the current path) while a parallel tank's Q <em>rises</em> with R (R shunts less
			current away from the tank).
		</p>
		<div class="table-wrap wide">
		<table>
			<thead><tr><th>Damping</th><th>Condition</th><th>Poles</th><th>Step response</th></tr></thead>
			<tbody>
				<tr><td>Underdamped</td><td>ζ &lt; 1 (Q &gt; ½)</td><td>complex pair <Tex math={'-\\zeta\\omega_0 \\pm j\\omega_0\\sqrt{1-\\zeta^2}'} /></td><td>rings at <Tex math={'\\omega_d=\\omega_0\\sqrt{1-\\zeta^2}'} />, overshoot <Tex math={'e^{-\\pi\\zeta/\\sqrt{1-\\zeta^2}}'} /></td></tr>
				<tr><td>Critically damped</td><td>ζ = 1 (Q = ½)</td><td>double real pole at −ω₀</td><td>fastest response without overshoot</td></tr>
				<tr><td>Overdamped</td><td>ζ &gt; 1 (Q &lt; ½)</td><td>two real poles <Tex math={'-\\omega_0(\\zeta \\mp \\sqrt{\\zeta^2-1})'} /></td><td>sluggish, dominated by the slower pole</td></tr>
			</tbody>
		</table>
		</div>
		<p>
			Peaking in the low-pass magnitude only appears for <Tex math={'Q > 1/\\sqrt{2}'} /> (ζ &lt; 0.707); Q = 1/√2 is the
			maximally flat (Butterworth) case. The band-pass output (across R, or the parallel tank) peaks at exactly 0 dB at f₀ with
			−3 dB points at <Tex math={'f_\\pm = f_0\\left(\\sqrt{1+\\tfrac{1}{4Q^2}} \\pm \\tfrac{1}{2Q}\\right)'} />, which are
			geometrically symmetric about f₀ and exactly f₀/Q apart.
		</p>

		<h3>Why the notch has zeros on the jω axis</h3>
		<p>Taking the output across the L–C pair gives a numerator equal to the impedance of a series LC:</p>
		<Tex display math={'Z_L + Z_C = sL + \\frac{1}{sC} = \\frac{s^2 LC + 1}{sC} = 0 \\quad\\text{at}\\quad s = \\pm j\\omega_0'} />
		<p>
			At f₀ the series LC is a short circuit, so the output is exactly zero: a pair of zeros sits on the imaginary axis right "above"
			the poles, and the magnitude dives to −∞ dB. Real inductors have series resistance r, which moves the zeros slightly into the
			left half-plane and limits the notch depth to about <Tex math={'20\\log_{10}\\frac{r}{R+r}'} />.
		</p>

		<Callout kind="try">
			<ul>
				<li>On the series RLC low-pass, press the <em>Q = 5</em> preset, then <em>Q = 0.5</em>: watch the poles move from a complex pair onto the real axis, and the ringing vanish.</li>
				<li>Switch between the four series-RLC outputs without touching R, L or C: the poles (and the energy plot) never change — only the zeros do.</li>
				<li>On the RC low-pass, read τ from the stats and check that the step response crosses 63 % at t = τ.</li>
				<li>Double C and halve L: f₀ stays put, but √(L/C) halves — so Q of a series circuit halves while Q of the tank doubles.</li>
				<li>Use the solver to build a 1 kHz, Q = 0.707 low-pass from a 100 nF capacitor, then try E6 rounding and see how far Q drifts.</li>
			</ul>
		</Callout>
	{/snippet}
</ToolLayout>

<style>
	.note {
		margin: 0;
	}
	.presets {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.circuit {
		display: grid;
		grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
		gap: 1rem 1.4rem;
		align-items: center;
	}
	.schem-wrap {
		min-width: 0;
	}
	.tf {
		min-width: 0;
	}
	.tf-row {
		border-bottom: 1px solid var(--border);
		padding-top: 0.35rem;
	}
	.tf-row :global(.tex-display) {
		margin: 0.1em 0 0.3em;
	}
	.tf-lbl {
		display: block;
		font-size: 0.75rem;
		color: var(--muted);
	}
	.tf p {
		margin: 0.5rem 0 0;
	}
	.solver {
		display: grid;
		grid-template-columns: minmax(0, 15rem) minmax(0, 1fr);
		gap: 1rem 1.5rem;
		align-items: start;
	}
	.solver-in {
		display: grid;
		gap: 0.6rem;
	}
	.solver-out {
		min-width: 0;
	}
	.table-wrap {
		overflow-x: auto;
	}
	.result {
		margin: 0.6rem 0;
	}
	.btns {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	@media (max-width: 900px) {
		.circuit,
		.solver {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
