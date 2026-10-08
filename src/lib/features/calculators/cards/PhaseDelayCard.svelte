<script lang="ts">
	import CalcCard from '../CalcCard.svelte';
	import Results from '../Results.svelte';
	import NumberInput from '$lib/components/controls/NumberInput.svelte';
	import Segmented from '$lib/components/controls/Segmented.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import { formatSI, trimNumber } from '$lib/dsp/units';
	import { delayToPhaseDeg, phaseDegToDelay, phaseDelayToFreq, SPEED_OF_SOUND } from '../math';

	let { id, title }: { id: string; title: string } = $props();

	type Solve = 'phase' | 'delay' | 'f';
	let solve = $state<Solve>('phase');
	let f = $state(1000);
	let phase = $state(90);
	let delay = $state(0.25e-3);
	let fs = $state(48000);

	const res = $derived.by(() => {
		if (solve === 'phase') return { f, delay, phase: delayToPhaseDeg(delay, f) };
		if (solve === 'delay') return { f, phase, delay: phaseDegToDelay(phase, f) };
		return { phase, delay, f: phaseDelayToFreq(phase, delay) };
	});
	function setSolve(v: Solve) {
		f = res.f;
		phase = res.phase;
		delay = res.delay;
		solve = v;
	}
</script>

<CalcCard
	{id}
	{title}
	blurb="A pure time delay t shifts a sinusoid at f by a phase lag of 360°·f·t (and vice versa: the phase delay of a filter)."
>
	{#snippet head()}
		<Segmented
			label="Solve for"
			size="small"
			value={solve}
			onchange={setSolve}
			options={[
				{ value: 'phase', label: 'Phase' },
				{ value: 'delay', label: 'Delay' },
				{ value: 'f', label: 'Frequency' }
			]}
		/>
	{/snippet}

	<div class="fields">
		{#if solve !== 'f'}<NumberInput
				label="Frequency f"
				bind:value={f}
				unit="Hz"
				si
				min={1e-12}
				logStep={1.05}
			/>{/if}
		{#if solve !== 'phase'}<NumberInput
				label="Phase lag φ"
				bind:value={phase}
				unit="°"
				digits={6}
			/>{/if}
		{#if solve !== 'delay'}<NumberInput
				label="Time delay t"
				bind:value={delay}
				unit="s"
				si
				logStep={1.05}
			/>{/if}
		<NumberInput
			label="Sample rate (for samples)"
			bind:value={fs}
			unit="Hz"
			si
			min={1e-9}
			logStep={1.05}
		/>
	</div>
	<Results
		rows={[
			solve === 'phase'
				? { label: 'Phase lag φ', value: `${trimNumber(res.phase, 6)}°`, primary: true }
				: null,
			solve === 'delay'
				? { label: 'Delay t', value: formatSI(res.delay, 's', 5), primary: true }
				: null,
			solve === 'f'
				? { label: 'Frequency f', value: formatSI(res.f, 'Hz', 5), primary: true }
				: null,
			{ label: 'Phase in radians', value: `${trimNumber((res.phase * Math.PI) / 180, 5)} rad` },
			{ label: 'Cycles of delay', value: trimNumber(res.phase / 360, 5) },
			{ label: 'Delay in samples', value: trimNumber(res.delay * fs, 6) },
			{
				label: 'Acoustic path (343 m/s)',
				value: `${trimNumber(res.delay * SPEED_OF_SOUND * 100, 5)} cm`
			}
		].filter((r) => r !== null)}
	/>

	{#snippet formula()}
		<Tex
			display
			math={'\\begin{gathered}\\varphi = 2\\pi f t\\;\\text{rad} = 360^\\circ\\, f\\, t,\\qquad t = \\frac{\\varphi}{360^\\circ f}\\\\[7pt] \\tau_p(\\omega)=-\\frac{\\angle H(j\\omega)}{\\omega}\\;\\;\\text{(phase delay)}\\end{gathered}'}
		/>
	{/snippet}
</CalcCard>
