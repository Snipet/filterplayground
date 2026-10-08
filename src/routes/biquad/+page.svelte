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
	import {
		BIQUAD_TYPES,
		biquad,
		biquadBandEdges,
		bwToQ,
		qToBw,
		type BiquadType
	} from '$lib/dsp/biquad';
	import { sos2zpk } from '$lib/dsp/convert';
	import { evaluate } from '$lib/dsp/response';
	import { formatSI, trimNumber } from '$lib/dsp/units';
	import { num } from '$lib/export';
	import { readSharedState } from '$lib/share';
	import { onMount } from 'svelte';
	import {
		FS_OPTIONS,
		F0_MIN,
		Q_MAX,
		Q_MIN,
		clampF0,
		clampQ,
		maxF0,
		restoreState
	} from '$lib/features/biquad/params';

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
		const r = restoreState({ type, fs, f0, q, gainDb }, st);
		type = r.type;
		fs = r.fs;
		f0 = r.f0;
		q = r.q;
		gainDb = r.gainDb;
	});

	const info = $derived(BIQUAD_TYPES.find((t) => t.id === type)!);
	// exact bandwidth of this digital filter (bilinear-warped), not the analog N(Q)
	const w0 = $derived((2 * Math.PI * f0) / fs);
	const bw = $derived(qToBw(q, w0));
	const bwRange = $derived({ min: qToBw(Q_MAX, w0), max: qToBw(Q_MIN, w0) });
	const edges = $derived(biquadBandEdges(f0, q, fs));
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
		f0 = clampF0(Number(x.toPrecision(4)), fs);
		if (info.usesGain) {
			// shelves reach half their gain at f0
			const g = type.includes('shelf') ? 2 * y : y;
			gainDb = Math.round(Math.max(-30, Math.min(30, g)) * 10) / 10;
		}
	}
	function setBw(v: number) {
		// ignore a blur-commit from the slider as it unmounts on a type change
		if (qMode === 'bw' && info.usesBw) q = clampQ(bwToQ(v, w0));
	}
	function onWheel(_id: string | number, dy: number) {
		if (!info.usesQ) return;
		q = Number(clampQ(q * Math.pow(1.1, -Math.sign(dy))).toPrecision(3));
	}

	const poleR = $derived(Math.max(...zpk.p.map((p) => Math.hypot(p.re, p.im))));
	const stats = $derived<Stat[]>([
		{
			label: 'Pole radius',
			value: trimNumber(poleR, 5),
			status: poleR < 1 ? 'good' : 'critical',
			hint: 'Must be < 1 for stability. Close to 1 = long ringing.'
		},
		{
			label: 'Pole angle',
			value: zpk.p.length
				? `${trimNumber((Math.abs(Math.atan2(zpk.p[0].im, zpk.p[0].re)) * 180) / Math.PI, 4)}°`
				: '—'
		},
		{ label: 'Gain at f₀', value: `${trimNumber(atF0, 4)} dB` },
		{
			label: 'Bandwidth',
			value: info.usesBw ? `${trimNumber(bw, 3)} oct` : '—',
			hint: info.usesBw
				? `Octaves between the ${type === 'peaking' ? 'half-gain (dB)' : '−3 dB'} points of this digital filter: ${formatSI(edges[0], 'Hz', 4)} and ${formatSI(edges[1], 'Hz', 4)}`
				: 'Only the band-pass, notch and peaking types have a bandwidth set by Q'
		},
		{
			label: 'Decay time (−60 dB)',
			value: poleR > 0 && poleR < 1 ? formatSI(Math.log(1e-3) / Math.log(poleR) / fs, 's', 3) : '—'
		}
	]);

	const fsOptions = FS_OPTIONS.map((v) => ({
		value: v,
		label: formatSI(v, 'Hz', 4)
	}));
	const typeOptions = BIQUAD_TYPES.map((t) => ({
		value: t.id,
		label: t.name,
		group: t.firstOrder ? 'First order' : 'Second order (biquad)'
	}));

	const differenceEq = $derived(
		`y[n] = ${num(sec[0], 6)}\\,x[n] ${sgn(sec[1])} ${num(Math.abs(sec[1]), 6)}\\,x[n-1] ${sgn(sec[2])} ${num(Math.abs(sec[2]), 6)}\\,x[n-2] ${sgn(-sec[4])} ${num(Math.abs(sec[4]), 6)}\\,y[n-1] ${sgn(-sec[5])} ${num(Math.abs(sec[5]), 6)}\\,y[n-2]`
	);
	function sgn(v: number) {
		return v < 0 ? '-' : '+';
	}

	const scipy = $derived(
		`# RBJ cookbook ${info.name}: f0=${f0} Hz, Q=${trimNumber(q, 4)}${info.usesGain ? `, gain=${gainDb} dB` : ''}, fs=${fs} Hz\nb = [${sec
			.slice(0, 3)
			.map((v) => num(v))
			.join(
				', '
			)}]\na = [1.0, ${num(sec[4])}, ${num(sec[5])}]\n\nfrom scipy import signal\ny = signal.lfilter(b, a, x)`
	);
</script>

<ToolLayout
	slug="biquad"
	share={shared}
	related={['parametric-eq', 'iir-designer', 'structures', 'quantization']}
>
	{#snippet controls()}
		<ControlGroup title="Type">
			<Select label="Filter type" bind:value={type} options={typeOptions} />
			<p class="small muted">{info.description}</p>
		</ControlGroup>
		<ControlGroup title="Parameters">
			<Slider label="Frequency f₀" bind:value={f0} min={F0_MIN} max={maxF0(fs)} log unit="Hz" />
			{#if info.usesQ}
				{#if info.usesBw}
					<Segmented
						size="small"
						bind:value={qMode}
						options={[
							{ value: 'q', label: 'Q' },
							{ value: 'bw', label: 'Bandwidth (oct)' }
						]}
					/>
				{/if}
				{#if qMode === 'bw' && info.usesBw}
					<Slider
						label="Bandwidth"
						bind:value={() => bw, setBw}
						min={bwRange.min}
						max={bwRange.max}
						log
						unit="oct"
					/>
				{:else}
					<Slider label="Q" bind:value={q} min={Q_MIN} max={Q_MAX} log />
				{/if}
			{/if}
			{#if info.usesGain}
				<Slider label="Gain" bind:value={gainDb} min={-30} max={30} step={0.1} unit="dB" />
			{/if}
			<Select
				label="Sample rate"
				bind:value={fs}
				options={fsOptions}
				onchange={(v) => (f0 = clampF0(f0, v))}
			/>
		</ControlGroup>
		<p class="small muted">
			Drag the handle on the magnitude plot{info.usesGain ? ' (up/down sets the gain)' : ''}; scroll
			over it to change Q.
		</p>
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

	<Card
		title="Coefficients"
		subtitle="Normalised so a₀ = 1 — this is the difference equation your code runs every sample."
	>
		<Tex display math={differenceEq} />
		<table class="coef">
			<thead><tr><th>b₀</th><th>b₁</th><th>b₂</th><th>a₁</th><th>a₂</th></tr></thead>
			<tbody>
				<tr>
					{#each [sec[0], sec[1], sec[2], sec[4], sec[5]] as v, i (i)}<td class="mono"
							>{num(v, 10)}</td
						>{/each}
				</tr>
			</tbody>
		</table>
	</Card>

	<Card title="Export">
		<ExportPanel
			kind="digital"
			{sos}
			{fs}
			recipes={[{ label: 'b / a', code: scipy }]}
			name="biquad"
		/>
	</Card>

	{#snippet theory()}
		<h2>Where the cookbook formulas come from</h2>
		<p>
			Each cookbook filter is a second-order <em>analog</em> prototype mapped to the z-plane with the
			bilinear transform, pre-warped so that f₀ lands exactly where you asked. The shared intermediate
			variables are:
		</p>
		<Tex
			display
			math={'\\omega_0 = 2\\pi\\frac{f_0}{f_s},\\qquad \\alpha = \\frac{\\sin\\omega_0}{2Q},\\qquad A = 10^{\\,\\text{gain}/40}'}
		/>
		<p>For example, the low-pass and peaking filters are</p>
		<Tex
			display
			math={'H_{LP}(z)=\\frac{\\frac{1-\\cos\\omega_0}{2}\\,(1+2z^{-1}+z^{-2})}{(1+\\alpha)-2\\cos\\omega_0\\,z^{-1}+(1-\\alpha)z^{-2}}'}
		/>
		<Tex
			display
			math={'H_{peak}(z)=\\frac{(1+\\alpha A)-2\\cos\\omega_0\\,z^{-1}+(1-\\alpha A)z^{-2}}{(1+\\alpha/A)-2\\cos\\omega_0\\,z^{-1}+(1-\\alpha/A)z^{-2}}'}
		/>
		<p>
			The second-order low-pass, high-pass, both band-pass, notch and all-pass types share the
			denominator
			<Tex math={'(1+\\alpha)-2\\cos\\omega_0\\,z^{-1}+(1-\\alpha)z^{-2}'} />, so for a given f₀ and
			Q they have the same poles: for Q &gt; ½ a complex pair at radius
			<Tex math={'r=\\sqrt{(1-\\alpha)/(1+\\alpha)}'} /> and angle θ with
			<Tex math={'\\cos\\theta=\\cos\\omega_0/\\sqrt{1-\\alpha^2}'} /> (≈ ω₀ when Q is high). The numerator
			decides the response type by where it puts the zeros: at z = −1 (low-pass), z = +1 (high-pass),
			z = ±1 (band-pass), on the unit circle at ±ω₀ (notch), or as reciprocals of the poles (all-pass).
			The peaking EQ uses α/A in its denominator instead, so its poles move with the gain and match the
			others only at 0 dB; the shelves have their own gain-dependent denominators.
		</p>
		<h3>Q, bandwidth and shelf slope</h3>
		<p>
			For the band-pass and notch filters the bandwidth N in octaves is measured between the −3 dB
			points (relative to the peak for band-pass); for the peaking EQ, between the points where the
			gain in dB is half its value at f₀. The analog prototype puts these points at
			<Tex math={'\\Omega_\\pm=\\sqrt{1+1/(4Q^2)}\\pm 1/(2Q)'} /> times its centre frequency, which gives
			the analog relation
		</p>
		<Tex display math={'\\frac{1}{Q} = 2\\sinh\\!\\left(\\frac{\\ln 2}{2}\\,N\\right)'} />
		<p>
			The bilinear transform maps Ω to the digital frequency ω with
			<Tex math={'\\tan(\\omega/2)=\\Omega\\tan(\\omega_0/2)'} />, which squeezes the band as f₀
			approaches Nyquist. The Bandwidth readout and slider use this exact mapping:
		</p>
		<Tex
			display
			math={'\\omega_\\pm = 2\\arctan\\!\\left(\\tan\\frac{\\omega_0}{2}\\left(\\sqrt{1+\\frac{1}{4Q^2}}\\pm\\frac{1}{2Q}\\right)\\right),\\qquad N=\\log_2\\frac{\\omega_+}{\\omega_-}'}
		/>
		<p>The cookbook approximates the same effect with the slope of the warping at ω₀:</p>
		<Tex
			display
			math={'\\frac{1}{Q} \\approx 2\\sinh\\!\\left(\\frac{\\ln 2}{2}\\,N\\,\\frac{\\omega_0}{\\sin\\omega_0}\\right)'}
		/>
		<p>
			This is accurate for narrow bands but drifts for wide ones near Nyquist: at fs = 48 kHz, f₀ =
			18 kHz and Q = 0.5 it gives 0.763 octaves, while the filter's −3 dB points are 0.835 octaves
			apart.
		</p>
		<Callout kind="try">
			<ul>
				<li>
					Push a low-pass f₀ close to fs/2: the bilinear transform squeezes the whole analog
					response into the band below Nyquist.
				</li>
				<li>
					Increase Q on the low-pass and watch the poles approach the unit circle — and the impulse
					response ring longer.
				</li>
				<li>
					Compare a notch and a band-pass with the same f₀ and Q: same poles, different zeros. Then
					set a peaking filter to +6 dB and −6 dB: the poles of one are the zeros of the other, so
					the cut exactly undoes the boost.
				</li>
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
