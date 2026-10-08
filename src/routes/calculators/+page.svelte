<script lang="ts">
	import ToolLayout from '$lib/components/layout/ToolLayout.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import { CALCULATORS, matchCalc } from '$lib/features/calculators/registry';
	import { toolHref } from '$lib/paths';

	let query = $state('');
	const visible = $derived(
		new Set(CALCULATORS.filter((c) => matchCalc(c, query)).map((c) => c.id))
	);
</script>

<ToolLayout
	slug="calculators"
	related={['formulas', 'glossary', 'order-calculator', 'rlc', 'biquad']}
>
	<div class="toolbar">
		<label class="search">
			<span class="visually-hidden">Filter calculators</span>
			<svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"
				><circle
					cx="8.5"
					cy="8.5"
					r="5.5"
					fill="none"
					stroke="currentColor"
					stroke-width="1.8"
				/><path
					d="M13 13l4.5 4.5"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
				/></svg
			>
			<input
				type="search"
				placeholder="Filter calculators — e.g. “dBu”, “Q”, “wavelength”"
				bind:value={query}
				onkeydown={(e) => {
					if (e.key === 'Escape') query = '';
				}}
			/>
		</label>
		<nav class="chips" aria-label="Calculators">
			{#each CALCULATORS as c (c.id)}
				<a href="#{c.id}" class:dim={!visible.has(c.id)}>{c.short}</a>
			{/each}
		</nav>
	</div>

	{#if visible.size === 0}
		<p class="muted empty">
			No calculator matches “{query}”. Try the <a href={toolHref('glossary')}>glossary</a> or the
			<a href={toolHref('formulas')}>formula sheet</a>.
		</p>
	{/if}

	<div class="grid">
		{#each CALCULATORS as c (c.id)}
			<div class="cell" class:gone={!visible.has(c.id)}>
				<c.component id={c.id} title={c.title} />
			</div>
		{/each}
	</div>

	{#snippet theory()}
		<h2>Notes on conventions</h2>
		<p>
			All inputs accept SI prefixes: type <code>4k7</code>, <code>10n</code>, <code>2.2µ</code> or
			<code>1meg</code>. A value is read in the unit shown beside its field, and typing that unit
			after the number is optional: <code>10 nF</code> is the same as <code>10n</code>, and
			<code>2 m</code> in the wavelength field is 2 metres (<code>2 mm</code>, <code>2 cm</code>
			and <code>2 km</code> work too). A different unit is not converted. Press <kbd>Enter</kbd> or
			leave the field to apply; <kbd>↑</kbd>/<kbd>↓</kbd> nudge the value (<kbd>Shift</kbd> for
			bigger steps). Each card has a stable link (<strong>#</strong>) you can bookmark.
		</p>
		<ul>
			<li>
				<strong>Decibels</strong> always compare powers: <Tex math={'10\\log_{10}(P_2/P_1)'} />. For
				amplitudes (voltage, current, pressure) the power is proportional to the square, which gives <Tex
					math={'20\\log_{10}(V_2/V_1)'}
				/> — the two only agree when both signals see the same impedance.
			</li>
			<li>
				<strong>Q and bandwidth.</strong> For a second-order resonance the −3 dB bandwidth is
				exactly f₀/Q and the edges are geometrically symmetric about f₀. The same Q in a low-pass
				section describes the corner peaking instead; see the
				<a href={toolHref('rlc')}>RLC explorer</a> and <a href={toolHref('bode')}>Bode builder</a>.
			</li>
			<li>
				<strong>Ripple conventions differ.</strong> IIR texts normalise the passband to a maximum of
				1 (gain between 1 − δ and 1), while FIR design (Parks–McClellan, Kaiser) uses 1 ± δ. Both
				are shown; the <a href={toolHref('order-calculator')}>order calculator</a>
				uses the FIR convention for its FIR estimates.
			</li>
			<li>
				<strong>Normalised frequency</strong> has no single convention: SciPy uses Hz with an
				explicit <code>fs</code>, MATLAB uses multiples of π rad/sample (1 = Nyquist), and many
				textbooks use ω in rad/sample (π = Nyquist).
			</li>
		</ul>
	{/snippet}
</ToolLayout>

<style>
	.toolbar {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.search {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		padding: 0 0.6rem;
		color: var(--muted);
		max-width: 520px;
	}
	.search:focus-within {
		border-color: var(--focus);
		box-shadow: 0 0 0 3px var(--accent-wash);
	}
	.search input {
		border: none;
		outline: none;
		background: transparent;
		padding: 0.45rem 0;
		width: 100%;
		min-width: 0;
		color: var(--text);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	.chips a {
		font-size: 0.8rem;
		padding: 0.12rem 0.55rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface);
		text-decoration: none;
		color: var(--text-2);
	}
	.chips a:hover {
		border-color: var(--accent);
		color: var(--accent-ink);
	}
	.chips a.dim {
		opacity: 0.4;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 360px), 1fr));
		gap: 1rem;
		align-items: start;
	}
	.cell {
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.cell.gone {
		display: none;
	}
	.empty {
		margin: 0;
	}
</style>
