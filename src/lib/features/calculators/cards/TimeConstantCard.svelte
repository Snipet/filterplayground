<script lang="ts">
	import CalcCard from '../CalcCard.svelte';
	import Results from '../Results.svelte';
	import NumberInput from '$lib/components/controls/NumberInput.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import { formatSI, trimNumber } from '$lib/dsp/units';
	import { cutoffFromTau, riseTime1090, settledFraction, tauFromCutoff, timeToFraction } from '../math';

	let { id, title }: { id: string; title: string } = $props();

	let tau = $state(1e-3);
	let t = $state(3e-3);
	let pct = $state(99);

	const multiples = [1, 2, 3, 4, 5, 7];
</script>

<CalcCard {id} {title} blurb="Step response of any first-order system (RC, RL, one-pole smoother): y(t) = 1 − e^(−t/τ).">
	<div class="fields">
		<NumberInput label="Time constant τ" value={tau} unit="s" si min={1e-18} logStep={1.05} onchange={(v) => (tau = v)} />
		<NumberInput label="or −3 dB frequency f₋₃dB" value={cutoffFromTau(tau)} unit="Hz" si min={1e-12} logStep={1.05} onchange={(v) => (tau = tauFromCutoff(v))} />
		<NumberInput label="Elapsed time t" bind:value={t} unit="s" si min={0} logStep={1.05} />
		<NumberInput label="Target level x" bind:value={pct} unit="%" min={1e-9} max={99.9999999} digits={8} />
	</div>
	<Results
		rows={[
			{ label: 'Settled after t', value: `${trimNumber(100 * settledFraction(t, tau), 6)} %`, primary: true },
			{ label: 'Remaining error after t', value: `${trimNumber(100 * Math.exp(-t / tau), 4)} %` },
			{ label: `Time to reach ${trimNumber(pct, 6)} %`, value: `${formatSI(timeToFraction(pct / 100, tau), 's', 4)} (${trimNumber(timeToFraction(pct / 100, 1), 4)} τ)`, primary: true },
			{ label: '10–90 % rise time', value: formatSI(riseTime1090(tau), 's', 4), hint: 'τ·ln 9 ≈ 2.197 τ ≈ 0.35 / f₋₃dB' }
		]}
	/>
	<div class="wrap">
		<table>
			<thead><tr><th>t</th>{#each multiples as m (m)}<th class="num">{m}τ</th>{/each}</tr></thead>
			<tbody>
				<tr><td>Reached</td>{#each multiples as m (m)}<td class="num">{trimNumber(100 * settledFraction(m, 1), 4)} %</td>{/each}</tr>
			</tbody>
		</table>
	</div>

	{#snippet formula()}
		<Tex display math={'\\begin{gathered}y(t)=1-e^{-t/\\tau}\\\\[7pt] t_x=-\\tau\\ln\\!\\left(1-\\frac{x}{100}\\right)\\\\[7pt] t_{r}=\\tau\\ln 9\\approx 2.2\\,\\tau\\approx\\frac{0.35}{f_{-3\\,\\text{dB}}}\\end{gathered}'} />
	{/snippet}
</CalcCard>

<style>
	.wrap {
		overflow-x: auto;
	}
	table {
		font-size: 0.82rem;
	}
	td,
	th {
		padding: 0.25em 0.4em;
		white-space: nowrap;
	}
</style>
