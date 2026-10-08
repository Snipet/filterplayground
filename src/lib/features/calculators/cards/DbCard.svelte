<script lang="ts">
	import CalcCard from '../CalcCard.svelte';
	import NumberInput from '$lib/components/controls/NumberInput.svelte';
	import Segmented from '$lib/components/controls/Segmented.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import { trimNumber } from '$lib/dsp/units';
	import { ampToDb, dbToAmp, powToDb, dbToPow, levelToVrms, levelsFromVrms } from '../math';

	let { id, title }: { id: string; title: string } = $props();

	let mode = $state<'ratio' | 'level'>('ratio');
	let db = $state(6);
	let vrms = $state(1);

	const lv = $derived(levelsFromVrms(vrms));
</script>

<CalcCard {id} {title} blurb="Edit any field — the others follow. Levels assume a sine wave for peak values.">
	{#snippet head()}
		<Segmented
			size="small"
			bind:value={mode}
			options={[
				{ value: 'ratio', label: 'Ratios' },
				{ value: 'level', label: 'Signal levels' }
			]}
		/>
	{/snippet}

	{#if mode === 'ratio'}
		<div class="fields three">
			<NumberInput label="Decibels" value={db} unit="dB" digits={6} onchange={(v) => (db = v)} />
			<NumberInput label="Amplitude ratio" value={dbToAmp(db)} min={1e-15} digits={6} logStep={1.1} onchange={(v) => (db = ampToDb(v))} />
			<NumberInput label="Power ratio" value={dbToPow(db)} min={1e-15} digits={6} logStep={1.1} onchange={(v) => (db = powToDb(v))} />
		</div>
		<p class="note">
			Amplitude ratio (voltage, current, pressure) = 10<sup>dB/20</sup>; power ratio = 10<sup>dB/10</sup> = amplitude².
			{#if Math.abs(db) > 0}Here {trimNumber(db, 4)} dB is ×{trimNumber(dbToAmp(db), 4)} in amplitude and ×{trimNumber(dbToPow(db), 4)} in power.{/if}
		</p>
	{:else}
		<div class="fields three">
			<NumberInput label="V rms" value={vrms} unit="V" si min={1e-12} logStep={1.1} onchange={(v) => (vrms = v)} />
			<NumberInput label="V peak" value={lv.vpk} unit="V" si min={1e-12} logStep={1.1} onchange={(v) => (vrms = levelToVrms(v, 'Vpk'))} />
			<NumberInput label="V peak-to-peak" value={lv.vpp} unit="V" si min={1e-12} logStep={1.1} onchange={(v) => (vrms = levelToVrms(v, 'Vpp'))} />
			<NumberInput label="dBV (re 1 V)" value={lv.dBV} unit="dBV" onchange={(v) => (vrms = levelToVrms(v, 'dBV'))} />
			<NumberInput label="dBu (re 0.775 V)" value={lv.dBu} unit="dBu" onchange={(v) => (vrms = levelToVrms(v, 'dBu'))} />
			<NumberInput label="dBm @ 600 Ω" value={lv.dBm600} unit="dBm" onchange={(v) => (vrms = levelToVrms(v, 'dBm600'))} />
			<NumberInput label="dBm @ 50 Ω" value={lv.dBm50} unit="dBm" onchange={(v) => (vrms = levelToVrms(v, 'dBm50'))} />
			<NumberInput label="Power into 600 Ω" value={lv.p600 * 1e3} unit="mW" digits={6} min={1e-15} logStep={1.1} onchange={(v) => (vrms = Math.sqrt(v * 1e-3 * 600))} />
			<NumberInput label="Power into 50 Ω" value={lv.p50 * 1e3} unit="mW" digits={6} min={1e-15} logStep={1.1} onchange={(v) => (vrms = Math.sqrt(v * 1e-3 * 50))} />
		</div>
	{/if}

	{#snippet formula()}
		{#if mode === 'ratio'}
			<Tex display math={'L = 20\\log_{10}\\frac{V_2}{V_1} = 10\\log_{10}\\frac{P_2}{P_1}'} />
		{:else}
			<Tex display math={'\\begin{gathered}\\text{dBV}=20\\log_{10}\\frac{V_\\text{rms}}{1\\,\\text{V}}\\\\[7pt] \\text{dBu}=20\\log_{10}\\frac{V_\\text{rms}}{\\sqrt{0.6}\\,\\text{V}}\\\\[7pt] \\text{dBm}=10\\log_{10}\\frac{V_\\text{rms}^2/R}{1\\,\\text{mW}}\\end{gathered}'} />
			<p class="small muted">0 dBu is the voltage that dissipates 1 mW in 600 Ω, so dBu = dBm @ 600 Ω. dBV = dBu − 2.218 dB.</p>
		{/if}
	{/snippet}
</CalcCard>
