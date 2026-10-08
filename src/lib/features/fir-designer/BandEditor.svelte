<script lang="ts">
	import NumberInput from '$lib/components/controls/NumberInput.svelte';
	import type { Band } from './design';

	interface Props {
		bands: Band[];
		fs: number;
		showWeight?: boolean;
		errors?: string[];
	}
	let { bands = $bindable(), fs, showWeight = true, errors = [] }: Props = $props();

	const nyq = $derived(fs / 2);

	function add() {
		const last = bands[bands.length - 1];
		if (!last) {
			bands.push({ f1: 0, f2: nyq / 2, d1: 1, d2: 1, weight: 1 });
			return;
		}
		const gap = 0.03 * nyq;
		if (nyq - last.f2 > 2 * gap) {
			bands.push({ f1: round(last.f2 + gap), f2: nyq, d1: 0, d2: 0, weight: 1 });
		} else {
			// split the last band to make room
			const mid = (last.f1 + last.f2) / 2;
			const old = last.f2;
			last.f2 = round(mid - gap / 2);
			bands.push({ f1: round(mid + gap / 2), f2: old, d1: last.d2, d2: last.d2, weight: last.weight });
		}
	}
	function remove(i: number) {
		bands.splice(i, 1);
	}
	const round = (v: number) => Number(v.toPrecision(4));
</script>

<div class="table-wrap">
	<table class="bands">
		<thead>
			<tr>
				<th>#</th>
				<th>From</th>
				<th>To</th>
				<th>Gain at start</th>
				<th>Gain at end</th>
				{#if showWeight}<th>Weight</th>{/if}
				<th><span class="visually-hidden">Remove</span></th>
			</tr>
		</thead>
		<tbody>
			{#each bands as b, i (i)}
				<tr>
					<td class="idx">{i + 1}</td>
					<td>
						<label class="visually-hidden" for="band-{i}-f1">Band {i + 1} start frequency (Hz)</label>
						<NumberInput id="band-{i}-f1" bind:value={b.f1} min={0} max={nyq} unit="Hz" si logStep={1.02} />
					</td>
					<td>
						<label class="visually-hidden" for="band-{i}-f2">Band {i + 1} end frequency (Hz)</label>
						<NumberInput id="band-{i}-f2" bind:value={b.f2} min={0} max={nyq} unit="Hz" si logStep={1.02} />
					</td>
					<td>
						<label class="visually-hidden" for="band-{i}-d1">Band {i + 1} desired gain at start</label>
						<NumberInput id="band-{i}-d1" bind:value={b.d1} step={0.1} />
					</td>
					<td>
						<label class="visually-hidden" for="band-{i}-d2">Band {i + 1} desired gain at end</label>
						<NumberInput id="band-{i}-d2" bind:value={b.d2} step={0.1} />
					</td>
					{#if showWeight}
						<td>
							<label class="visually-hidden" for="band-{i}-w">Band {i + 1} weight</label>
							<NumberInput id="band-{i}-w" bind:value={b.weight} min={0} logStep={1.25} />
						</td>
					{/if}
					<td>
						<button class="btn ghost small" type="button" onclick={() => remove(i)} disabled={bands.length <= 1} aria-label="Remove band {i + 1}"
							>✕</button
						>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
<div class="foot">
	<button class="btn small" type="button" onclick={add}>+ Add band</button>
	<span class="small muted">Gains are linear amplitudes; between bands the response is unconstrained (“don’t care”).</span>
</div>
{#if errors.length}
	<ul class="errs small" role="alert">
		{#each errors as e, i (i)}<li><span aria-hidden="true">✕</span> {e}</li>{/each}
	</ul>
{/if}

<style>
	.table-wrap {
		overflow-x: auto;
	}
	.bands {
		min-width: 620px;
	}
	.bands td:nth-child(2),
	.bands td:nth-child(3) {
		min-width: 6.5rem;
	}
	.bands td {
		padding: 0.25em 0.3em;
		vertical-align: middle;
	}
	.bands th {
		padding: 0.35em 0.3em;
		font-size: 0.8rem;
		white-space: nowrap;
	}
	.idx {
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}
	.foot {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		flex-wrap: wrap;
		margin-top: 0.5rem;
	}
	.errs {
		margin: 0.5rem 0 0;
		padding: 0;
		list-style: none;
		color: var(--critical-ink);
	}
</style>
