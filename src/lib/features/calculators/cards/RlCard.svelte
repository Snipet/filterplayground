<script lang="ts">
	import CalcCard from '../CalcCard.svelte';
	import Results from '../Results.svelte';
	import NumberInput from '$lib/components/controls/NumberInput.svelte';
	import Segmented from '$lib/components/controls/Segmented.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import { formatSI, trimNumber } from '$lib/dsp/units';
	import { rlCutoff, rlL, rlR, tauFromCutoff, cutoffFromTau } from '../math';

	let { id, title }: { id: string; title: string } = $props();

	type Solve = 'fc' | 'R' | 'L';
	let solve = $state<Solve>('fc');
	let R = $state(100);
	let L = $state(10e-3);
	let fc = $state(1000);

	const res = $derived.by(() => {
		if (solve === 'fc') return { R, L, fc: rlCutoff(R, L) };
		if (solve === 'R') return { R: rlR(L, fc), L, fc };
		return { R, L: rlL(R, fc), fc };
	});

	function setSolve(v: Solve) {
		R = res.R;
		L = res.L;
		fc = res.fc;
		solve = v;
	}
</script>

<CalcCard {id} {title} blurb="First-order RL low-pass (series L, shunt R) or high-pass (series R, shunt L).">
	{#snippet head()}
		<Segmented
			label="Solve for"
			size="small"
			value={solve}
			onchange={setSolve}
			options={[
				{ value: 'fc', label: 'fc & τ' },
				{ value: 'R', label: 'R' },
				{ value: 'L', label: 'L' }
			]}
		/>
	{/snippet}

	<div class="fields">
		{#if solve !== 'R'}<NumberInput label="Resistance R" bind:value={R} unit="Ω" si min={1e-9} logStep={1.1} />{/if}
		{#if solve !== 'L'}<NumberInput label="Inductance L" bind:value={L} unit="H" si min={1e-15} logStep={1.1} />{/if}
		{#if solve !== 'fc'}
			<NumberInput label="Cutoff fc (−3 dB)" bind:value={fc} unit="Hz" si min={1e-9} logStep={1.05} />
			<NumberInput label="Time constant τ" value={tauFromCutoff(fc)} unit="s" si min={1e-18} logStep={1.05} onchange={(v) => (fc = cutoffFromTau(v))} />
		{/if}
	</div>
	<Results
		rows={[
			solve === 'R' ? { label: 'Resistance R', value: formatSI(res.R, 'Ω', 4), primary: true } : null,
			solve === 'L' ? { label: 'Inductance L', value: formatSI(res.L, 'H', 4), primary: true } : null,
			solve === 'fc' ? { label: 'Cutoff fc', value: formatSI(res.fc, 'Hz', 4), primary: true } : null,
			{ label: 'Time constant τ = L/R', value: formatSI(res.L / res.R, 's', 4), primary: solve === 'fc' },
			{ label: 'ωc = 2π fc', value: `${trimNumber(2 * Math.PI * res.fc, 5)} rad/s` }
		].filter((r) => r !== null)}
	/>

	{#snippet formula()}
		<Tex display math={'f_c=\\frac{R}{2\\pi L},\\qquad \\tau = \\frac{L}{R} = \\frac{1}{2\\pi f_c}'} />
	{/snippet}
</CalcCard>
