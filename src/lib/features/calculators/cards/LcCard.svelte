<script lang="ts">
	import CalcCard from '../CalcCard.svelte';
	import Results from '../Results.svelte';
	import NumberInput from '$lib/components/controls/NumberInput.svelte';
	import Segmented from '$lib/components/controls/Segmented.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import { formatSI } from '$lib/dsp/units';
	import { characteristicImpedance, lcOther, lcResonance, reactanceC, reactanceL } from '../math';

	let { id, title }: { id: string; title: string } = $props();

	type Solve = 'f0' | 'L' | 'C';
	let solve = $state<Solve>('f0');
	let L = $state(1e-3);
	let C = $state(1e-6);
	let f0 = $state(5000);
	let f = $state(1000);

	const res = $derived.by(() => {
		if (solve === 'f0') return { L, C, f0: lcResonance(L, C) };
		if (solve === 'L') return { L: lcOther(C, f0), C, f0 };
		return { L, C: lcOther(L, f0), f0 };
	});

	function setSolve(v: Solve) {
		L = res.L;
		C = res.C;
		f0 = res.f0;
		solve = v;
	}

	const xl = $derived(reactanceL(f, res.L));
	const xc = $derived(reactanceC(f, res.C));
	const xSeries = $derived(xl - xc);
	const xPar = $derived((xl * xc) / (xc - xl));
	const kind = (x: number) => (Math.abs(x) < 1e-12 ? '' : x > 0 ? ' (inductive)' : ' (capacitive)');
	const fmtX = (x: number) => (Number.isFinite(x) ? formatSI(Math.abs(x), 'Ω', 4) + kind(x) : '∞ (resonance)');
</script>

<CalcCard {id} {title} blurb="Series or parallel LC tank. Reactances are evaluated at the frequency f you choose.">
	{#snippet head()}
		<Segmented
			label="Solve for"
			size="small"
			value={solve}
			onchange={setSolve}
			options={[
				{ value: 'f0', label: 'f₀' },
				{ value: 'L', label: 'L' },
				{ value: 'C', label: 'C' }
			]}
		/>
	{/snippet}

	<div class="fields">
		{#if solve !== 'L'}<NumberInput label="Inductance L" bind:value={L} unit="H" si min={1e-15} logStep={1.1} />{/if}
		{#if solve !== 'C'}<NumberInput label="Capacitance C" bind:value={C} unit="F" si min={1e-18} logStep={1.1} />{/if}
		{#if solve !== 'f0'}<NumberInput label="Resonance f₀" bind:value={f0} unit="Hz" si min={1e-9} logStep={1.05} />{/if}
		<NumberInput label="Evaluate reactances at f" bind:value={f} unit="Hz" si min={1e-9} logStep={1.05} />
	</div>
	<Results
		rows={[
			solve === 'f0' ? { label: 'Resonance f₀', value: formatSI(res.f0, 'Hz', 4), primary: true } : null,
			solve === 'L' ? { label: 'Inductance L', value: formatSI(res.L, 'H', 4), primary: true } : null,
			solve === 'C' ? { label: 'Capacitance C', value: formatSI(res.C, 'F', 4), primary: true } : null,
			{ label: 'Z₀ = √(L/C)', value: formatSI(characteristicImpedance(res.L, res.C), 'Ω', 4), hint: 'Characteristic impedance: both reactances equal Z₀ at resonance' },
			{ label: 'Inductive reactance at f', value: formatSI(xl, 'Ω', 4) },
			{ label: 'Capacitive reactance at f', value: formatSI(xc, 'Ω', 4) },
			{ label: 'Series LC reactance', value: fmtX(xSeries), hint: 'XL − XC' },
			{ label: 'Parallel LC reactance', value: fmtX(xPar), hint: 'XL·XC/(XC − XL)' }
		].filter((r) => r !== null)}
	/>

	{#snippet formula()}
		<Tex display math={'\\begin{gathered}f_0=\\frac{1}{2\\pi\\sqrt{LC}},\\qquad Z_0=\\sqrt{\\frac{L}{C}}\\\\[7pt] X_L=2\\pi fL,\\qquad X_C=\\frac{1}{2\\pi fC}\\end{gathered}'} />
	{/snippet}
</CalcCard>
