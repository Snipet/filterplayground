<script lang="ts">
	import Slider from '$lib/components/controls/Slider.svelte';
	import Segmented from '$lib/components/controls/Segmented.svelte';
	import Toggle from '$lib/components/controls/Toggle.svelte';
	import { seriesColor } from '$lib/components/plot/scales';
	import { FACTOR_TYPES, type Factor } from '$lib/features/bode/factors';
	import { trimNumber } from '$lib/dsp/units';

	interface Props {
		factor: Factor;
		index: number;
		onupdate: (patch: Partial<Factor>) => void;
		onremove: () => void;
	}
	let { factor, index, onupdate, onremove }: Props = $props();

	const name = $derived(FACTOR_TYPES.find((t) => t.id === factor.type)?.name ?? factor.type);
	const color = $derived(seriesColor(factor.slot));
</script>

<div class="factor">
	<div class="head">
		<svg width="18" height="8" aria-hidden="true"
			><line
				x1="1"
				y1="4"
				x2="17"
				y2="4"
				stroke={color}
				stroke-width="2.5"
				stroke-linecap="round"
			/></svg
		>
		<span class="name">{index + 1}. {name}</span>
		<button
			class="btn ghost small"
			type="button"
			aria-label="Remove factor {index + 1} ({name})"
			onclick={onremove}>✕</button
		>
	</div>
	<div class="body">
		{#if factor.type === 'gain'}
			<Slider
				label="|K|"
				value={factor.gainDb}
				min={-40}
				max={80}
				step={0.5}
				unit="dB"
				onchange={(v) => onupdate({ gainDb: v })}
			/>
			<p class="small muted lin">
				|K| = {trimNumber(Math.pow(10, factor.gainDb / 20), 4)} (linear)
			</p>
			<Segmented
				size="small"
				label="Sign"
				value={factor.sign}
				options={[
					{ value: 1, label: 'K > 0' },
					{ value: -1, label: 'K < 0 (−180°)' }
				]}
				onchange={(v) => onupdate({ sign: v === -1 ? -1 : 1 })}
			/>
		{:else if factor.type === 'power'}
			<Segmented
				size="small"
				label="Power n"
				value={factor.n}
				options={[
					{ value: -2, label: '1/s²' },
					{ value: -1, label: '1/s' },
					{ value: 1, label: 's' },
					{ value: 2, label: 's²' }
				]}
				onchange={(v) => onupdate({ n: v })}
			/>
			<Slider
				label="0 dB frequency f_u"
				value={factor.f}
				min={0.1}
				max={1e6}
				log
				si
				unit="Hz"
				onchange={(v) => onupdate({ f: v })}
			/>
		{:else if factor.type === 'realPole' || factor.type === 'realZero'}
			<Slider
				label="Corner frequency"
				value={factor.f}
				min={0.1}
				max={1e6}
				log
				si
				unit="Hz"
				onchange={(v) => onupdate({ f: v })}
			/>
			<Toggle
				checked={factor.rhp}
				label="Right half-plane"
				help={factor.type === 'realZero'
					? 'Non-minimum phase: same |H|, phase goes the other way'
					: 'Unstable pole: same |H|, phase rises'}
				onchange={(v) => onupdate({ rhp: v })}
			/>
		{:else if factor.type === 'complexPole' || factor.type === 'complexZero'}
			<Slider
				label="Natural frequency f_n"
				value={factor.f}
				min={0.1}
				max={1e6}
				log
				si
				unit="Hz"
				onchange={(v) => onupdate({ f: v })}
			/>
			<Slider
				label="Damping ζ"
				value={factor.zeta}
				min={0.005}
				max={2}
				log
				onchange={(v) => onupdate({ zeta: v })}
			/>
		{:else if factor.type === 'delay'}
			<Slider
				label="Delay T"
				value={factor.T}
				min={1e-6}
				max={1}
				log
				si
				unit="s"
				onchange={(v) => onupdate({ T: v })}
			/>
		{/if}
	</div>
</div>

<style>
	.factor {
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface-2);
		padding: 0.35rem 0.6rem 0.6rem;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}
	.name {
		flex: 1;
		font-size: 0.86rem;
		font-weight: 600;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.body {
		display: grid;
		gap: 0.55rem;
		margin-top: 0.3rem;
	}
	.lin {
		margin: -0.35rem 0 0;
	}
</style>
