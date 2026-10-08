<script lang="ts">
	import CalcCard from '../CalcCard.svelte';
	import Results from '../Results.svelte';
	import NumberInput from '$lib/components/controls/NumberInput.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import { formatSI, trimNumber } from '$lib/dsp/units';
	import { prewarpHz, unwarpHz } from '../math';

	let { id, title }: { id: string; title: string } = $props();

	let fs = $state(48000);
	let fd = $state(10000);
	const nyq = $derived(fs / 2);
	const fdc = $derived(Math.min(fd, nyq * 0.999999));
	const fa = $derived(prewarpHz(fdc, fs));
	const landed = $derived(unwarpHz(fdc, fs));
</script>

<CalcCard {id} {title} blurb="The bilinear transform squeezes 0…∞ Hz into 0…fs/2. Prewarping designs the analog prototype at fa so it lands exactly on fd.">
	<div class="fields">
		<NumberInput label="Sample rate fs" bind:value={fs} unit="Hz" si min={1e-9} logStep={1.05} />
		<NumberInput label="Digital frequency fd" value={fdc} unit="Hz" si min={0} max={nyq * 0.999999} logStep={1.05} onchange={(v) => (fd = v)} />
		<NumberInput label="Prewarped analog fa" value={fa} unit="Hz" si min={0} logStep={1.05} onchange={(v) => (fd = unwarpHz(v, fs))} />
		<NumberInput label="Prewarped Ωa" value={2 * Math.PI * fa} unit="rad/s" digits={7} min={0} logStep={1.05} onchange={(v) => (fd = unwarpHz(v / (2 * Math.PI), fs))} />
	</div>
	<Results
		rows={[
			{ label: 'Warping ratio fa / fd', value: fdc > 0 ? trimNumber(fa / fdc, 6) : '1' },
			{ label: 'Without prewarp, fd lands at', value: formatSI(landed, 'Hz', 5), hint: 'Where an analog design at fd ends up after the plain bilinear transform' },
			{ label: 'Error without prewarp', value: fdc > 0 ? `${trimNumber(((landed - fdc) / fdc) * 100, 4)} %` : '0 %' }
		]}
	/>

	{#snippet formula()}
		<Tex display math={'\\begin{gathered}s=2f_s\\frac{z-1}{z+1}\\;\\Rightarrow\\; \\Omega_a = 2f_s\\tan\\frac{\\omega_d}{2}\\\\[7pt] f_a=\\frac{f_s}{\\pi}\\tan\\frac{\\pi f_d}{f_s},\\qquad f_d=\\frac{f_s}{\\pi}\\arctan\\frac{\\pi f_a}{f_s}\\end{gathered}'} />
	{/snippet}
</CalcCard>
