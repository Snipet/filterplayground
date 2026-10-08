<script lang="ts">
	import { onMount } from 'svelte';
	import ToolLayout from '$lib/components/layout/ToolLayout.svelte';
	import ControlGroup from '$lib/components/layout/ControlGroup.svelte';
	import Card from '$lib/components/layout/Card.svelte';
	import Select from '$lib/components/controls/Select.svelte';
	import Segmented from '$lib/components/controls/Segmented.svelte';
	import Slider from '$lib/components/controls/Slider.svelte';
	import ResponseView, { type FilterEntry } from '$lib/components/plot/ResponseView.svelte';
	import StatGrid from '$lib/components/content/StatGrid.svelte';
	import Callout from '$lib/components/content/Callout.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import CodeBlock from '$lib/components/content/CodeBlock.svelte';
	import TimeCard from '$lib/features/iir-designer/TimeCard.svelte';
	import BlockDiagram from '$lib/features/simple-filters/BlockDiagram.svelte';
	import PhaseDelayPz from '$lib/features/simple-filters/PhaseDelayPz.svelte';
	import {
		SIMPLE_FILTERS,
		defaults,
		resolve,
		type Built,
		type ParamValues,
		type SimpleFilter
	} from '$lib/features/simple-filters/catalog';
	import { formatSI } from '$lib/dsp/units';
	import { readSharedState } from '$lib/share';

	let selectedId = $state('ema');
	let fs = $state(48000);
	let values = $state<Record<string, ParamValues>>(
		Object.fromEntries(SIMPLE_FILTERS.map((f) => [f.id, defaults(f)]))
	);
	let scale = $state<'log' | 'linear'>('log');

	const def = $derived<SimpleFilter>(
		SIMPLE_FILTERS.find((f) => f.id === selectedId) ?? SIMPLE_FILTERS[0]
	);
	const vals = $derived(values[def.id]);

	const shared = $derived({ id: selectedId, fs, values: vals });
	onMount(() => {
		const st = readSharedState<typeof shared>();
		if (!st) return;
		const f = SIMPLE_FILTERS.find((x) => x.id === st.id);
		if (typeof st.fs === 'number' && st.fs >= 100 && st.fs <= 1e6) fs = st.fs;
		if (!f) return;
		select(f.id);
		if (st.values && typeof st.values === 'object') {
			const src = st.values as ParamValues;
			for (const p of f.params) {
				const v = src[p.key];
				if (p.kind === 'slider' && typeof v === 'number' && Number.isFinite(v))
					values[f.id][p.key] = v;
				if (p.kind === 'choice' && typeof v === 'string' && p.options.some((o) => o.value === v))
					values[f.id][p.key] = v;
			}
		}
	});

	function select(id: string) {
		const f = SIMPLE_FILTERS.find((x) => x.id === id);
		if (!f) return;
		selectedId = id;
		scale = f.scale;
	}

	const built = $derived.by(
		(): { b: Built; error?: undefined } | { b?: undefined; error: string } => {
			try {
				const b = def.build(vals, fs);
				return { b };
			} catch (e) {
				return { error: e instanceof Error ? e.message : String(e) };
			}
		}
	);

	const entries = $derived.by((): FilterEntry[] => {
		if (!built.b) return [];
		const out: FilterEntry[] = [{ filter: built.b.filter, label: def.name, color: 'var(--s1)' }];
		if (built.b.reference)
			out.push({
				filter: { kind: 'analog', zpk: built.b.reference.zpk },
				label: built.b.reference.label,
				color: 'var(--s2)',
				dash: '6 4'
			});
		return out;
	});

	const fsOptions = [1000, 8000, 16000, 44100, 48000, 96000].map((v) => ({
		value: v,
		label: formatSI(v, 'Hz', 4)
	}));
</script>

<ToolLayout
	slug="simple-filters"
	share={shared}
	related={['biquad', 'pole-zero', 'iir-designer', 'structures', 'signal-lab']}
>
	{#snippet controls()}
		<ControlGroup title="Filter">
			<div class="catalog" role="radiogroup" aria-label="Filter">
				{#each SIMPLE_FILTERS as f, i (f.id)}
					<button
						type="button"
						role="radio"
						aria-checked={f.id === selectedId}
						class:active={f.id === selectedId}
						onclick={() => select(f.id)}
					>
						<span class="idx">{i + 1}</span>{f.name}
					</button>
				{/each}
			</div>
		</ControlGroup>
		<ControlGroup title="Parameters">
			<Select label="Sample rate" bind:value={fs} options={fsOptions} />
			{#each def.params as p (def.id + p.key)}
				{#if !p.show || p.show(vals)}
					{#if p.kind === 'slider'}
						<Slider
							label={p.label}
							value={Number(vals[p.key])}
							min={resolve(p.min, fs)}
							max={resolve(p.max, fs)}
							log={p.log}
							integer={p.integer}
							step={p.step}
							unit={p.unit}
							si={p.si}
							help={p.help}
							onchange={(v) => (values[def.id][p.key] = v)}
						/>
					{:else if p.options.length <= 3}
						<Segmented
							label={p.label}
							size="small"
							value={String(vals[p.key])}
							options={p.options}
							onchange={(v) => (values[def.id][p.key] = v)}
						/>
					{:else}
						<Select
							label={p.label}
							value={String(vals[p.key])}
							options={p.options}
							onchange={(v) => (values[def.id][p.key] = v)}
						/>
					{/if}
				{/if}
			{/each}
		</ControlGroup>
	{/snippet}

	{#if built.error}
		<Callout kind="danger">{built.error}</Callout>
	{:else if built.b}
		{@const b = built.b}
		<Card title={def.name} subtitle={def.summary}>
			<div class="eqs">
				{#each b.equation as e, i (i)}
					<Tex display math={e} />
				{/each}
			</div>
			<div class="split">
				<div class="diagram">
					<BlockDiagram diagram={b.diagram} label="{def.name} block diagram" />
					<p class="small muted cap">
						Direct form: z⁻ᵏ blocks delay by k samples, triangles multiply, circles add.
					</p>
				</div>
				<div class="side">
					<h4>Typical uses</h4>
					<ul>
						{#each def.uses as u (u)}<li>{u}</li>{/each}
					</ul>
					<CodeBlock code={b.code} language="c — per sample" maxHeight="8rem" />
				</div>
			</div>
		</Card>

		{#if b.warning}
			<Callout kind="warning">{b.warning}</Callout>
		{/if}

		<StatGrid stats={b.stats} />

		<ResponseView
			filters={entries}
			views={[]}
			bind:xScale={scale}
			fmin={scale === 'log' ? fs * 1e-5 : undefined}
			vlines={b.vlines ?? []}
		/>
		<PhaseDelayPz {entries} {fs} {scale} fmin={fs * 1e-5} />

		<TimeCard
			entries={[{ filter: b.filter, label: def.name, color: 'var(--s1)' }]}
			n={b.n}
			subtitle="What the difference equation does to a single 1 (impulse) and to a constant 1 (step)."
		/>
	{/if}

	{#snippet theory()}
		<h2>Small filters, big jobs</h2>
		<p>
			Most real-world filtering is done by filters with one or two poles. They are cheap, easy to
			reason about, and each one is a lesson in how pole and zero positions shape a response. On the
			unit circle <Tex math={'z=e^{j\\omega}'} /> the gain is a ratio of distances:
		</p>
		<Tex
			display
			math={'|H(e^{j\\omega})| = |b_0|\\,\\frac{\\prod_i |e^{j\\omega}-z_i|}{\\prod_k |e^{j\\omega}-p_k|}'}
		/>
		<p>
			A pole close to the circle makes a peak where the circle passes near it; a zero on the circle
			makes a perfect null. Put a zero and a pole close together (DC blocker, notch) and they cancel
			everywhere except right next to them.
		</p>
		<h3>The one-pole family</h3>
		<p>
			The EMA <Tex math={'y[n]=\\alpha x[n]+(1-\\alpha)y[n-1]'} /> has a single pole at p = 1 − α. Sampling
			an RC low-pass with time constant τ gives exactly this pole, <Tex math={'p=e^{-T/\\tau}'} />,
			so α = 1 − e<sup>−T/τ</sup>. Setting |H|² = ½ gives the exact −3 dB relation
		</p>
		<Tex
			display
			math={'\\cos\\omega_c = 1-\\frac{\\alpha^2}{2(1-\\alpha)}\\quad\\Longleftrightarrow\\quad \\alpha = -y+\\sqrt{y^2+2y},\\ \\ y=1-\\cos\\omega_c'}
		/>
		<p>
			For f<sub>c</sub> ≪ f<sub>s</sub> both reduce to the familiar <Tex
				math={'\\alpha\\approx 1-e^{-2\\pi f_c/f_s}\\approx 2\\pi f_c/f_s'}
			/>; near Nyquist they differ, and above α = 2√2 − 2 ≈ 0.83 the filter never reaches −3 dB at
			all. The high-pass, DC blocker and leaky integrator are the same structure with a zero added
			at z = 1 or the input scaling changed.
		</p>
		<h3>Delays: moving averages and combs</h3>
		<p>
			A delay of D samples, z<sup>−D</sup>, has a phase that winds D times around the circle, so
			anything built from it repeats every f<sub>s</sub>/D:
		</p>
		<Tex
			display
			math={'H_{\\text{FF}}(z)=1+g z^{-D}\\ \\ (\\text{zeros at } z^D=-g),\\qquad H_{\\text{FB}}(z)=\\frac{1}{1-g z^{-D}}\\ \\ (\\text{poles at } z^D = g,\\ |p| = |g|^{1/D})'}
		/>
		<p>
			The moving average is a feed-forward comb divided by an integrator: <Tex
				math={'\\tfrac1N\\sum_{k<N} z^{-k}=\\tfrac1N\\frac{1-z^{-N}}{1-z^{-1}}'}
			/>. The comb places N zeros evenly on the circle; the integrator's pole at z = 1 cancels the
			one at DC, leaving nulls at every k·f<sub>s</sub>/N. In floating point the cancellation is not
			exact, so recursive averages are run in integer arithmetic (as in CIC decimators) or
			periodically re-summed.
		</p>
		<h3>Resonators and notches</h3>
		<p>
			A conjugate pole pair <Tex math={'p=re^{\\pm j\\theta}'} /> rings at θ = 2πf<sub>0</sub>/f<sub
				>s</sub
			>
			with a −3 dB bandwidth of about <Tex math={'B\\approx (1-r)f_s/\\pi'} /> (hence r ≈ e<sup
				>−πB/f<sub>s</sub></sup
			>) and an envelope decaying as rⁿ. Put zeros on the circle at the same angle and you have a
			notch: the zeros null f<sub>0</sub>, the poles restore the gain elsewhere.
		</p>
		<h3>All-pass and differentiator</h3>
		<p>
			The first-order all-pass <Tex math={'H(z)=\\frac{c+z^{-1}}{1+cz^{-1}}'} /> has its zero at −1/c,
			the mirror image of the pole, so |H| = 1 exactly. Its group delay at DC is (1 − c)/(1 + c) samples:
			choose c = (1 − d)/(1 + d) for a fractional delay d. The first difference <Tex
				math={'1-e^{-j\\omega}=2j\\sin(\\omega/2)\\,e^{-j\\omega/2}'}
			/> behaves like jω (a differentiator scaled by T) for small ω, with half a sample of delay, and
			reaches its maximum gain of 2 at Nyquist.
		</p>
		<Callout kind="try">
			<ul>
				<li>
					One-pole low-pass at 48 kHz: set the cutoff to 10 kHz and switch between <em
						>1 − e^(−2πfc/fs)</em
					>
					and <em>Exact −3 dB</em> — compare the measured −3 dB frequency.
				</li>
				<li>
					Moving average at fs = 1 kHz with N = 20: the nulls land on 50, 100, 150 Hz — a classic
					mains-hum rejector.
				</li>
				<li>
					Comb filter with g = 0.9: switch from feed-forward to feedback. Notches become resonant
					peaks and the impulse response starts to ring.
				</li>
				<li>
					Resonator with <em>Fixed</em> scaling: sweep f₀ from 500 Hz to 20 kHz with and without zeros
					at ±1 — only the version with zeros keeps its peak gain.
				</li>
				<li>
					Leaky integrator: switch to <em>Accumulator</em> and look at the step response ramp and the
					pole sitting on the unit circle.
				</li>
			</ul>
		</Callout>
	{/snippet}
</ToolLayout>

<style>
	.catalog {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.catalog button {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		text-align: left;
		border: 1px solid transparent;
		background: transparent;
		border-radius: var(--radius-sm);
		padding: 0.3rem 0.5rem;
		font-size: 0.88rem;
		cursor: pointer;
		color: var(--text);
	}
	.catalog button:hover {
		background: var(--surface-2);
	}
	.catalog button.active {
		background: var(--accent-wash);
		border-color: var(--accent);
		color: var(--accent-ink);
		font-weight: 600;
	}
	.idx {
		flex: none;
		width: 1.2rem;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
		font-weight: 400;
	}
	.eqs {
		margin-bottom: 0.4rem;
	}
	.split {
		display: grid;
		grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
		gap: 1rem 1.4rem;
		align-items: start;
	}
	.diagram {
		min-width: 0;
		padding: 0.4rem 0.2rem;
	}
	.cap {
		margin: 0.4rem 0 0;
	}
	.side {
		min-width: 0;
	}
	@media (max-width: 760px) {
		.split {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	.side h4 {
		margin: 0 0 0.3rem;
		font-size: 0.9rem;
	}
	.side ul {
		font-size: 0.88rem;
		margin-bottom: 0.7rem;
	}
</style>
