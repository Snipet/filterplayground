<script lang="ts">
	import CalcCard from '../CalcCard.svelte';
	import Results from '../Results.svelte';
	import NumberInput from '$lib/components/controls/NumberInput.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import { formatSI, trimNumber } from '$lib/dsp/units';
	import { aliasFrequency } from '../math';

	let { id, title }: { id: string; title: string } = $props();

	let fs = $state(48000);
	let f = $state(1000);
	let n = $state(480);
	const nu = $derived(f / fs);
	const alias = $derived(aliasFrequency(f, fs));
</script>

<CalcCard
	{id}
	{title}
	blurb="Every common way of writing a digital frequency. Edit any field; they all describe the same frequency."
>
	<div class="fields">
		<NumberInput label="Sample rate fs" bind:value={fs} unit="Hz" si min={1e-9} logStep={1.05} />
		<NumberInput
			label="Frequency f"
			value={f}
			unit="Hz"
			si
			min={0}
			logStep={1.05}
			onchange={(x) => (f = x)}
		/>
		<NumberInput
			label="f / fs (cycles/sample)"
			value={nu}
			digits={6}
			min={0}
			onchange={(x) => (f = x * fs)}
		/>
		<NumberInput
			label="ω (rad/sample)"
			value={2 * Math.PI * nu}
			digits={6}
			min={0}
			onchange={(x) => (f = (x / (2 * Math.PI)) * fs)}
		/>
		<NumberInput
			label="f / (fs/2) — × π rad/sample"
			value={2 * nu}
			digits={6}
			min={0}
			onchange={(x) => (f = (x * fs) / 2)}
			help="Nyquist fraction; MATLAB's normalised frequency"
		/>
		<NumberInput
			label="Period (samples)"
			value={fs / f}
			digits={6}
			min={1e-9}
			onchange={(x) => (f = fs / x)}
		/>
	</div>
	<Results
		rows={[
			{ label: 'Nyquist frequency fs/2', value: formatSI(fs / 2, 'Hz', 5) },
			{
				label: 'Appears after sampling at',
				value: formatSI(alias, 'Hz', 5),
				primary: f > fs / 2,
				hint: 'Aliased frequency folded into 0 … fs/2'
			},
			{ label: 'Sample period Ts', value: formatSI(1 / fs, 's', 5) }
		]}
	/>
	{#if f > fs / 2}
		<p class="note">
			<strong>Above Nyquist:</strong> a {formatSI(f, 'Hz', 4)} tone aliases to {formatSI(
				alias,
				'Hz',
				4
			)}.
		</p>
	{/if}
	<p class="sub">Samples ↔ time</p>
	<div class="fields">
		<NumberInput label="Samples n" value={n} digits={8} min={0} onchange={(x) => (n = x)} />
		<NumberInput
			label="Duration t"
			value={n / fs}
			unit="s"
			si
			min={0}
			logStep={1.05}
			onchange={(x) => (n = x * fs)}
		/>
	</div>
	<p class="note">
		{trimNumber(n, 6)} samples at {formatSI(fs, 'Hz', 4)} last {formatSI(n / fs, 's', 4)}.
	</p>

	{#snippet formula()}
		<Tex
			display
			math={'\\begin{gathered}\\nu=\\frac{f}{f_s},\\qquad \\omega = 2\\pi\\frac{f}{f_s}\\;\\text{rad/sample}\\\\[7pt] \\frac{f}{f_s/2}=\\frac{\\omega}{\\pi},\\qquad t = \\frac{n}{f_s}\\end{gathered}'}
		/>
	{/snippet}
</CalcCard>
