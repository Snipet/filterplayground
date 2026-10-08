<script lang="ts">
	import CalcCard from '../CalcCard.svelte';
	import Results from '../Results.svelte';
	import NumberInput from '$lib/components/controls/NumberInput.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import { formatSI, trimNumber } from '$lib/dsp/units';
	import { bandEdges, bwHzToQ, lowpassPeak, octavesToQ, overshoot, qToBwHz, qToOctaves, qToZeta, zetaToQ } from '../math';

	let { id, title }: { id: string; title: string } = $props();

	let f0 = $state(1000);
	let q = $state(Math.SQRT1_2);

	const edges = $derived(bandEdges(f0, q));
	const zeta = $derived(qToZeta(q));
	const peak = $derived(lowpassPeak(f0, q));
	const os = $derived(overshoot(zeta));
</script>

<CalcCard {id} {title} blurb="Edit Q, ζ or either bandwidth — the others follow. Bandwidth is between the −3 dB points of a second-order resonance.">
	<div class="fields">
		<NumberInput label="Centre / natural frequency f₀" bind:value={f0} unit="Hz" si min={1e-9} logStep={1.05} />
		<NumberInput label="Quality factor Q" value={q} min={1e-6} digits={6} logStep={1.05} onchange={(v) => (q = v)} />
		<NumberInput label="Damping ratio ζ" value={zeta} min={1e-6} digits={6} logStep={1.05} onchange={(v) => (q = zetaToQ(v))} />
		<NumberInput label="Bandwidth (Hz)" value={qToBwHz(f0, q)} unit="Hz" si min={1e-9} logStep={1.05} onchange={(v) => (q = bwHzToQ(f0, v))} />
		<NumberInput label="Bandwidth (octaves)" value={qToOctaves(q)} unit="oct" min={1e-6} digits={6} logStep={1.05} onchange={(v) => (q = octavesToQ(v))} />
	</div>
	<Results
		rows={[
			{ label: 'Lower −3 dB frequency', value: formatSI(edges[0], 'Hz', 5), primary: true },
			{ label: 'Upper −3 dB frequency', value: formatSI(edges[1], 'Hz', 5), primary: true },
			{ label: 'Step overshoot (2nd-order LP)', value: `${trimNumber(os * 100, 4)} %`, hint: 'e^(−πζ/√(1−ζ²)) for ζ < 1, none otherwise' },
			{ label: 'LP resonant peak', value: peak ? `${trimNumber(20 * Math.log10(peak.gain), 4)} dB @ ${formatSI(peak.fr, 'Hz', 4)}` : 'none (Q ≤ 0.707)', hint: 'Peak of ω₀²/(s² + ω₀s/Q + ω₀²)' },
			{ label: 'Damping', value: zeta < 1 ? 'under-damped' : zeta === 1 ? 'critically damped' : 'over-damped' }
		]}
	/>

	{#snippet formula()}
		<Tex display math={'\\begin{gathered}Q=\\frac{1}{2\\zeta}=\\frac{f_0}{f_h-f_l}\\\\[7pt] f_{l,h}=f_0\\left(\\sqrt{1+\\frac{1}{4Q^2}}\\mp\\frac{1}{2Q}\\right)\\\\[7pt] N_\\text{oct}=\\log_2\\frac{f_h}{f_l}=\\frac{2}{\\ln 2}\\operatorname{asinh}\\frac{1}{2Q}\\\\[7pt] Q=\\frac{\\sqrt{2^{N}}}{2^{N}-1}\\end{gathered}'} />
		<p class="small muted">The edges are geometric-symmetric: f<sub>l</sub>·f<sub>h</sub> = f₀². Digital cookbook biquads use a bilinear-warped version of the octave formula.</p>
	{/snippet}
</CalcCard>
