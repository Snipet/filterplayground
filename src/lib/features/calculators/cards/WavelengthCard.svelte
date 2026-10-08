<script lang="ts">
	import CalcCard from '../CalcCard.svelte';
	import NumberInput from '$lib/components/controls/NumberInput.svelte';
	import Select from '$lib/components/controls/Select.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import { trimNumber } from '$lib/dsp/units';
	import { SPEED_OF_LIGHT, SPEED_OF_SOUND } from '../math';

	let { id, title }: { id: string; title: string } = $props();

	const TAU = 2 * Math.PI;
	let f = $state(1000);
	let medium = $state<'air' | 'water' | 'light' | 'custom'>('air');
	let custom = $state(200e6);
	const v = $derived(
		medium === 'air' ? SPEED_OF_SOUND : medium === 'water' ? 1481 : medium === 'light' ? SPEED_OF_LIGHT : custom
	);
	const lambda = $derived(v / f);
	const lambdaText = $derived(
		lambda >= 1000 ? `${trimNumber(lambda / 1000, 5)} km` : lambda >= 1 ? `${trimNumber(lambda, 5)} m` : lambda >= 0.01 ? `${trimNumber(lambda * 100, 5)} cm` : lambda >= 1e-3 ? `${trimNumber(lambda * 1e3, 5)} mm` : `${trimNumber(lambda * 1e6, 5)} µm`
	);
</script>

<CalcCard {id} {title} blurb="Edit any field. Wavelength depends on the propagation speed of the medium.">
	<div class="fields">
		<NumberInput label="Frequency f" value={f} unit="Hz" si min={1e-12} logStep={1.05} onchange={(x) => (f = x)} />
		<NumberInput label="Period T" value={1 / f} unit="s" si min={1e-18} logStep={1.05} onchange={(x) => (f = 1 / x)} />
		<NumberInput label="Angular frequency ω" value={TAU * f} unit="rad/s" digits={6} min={1e-12} logStep={1.05} onchange={(x) => (f = x / TAU)} />
		<NumberInput label="Wavelength λ (m)" value={lambda} unit="m" digits={6} min={1e-15} logStep={1.05} onchange={(x) => (f = v / x)} help={lambdaText} />
		<div class="span">
		<Select
			label="Medium"
			bind:value={medium}
			options={[
				{ value: 'air', label: 'Sound in air, 343 m/s (20 °C)' },
				{ value: 'water', label: 'Sound in water, 1481 m/s (20 °C)' },
				{ value: 'light', label: 'Light in vacuum, c = 299 792 458 m/s' },
				{ value: 'custom', label: 'Custom speed…' }
			]}
		/>
		</div>
		{#if medium === 'custom'}
			<NumberInput label="Propagation speed v" bind:value={custom} unit="m/s" digits={6} min={1e-9} logStep={1.05} help="e.g. ≈ 0.66 c in coax with PE dielectric" />
		{/if}
	</div>

	{#snippet formula()}
		<Tex display math={'T=\\frac{1}{f},\\qquad \\omega = 2\\pi f,\\qquad \\lambda=\\frac{v}{f}'} />
	{/snippet}
</CalcCard>

<style>
	.span {
		grid-column: 1 / -1;
	}
</style>
