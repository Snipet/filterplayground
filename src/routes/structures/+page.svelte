<script lang="ts">
	import ToolLayout from '$lib/components/layout/ToolLayout.svelte';
	import ControlGroup from '$lib/components/layout/ControlGroup.svelte';
	import Card from '$lib/components/layout/Card.svelte';
	import Select from '$lib/components/controls/Select.svelte';
	import Segmented from '$lib/components/controls/Segmented.svelte';
	import Slider from '$lib/components/controls/Slider.svelte';
	import Plot, { type Series } from '$lib/components/plot/Plot.svelte';
	import StatGrid, { type Stat } from '$lib/components/content/StatGrid.svelte';
	import Callout from '$lib/components/content/Callout.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import CodeBlock from '$lib/components/content/CodeBlock.svelte';
	import { BIQUAD_TYPES, type BiquadType } from '$lib/dsp/biquad';
	import { sosfilt } from '$lib/dsp/time';
	import { trimNumber } from '$lib/dsp/units';
	import { seriesColor } from '$lib/components/plot/scales';
	import BlockDiagram from '$lib/features/structures/BlockDiagram.svelte';
	import { PRESETS, presetFilter, type PresetId } from '$lib/features/structures/presets';
	import { buildStructures, type StructureInfo } from '$lib/features/structures/structures';
	import {
		runProcessor,
		trace,
		STRUCTURE_IDS,
		type StructureId
	} from '$lib/features/structures/realize';
	import { toolHref } from '$lib/paths';

	let preset = $state<PresetId>('butter4');
	let bqType = $state<BiquadType>('lowpass');
	let bqF0 = $state(1000);
	let bqQ = $state(0.707);
	let bqGain = $state(6);
	let chosen = $state<StructureId>('tdf2');
	let stepInput = $state<'impulse' | 'step'>('impulse');
	let n = $state(2);
	const NSTEPS = 9;
	const NCMP = 160;

	const presetInfo = $derived(PRESETS.find((p) => p.id === preset)!);
	const bqInfo = $derived(BIQUAD_TYPES.find((t) => t.id === bqType)!);

	const built = $derived.by(() => {
		try {
			const f = presetFilter(preset, { type: bqType, f0: bqF0, q: bqQ, gainDb: bqGain });
			return { f, list: buildStructures(f.b, f.a, f.sos), error: null as string | null };
		} catch (e) {
			return {
				f: null,
				list: [] as StructureInfo[],
				error: e instanceof Error ? e.message : String(e)
			};
		}
	});

	const list = $derived(built.list);
	// When the chosen structure does not apply (FIR ↔ IIR), show its natural counterpart;
	// `chosen` keeps the user's pick so it comes back with a filter it applies to.
	const COUNTERPART: Partial<Record<StructureId, StructureId>> = {
		df1: 'fir',
		df2: 'fir',
		tdf2: 'firt',
		fir: 'df1',
		firt: 'tdf2'
	};
	const applicable = (id: StructureId | undefined) => list.find((s) => s.id === id && s.applicable);
	const current = $derived(
		applicable(chosen) ?? applicable(COUNTERPART[chosen]) ?? list.find((s) => s.applicable)
	);
	const chosenInfo = $derived(list.find((s) => s.id === chosen));
	const diagram = $derived(current?.diagram ? current.diagram() : null);

	// ---------- equivalence ----------
	const impulse = (len: number) => Array.from({ length: len }, (_, i) => (i === 0 ? 1 : 0));
	const reference = $derived(built.f ? Array.from(sosfilt(built.f.sos, impulse(NCMP))) : []);
	const deviations = $derived(
		list.map((s) => {
			if (!s.applicable || !s.make) return null;
			const y = runProcessor(s.make(), impulse(NCMP));
			const d = y.map((v, i) => Math.abs(v - reference[i]));
			return { d, max: Math.max(...d) };
		})
	);
	const errSeries = $derived<Series[]>(
		list
			.map((s, i) => ({ s, i, dev: deviations[i] }))
			.filter((o) => o.dev)
			.map(({ s, dev }) => ({
				x: dev!.d.map((_, k) => k),
				y: dev!.d.map((v) => Math.max(v, 1e-18)),
				label: s.name,
				color: seriesColor(STRUCTURE_IDS.indexOf(s.id)),
				format: (v: number) => (v <= 1e-18 ? '0 (exact)' : v.toExponential(2))
			}))
	);
	const errMax = $derived(Math.max(1e-18, ...deviations.filter((d) => d).map((d) => d!.max)));
	const refSeries = $derived<Series[]>([
		{
			x: reference.map((_, i) => i).slice(0, 64),
			y: reference.slice(0, 64),
			kind: 'stem',
			label: 'h[n] (sosfilt)'
		}
	]);

	// ---------- step-through ----------
	const stepX = $derived(
		Array.from({ length: NSTEPS }, (_, i) => (stepInput === 'impulse' ? (i === 0 ? 1 : 0) : 1))
	);
	const rows = $derived(current?.make ? trace(current.make(), stepX) : []);
	const nClamped = $derived(Math.min(Math.max(0, n), NSTEPS - 1));
	const liveValues = $derived(rows[nClamped]?.state ?? null);

	const stats = $derived.by((): Stat[] => {
		if (!current || !current.ops) return [];
		const dev = deviations[list.indexOf(current)];
		const out: Stat[] = [
			{
				label: 'Multiplies / sample',
				value: String(current.ops.mul),
				hint: 'For the general structure; multiplications by exactly 0 or 1 could be skipped.'
			},
			{ label: 'Additions / sample', value: String(current.ops.add) },
			{
				label: 'Delays (memory)',
				value: String(current.ops.delay),
				hint: 'Number of z⁻¹ elements = state variables'
			},
			{
				label: 'Max |h − h_ref|',
				value: dev ? (dev.max === 0 ? '0 (bit-exact)' : dev.max.toExponential(1)) : '—',
				status: dev && dev.max < 1e-10 ? 'good' : 'warning',
				hint: `Largest difference between this structure's impulse response and scipy-style sosfilt over ${NCMP} samples (double precision)`
			}
		];
		if (current.latticeStable !== undefined)
			out.push({
				label:
					current.id === 'lattice' && built.f?.a.length === 1
						? 'All |k| < 1 (min. phase)'
						: 'All |k| < 1 (stable)',
				value: current.latticeStable ? 'Yes' : 'No',
				status: current.latticeStable ? 'good' : 'warning'
			});
		return out;
	});

	const typeOptions = BIQUAD_TYPES.map((t) => ({
		value: t.id,
		label: t.name,
		group: t.firstOrder ? 'First order' : 'Second order'
	}));

	const fmt = (v: number) => (Math.abs(v) < 1e-15 ? '0' : trimNumber(v, 5));
</script>

<ToolLayout
	slug="structures"
	related={['biquad', 'quantization', 'tf-analyzer', 'iir-designer', 'convolution']}
>
	{#snippet controls()}
		<ControlGroup title="Filter">
			<Select
				label="Example filter"
				bind:value={preset}
				options={PRESETS.map((p) => ({ value: p.id, label: p.label }))}
			/>
			<p class="small muted desc">{presetInfo.description}</p>
			{#if preset === 'biquad'}
				<Select label="Biquad type" bind:value={bqType} options={typeOptions} />
				<Slider label="Frequency f₀" bind:value={bqF0} min={20} max={20000} log unit="Hz" />
				{#if bqInfo.usesQ}<Slider label="Q" bind:value={bqQ} min={0.1} max={20} log />{/if}
				{#if bqInfo.usesGain}<Slider
						label="Gain"
						bind:value={bqGain}
						min={-24}
						max={24}
						step={0.5}
						unit="dB"
					/>{/if}
				<p class="small muted desc">fs = 48 kHz</p>
			{/if}
		</ControlGroup>
		<ControlGroup title="Structure">
			<fieldset class="structs">
				<legend class="visually-hidden">Structure</legend>
				{#each list as s (s.id)}
					<label class:disabled={!s.applicable} title={s.reason}>
						<!-- checked follows what is shown; onclick also catches a click on a substitute that is already checked -->
						<input
							type="radio"
							name="structure"
							value={s.id}
							checked={current?.id === s.id}
							onchange={() => (chosen = s.id)}
							onclick={() => (chosen = s.id)}
							disabled={!s.applicable}
						/>
						<span
							class="swatch"
							style:background={seriesColor(STRUCTURE_IDS.indexOf(s.id))}
							aria-hidden="true"
						></span>
						<span
							>{s.name}{#if !s.applicable}<span class="muted">&nbsp;— n/a</span>{/if}</span
						>
					</label>
				{/each}
			</fieldset>
			{#if current && chosenInfo && current.id !== chosen}
				<p class="small muted desc" role="status">
					{chosenInfo.name} does not apply here. {chosenInfo.reason ?? ''} Showing {current.name}
					instead.
				</p>
			{/if}
		</ControlGroup>
		<ControlGroup title="Step-through input">
			<Segmented
				bind:value={stepInput}
				options={[
					{ value: 'impulse', label: 'Impulse δ[n]' },
					{ value: 'step', label: 'Step u[n]' }
				]}
			/>
		</ControlGroup>
	{/snippet}

	{#if built.error}
		<Callout kind="danger">{built.error}</Callout>
	{/if}

	{#if current && diagram}
		<StatGrid {stats} />

		<Card
			title={current.name}
			subtitle="Multipliers show the actual coefficients (4 significant digits). The numbers beside each z⁻¹ box are its contents at the selected step n."
		>
			{#snippet actions()}
				<div class="stepper" role="group" aria-label="Step through time">
					<button
						class="btn small"
						type="button"
						onclick={() => (n = Math.max(0, nClamped - 1))}
						disabled={nClamped === 0}
						aria-label="Previous sample">◀ Prev</button
					>
					<span class="nlabel tabular">n = {nClamped}</span>
					<button
						class="btn small"
						type="button"
						onclick={() => (n = Math.min(NSTEPS - 1, nClamped + 1))}
						disabled={nClamped === NSTEPS - 1}
						aria-label="Next sample">Next ▶</button
					>
					<button class="btn small ghost" type="button" onclick={() => (n = 0)}>Reset</button>
				</div>
			{/snippet}
			<BlockDiagram {diagram} values={liveValues} label="{current.name} block diagram" />
			{#if rows[nClamped]}
				<p class="small now">
					At n = {nClamped}: x[n] = {fmt(rows[nClamped].x)}, the delays hold the values shown, and
					the structure produces
					<strong>y[n] = {fmt(rows[nClamped].y)}</strong>.
				</p>
			{/if}
			<ul class="notes small">
				{#each current.notes as note (note)}<li>{note}</li>{/each}
			</ul>
		</Card>

		<Card
			title="Step-through table"
			subtitle="State = contents of the delay elements at time n, i.e. before y[n] is computed. Click a row to show it on the diagram."
		>
			<div class="table-wrap">
				<table class="trace">
					<thead>
						<tr>
							<th class="num">n</th>
							<th class="num">x[n]</th>
							{#each current.stateLabels as l (l)}<th class="num state">{l}</th>{/each}
							<th class="num">y[n]</th>
						</tr>
					</thead>
					<tbody>
						{#each rows as r, i (i)}
							<tr class:active={i === nClamped} onclick={() => (n = i)}>
								<td class="num">{i}</td>
								<td class="num">{fmt(r.x)}</td>
								{#each r.state as v, j (j)}<td class="num mono">{fmt(v)}</td>{/each}
								<td class="num mono strong">{fmt(r.y)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</Card>

		<Card
			title="C implementation"
			subtitle="Single-precision, one sample in, one sample out. State variables are static; reset them to zero to restart."
		>
			{#if current.code}<CodeBlock
					code={current.code}
					language="c"
					filename="{current.id}.c"
				/>{/if}
		</Card>
	{/if}

	<Card
		title="All structures, same filter"
		subtitle="Every structure computes the same transfer function; they differ in cost, memory and numerical behaviour."
	>
		<div class="table-wrap">
			<table class="cmp">
				<thead>
					<tr>
						<th>Structure</th>
						<th class="num">Mult.</th>
						<th class="num">Add.</th>
						<th class="num">Delays</th>
						<th class="num">Max |h − h_ref|</th>
					</tr>
				</thead>
				<tbody>
					{#each list as s, i (s.id)}
						<tr class:sel={current?.id === s.id}>
							<td>
								<span
									class="swatch"
									style:background={seriesColor(STRUCTURE_IDS.indexOf(s.id))}
									aria-hidden="true"
								></span>
								{s.name}
								{#if !s.applicable}<div class="small muted">{s.reason}</div>{/if}
							</td>
							<td class="num">{s.ops?.mul ?? '—'}</td>
							<td class="num">{s.ops?.add ?? '—'}</td>
							<td class="num">{s.ops?.delay ?? '—'}</td>
							<td class="num"
								>{deviations[i]
									? deviations[i]!.max === 0
										? '0'
										: deviations[i]!.max.toExponential(1)
									: '—'}</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<div class="plots">
			<div>
				<Plot
					series={refSeries}
					xLabel="Sample n"
					yLabel="h[n]"
					title="Reference impulse response"
					height={240}
					legend={false}
					exportName="impulse-response"
				/>
			</div>
			<div>
				<Plot
					series={errSeries}
					yScale="log"
					yDomain={[1e-18, Math.max(1e-13, errMax * 5)]}
					xLabel="Sample n"
					yLabel="|h − h_ref|"
					title="Deviation from sosfilt"
					yFormat={(v) => v.toExponential(0)}
					height={240}
					exportName="deviation"
				/>
				<p class="small muted">
					Exact zeros are drawn at 10⁻¹⁸. Everything below ~10⁻¹⁵ is double-precision rounding: the
					structures are equivalent.
				</p>
			</div>
		</div>
	</Card>

	{#snippet theory()}
		<h2>Why one filter has many structures</h2>
		<p>
			A transfer function <Tex math={'H(z)=B(z)/A(z)'} /> says <em>what</em> a filter does; a
			<strong>structure</strong>
			(or realisation) says <em>how</em> it is computed: which intermediate signals exist, how many delays
			store them, and in which order multiplications and additions happen. With exact arithmetic all structures
			give identical outputs — the table above confirms it to within double-precision rounding. In real
			hardware they differ in:
		</p>
		<ul>
			<li><strong>Cost and memory</strong> — multiplies, adds and delays per sample;</li>
			<li>
				<strong>Coefficient sensitivity</strong> — how far poles and zeros move when the
				coefficients are rounded (see
				<a href={toolHref('quantization')}>Coefficient Quantization</a>);
			</li>
			<li>
				<strong>Internal signal levels</strong> — overflow and round-off noise in fixed point;
			</li>
			<li>
				<strong>Parallelism and latency</strong> — the longest chain of operations between a delay and
				the next one.
			</li>
		</ul>
		<h3>Direct forms</h3>
		<p>
			Direct form I implements the difference equation literally, with separate delay lines for x
			and y:
		</p>
		<Tex display math={'y[n]=\\sum_{k=0}^{M} b_k\\,x[n-k]-\\sum_{k=1}^{N} a_k\\,y[n-k]'} />
		<p>
			Since the two halves are linear and time-invariant, they can be swapped: run the poles first, <Tex
				math={'w[n]=x[n]-\\sum a_k w[n-k]'}
			/>, then the zeros, <Tex math={'y[n]=\\sum b_k w[n-k]'} />. Now both halves read the same
			delayed signal, so one delay line suffices: <strong>direct form II</strong> is
			<em>canonical</em>
			(max(M, N) delays, the minimum). The price: w[n] is x filtered by <Tex math={'1/A(z)'} />,
			which for a sharp filter can be far larger than x or y — a headache in fixed point. DF I needs
			twice the memory but, with a single wide accumulator, tolerates intermediate overflow; it is
			the usual choice on fixed-point DSPs.
		</p>
		<h3>Transposition</h3>
		<p>
			The <strong>transposition theorem</strong>: reversing every branch of a single-input
			single-output signal-flow graph, exchanging input and output, and turning branch points into
			adders (and vice versa) leaves the transfer function unchanged. Applied to DF II it gives the
			<strong>transposed direct form II</strong>, where each state holds a partial sum:
		</p>
		<Tex display math={'y[n]=b_0x[n]+s_1[n-1],\\qquad s_k[n]=b_kx[n]-a_ky[n]+s_{k+1}[n-1]'} />
		<p>
			It has the same cost as DF II but no large internal node — the standard choice in floating
			point (SciPy’s <code>sosfilt</code> and most audio code). The FIR transposed form follows the same
			way from the tapped delay line.
		</p>
		<h3>Cascade and parallel</h3>
		<p>
			Factoring <Tex math={'H(z)=\\prod_i H_i(z)'} /> into second-order sections gives the
			<strong>cascade</strong>; expanding into partial fractions <Tex
				math={'H(z)=c_0+\\sum_i H_i(z)'}
			/> gives the <strong>parallel</strong> form. In both, each section realises only one pole pair,
			so a rounded coefficient can only disturb that pair. A high-order direct form, by contrast, lets
			every coefficient move every pole — the reason no one implements an 8th-order IIR as a single difference
			equation. The cascade keeps the zeros exact (e.g. at z = −1) and allows choosing the pairing and
			order of sections for noise and overflow; the parallel form lets the sections run concurrently,
			but its zeros come from the sum of the sections and are therefore more sensitive.
		</p>
		<h3>Lattice structures</h3>
		<p>
			The step-down (backward Levinson) recursion turns <Tex math={'A_N(z)'} /> into
			<strong>reflection coefficients</strong>
			<Tex math={'k_m'} />, one per stage:
		</p>
		<Tex
			display
			math={'k_m = a^{(m)}_m,\\qquad a^{(m-1)}_i=\\frac{a^{(m)}_i-k_m\\,a^{(m)}_{m-i}}{1-k_m^2}'}
		/>
		<p>
			A lattice built from these coefficients is modular (every stage is identical), and its
			stability check is trivial: <Tex math={'A_N(z)'} /> has all roots inside the unit circle
			<em>if and only if</em>
			<Tex math={'|k_m|<1'} /> for every m. Rounding a <Tex math="k_m" /> to anything with <Tex
				math={'|k_m|<1'}
			/> keeps the filter stable. The all-pole lattice realises <Tex math={'1/A(z)'} />; adding a
			<strong>ladder</strong>
			of taps <Tex math={'\\nu_m'} /> on the backward signals <Tex math={'g_m'} /> realises any numerator
			(Gray–Markel lattice–ladder). The FIR lattice realises <Tex math={'h_0 A(z)'} /> directly and is
			used in speech coding (LPC) and adaptive filters. It breaks down when some <Tex
				math={'|k_m|=1'}
			/>, which is exactly what happens for a linear-phase FIR: symmetric taps give <Tex
				math={'k_M=h_M/h_0=\\pm1'}
			/>.
		</p>
		<Callout kind="try">
			<ul>
				<li>
					Step through the <em>Butterworth</em> in DF I and DF II with an impulse: the DF I delays simply
					hold copies of past x and y, while the DF II delays hold w[n], which grows larger than either.
				</li>
				<li>
					Compare the operation counts of DF II and the cascade for the 4th-order Butterworth: the
					cascade costs a few more multiplies — the price of robustness.
				</li>
				<li>
					Choose the <em>7-tap linear-phase FIR</em>: the lattice is unavailable because k₆ = ±1.
					Switch to the <em>minimum-phase FIR</em>: every |k| is below 1.
				</li>
				<li>
					Use the adjustable biquad as a peaking EQ and raise the gain to +24 dB: watch the ladder
					coefficients in the lattice–ladder diagram change while the reflection coefficients (the
					poles) barely move.
				</li>
				<li>
					Look at the parallel form of the elliptic filter: a constant direct term c₀ appears
					because the numerator and denominator have the same degree.
				</li>
			</ul>
		</Callout>
	{/snippet}
</ToolLayout>

<style>
	.desc {
		margin: -0.1rem 0 0;
	}
	.structs {
		border: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.structs label {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		font-size: 0.88rem;
		padding: 0.18rem 0.3rem;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}
	.structs label:hover {
		background: var(--surface-2);
	}
	.structs label.disabled {
		cursor: default;
		color: var(--muted);
	}
	.swatch {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 2px;
		flex: none;
		margin-right: 0.15rem;
	}
	.stepper {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		flex-wrap: wrap;
	}
	.nlabel {
		font-weight: 600;
		min-width: 3.6em;
		text-align: center;
		font-size: 0.9rem;
	}
	.now {
		margin: 0.4rem 0 0.2rem;
	}
	.notes {
		margin: 0.4rem 0 0;
		color: var(--text-2);
	}
	.table-wrap {
		overflow-x: auto;
	}
	.trace td,
	.trace th {
		font-size: 0.82rem;
		white-space: nowrap;
	}
	.trace tbody tr {
		cursor: pointer;
	}
	.trace tr.active td {
		background: var(--accent-wash);
	}
	.trace th.state {
		font-family: var(--font-mono);
		font-weight: 500;
	}
	.strong {
		font-weight: 650;
	}
	tr.sel td {
		background: var(--accent-wash);
	}
	.cmp td:first-child {
		min-width: 14rem;
	}
	.plots {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 1rem;
		margin-top: 1rem;
	}
</style>
