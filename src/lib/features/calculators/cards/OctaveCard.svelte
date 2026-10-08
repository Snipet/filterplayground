<script lang="ts">
	import CalcCard from '../CalcCard.svelte';
	import Results from '../Results.svelte';
	import NumberInput from '$lib/components/controls/NumberInput.svelte';
	import Segmented from '$lib/components/controls/Segmented.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import { formatSI, trimNumber } from '$lib/dsp/units';
	import { interval, octaveBand, octaveBandIndex, octaveBands, type OctaveBase } from '../math';

	let { id, title }: { id: string; title: string } = $props();

	let f1 = $state(440);
	let f2 = $state(1000);
	let b = $state(3);
	let base = $state<OctaveBase>(10);
	let f = $state(1000);

	const iv = $derived(interval(f1, f2));
	const band = $derived(octaveBand(octaveBandIndex(f, b, base), b, base));
	const bands = $derived(octaveBands(b, base, 20, 20000));
	const hz = (v: number) => formatSI(v, 'Hz', 5);
</script>

<CalcCard
	{id}
	{title}
	blurb="Musical and acoustic intervals between two frequencies, and fractional-octave analysis bands."
>
	<div class="fields">
		<NumberInput label="Frequency f₁" bind:value={f1} unit="Hz" si min={1e-9} logStep={1.05} />
		<NumberInput label="Frequency f₂" bind:value={f2} unit="Hz" si min={1e-9} logStep={1.05} />
	</div>
	<Results
		rows={[
			{ label: 'Ratio f₂/f₁', value: trimNumber(iv.ratio, 6) },
			{ label: 'Octaves', value: trimNumber(iv.octaves, 6), primary: true },
			{ label: 'Decades', value: trimNumber(iv.decades, 6) },
			{ label: 'Semitones', value: trimNumber(iv.semitones, 6) },
			{ label: 'Cents', value: trimNumber(iv.cents, 6) }
		]}
	/>

	<p class="sub">Fractional-octave bands</p>
	<div class="head-row">
		<Segmented
			size="small"
			label="Bandwidth"
			bind:value={b}
			options={[
				{ value: 1, label: '1/1' },
				{ value: 3, label: '1/3' },
				{ value: 6, label: '1/6' },
				{ value: 12, label: '1/12' },
				{ value: 24, label: '1/24' }
			]}
		/>
		<Segmented
			size="small"
			label="Octave ratio G"
			bind:value={base}
			options={[
				{ value: 10, label: 'Base 10' },
				{ value: 2, label: 'Base 2' }
			]}
		/>
	</div>
	<NumberInput
		label="Find the band containing f"
		bind:value={f}
		unit="Hz"
		si
		min={1e-6}
		logStep={1.05}
	/>
	<Results
		rows={[
			{ label: 'Lower edge', value: hz(band.lower) },
			{ label: 'Exact mid-band', value: hz(band.centre), primary: true },
			{ label: 'Upper edge', value: hz(band.upper) },
			{
				label: 'Nominal mid-band',
				value: band.nominal ? formatSI(band.nominal, 'Hz', 4) : '— (1/1, 1/3 only)'
			}
		]}
	/>
	<div class="bands" role="region" aria-label="Band table" tabindex="-1">
		<table>
			<thead>
				<tr
					><th class="num">x</th><th class="num">Lower</th><th class="num">Mid-band</th><th
						class="num">Upper</th
					>{#if b <= 3}<th class="num">Nominal</th>{/if}</tr
				>
			</thead>
			<tbody>
				{#each bands as bd (bd.x)}
					<tr class:hit={bd.x === band.x}>
						<td class="num">{bd.x}</td>
						<td class="num">{formatSI(bd.lower, '', 4)}</td>
						<td class="num">{formatSI(bd.centre, '', 4)}</td>
						<td class="num">{formatSI(bd.upper, '', 4)}</td>
						{#if b <= 3}<td class="num">{formatSI(bd.nominal ?? NaN, '', 3)}</td>{/if}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<p class="note">
		Bands from 20 Hz to 20 kHz in Hz. Base 10 (G = 10<sup>0.3</sup> ≈ 1.99526) is the IEC
		61260-1:2014 / ANSI S1.11 preferred convention; base 2 (G = 2) is the musical one. Reference
		frequency f<sub>r</sub> = 1 kHz; band x = 0 is centred on (odd fractions) or starts at (even fractions)
		1 kHz.
	</p>

	{#snippet formula()}
		<Tex
			display
			math={'\\begin{gathered}N_\\text{oct}=\\log_2\\frac{f_2}{f_1},\\qquad N_\\text{dec}=\\log_{10}\\frac{f_2}{f_1}\\\\[7pt] \\text{cents}=1200\\log_2\\frac{f_2}{f_1}\\end{gathered}'}
		/>
		<Tex
			display
			math={'\\begin{gathered}f_m=f_r\\,G^{x/b}\\quad(b\\text{ odd})\\\\[7pt] f_m=f_r\\,G^{(2x+1)/(2b)}\\quad(b\\text{ even})\\\\[7pt] f_{1,2}=f_m\\,G^{\\mp 1/(2b)}\\end{gathered}'}
		/>
	{/snippet}
</CalcCard>

<style>
	.head-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 0.8rem;
	}
	.bands {
		max-height: 220px;
		overflow: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}
	.bands table {
		font-size: 0.82rem;
	}
	.bands th {
		position: sticky;
		top: 0;
	}
	.bands td,
	.bands th {
		padding: 0.2em 0.5em;
	}
	tr.hit td {
		background: var(--accent-wash);
		font-weight: 600;
	}
</style>
