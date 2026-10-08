<script lang="ts">
	import Select from '$lib/components/controls/Select.svelte';
	import Slider from '$lib/components/controls/Slider.svelte';
	import { WINDOWS, windowInfo, type WindowType } from '$lib/dsp/windows';

	export interface Slot {
		on: boolean;
		type: WindowType;
		param?: number;
	}

	interface Props {
		slot: Slot;
		index: number;
		color: string;
	}
	let { slot = $bindable(), index, color }: Props = $props();

	const info = $derived(windowInfo(slot.type));
	const letter = $derived('ABCD'[index] ?? String(index + 1));
	const id = $derived(`slot-${index}`);
	const options = WINDOWS.map((w) => ({ value: w.id, label: w.name }));
</script>

<div class="slot" class:off={!slot.on}>
	<div class="head">
		<input type="checkbox" id="{id}-on" bind:checked={slot.on} />
		<span class="swatch" style:background={color} aria-hidden="true"></span>
		<label for="{id}-on">Window {letter}</label>
	</div>
	<Select
		label="Window {letter} type"
		bind:value={slot.type}
		{options}
		onchange={(v: WindowType) => (slot.param = windowInfo(v).param?.default)}
	/>
	{#if info.param && slot.on}
		<Slider
			label={info.param.label}
			value={slot.param ?? info.param.default}
			min={info.param.min}
			max={info.param.max}
			step={info.param.step}
			onchange={(v) => (slot.param = v)}
		/>
	{/if}
</div>

<style>
	.slot {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding: 0.45rem 0.55rem 0.55rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface-2);
	}
	.slot.off {
		opacity: 0.7;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		font-size: 0.85rem;
		font-weight: 600;
	}
	.head input {
		margin: 0;
		accent-color: var(--accent);
	}
	.swatch {
		width: 18px;
		height: 4px;
		border-radius: 2px;
		flex: none;
	}
	.slot :global(.select label) {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
</style>
