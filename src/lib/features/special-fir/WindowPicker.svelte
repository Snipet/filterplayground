<script lang="ts">
	import Select from '$lib/components/controls/Select.svelte';
	import Slider from '$lib/components/controls/Slider.svelte';
	import {
		WINDOWS,
		windowInfo,
		windowParamAt,
		windowParamRange,
		type WindowType
	} from '$lib/dsp/windows';
	import type { WindowSpec } from '$lib/dsp/fir';

	interface Props {
		value: WindowSpec;
		label?: string;
		/** Window length: limits parameters whose valid range depends on it (DPSS NW < N/2). */
		N?: number;
	}
	let { value = $bindable(), label = 'Window', N = Infinity }: Props = $props();
	const info = $derived(windowInfo(value.type));
	const range = $derived(windowParamRange(value.type, N));
	const options = WINDOWS.map((w) => ({ value: w.id, label: w.name }));
</script>

<Select
	{label}
	value={value.type}
	{options}
	onchange={(t: WindowType) => (value = { type: t, param: windowInfo(t).param?.default })}
/>
{#if range}
	<Slider
		label={range.label}
		value={windowParamAt(value.type, N, value.param) ?? range.default}
		min={range.min}
		max={range.max}
		step={range.step}
		onchange={(v) => (value = { type: value.type, param: v })}
		help={range.max < (info.param?.max ?? Infinity)
			? `${range.help} Must stay below N/2 = ${N / 2}.`
			: range.help}
	/>
{/if}
