<script lang="ts">
	import CalcCard from '../CalcCard.svelte';
	import Results from '../Results.svelte';
	import NumberInput from '$lib/components/controls/NumberInput.svelte';
	import Segmented from '$lib/components/controls/Segmented.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import { formatSI } from '$lib/dsp/units';

	let { id, title }: { id: string; title: string } = $props();

	const TAU = 2 * Math.PI;
	type Solve = 'X' | 'f' | 'val';
	let part = $state<'C' | 'L'>('C');
	let solve = $state<Solve>('X');
	let f = $state(1000);
	let C = $state(100e-9);
	let L = $state(10e-3);
	let X = $state(1000);

	// X_C = 1/(2πfC), X_L = 2πfL
	const res = $derived.by(() => {
		const val = part === 'C' ? C : L;
		if (solve === 'X') return { f, val, X: part === 'C' ? 1 / (TAU * f * val) : TAU * f * val };
		if (solve === 'f') return { f: part === 'C' ? 1 / (TAU * X * val) : X / (TAU * val), val, X };
		return { f, val: part === 'C' ? 1 / (TAU * f * X) : X / (TAU * f), X };
	});

	function sync() {
		f = res.f;
		X = res.X;
		if (part === 'C') C = res.val;
		else L = res.val;
	}
	function setSolve(v: Solve) {
		sync();
		solve = v;
	}
	function setPart(v: 'C' | 'L') {
		sync();
		part = v;
	}
	const unit = $derived(part === 'C' ? 'F' : 'H');
	const name = $derived(part === 'C' ? 'Capacitance C' : 'Inductance L');
</script>

<CalcCard {id} {title} blurb="Magnitude of the impedance of an ideal capacitor or inductor at one frequency.">
	{#snippet head()}
		<Segmented
			size="small"
			value={part}
			onchange={setPart}
			options={[
				{ value: 'C', label: 'Capacitor' },
				{ value: 'L', label: 'Inductor' }
			]}
		/>
		<Segmented
			label="Solve for"
			size="small"
			value={solve}
			onchange={setSolve}
			options={[
				{ value: 'X', label: 'X' },
				{ value: 'f', label: 'f' },
				{ value: 'val', label: part }
			]}
		/>
	{/snippet}

	<div class="fields">
		{#if solve !== 'f'}<NumberInput label="Frequency f" bind:value={f} unit="Hz" si min={1e-9} logStep={1.05} />{/if}
		{#if solve !== 'val'}
			{#if part === 'C'}
				<NumberInput label={name} bind:value={C} unit="F" si min={1e-18} logStep={1.1} />
			{:else}
				<NumberInput label={name} bind:value={L} unit="H" si min={1e-15} logStep={1.1} />
			{/if}
		{/if}
		{#if solve !== 'X'}<NumberInput label="Reactance |X|" bind:value={X} unit="Ω" si min={1e-12} logStep={1.1} />{/if}
	</div>
	<Results
		rows={[
			solve === 'X' ? { label: part === 'C' ? 'Capacitive reactance' : 'Inductive reactance', value: formatSI(res.X, 'Ω', 4), primary: true } : null,
			solve === 'f' ? { label: 'Frequency f', value: formatSI(res.f, 'Hz', 4), primary: true } : null,
			solve === 'val' ? { label: name, value: formatSI(res.val, unit, 4), primary: true } : null,
			{ label: 'Impedance Z', value: `${part === 'C' ? '−' : '+'}j ${formatSI(res.X, 'Ω', 4)}` },
			{ label: 'Admittance |Y| = 1/|X|', value: formatSI(1 / res.X, 'S', 4) }
		].filter((r) => r !== null)}
	/>

	{#snippet formula()}
		<Tex display math={'\\begin{gathered}X_C=\\frac{1}{2\\pi f C},\\qquad Z_C=\\frac{1}{j\\omega C}=-jX_C\\\\[7pt] X_L=2\\pi f L,\\qquad Z_L=j\\omega L=jX_L\\end{gathered}'} />
	{/snippet}
</CalcCard>
