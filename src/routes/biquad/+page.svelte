<script lang="ts">
	import ToolLayout from '$lib/components/layout/ToolLayout.svelte';
	import ControlGroup from '$lib/components/layout/ControlGroup.svelte';
	import Card from '$lib/components/layout/Card.svelte';
	import Select from '$lib/components/controls/Select.svelte';
	import Segmented from '$lib/components/controls/Segmented.svelte';
	import Slider from '$lib/components/controls/Slider.svelte';
	import ResponseView from '$lib/components/plot/ResponseView.svelte';
	import StatGrid, { type Stat } from '$lib/components/content/StatGrid.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import Callout from '$lib/components/content/Callout.svelte';
	import ExportPanel from '$lib/components/content/ExportPanel.svelte';
	import { BIQUAD_TYPES, biquad, bwToQ, qToBw, type BiquadType } from '$lib/dsp/biquad';
	import { sos2zpk } from '$lib/dsp/convert';
	import { evaluate } from '$lib/dsp/response';
	import { formatSI, trimNumber } from '$lib/dsp/units';
	import { num } from '$lib/export';
	import { readSharedState } from '$lib/share';
	import { onMount } from 'svelte';

	let type = $state<BiquadType>('peaking');
	let fs = $state(48000);
	let f0 = $state(1000);
	let q = $state(1.0);
	let gainDb = $state(6);
	let qMode = $state<'q' | 'bw'>('q');

	const shared = $derived({ type, fs, f0, q, gainDb });
	onMount(() => {
		const st = readSharedState<typeof shared>();
		if (!st) return;
		if (st.type && BIQUAD_TYPES.some((t) => t.id === st.type)) type = st.type;
		if (typeof st.fs === 'number' && st.fs > 0) fs = st.fs;
		if (typeof st.f0 === 'number' && st.f0 > 0) f0 = st.f0;
		if (typeof st.q === 'number' && st.q > 0) q = st.q;
		if (typeof st.gainDb === 'number') gainDb = st.gainDb;
	});

	const info = $derived(BIQUAD_TYPES.find((t) => t.id === type)!);
	const bw = $derived(qToBw(q));
	const sec = $derived(biquad({ type, f0, fs, q, gainDb }));
	const sos = $derived([sec]);
	const filter = $derived({ kind: 'digital' as const, fs, sos });
	const zpk = $derived(sos2zpk(sos));

	const atF0 = $derived(evaluate(filter, [f0]).magDb[0]);
	const markers = $derived([
		{
			id: 'f0',
			x: f0,
			y: Number.isFinite(atF0) ? Math.max(atF0, -60) : -60,
			draggable: true,
			axis: info.usesGain ? ('xy' as const) : ('x' as const),
			color: 'var(--s2)'
		}
	]);

	function onDrag(_id: string | number, x: number, y: number) {
		f0 = Number(Math.min(fs / 2 * 0.98, Math.max(10, x)).toPrecision(4));
		if (info.usesGain) {
			// shelves reach half their gain at f0
			const g = type.includes('shelf') ? 2 * y : y;
			gainDb = Math.round(Math.max(-30, Math.min(30, g)) * 10) / 10;
		}
	}
	function onWheel(_id: string | number, dy: number) {
		if (!info.usesQ) return;
		q = Number(Math.min(50, Math.max(0.1, q * Math.pow(1.1, -Math.sign(dy)))).toPrecision(3));
	}

	const poleR = $derived(Math.max(...zpk.p.map((p) => Math.hypot(p.re, p.im))));
	const stats = $derived<Stat[]>([
		{ label: 'Pole radius', value: trimNumber(poleR, 5), status: poleR < 1 ? 'good' : 'critical', hint: 'Must be < 1 for stability. Close to 1 = long ringing.' },
		{ label: 'Pole angle', value: zpk.p.length ? `${trimNumber((Math.abs(Math.atan2(zpk.p[0].im, zpk.p[0].re)) * 180) / Math.PI, 4)}°` : '—' },
		{ label: 'Gain at f₀', value: `${trimNumber(atF0, 4)} dB` },
		{ label: 'Bandwidth', value: info.usesQ ? `${trimNumber(bw, 3)} oct` : '—', hint: 'Bandwidth in octaves equivalent to Q (bilinear-warped definition)' },
		{ label: 'Decay time (−60 dB)', value: poleR > 0 && poleR < 1 ? formatSI(Math.log(1e-3) / Math.log(poleR) / fs, 's', 3) : '—' }
	]);

	const fsOptions = [8000, 16000, 22050, 32000, 44100, 48000, 88200, 96000, 192000].map((v) => ({ value: v, label: formatSI(v, 'Hz', 4) }));
	const typeOptions = BIQUAD_TYPES.map((t) => ({ value: t.id, label: t.name, group: t.firstOrder ? 'First order' : 'Second order (biquad)' }));

	const differenceEq = $derived(
		`y[n] = ${num(sec[0], 6)}\\,x[n] ${sgn(sec[1])} ${num(Math.abs(sec[1]), 6)}\\,x[n-1] ${sgn(sec[2])} ${num(Math.abs(sec[2]), 6)}\\,x[n-2] ${sgn(-sec[4])} ${num(Math.abs(sec[4]), 6)}\\,y[n-1] ${sgn(-sec[5])} ${num(Math.abs(sec[5]), 6)}\\,y[n-2]`
	);
	function sgn(v: number) {
		return v < 0 ? '-' : '+';
	}

	const scipy = $derived(
		`# RBJ cookbook ${info.name}: f0=${f0} Hz, Q=${trimNumber(q, 4)}${info.usesGain ? `, gain=${gainDb} dB` : ''}, fs=${fs} Hz\nb = [${sec.slice(0, 3).map((v) => num(v)).join(', ')}]\na = [1.0, ${num(sec[4])}, ${num(sec[5])}]\n\nfrom scipy import signal\ny = signal.lfilter(b, a, x)`
	);
</script>

<ToolLayout slug="biquad" share={shared} related={['parametric-eq', 'iir-designer', 'structures', 'quantization']}>
	{#snippet controls()}
		<ControlGroup title="Type">
			<Select label="Filter type" bind:value={type} options={typeOptions} />
			<p class="small muted">{info.description}</p>
		</ControlGroup>
		<ControlGroup title="Parameters">
			<Slider label="Frequency f₀" bind:value={f0} min={10} max={fs / 2 * 0.98} log unit="Hz" />
			{#if info.usesQ}
				<Segmented
					size="small"
					bind:value={qMode}
					options={[
						{ value: 'q', label: 'Q' },
						{ value: 'bw', label: 'Bandwidth (oct)' }
					]}
				/>
				{#if qMode === 'q'}
					<Slider label="Q" bind:value={q} min={0.1} max={50} log />
				{:else}
					<Slider label="Bandwidth" value={bw} min={0.05} max={6} log unit="oct" onchange={(v) => (q = bwToQ(v))} />
				{/if}
			{/if}
			{#if info.usesGain}
				<Slider label="Gain" bind:value={gainDb} min={-30} max={30} step={0.1} unit="dB" />
			{/if}
			<Select label="Sample rate" bind:value={fs} options={fsOptions} />
		</ControlGroup>
		<p class="small muted">Drag the handle on the magnitude plot{info.usesGain ? ' (up/down sets the gain)' : ''}; scroll over it to change Q.</p>
	{/snippet}

	<StatGrid {stats} />

	<ResponseView
		filters={[{ filter, label: info.name }]}
		{markers}
		onmarkerdrag={onDrag}
		onmarkerwheel={onWheel}
		xScale="log"
		fmin={10}
		views={['phase', 'groupDelay', 'pz', 'impulse']}
	/>

	<Card title="Coefficients" subtitle="Normalised so a₀ = 1 — this is the difference equation your code runs every sample.">
		<Tex display math={differenceEq} />
		<table class="coef">
			<thead><tr><th>b₀</th><th>b₁</th><th>b₂</th><th>a₁</th><th>a₂</th></tr></thead>
			<tbody>
				<tr>
					{#each [sec[0], sec[1], sec[2], sec[4], sec[5]] as v, i (i)}<td class="mono">{num(v, 10)}</td>{/each}
				</tr>
			</tbody>
		</table>
	</Card>

	<Card title="Export">
		<ExportPanel kind="digital" {sos} {fs} recipes={[{ label: 'b / a', code: scipy }]} name="biquad" />
	</Card>

	{#snippet theory()}
		<h2>Where the cookbook formulas come from</h2>
		<p>
			Each cookbook filter is a second-order <em>analog</em> prototype mapped to the z-plane with the bilinear transform,
			pre-warped so that f₀ lands exactly where you asked. The shared intermediate variables are:
		</p>
		<Tex display math={'\\omega_0 = 2\\pi\\frac{f_0}{f_s},\\qquad \\alpha = \\frac{\\sin\\omega_0}{2Q},\\qquad A = 10^{\\,\\text{gain}/40}'} />
		<p>For example, the low-pass and peaking filters are</p>
		<Tex display math={'H_{LP}(z)=\\frac{\\frac{1-\\cos\\omega_0}{2}\\,(1+2z^{-1}+z^{-2})}{(1+\\alpha)-2\\cos\\omega_0\\,z^{-1}+(1-\\alpha)z^{-2}}'} />
		<Tex display math={'H_{peak}(z)=\\frac{(1+\\alpha A)-2\\cos\\omega_0\\,z^{-1}+(1-\\alpha A)z^{-2}}{(1+\\alpha/A)-2\\cos\\omega_0\\,z^{-1}+(1-\\alpha/A)z^{-2}}'} />
		<p>
			All second-order types share the same denominator, so they have the same poles for a given f₀ and Q. The poles sit at
			radius <Tex math={'r=\\sqrt{(1-\\alpha)/(1+\\alpha)}'} /> and angle ≈ ω₀. The numerator decides the response type by
			where it puts the zeros: at z = −1 (low-pass), z = +1 (high-pass), on the unit circle at ±ω₀ (notch), or as
			reciprocals of the poles (all-pass).
		</p>
		<h3>Q, bandwidth and shelf slope</h3>
		<p>The cookbook relates Q to the bandwidth N in octaves (measured between the half-gain points in the warped domain):</p>
		<Tex display math={'\\frac{1}{Q} = 2\\sinh\\!\\left(\\frac{\\ln 2}{2}\\,N\\,\\frac{\\omega_0}{\\sin\\omega_0}\\right)'} />
		<Callout kind="try">
			<ul>
				<li>Push a low-pass f₀ close to fs/2: the bilinear transform squeezes the whole analog response into the band below Nyquist.</li>
				<li>Increase Q on the low-pass and watch the poles approach the unit circle — and the impulse response ring longer.</li>
				<li>Compare a notch and a peaking filter with −30 dB gain: same poles, different zeros.</li>
			</ul>
		</Callout>
	{/snippet}
</ToolLayout>

<style>
	.coef td {
		font-size: 0.82rem;
		overflow-wrap: anywhere;
	}
</style>
