<script lang="ts">
	import CalcCard from '../CalcCard.svelte';
	import NumberInput from '$lib/components/controls/NumberInput.svelte';
	import { formatSI, trimNumber } from '$lib/dsp/units';
	import { eSeriesNeighbours, SERIES_NAMES } from '../math';

	let { id, title }: { id: string; title: string } = $props();

	let value = $state(5000);
	const rows = $derived(SERIES_NAMES.map((s) => ({ s, n: eSeriesNeighbours(value, s) })));
	const tol: Record<string, string> = {
		E6: '±20 %',
		E12: '±10 %',
		E24: '±5 %',
		E48: '±2 %',
		E96: '±1 %'
	};
	const pct = (v: number) => {
		const r = Math.round(v * 1e4) / 1e4 || 0;
		return `${r > 0 ? '+' : ''}${trimNumber(r, 3)} %`;
	};
</script>

<CalcCard
	{id}
	{title}
	blurb="Nearest preferred (IEC 60063) values below and above any value, with the error each introduces."
>
	<NumberInput
		label="Value (any unit; SI prefixes like 4k7, 33n work)"
		bind:value
		si
		min={1e-15}
		logStep={1.05}
	/>
	<div class="wrap">
		<table>
			<thead>
				<tr
					><th>Series</th><th class="num">Below</th><th class="num">Error</th><th class="num"
						>Above</th
					><th class="num">Error</th></tr
				>
			</thead>
			<tbody>
				{#each rows as r (r.s)}
					<tr>
						<td><strong>{r.s}</strong> <span class="muted small">{tol[r.s]}</span></td>
						<td class="num" class:best={r.n.nearest === r.n.below}>{formatSI(r.n.below, '', 3)}</td>
						<td class="num">{pct(r.n.errBelow)}</td>
						<td class="num" class:best={r.n.nearest === r.n.above}>{formatSI(r.n.above, '', 3)}</td>
						<td class="num">{pct(r.n.errAbove)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<p class="note">
		The highlighted value is the nearest in ratio (log distance). Tolerances are the ones each
		series was designed for.
	</p>

	{#snippet formula()}
		<p class="small muted f">
			E<em>n</em> has <em>n</em> values per decade spaced ≈ 10<sup>1/n</sup> apart. E48/E96 are 10<sup
				>i/n</sup
			> rounded to three figures; E6–E24 use historical values (2.7, 3.3, 3.9, 4.7, 8.2 differ from pure
			rounding).
		</p>
	{/snippet}
</CalcCard>

<style>
	.wrap {
		overflow-x: auto;
	}
	table {
		font-size: 0.86rem;
	}
	td,
	th {
		padding: 0.3em 0.45em;
	}
	td.best {
		background: var(--accent-wash);
		font-weight: 650;
	}
	.f {
		margin: 0.3rem 0;
	}
</style>
