<script lang="ts">
	import CalcCard from '../CalcCard.svelte';
	import NumberInput from '$lib/components/controls/NumberInput.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import {
		attenToDelta,
		deltaOneToRipple,
		deltaSymToRipple,
		deltaToAtten,
		epsToRipple,
		returnLossToRho,
		rhoToReturnLoss,
		rhoToRipple,
		rhoToVswr,
		rippleToDeltaOne,
		rippleToDeltaSym,
		rippleToEps,
		rippleToRho,
		vswrToRho
	} from '../math';

	let { id, title }: { id: string; title: string } = $props();

	let rp = $state(0.5);
	let rs = $state(60);
	const rho = $derived(rippleToRho(rp));
	const MIN_RP = 1e-9;
</script>

<CalcCard {id} {title} blurb="Edit any field. The return-loss/VSWR row applies to lossless, doubly-terminated (LC ladder) filters.">
	<p class="sub">Passband</p>
	<div class="fields three">
		<NumberInput label="Ripple Rp" value={rp} unit="dB" min={MIN_RP} digits={6} logStep={1.1} onchange={(v) => (rp = v)} />
		<NumberInput label="Ripple factor ε" value={rippleToEps(rp)} min={1e-6} digits={6} logStep={1.1} onchange={(v) => (rp = epsToRipple(v))} />
		<NumberInput label="δp (1 ± δp)" value={rippleToDeltaSym(rp)} min={1e-9} max={0.999999} digits={6} logStep={1.1} onchange={(v) => (rp = deltaSymToRipple(v))} help="FIR / Parks–McClellan" />
		<NumberInput label="δp (1 − δp … 1)" value={rippleToDeltaOne(rp)} min={1e-9} max={0.999999} digits={6} logStep={1.1} onchange={(v) => (rp = deltaOneToRipple(v))} help="IIR convention" />
		<NumberInput label="Reflection |ρ|" value={rho} min={1e-6} max={0.999999} digits={6} logStep={1.1} onchange={(v) => (rp = rhoToRipple(v))} />
		<NumberInput label="Return loss" value={rhoToReturnLoss(rho)} unit="dB" min={1e-6} digits={5} onchange={(v) => (rp = rhoToRipple(returnLossToRho(v)))} />
		<NumberInput label="VSWR" value={rhoToVswr(rho)} min={1.000001} digits={6} logStep={1.02} onchange={(v) => (rp = rhoToRipple(vswrToRho(v)))} />
	</div>
	<p class="sub">Stopband</p>
	<div class="fields three">
		<NumberInput label="Attenuation Rs" value={rs} unit="dB" min={0} digits={6} onchange={(v) => (rs = v)} />
		<NumberInput label="δs (peak gain)" value={attenToDelta(rs)} min={1e-15} max={1} digits={6} logStep={1.1} onchange={(v) => (rs = deltaToAtten(v))} />
		<NumberInput label="δs in %" value={100 * attenToDelta(rs)} unit="%" min={1e-13} max={100} digits={6} logStep={1.1} onchange={(v) => (rs = deltaToAtten(v / 100))} />
	</div>

	{#snippet formula()}
		<Tex display math={'\\begin{gathered}\\varepsilon=\\sqrt{10^{R_p/10}-1},\\qquad \\delta_s=10^{-R_s/20}\\\\[7pt] R_p=20\\log_{10}\\frac{1+\\delta_p}{1-\\delta_p}\\\\[7pt] R_p=-20\\log_{10}(1-\\delta_p)\\\\[7pt] |\\rho|=\\sqrt{1-10^{-R_p/10}}=\\frac{\\varepsilon}{\\sqrt{1+\\varepsilon^2}}\\\\[7pt] RL=-20\\log_{10}|\\rho|,\\qquad \\text{VSWR}=\\frac{1+|\\rho|}{1-|\\rho|}\\end{gathered}'} />
	{/snippet}
</CalcCard>
