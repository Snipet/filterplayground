<script lang="ts">
	import Select from '$lib/components/controls/Select.svelte';
	import Slider from '$lib/components/controls/Slider.svelte';
	import { WINDOWS, windowInfo, type WindowType } from '$lib/dsp/windows';
	import type { WindowSpec } from '$lib/dsp/fir';

	interface Props {
		value: WindowSpec;
		label?: string;
	}
	let { value = $bindable(), label = 'Window' }: Props = $props();
	const info = $derived(windowInfo(value.type));
	const options = WINDOWS.map((w) => ({ value: w.id, label: w.name }));
</script>

<Select {label} value={value.type} {options} onchange={(t: WindowType) => (value = { type: t, param: windowInfo(t).param?.default })} />
{#if info.param}
	<Slider
		label={info.param.label}
		value={value.param ?? info.param.default}
		min={info.param.min}
		max={info.param.max}
		step={info.param.step}
		onchange={(v) => (value = { type: value.type, param: v })}
		help={info.param.help}
	/>
{/if}
