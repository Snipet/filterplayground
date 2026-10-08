<script lang="ts">
	import ToolLayout from '$lib/components/layout/ToolLayout.svelte';
	import ControlGroup from '$lib/components/layout/ControlGroup.svelte';
	import Card from '$lib/components/layout/Card.svelte';
	import Segmented from '$lib/components/controls/Segmented.svelte';
	import NumberInput from '$lib/components/controls/NumberInput.svelte';
	import Plot, { type Series } from '$lib/components/plot/Plot.svelte';
	import StatGrid, { type Stat } from '$lib/components/content/StatGrid.svelte';
	import Callout from '$lib/components/content/Callout.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import CodeBlock from '$lib/components/content/CodeBlock.svelte';
	import { freqFormat, seriesColor } from '$lib/components/plot/scales';
	import { evaluate, linspace, logspace } from '$lib/dsp/response';
	import { formatSI, trimNumber } from '$lib/dsp/units';
	import type { AnalogFamily } from '$lib/dsp/analog';
	import type { BandType } from '$lib/dsp/types';
	import { specRegions } from '$lib/specmask';
	import { toolHref } from '$lib/paths';
	import {
		discrimination,
		firMults,
		firResults,
		iirResults,
		isBand as isBandType,
		selectivity,
		transitionHz,
		validateSpec,
		WINDOW_RULES,
		type OrderSpec
	} from '$lib/features/order-calculator/compute';

	type Edges = { fp: [number, number]; fst: [number, number] };

	let domain = $state<'analog' | 'digital'>('digital');
	let fs = $state(48000);
	let band = $state<BandType>('lowpass');
	let rp = $state(1);
	let rs = $state(60);
	let edges = $state<Record<BandType, Edges>>({
		lowpass: { fp: [1000, 1000], fst: [2000, 2000] },
		highpass: { fp: [2000, 2000], fst: [1000, 1000] },
		bandpass: { fp: [1000, 2000], fst: [700, 3000] },
		bandstop: { fp: [700, 3000], fst: [1000, 2000] }
	});

	const isBand = $derived(isBandType(band));
	const spec = $derived<OrderSpec>({
		domain,
		fs,
		band,
		fp: [...edges[band].fp],
		fst: [...edges[band].fst],
		rp,
		rs
	});
	const error = $derived(validateSpec(spec));

	const iir = $derived(error ? [] : iirResults(spec));
	const fir = $derived(!error && domain === 'digital' ? firResults(spec) : null);

	// ---------- examples ----------
	interface Example {
		label: string;
		domain: 'analog' | 'digital';
		fs?: number;
		band: BandType;
		fp: [number, number];
		fst: [number, number];
		rp: number;
		rs: number;
	}
	const EXAMPLES: Example[] = [
		{
			label: 'Anti-alias for a 48 kHz ADC',
			domain: 'analog',
			band: 'lowpass',
			fp: [20000, 20000],
			fst: [28000, 28000],
			rp: 0.1,
			rs: 60
		},
		{
			label: 'Decimate 48 → 12 kHz',
			domain: 'digital',
			fs: 48000,
			band: 'lowpass',
			fp: [5000, 5000],
			fst: [6000, 6000],
			rp: 0.1,
			rs: 80
		},
		{
			label: 'Telephone band (8 kHz)',
			domain: 'digital',
			fs: 8000,
			band: 'bandpass',
			fp: [300, 3400],
			fst: [200, 3700],
			rp: 0.5,
			rs: 40
		},
		{
			label: 'Rumble high-pass',
			domain: 'digital',
			fs: 48000,
			band: 'highpass',
			fp: [40, 40],
			fst: [20, 20],
			rp: 0.5,
			rs: 40
		},
		{
			label: '50 Hz hum reject',
			domain: 'digital',
			fs: 1000,
			band: 'bandstop',
			fp: [40, 62],
			fst: [48, 52],
			rp: 1,
			rs: 40
		}
	];
	function loadExample(ex: Example) {
		domain = ex.domain;
		if (ex.fs) fs = ex.fs;
		band = ex.band;
		edges[ex.band] = { fp: [...ex.fp], fst: [...ex.fst] };
		rp = ex.rp;
		rs = ex.rs;
	}

	// ---------- summary ----------
	const best = $derived.by(() => {
		const ok = iir.filter((r) => !r.capped);
		if (!ok.length) return null;
		return ok.reduce((a, b) => (b.order < a.order ? b : a));
	});
	const bestFir = $derived.by(() => {
		if (!fir) return null;
		const ok = fir.rows.filter((r) => r.meets);
		return ok.reduce((a, b) => (b.taps < a.taps ? b : a));
	});

	const stats = $derived.by((): Stat[] => {
		if (error) return [];
		const sel = selectivity(spec);
		const k1 = discrimination(rp, rs);
		const tw = transitionHz(spec);
		const out: Stat[] = [
			{
				label: 'Selectivity Ωs = 1/k',
				value: trimNumber(sel, 5),
				hint:
					'Stopband edge of the equivalent normalised low-pass prototype (passband edge = 1)' +
					(domain === 'digital' ? ', after bilinear prewarping' : '')
			},
			{
				label: 'Discrimination 1/k₁',
				value: `${trimNumber(1 / k1, 4)} (${trimNumber(20 * Math.log10(1 / k1), 4)} dB)`,
				hint: 'k₁ = εp/εs = √((10^(Rp/10) − 1)/(10^(Rs/10) − 1))'
			},
			{
				label: 'Transition width',
				value:
					domain === 'digital'
						? `${formatSI(tw, 'Hz', 4)} = ${trimNumber(tw / fs, 4)}·fs`
						: `${formatSI(tw, 'Hz', 4)} (${trimNumber(Math.log2(sel), 3)} oct)`
			}
		];
		if (best)
			out.push({
				label: 'Lowest-order IIR',
				value: `${best.name.split(' (')[0]}, N = ${best.order}`
			});
		if (bestFir)
			out.push({
				label: 'Shortest FIR',
				value: `${bestFir.method.replace(' (equiripple)', '')}, ${bestFir.taps} taps`
			});
		return out;
	});

	// ---------- plots ----------
	const DEFAULT_ON: AnalogFamily[] = ['butter', 'cheby1', 'cheby2', 'ellip', 'bessel'];
	let shown = $state<Record<string, boolean>>(
		Object.fromEntries(
			['butter', 'cheby1', 'cheby2', 'ellip', 'bessel', 'legendre', 'gaussian', 'critical'].map(
				(f) => [f, DEFAULT_ON.includes(f as AnalogFamily)]
			)
		)
	);
	let xScaleSel = $state<'auto' | 'log' | 'linear'>('auto');
	// auto: log for analog, and for digital specs whose edges all sit in the bottom eighth of the band
	const xScale = $derived<'log' | 'linear'>(
		xScaleSel === 'auto'
			? domain === 'analog' || Math.max(...edges[band].fp, ...edges[band].fst) < fs / 16
				? 'log'
				: 'linear'
			: xScaleSel
	);

	const allEdges = $derived([...spec.fp, ...spec.fst]);
	const xRange = $derived.by((): [number, number] => {
		const lo = Math.min(...allEdges);
		const hi = Math.max(...allEdges);
		if (domain === 'analog') return [lo / 10, hi * 10];
		return xScale === 'log' ? [lo / 10, fs / 2] : [0, fs / 2];
	});
	const grid = $derived(
		xScale === 'log' ? logspace(xRange[0], xRange[1], 700) : linspace(xRange[0], xRange[1], 700)
	);

	const series = $derived<Series[]>(
		iir
			.filter((r) => shown[r.family])
			.map((r) => ({
				x: grid,
				y: evaluate(r.filter, grid).magDb,
				label: `${r.name.split(' (')[0]} (N = ${r.order}${r.capped ? ', fails' : ''})`,
				color: seriesColor(r.index),
				dash: r.capped ? '6 4' : undefined,
				format: (v: number) => `${trimNumber(v, 4)} dB`
			}))
	);

	const regions = $derived(
		error
			? []
			: specRegions(band, isBand ? spec.fp : spec.fp[0], isBand ? spec.fst : spec.fst[0], rp, rs)
	);
	const yMain = $derived<[number, number]>([-Math.ceil((rs + 40) / 10) * 10, 5]);
	const yPass = $derived<[number, number]>([-(2 * rp + 0.2), Math.max(0.3, 0.5 * rp)]);
	const passX = $derived.by((): [number, number] => {
		const [s1, s2] = spec.fst;
		switch (band) {
			case 'lowpass':
				return [xRange[0], s1];
			case 'highpass':
				return [s1, xRange[1]];
			case 'bandpass':
				return [s1, s2];
			case 'bandstop':
				return xRange;
		}
	});
	const hz = (v: number) => formatSI(v, 'Hz', 4);

	// ---------- table helpers ----------
	const cutoffText = (r: (typeof iir)[number]) =>
		r.f2 !== undefined
			? `${formatSI(r.f1, 'Hz', 5)} – ${formatSI(r.f2, 'Hz', 5)}`
			: formatSI(r.f1, 'Hz', 5);
	const passOk = (v: number) => v <= rp + 1e-6;
	const stopOk = (v: number) => v >= rs - 1e-2;
	const shortName = (n: string) => n.split(' (')[0];
	const db = (v: number) => (Number.isFinite(v) ? `${trimNumber(v, 4)} dB` : '∞ dB');

	// ---------- SciPy ----------
	const scipy = $derived.by(() => {
		if (error) return '';
		const arr = (a: number[]) =>
			a.length === 1 ? trimNumber(a[0], 8) : `[${a.map((v) => trimNumber(v, 8)).join(', ')}]`;
		const wp = isBand ? arr(spec.fp) : arr([spec.fp[0]]);
		const ws = isBand ? arr(spec.fst) : arr([spec.fst[0]]);
		const lines =
			domain === 'digital'
				? [
						'from scipy import signal',
						'',
						`fs = ${fs}`,
						`wp, ws = ${wp}, ${ws}   # Hz`,
						`Rp, Rs = ${rp}, ${rs}   # dB`,
						'',
						...['buttord', 'cheb1ord', 'cheb2ord', 'ellipord'].map(
							(f) => `N, Wn = signal.${f}(wp, ws, Rp, Rs, fs=fs)`
						),
						'',
						'# Kaiser window: width is relative to Nyquist',
						`numtaps, beta = signal.kaiserord(${trimNumber(fir?.kaiserA ?? rs, 6)}, ${trimNumber((2 * transitionHz(spec)) / fs, 6)})`
					]
				: [
						'import numpy as np',
						'from scipy import signal',
						'',
						`wp = 2 * np.pi * np.array(${wp})   # rad/s`,
						`ws = 2 * np.pi * np.array(${ws})`,
						`Rp, Rs = ${rp}, ${rs}   # dB`,
						'',
						...['buttord', 'cheb1ord', 'cheb2ord', 'ellipord'].map(
							(f) => `N, Wn = signal.${f}(wp, ws, Rp, Rs, analog=True)`
						)
					];
		return lines.join('\n');
	});
</script>

<ToolLayout
	slug="order-calculator"
	related={['analog-designer', 'iir-designer', 'fir-designer', 'family-compare', 'calculators']}
>
	{#snippet controls()}
		<ControlGroup title="Domain">
			<Segmented
				bind:value={domain}
				options={[
					{ value: 'analog', label: 'Analog' },
					{ value: 'digital', label: 'Digital (bilinear)' }
				]}
			/>
			{#if domain === 'digital'}
				<NumberInput label="Sample rate fs" bind:value={fs} unit="Hz" si min={1} logStep={1.05} />
			{/if}
		</ControlGroup>

		<ControlGroup title="Response type">
			<Segmented
				bind:value={band}
				options={[
					{ value: 'lowpass', label: 'LP' },
					{ value: 'highpass', label: 'HP' },
					{ value: 'bandpass', label: 'BP' },
					{ value: 'bandstop', label: 'BS' }
				]}
			/>
		</ControlGroup>

		<ControlGroup title="Band edges" columns={2}>
			{#if isBand}
				<NumberInput
					label="Passband f₁"
					bind:value={edges[band].fp[0]}
					unit="Hz"
					si
					min={1e-6}
					logStep={1.05}
				/>
				<NumberInput
					label="Passband f₂"
					bind:value={edges[band].fp[1]}
					unit="Hz"
					si
					min={1e-6}
					logStep={1.05}
				/>
				<NumberInput
					label="Stopband f₁"
					bind:value={edges[band].fst[0]}
					unit="Hz"
					si
					min={1e-6}
					logStep={1.05}
				/>
				<NumberInput
					label="Stopband f₂"
					bind:value={edges[band].fst[1]}
					unit="Hz"
					si
					min={1e-6}
					logStep={1.05}
				/>
			{:else}
				<NumberInput
					label="Passband edge"
					bind:value={edges[band].fp[0]}
					unit="Hz"
					si
					min={1e-6}
					logStep={1.05}
				/>
				<NumberInput
					label="Stopband edge"
					bind:value={edges[band].fst[0]}
					unit="Hz"
					si
					min={1e-6}
					logStep={1.05}
				/>
			{/if}
		</ControlGroup>

		<ControlGroup title="Ripple & attenuation" columns={2}>
			<NumberInput
				label="Passband ripple Rp"
				bind:value={rp}
				unit="dB"
				min={0.0001}
				max={20}
				logStep={1.1}
				help="Max loss in the passband"
			/>
			<NumberInput
				label="Stopband Rs"
				bind:value={rs}
				unit="dB"
				min={1}
				max={200}
				step={1}
				help="Min attenuation"
			/>
		</ControlGroup>

		<ControlGroup title="Examples">
			<div class="examples">
				{#each EXAMPLES as ex (ex.label)}
					<button type="button" class="btn small" onclick={() => loadExample(ex)}>{ex.label}</button
					>
				{/each}
			</div>
		</ControlGroup>
	{/snippet}

	{#if error}
		<Callout kind="danger" title="Check the specification">{error}</Callout>
	{:else}
		<StatGrid {stats} />

		<Card
			title="IIR filter families"
			subtitle={domain === 'digital'
				? `Minimum order for each family when the analog prototype is mapped with the prewarped bilinear transform at fs = ${formatSI(fs, 'Hz', 4)}.`
				: 'Minimum order of each analog approximation.'}
		>
			<div class="table-wrap">
				<table class="iir">
					<thead>
						<tr>
							<th>Family</th>
							<th class="num">Order</th>
							<th>Cutoff for the designer</th>
							<th class="num" title="Second-order sections (+ first-order section)">Sections</th>
							{#if domain === 'digital'}<th
									class="num"
									title="Multiplications per output sample: 5 per biquad, 3 per first-order section"
									>Mult.</th
								>{/if}
							<th class="num">Passband loss</th>
							<th class="num">Stopband atten.</th>
						</tr>
					</thead>
					<tbody>
						{#each iir as r (r.family)}
							<tr class:best={best?.family === r.family}>
								<td class="fam"
									><span class="swatch" style:background={seriesColor(r.index)} aria-hidden="true"
									></span>{shortName(r.name)}</td
								>
								<td class="num">
									{#if r.capped}
										<span class="bad">✕ &gt; {r.maxOrder}</span>
									{:else}
										<strong>{r.order}</strong>{#if isBand}<div class="muted small">
												{r.poles} poles
											</div>{/if}
									{/if}
								</td>
								<td>
									{#if r.capped}<span class="muted small">not reachable at N ≤ {r.maxOrder}</span
										>{:else}<span class="nowrap">{cutoffText(r)}</span>
										<div class="muted small">{r.cutoffMeaning}</div>{/if}
								</td>
								<td class="num nowrap">{r.biquads}{r.firstOrder ? ` + ${r.firstOrder}` : ''}</td>
								{#if domain === 'digital'}<td class="num">{r.mults}</td>{/if}
								<td class="num"
									><span class={passOk(r.passAtt) ? 'ok' : 'bad'}
										>{passOk(r.passAtt) ? '✓' : '✕'} {db(r.passAtt)}</span
									></td
								>
								<td class="num"
									><span class={stopOk(r.stopAtt) ? 'ok' : 'bad'}
										>{stopOk(r.stopAtt) ? '✓' : '✕'} {db(r.stopAtt)}</span
									></td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="small muted note">
				Worst-case values are measured on the designed filter across the whole passband and stopband{isBand
					? 's'
					: ''}. Failed rows show the filter at the family's maximum order. Monotonic families
				(Butterworth, Bessel, Legendre, Gaussian, critical) are scaled so the loss at the passband
				edge is exactly Rp; Chebyshev II is placed so it is exactly Rs at its stopband edge.
				Sections = biquads (+ a first-order section for odd orders).
				{#if domain === 'digital'}Mult. = multiplications per sample: 5 per biquad, 3 per
					first-order section.{/if}
			</p>
		</Card>

		<Card title="Minimum-order designs against the specification">
			{#snippet actions()}
				<Segmented
					size="small"
					bind:value={xScaleSel}
					options={[
						{ value: 'auto', label: 'Auto' },
						{ value: 'log', label: 'Log f' },
						{ value: 'linear', label: 'Linear f' }
					]}
				/>
			{/snippet}
			<div class="toggles" role="group" aria-label="Legend: click to show or hide a family">
				{#each iir as r (r.family)}
					<label class="chip" class:off={!shown[r.family]}>
						<input type="checkbox" bind:checked={shown[r.family]} />
						<span
							class="swatch"
							class:dashed={r.capped}
							style:background={seriesColor(r.index)}
							aria-hidden="true"
						></span>
						{shortName(r.name)}
						<span class="muted">{r.capped ? `(fails at ${r.order})` : `N = ${r.order}`}</span>
					</label>
				{/each}
			</div>
			<Plot
				{series}
				{xScale}
				xDomain={xRange}
				yDomain={yMain}
				xLabel="Frequency (Hz)"
				yLabel="Magnitude (dB)"
				xFormat={freqFormat}
				xTooltipFormat={hz}
				{regions}
				height={340}
				legend={false}
				exportName="order-calculator-magnitude"
			/>
			<h4 class="sub-title">Passband detail</h4>
			<Plot
				{series}
				{xScale}
				xDomain={passX}
				yDomain={yPass}
				xLabel="Frequency (Hz)"
				yLabel="Magnitude (dB)"
				xFormat={freqFormat}
				xTooltipFormat={hz}
				{regions}
				height={240}
				legend={false}
			/>
			<p class="small muted note">
				The chips are the legend — click to show or hide a family. Shaded areas are forbidden by the
				specification. Dashed curves are families that cannot meet it within their maximum order
				(shown at that order).
			</p>
		</Card>

		{#if fir}
			<Card
				title="FIR length estimates"
				subtitle={`Transition width Δf = ${trimNumber(fir.df, 4)} cycles/sample (the narrowest transition band ÷ fs). Linear phase, delay = (N − 1)/2 samples.`}
			>
				<div class="table-wrap">
					<table>
						<thead>
							<tr>
								<th>Method</th>
								<th class="num">Taps N</th>
								<th>Basis</th>
								<th>Meets the spec?</th>
								<th class="num">Mult./sample</th>
								<th class="num">Delay</th>
							</tr>
						</thead>
						<tbody>
							{#each fir.rows as r (r.id)}
								{@const m = firMults(r.taps)}
								<tr class:best={bestFir?.id === r.id}>
									<td>{r.method}</td>
									<td class="num"
										><strong>{r.taps}</strong>{#if r.madeOdd}<div class="muted small">
												odd (type I)
											</div>{/if}</td
									>
									<td class="small">{r.detail}</td>
									<td class="small">
										{#if r.windowAtt !== undefined}
											<span class={r.meets ? 'ok' : 'bad'}>{r.meets ? '✓ yes' : '✕ no'}</span>
											<span class="muted">— ≈ {r.windowAtt} dB, {r.windowRipple} dB ripple</span>
										{:else}
											<span class="ok">✓ yes</span> <span class="muted">(estimate)</span>
										{/if}
									</td>
									<td class="num"
										>{m.direct}
										<div class="muted small">{m.symmetric} with symmetry</div></td
									>
									<td class="num"
										>{formatSI((r.taps - 1) / 2 / fs, 's', 3)}
										<div class="muted small">{trimNumber((r.taps - 1) / 2, 4)} samples</div></td
									>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				{#if best && bestFir}
					<p class="cmp">
						<strong>Cost:</strong> the {best.name.split(' (')[0].toLowerCase()} IIR needs
						<strong>{best.mults}</strong>
						multiplications per sample; the shortest FIR ({bestFir.method.replace(
							' (equiripple)',
							''
						)}, {bestFir.taps} taps) needs <strong>{firMults(bestFir.taps).symmetric}</strong> even
						with coefficient symmetry —
						{trimNumber(firMults(bestFir.taps).symmetric / best.mults, 3)}× more — but it has
						exactly linear phase and cannot become unstable.
					</p>
				{/if}
				<p class="small muted note">
					Kaiser uses A = −20·log₁₀ min(δp, δs) = {trimNumber(fir.kaiserA, 4)} dB, since the window method
					gives about the same ripple in both bands. Parks–McClellan uses the Herrmann–Rabiner–Chan formula
					with δp = {trimNumber(fir.dp, 4)} (passband 1 ± δp) and δs = {trimNumber(fir.ds, 4)}; real
					designs may need a few taps more or fewer. Fixed windows use the rules of thumb in the
					theory section and cannot reach more than their typical attenuation however long they are.
					Design them in the <a href={toolHref('fir-designer')}>FIR designer</a>.
				</p>
			</Card>
		{:else}
			<Callout kind="note" title="FIR estimates need a sample rate"
				>Switch the domain to <em>Digital</em> to compare FIR lengths with the IIR orders.</Callout
			>
		{/if}

		<Card title="Check it in SciPy">
			<CodeBlock code={scipy} language="python" />
		</Card>
	{/if}

	{#snippet theory()}
		<h2>How the minimum order is found</h2>
		<p>
			Every specification — low-pass, high-pass, band-pass or band-stop, analog or digital — is
			first reduced to an equivalent
			<strong>normalised low-pass prototype</strong> with its passband edge at 1 rad/s. Two numbers
			then decide the order — the <strong>selectivity</strong> k and the
			<strong>discrimination</strong> k₁:
		</p>
		<Tex
			display
			math={'\\begin{gathered}k=\\frac{\\Omega_p}{\\Omega_s}=\\frac{1}{\\Omega_s}<1\\\\[8pt] k_1=\\frac{\\varepsilon_p}{\\varepsilon_s}=\\sqrt{\\frac{10^{R_p/10}-1}{10^{R_s/10}-1}}\\ll 1\\end{gathered}'}
		/>
		<p>
			For a high-pass filter <Tex math={'\\Omega_s = \\omega_p/\\omega_s'} />. For band-pass edges,
			the low-pass → band-pass mapping
			<Tex math={'\\Omega = (\\omega^2-\\omega_0^2)/(B\\,\\omega)'} /> with <Tex
				math={'\\omega_0^2=\\omega_{p1}\\omega_{p2}'}
			/> and
			<Tex math={'B=\\omega_{p2}-\\omega_{p1}'} /> gives <Tex
				math={'\\Omega_s=\\min_i |\\omega_{si}^2-\\omega_0^2|/(B\\,\\omega_{si})'}
			/> (the reciprocal for band-stop). For a digital filter every edge is first
			<strong>prewarped</strong>,
			<Tex math={'\\omega = 2f_s\\tan(\\pi f/f_s)'} />, so that the bilinear transform lands it back
			exactly where you asked.
		</p>
		<h3>Order formulas</h3>
		<div class="table-wrap wide">
			<table>
				<thead><tr><th>Family</th><th>Minimum order</th></tr></thead>
				<tbody>
					<tr
						><td>Butterworth</td><td
							><Tex
								math={'N\\ge\\dfrac{\\log(1/k_1)}{\\log(1/k)}=\\dfrac{\\log_{10}\\!\\big[(10^{R_s/10}-1)/(10^{R_p/10}-1)\\big]}{2\\log_{10}\\Omega_s}'}
							/></td
						></tr
					>
					<tr
						><td>Chebyshev I and II</td><td
							><Tex
								math={'N\\ge\\dfrac{\\operatorname{arccosh}(1/k_1)}{\\operatorname{arccosh}(1/k)}'}
							/></td
						></tr
					>
					<tr
						><td>Elliptic (Cauer)</td><td
							><Tex
								math={"N\\ge\\dfrac{K(k)\\,K'(k_1)}{K'(k)\\,K(k_1)},\\quad K'(k)=K\\big(\\sqrt{1-k^2}\\big)"}
							/></td
						></tr
					>
					<tr
						><td>Bessel, Legendre, Gaussian, critical</td><td
							>No closed form: try N = 1, 2, … until the loss at Ω<sub>s</sub> (with the passband
							edge scaled to exactly R<sub>p</sub>) reaches R<sub>s</sub>.</td
						></tr
					>
				</tbody>
			</table>
		</div>
		<p>
			<Tex math={'K'} /> is the complete elliptic integral of the first kind. Because arccosh grows like
			a logarithm,
			<Tex math={'\\operatorname{arccosh}(1/k)\\approx\\ln(2/k)'} /> is much larger than <Tex
				math={'\\log(1/k)'}
			/> when the transition is narrow, which is why Chebyshev beats Butterworth. The SciPy functions
			<code>buttord</code>, <code>cheb1ord</code>, <code>cheb2ord</code> and
			<code>ellipord</code> implement exactly these formulas; the table above agrees with them.
		</p>
		<h3>Why the elliptic filter wins</h3>
		<p>
			A Butterworth filter spends all of its degrees of freedom on being flat at DC; Chebyshev
			filters spread the error evenly over one band; the elliptic filter spreads it evenly over <em
				>both</em
			>
			bands, placing transmission zeros on the jω axis just beyond the passband. It is optimal in the
			minimax sense: no filter of the same order has a narrower transition for the same R<sub>p</sub
			>
			and R<sub>s</sub>. For small k₁ its order grows only like
		</p>
		<Tex
			display
			math={"\\begin{gathered}N\\approx\\frac{\\ln(16/k_1^2)}{\\ln(1/q)}\\\\[8pt] q\\approx\\frac{1}{2}\\,\\frac{1-\\sqrt{k'}}{1+\\sqrt{k'}}+\\cdots,\\qquad k'=\\sqrt{1-k^2}\\end{gathered}"}
		/>
		<p>
			where the nome <Tex math={'q'} /> shrinks rapidly as the transition widens. The price is passband
			ripple, stopband ripple and the worst group-delay variation and step-response ringing of all the
			families — compare them in the
			<a href={toolHref('family-compare')}>family comparison</a>.
		</p>
		<h3>FIR length estimates</h3>
		<p>
			FIR length depends on the transition width <Tex
				math={'\\Delta f=|f_\\text{stop}-f_\\text{pass}|/f_s'}
			/> (cycles/sample) rather than on a frequency ratio, and grows as <Tex
				math={'1/\\Delta f'}
			/>:
		</p>
		<p><strong>Kaiser window</strong> (A = −20·log₁₀ δ in dB):</p>
		<Tex display math={'N\\approx\\frac{A-7.95}{14.36\\,\\Delta f}+1'} />
		<Tex
			display
			math={'\\beta=\\begin{cases}0.1102\\,(A-8.7), & A>50\\\\ 0.5842\\,(A-21)^{0.4}+0.07886\\,(A-21), & 21\\le A\\le 50\\\\ 0, & A<21\\end{cases}'}
		/>
		<p><strong>Parks–McClellan</strong> (Herrmann, Rabiner &amp; Chan, 1973):</p>
		<Tex
			display
			math={'N\\approx\\frac{D_\\infty(\\delta_p,\\delta_s)}{\\Delta f}-f(\\delta_p,\\delta_s)\\,\\Delta f+1'}
		/>
		<Tex
			display
			math={'D_\\infty=\\big(a_1L_p^2+a_2L_p+a_3\\big)L_s+\\big(a_4L_p^2+a_5L_p+a_6\\big)'}
		/>
		<Tex display math={'f=11.01217+0.51244\\,(L_p-L_s)'} />
		<Tex display math={'L_p=\\log_{10}\\delta_p,\\qquad L_s=\\log_{10}\\delta_s'} />
		<p class="small">
			with a₁ = 0.005309, a₂ = 0.07114, a₃ = −0.4761, a₄ = −0.00266, a₅ = −0.5941, a₆ = −0.4278.
			Kaiser's simpler equiripple estimate
			<Tex
				math={'N\\approx\\frac{-20\\log_{10}\\sqrt{\\delta_p\\delta_s}-13}{14.6\\,\\Delta f}+1'}
			/> gives similar numbers.
		</p>
		<p>
			Fixed windows trade main-lobe width (transition width) against sidelobe level (attenuation),
			which no length can improve:
		</p>
		<div class="table-wrap">
			<table>
				<thead
					><tr
						><th>Window</th><th class="num">Transition Δf</th><th class="num"
							>Stopband attenuation</th
						><th class="num">Passband ripple</th></tr
					></thead
				>
				<tbody>
					<tr
						><td>Rectangular</td><td class="num">0.9/N</td><td class="num">21 dB</td><td class="num"
							>0.74 dB</td
						></tr
					>
					{#each WINDOW_RULES as w (w.id)}
						<tr
							><td>{w.name}</td><td class="num">{w.c}/N</td><td class="num">{w.att} dB</td><td
								class="num">{w.ripple} dB</td
							></tr
						>
					{/each}
				</tbody>
			</table>
		</div>
		<h3>Why FIR filters need so many more taps</h3>
		<p>
			An IIR filter's poles can sit right next to the unit circle (or the jω axis) and create a
			steep edge with a handful of coefficients; its order grows only logarithmically as the
			transition narrows. An FIR filter has only zeros, so a sharp edge needs a long impulse
			response — the length is inversely proportional to Δf. In exchange, a symmetric FIR has <strong
				>exactly linear phase</strong
			>
			(a constant delay of (N − 1)/2 samples, so every frequency is delayed equally and waveshapes are
			preserved), it is always stable, and it is robust to coefficient quantisation. Symmetry also halves
			the multiplications: pre-add the two samples that share a coefficient. See
			<a href={toolHref('linear-phase')}>linear vs minimum phase</a> for the consequences.
		</p>
		<Callout kind="try">
			<ul>
				<li>
					Halve the transition band and watch the elliptic order rise by one or two while the FIR
					lengths double.
				</li>
				<li>
					Raise R<sub>s</sub> from 40 to 80 dB: the Hann and Hamming rows switch to “no” — no length helps
					a fixed window.
				</li>
				<li>
					Load the <em>50 Hz hum reject</em> example: band-stop specs are where IIR filters shine.
				</li>
				<li>
					Switch the same edges between analog and digital at a low fs: prewarping changes the
					effective selectivity.
				</li>
			</ul>
		</Callout>
	{/snippet}
</ToolLayout>

<style>
	.table-wrap {
		overflow-x: auto;
	}
	table td {
		vertical-align: middle;
	}
	tr.best td {
		background: var(--accent-wash);
	}
	.swatch {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 2px;
		margin-right: 0.45rem;
		vertical-align: baseline;
	}
	.ok {
		color: var(--good-ink);
		white-space: nowrap;
	}
	.bad {
		color: var(--critical-ink);
		white-space: nowrap;
	}
	.note {
		margin: 0.6rem 0 0;
	}
	.cmp {
		margin: 0.7rem 0 0;
		font-size: 0.92rem;
	}
	.examples {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	.examples .btn {
		white-space: normal;
		text-align: left;
	}
	.toggles {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-bottom: 0.5rem;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.1rem;
		font-size: 0.82rem;
		border: 1px solid var(--border-strong);
		border-radius: 999px;
		padding: 0.1rem 0.6rem 0.1rem 0.45rem;
		cursor: pointer;
		background: var(--surface);
		user-select: none;
	}
	.chip input {
		position: absolute;
		opacity: 0;
		width: 1px;
		height: 1px;
	}
	.chip:has(input:focus-visible) {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
	.chip.off {
		opacity: 0.5;
		border-style: dashed;
	}
	.chip .swatch {
		margin-right: 0.3rem;
	}
	.chip .muted {
		margin-left: 0.25rem;
	}
	.swatch.dashed {
		background-image: linear-gradient(90deg, transparent 50%, var(--surface) 50%) !important;
		background-size: 4px 100%;
	}
	.nowrap {
		white-space: nowrap;
	}
	.fam {
		white-space: nowrap;
	}
	.sub-title {
		margin: 0.9rem 0 0.3rem;
		font-size: 0.9rem;
	}
</style>
