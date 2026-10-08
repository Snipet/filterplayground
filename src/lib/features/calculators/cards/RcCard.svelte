<script lang="ts">
	import CalcCard from '../CalcCard.svelte';
	import Results from '../Results.svelte';
	import NumberInput from '$lib/components/controls/NumberInput.svelte';
	import Segmented from '$lib/components/controls/Segmented.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import { formatSI, trimNumber } from '$lib/dsp/units';
	import { eSeriesNeighbours, rcCutoff, rcOther, tauFromCutoff, cutoffFromTau } from '../math';

	let { id, title }: { id: string; title: string } = $props();

	type Solve = 'fc' | 'R' | 'C';
	let solve = $state<Solve>('fc');
	let R = $state(10e3);
	let C = $state(10e-9);
	let fc = $state(1000);

	const res = $derived.by(() => {
		if (solve === 'fc') return { R, C, fc: rcCutoff(R, C) };
		if (solve === 'R') return { R: rcOther(C, fc), C, fc };
		return { R, C: rcOther(R, fc), fc };
	});

	function setSolve(v: Solve) {
		R = res.R;
		C = res.C;
		fc = res.fc;
		solve = v;
	}

	const suggestions = $derived.by(() => {
		if (solve === 'fc') return [];
		const target = solve === 'R' ? res.R : res.C;
		return (['E12', 'E24'] as const).map((s) => {
			const n = eSeriesNeighbours(target, s);
			const f = solve === 'R' ? rcCutoff(n.nearest, res.C) : rcCutoff(res.R, n.nearest);
			const err = Math.round(((f - res.fc) / res.fc) * 1e4) / 1e4 || 0;
			return {
				label: `Nearest ${s} ${solve}`,
				value: `${formatSI(n.nearest, solve === 'R' ? 'Ω' : 'F', 3)} → ${formatSI(f, 'Hz', 4)} (${err >= 0 ? '+' : ''}${trimNumber(err, 2)} %)`
			};
		});
	});
</script>

<CalcCard
	{id}
	{title}
	blurb="First-order RC low-pass or high-pass: pick the unknown, enter the other two."
>
	{#snippet head()}
		<Segmented
			label="Solve for"
			size="small"
			value={solve}
			onchange={setSolve}
			options={[
				{ value: 'fc', label: 'fc & τ' },
				{ value: 'R', label: 'R' },
				{ value: 'C', label: 'C' }
			]}
		/>
	{/snippet}

	<div class="fields">
		{#if solve !== 'R'}<NumberInput
				label="Resistance R"
				bind:value={R}
				unit="Ω"
				si
				min={1e-6}
				logStep={1.1}
			/>{/if}
		{#if solve !== 'C'}<NumberInput
				label="Capacitance C"
				bind:value={C}
				unit="F"
				si
				min={1e-18}
				logStep={1.1}
			/>{/if}
		{#if solve !== 'fc'}
			<NumberInput
				label="Cutoff fc (−3 dB)"
				bind:value={fc}
				unit="Hz"
				si
				min={1e-9}
				logStep={1.05}
			/>
			<NumberInput
				label="Time constant τ"
				value={tauFromCutoff(fc)}
				unit="s"
				si
				min={1e-18}
				logStep={1.05}
				onchange={(v) => (fc = cutoffFromTau(v))}
			/>
		{/if}
	</div>
	<Results
		rows={[
			solve === 'R'
				? { label: 'Resistance R', value: formatSI(res.R, 'Ω', 4), primary: true }
				: null,
			solve === 'C'
				? { label: 'Capacitance C', value: formatSI(res.C, 'F', 4), primary: true }
				: null,
			solve === 'fc'
				? { label: 'Cutoff fc', value: formatSI(res.fc, 'Hz', 4), primary: true }
				: null,
			{
				label: 'Time constant τ = RC',
				value: formatSI(res.R * res.C, 's', 4),
				primary: solve === 'fc'
			},
			{ label: 'ωc = 2π fc', value: `${trimNumber(2 * Math.PI * res.fc, 5)} rad/s` },
			...suggestions
		].filter((r) => r !== null)}
	/>

	{#snippet formula()}
		<Tex display math={'f_c=\\frac{1}{2\\pi RC},\\qquad \\tau = RC = \\frac{1}{2\\pi f_c}'} />
	{/snippet}
</CalcCard>
