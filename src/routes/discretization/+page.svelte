<script lang="ts">
	import { onMount } from 'svelte';
	import ToolLayout from '$lib/components/layout/ToolLayout.svelte';
	import ControlGroup from '$lib/components/layout/ControlGroup.svelte';
	import Card from '$lib/components/layout/Card.svelte';
	import Select from '$lib/components/controls/Select.svelte';
	import Segmented from '$lib/components/controls/Segmented.svelte';
	import Slider from '$lib/components/controls/Slider.svelte';
	import NumberInput from '$lib/components/controls/NumberInput.svelte';
	import ResponseView, { type FilterEntry } from '$lib/components/plot/ResponseView.svelte';
	import Plot, { type Series } from '$lib/components/plot/Plot.svelte';
	import PoleZeroPlot, { type PzContext } from '$lib/components/plot/PoleZeroPlot.svelte';
	import { freqFormat } from '$lib/components/plot/scales';
	import StatGrid, { type Stat } from '$lib/components/content/StatGrid.svelte';
	import Callout from '$lib/components/content/Callout.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import TimeCard from '$lib/features/iir-designer/TimeCard.svelte';
	import {
		ANALOG_COLOR,
		METHODS,
		digitalFrequency,
		discretizeWith,
		mapLine,
		mapS,
		maxDbError,
		methodInfo,
		passbandGrid,
		sPlaneGrid,
		usesExp,
		warpedHz,
		type MethodId,
		type MethodResult
	} from '$lib/features/discretization/mapping';
	import { FAMILIES, familyInfo, type AnalogFamily } from '$lib/dsp/analog';
	import { designAnalog, type IIRSpec } from '$lib/dsp/design';
	import { evaluate, linspace } from '$lib/dsp/response';
	import { analogTimeResponse } from '$lib/dsp/time';
	import { abs, c, type Complex } from '$lib/dsp/complex';
	import { formatSI, trimNumber } from '$lib/dsp/units';
	import type { BandType, ZPK } from '$lib/dsp/types';
	import { readSharedState } from '$lib/share';

	let fs = $state(8000);
	let family = $state<AnalogFamily>('butter');
	let band = $state<BandType>('lowpass');
	let order = $state(4);
	let f1 = $state(2000);
	let f2 = $state(3000);
	let rp = $state(1);
	let rs = $state(40);
	let enabled = $state<MethodId[]>(['bilinear-prewarp', 'bilinear', 'matched', 'impulse']);
	let view = $state<MethodId>('bilinear');
	let respScale = $state<'log' | 'linear'>('linear');

	const shared = $derived({ fs, family, band, order, f1, f2, rp, rs, enabled, view });
	onMount(() => {
		const st = readSharedState<typeof shared>();
		if (!st) return;
		const isMethod = (v: unknown): v is MethodId => METHODS.some((m) => m.id === v);
		if (typeof st.fs === 'number' && st.fs > 0) fs = st.fs;
		if (st.family && FAMILIES.some((f) => f.id === st.family)) family = st.family;
		if (
			st.band === 'lowpass' ||
			st.band === 'highpass' ||
			st.band === 'bandpass' ||
			st.band === 'bandstop'
		)
			band = st.band;
		if (typeof st.order === 'number') order = Math.min(10, Math.max(1, Math.round(st.order)));
		if (typeof st.f1 === 'number' && st.f1 > 0) f1 = st.f1;
		if (typeof st.f2 === 'number' && st.f2 > 0) f2 = st.f2;
		if (typeof st.rp === 'number' && st.rp > 0) rp = st.rp;
		if (typeof st.rs === 'number' && st.rs > 0) rs = st.rs;
		if (Array.isArray(st.enabled)) enabled = st.enabled.filter(isMethod);
		if (isMethod(st.view)) view = st.view;
	});

	const nyq = $derived(fs / 2);
	const info = $derived(familyInfo(family));
	const isBand = $derived(band === 'bandpass' || band === 'bandstop');
	const e1 = $derived(Math.min(f1, nyq * 0.99));
	const e2 = $derived(Math.min(f2, nyq * 0.99));
	const fRef = $derived(isBand ? Math.sqrt(e1 * e2) : e1);
	const spec = $derived<IIRSpec>({
		family,
		band,
		order: Math.min(order, info.maxOrder),
		f1: e1,
		f2: isBand ? e2 : undefined,
		rp,
		rs,
		besselNorm: 'mag'
	});

	const inputError = $derived.by(() => {
		if (isBand && !(f1 < f2)) return 'The lower band edge must be below the upper band edge.';
		return null;
	});

	const analog = $derived.by((): ZPK | null => {
		if (inputError) return null;
		try {
			return designAnalog(spec);
		} catch {
			return null;
		}
	});

	const results = $derived.by((): Map<MethodId, MethodResult | { error: string }> => {
		const out = new Map<MethodId, MethodResult | { error: string }>();
		if (!analog) return out;
		for (const m of METHODS) {
			try {
				out.set(m.id, discretizeWith(m.id, spec, fs));
			} catch (e) {
				out.set(m.id, { error: e instanceof Error ? e.message : String(e) });
			}
		}
		return out;
	});
	const ok = (r: MethodResult | { error: string } | undefined): r is MethodResult =>
		!!r && !('error' in r);
	const shown = $derived(METHODS.filter((m) => enabled.includes(m.id) && ok(results.get(m.id))));

	function toggle(id: MethodId, on: boolean) {
		enabled = on
			? METHODS.map((m) => m.id).filter((m) => m === id || enabled.includes(m))
			: enabled.filter((m) => m !== id);
	}

	// ----- response comparison -----
	const entries = $derived.by((): FilterEntry[] => {
		if (!analog) return [];
		const out: FilterEntry[] = [
			{
				filter: { kind: 'analog', zpk: analog },
				label: 'Analog H(s)',
				color: ANALOG_COLOR,
				dash: '6 4'
			}
		];
		for (const m of shown) {
			const r = results.get(m.id) as MethodResult;
			out.push({ filter: { kind: 'digital', fs, zpk: r.zpk }, label: m.name, color: m.color });
		}
		return out;
	});

	// ----- per-method table -----
	const rows = $derived.by(() => {
		if (!analog) return [];
		const pass = passbandGrid(band, e1, e2, fs);
		const edges = isBand ? [e1, e2] : [e1];
		return METHODS.map((m) => {
			const r = results.get(m.id);
			if (!ok(r)) return { m, error: r?.error ?? 'failed' };
			const pe = maxDbError(analog, r.zpk, fs, pass);
			const ee = maxDbError(analog, r.zpk, fs, edges);
			const atNyq = evaluate({ kind: 'digital', fs, zpk: r.zpk }, [nyq]).magDb[0];
			return { m, r, pe, ee, atNyq };
		});
	});

	const warnings = $derived(
		METHODS.filter((m) => enabled.includes(m.id))
			.map((m) => ({ m, r: results.get(m.id) }))
			.filter(({ r }) => r && ('error' in r || (r as MethodResult).warning))
	);

	// ----- general stats -----
	const stats = $derived.by((): Stat[] => {
		if (!analog) return [];
		const bil = (f: number) => digitalFrequency('bilinear', f, fs, f);
		const edgeList = isBand ? [e1, e2] : [e1];
		const aliasDb = evaluate({ kind: 'analog', zpk: analog }, [nyq]).magDb[0];
		const stable = METHODS.filter((m) => {
			const r = results.get(m.id);
			return ok(r) && r.stable;
		}).length;
		return [
			{
				label: isBand ? 'Edges / fs' : 'fc / fs',
				value: edgeList.map((f) => trimNumber(f / fs, 3)).join(', ')
			},
			{
				label: isBand ? 'Edges after bilinear' : 'fc after bilinear',
				value: edgeList.map((f) => formatSI(bil(f), 'Hz', 4)).join(', '),
				hint: 'Without prewarping: f_d = (fs/π)·atan(π·f/fs)'
			},
			{
				label: isBand ? 'Prewarped edges' : 'Prewarped fc',
				value: edgeList.map((f) => formatSI(warpedHz(f, fs), 'Hz', 4)).join(', '),
				hint: 'Design the analog filter here and the bilinear transform brings it back to the edge: (fs/π)·tan(π·f/fs)'
			},
			{
				label: 'Analog gain at fs/2',
				value: dbv(aliasDb),
				hint: 'How much the analog response still passes at Nyquist — what impulse invariance folds back'
			},
			{
				label: 'Stable results',
				value: `${stable} of ${METHODS.length}`,
				status: stable === METHODS.length ? 'good' : 'warning'
			}
		];
	});

	// ----- frequency mapping plot -----
	const mapX = $derived(linspace(0, 1.5 * fs, 900));
	const mapSeries = $derived.by((): Series[] => {
		const out: Series[] = [
			{
				x: [0, nyq],
				y: [0, nyq],
				label: 'f_d = f_a (ideal)',
				color: 'var(--muted)',
				dash: '3 4',
				width: 1.5,
				format: (v) => formatSI(v, 'Hz', 4)
			}
		];
		for (const m of shown) {
			const dashed =
				(m.id === 'impulse' && enabled.includes('matched')) ||
				(m.id === 'forward-euler' && enabled.includes('backward-euler'));
			out.push({
				x: mapX,
				y: mapX.map((f) => digitalFrequency(m.id, f, fs, fRef)),
				label: m.name,
				color: m.color,
				dash: dashed ? '7 5' : undefined,
				format: (v) => formatSI(v, 'Hz', 4)
			});
		}
		return out;
	});

	// ----- s-plane / z-plane mapping view -----
	const viewResult = $derived.by(() => {
		const r = results.get(view);
		return ok(r) ? r : null;
	});
	const sPoles = $derived(
		viewResult ? viewResult.analog.p.map((p) => c(p.re / (2 * Math.PI), p.im / (2 * Math.PI))) : []
	);
	const sExtent = $derived(Math.max(0.75 * fs, 1.15 * Math.max(0, ...sPoles.map(abs))));
	// lines beyond ±fs/2 last, so where they land on top of the primary strip (aliasing) stays visible
	const grid = $derived(
		sPlaneGrid(fs, sExtent, view).sort((a, b) => Number(a.aliased) - Number(b.aliased))
	);
	const zGrid = $derived(grid.map((l) => ({ ...l, pts: mapLine(view, l.pts, fs) })));
	const zPoles = $derived(viewResult?.zpk.p ?? []);
	const zExtent = $derived(
		Math.max(view === 'forward-euler' ? 2.2 : 1.3, 1.15 * Math.max(0, ...zPoles.map(abs)))
	);
	const markF = $derived(view === 'bilinear-prewarp' ? warpedHz(fRef, fs) : fRef);
	const markZ = $derived(mapS(view, c(0, 2 * Math.PI * markF), fs));

	function pathOf(pts: Complex[], X: (v: number) => number, Y: (v: number) => number): string {
		let d = '';
		let pen = false;
		for (const p of pts) {
			const x = X(p.re);
			const y = Y(p.im);
			if (!Number.isFinite(x) || !Number.isFinite(y)) {
				pen = false;
				continue;
			}
			d += `${pen ? 'L' : 'M'}${Math.max(-1e4, Math.min(1e4, x)).toFixed(1)},${Math.max(-1e4, Math.min(1e4, y)).toFixed(1)}`;
			pen = true;
		}
		return d;
	}

	// ----- time response -----
	const timeLimits = $derived.by((): [number, number] | undefined => {
		if (!analog) return undefined;
		try {
			const n = 256;
			const imp = analogTimeResponse(analog, 'impulse', (n - 1) / fs, n).y.map((v) =>
				Math.abs(v / fs)
			);
			const stp = analogTimeResponse(analog, 'step', (n - 1) / fs, n).y.map(Math.abs);
			const m = Math.max(...imp, ...stp, 1e-6);
			return [-1.6 * m, 1.6 * m];
		} catch {
			return undefined;
		}
	});

	const familyOptions = FAMILIES.map((f) => ({ value: f.id, label: f.name }));
	const FS_PRESETS = [1000, 8000, 16000, 44100, 48000, 96000];
	const fsOptions = [
		...FS_PRESETS.map((v) => ({ value: v, label: formatSI(v, 'Hz', 4) })),
		{ value: 0, label: 'Custom…' }
	];
	const fsSel = $derived(FS_PRESETS.includes(fs) ? fs : 0);
	const hz = (v: number) => formatSI(v, 'Hz', 4);
	/** dB with tiny values shown as 0 and vanishing gains as −∞. */
	const dbv = (v: number) =>
		!Number.isFinite(v) || v < -250 ? '−∞ dB' : `${Math.abs(v) < 5e-4 ? '0' : trimNumber(v, 3)} dB`;
	const methodOptions = METHODS.map((m) => ({ value: m.id, label: m.name }));
</script>

<ToolLayout
	slug="discretization"
	share={shared}
	related={['iir-designer', 'analog-designer', 'aliasing', 'pole-zero', 'biquad']}
>
	{#snippet controls()}
		<ControlGroup title="Analog filter">
			<Select label="Family" bind:value={family} options={familyOptions} />
			<Segmented
				label="Response type"
				bind:value={band}
				options={[
					{ value: 'lowpass', label: 'LP' },
					{ value: 'highpass', label: 'HP' },
					{ value: 'bandpass', label: 'BP' },
					{ value: 'bandstop', label: 'BS' }
				]}
			/>
			<Slider
				label="Order N"
				bind:value={order}
				min={1}
				max={Math.min(10, info.maxOrder)}
				integer
			/>
			{#if isBand}
				<Slider label="Lower edge f₁" bind:value={f1} min={1} max={nyq * 0.99} log unit="Hz" />
				<Slider label="Upper edge f₂" bind:value={f2} min={1} max={nyq * 0.99} log unit="Hz" />
			{:else}
				<Slider label="Cutoff fc" bind:value={f1} min={1} max={nyq * 0.99} log unit="Hz" />
			{/if}
			{#if info.usesRp}
				<Slider label="Passband ripple Rp" bind:value={rp} min={0.01} max={6} log unit="dB" />
			{/if}
			{#if info.usesRs}
				<Slider
					label="Stopband attenuation Rs"
					bind:value={rs}
					min={10}
					max={120}
					step={1}
					unit="dB"
				/>
			{/if}
		</ControlGroup>

		<ControlGroup title="Sampling">
			<Select
				label="Sample rate"
				value={fsSel}
				options={fsOptions}
				onchange={(v) => {
					if (v > 0) fs = v;
				}}
			/>
			<NumberInput label="fs (any value)" bind:value={fs} unit="Hz" min={1} si logStep={1.1} />
		</ControlGroup>

		<ControlGroup title="Methods">
			<ul class="methods">
				{#each METHODS as m (m.id)}
					<li>
						<label>
							<input
								type="checkbox"
								checked={enabled.includes(m.id)}
								onchange={(e) => toggle(m.id, (e.target as HTMLInputElement).checked)}
							/>
							<span class="swatch" style:background={m.color} aria-hidden="true"></span>
							<span>{m.name}</span>
						</label>
					</li>
				{/each}
			</ul>
			<p class="small muted tight">The analog reference is always drawn dashed.</p>
		</ControlGroup>
	{/snippet}

	{#if inputError}
		<Callout kind="danger">{inputError}</Callout>
	{:else if !analog}
		<Callout kind="danger">The analog filter could not be designed with these settings.</Callout>
	{/if}
	{#if f1 >= nyq || (isBand && f2 >= nyq)}
		<Callout kind="warning"
			>Band edges must be below fs/2 = {hz(nyq)}; they were clamped to 0.99·fs/2.</Callout
		>
	{/if}
	{#each warnings as w (w.m.id)}
		<Callout kind="warning" title={w.m.name}
			>{'error' in w.r! ? w.r.error : (w.r as MethodResult).warning}</Callout
		>
	{/each}

	<StatGrid {stats} />

	{#if analog}
		<ResponseView
			filters={entries}
			views={['phase', 'groupDelay']}
			bind:xScale={respScale}
			fmin={respScale === 'log' ? nyq / 1000 : undefined}
			fmax={nyq}
			vlines={isBand
				? [
						{ value: e1, label: 'f₁' },
						{ value: e2, label: 'f₂' }
					]
				: [{ value: e1, label: 'fc' }]}
			title="Analog vs digital, 0 … fs/2"
		/>

		<Card
			title="Method comparison"
			subtitle="Errors are |digital − analog| in dB. The passband is the analog design's passband below Nyquist; the edge error is measured at the band edge(s)."
		>
			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th>Method</th>
							<th>Stability</th>
							<th class="num">Max passband error</th>
							<th class="num">Error at edge</th>
							<th class="num">Gain at fs/2</th>
						</tr>
					</thead>
					<tbody>
						{#each rows as row (row.m.id)}
							<tr class:off={!enabled.includes(row.m.id)}>
								<td
									><span class="swatch" style:background={row.m.color} aria-hidden="true"
									></span>{row.m.name}</td
								>
								{#if 'error' in row}
									<td colspan="4" class="crit">✕ {row.error}</td>
								{:else}
									<td class={row.r.stable ? 'good' : 'crit'}
										>{row.r.stable ? '✓ stable' : '✕ unstable'}
										<span class="muted">(max |p| {trimNumber(row.r.maxPoleRadius, 4)})</span></td
									>
									<td class="num">{Number.isFinite(row.pe) ? dbv(row.pe) : '—'}</td>
									<td class="num">{dbv(row.ee)}</td>
									<td class="num">{dbv(row.atNyq)}</td>
								{/if}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</Card>

		<Card
			title="Frequency mapping"
			subtitle="Where an analog frequency fₐ ends up on the digital axis. z = e^(sT) methods fold (alias) every fs; the bilinear transform compresses the whole axis below fs/2; for the Euler methods the jω axis misses the unit circle and this is only the angle of its image."
		>
			<Plot
				series={mapSeries}
				xDomain={[0, 1.5 * fs]}
				yDomain={[0, nyq]}
				xLabel="Analog frequency fₐ (Hz)"
				yLabel="Digital frequency f_d (Hz)"
				xFormat={freqFormat}
				yFormat={freqFormat}
				xTooltipFormat={hz}
				vlines={[
					{ value: fRef, label: isBand ? '√(f₁f₂)' : 'fc' },
					{ value: nyq, label: 'fs/2' },
					{ value: fs, label: 'fs' }
				]}
				height={300}
				exportName="frequency-mapping"
			/>
			{#if isBand}<p class="small muted">
					The prewarped curve is drawn for the geometric centre √(f₁f₂); the actual design prewarps
					both edges.
				</p>{/if}
		</Card>

		<Card
			title="s-plane → z-plane"
			subtitle="A grid of constant-σ and constant-ω lines in the s-plane (in Hz: s/2π) and its image under the selected mapping, with the poles of the analog filter that is discretised and of the digital result."
		>
			{#snippet actions()}
				<Select label="Mapping" bind:value={view} options={methodOptions} />
			{/snippet}
			<div class="planes">
				<div>
					<PoleZeroPlot
						poles={sPoles}
						domain="s"
						sHz
						extent={sExtent}
						height={330}
						title="s-plane (analog)"
					>
						{#snippet overlay(ctx: PzContext)}
							<defs>
								<clipPath id="dz-sclip"
									><rect
										x={ctx.X(-ctx.R)}
										y={ctx.Y(ctx.R)}
										width={2 * ctx.R * ctx.k}
										height={2 * ctx.R * ctx.k}
									/></clipPath
								>
							</defs>
							<g clip-path="url(#dz-sclip)">
								{#each grid as l, i (i)}
									<path
										class="gl {l.kind}"
										class:aliased={l.aliased}
										d={pathOf(l.pts, ctx.X, ctx.Y)}
									/>
								{/each}
								<line
									class="strip"
									x1={ctx.X(-ctx.R)}
									x2={ctx.X(ctx.R)}
									y1={ctx.Y(nyq)}
									y2={ctx.Y(nyq)}
								/>
								<line
									class="strip"
									x1={ctx.X(-ctx.R)}
									x2={ctx.X(ctx.R)}
									y1={ctx.Y(-nyq)}
									y2={ctx.Y(-nyq)}
								/>
								<text class="lbl" x={ctx.X(-ctx.R) + 4} y={ctx.Y(nyq) - 4}>ω/2π = fs/2</text>
								<circle class="mark" cx={ctx.X(0)} cy={ctx.Y(markF)} r="4.5" />
								<text class="lbl" x={ctx.X(0) + 7} y={ctx.Y(markF) + 4}
									>{view === 'bilinear-prewarp' ? 'f′' : 'f'}{isBand ? '₀' : 'c'}</text
								>
							</g>
						{/snippet}
					</PoleZeroPlot>
				</div>
				<div>
					<PoleZeroPlot
						poles={zPoles}
						domain="z"
						{fs}
						extent={zExtent}
						height={330}
						title="z-plane: {methodInfo(view).name}"
					>
						{#snippet overlay(ctx: PzContext)}
							<defs>
								<clipPath id="dz-zclip"
									><rect
										x={ctx.X(-ctx.R)}
										y={ctx.Y(ctx.R)}
										width={2 * ctx.R * ctx.k}
										height={2 * ctx.R * ctx.k}
									/></clipPath
								>
							</defs>
							<g clip-path="url(#dz-zclip)">
								{#each zGrid as l, i (i)}
									<path
										class="gl {l.kind}"
										class:aliased={l.aliased}
										d={pathOf(l.pts, ctx.X, ctx.Y)}
									/>
								{/each}
								<circle class="mark" cx={ctx.X(markZ.re)} cy={ctx.Y(markZ.im)} r="4.5" />
								<text
									class="lbl"
									x={ctx.X(0.8 * markZ.re)}
									y={ctx.Y(0.8 * markZ.im) + 4}
									text-anchor="middle">{isBand ? 'f₀' : 'fc'}</text
								>
							</g>
						{/snippet}
					</PoleZeroPlot>
				</div>
			</div>
			<ul class="legend">
				<li>
					<svg width="24" height="8" aria-hidden="true"
						><line class="jw" x1="1" x2="23" y1="4" y2="4" /></svg
					>jω axis (σ = 0)
				</li>
				<li>
					<svg width="24" height="8" aria-hidden="true"
						><line class="sigma" x1="1" x2="23" y1="4" y2="4" /></svg
					>constant σ &lt; 0
				</li>
				<li>
					<svg width="24" height="8" aria-hidden="true"
						><line class="omega" x1="1" x2="23" y1="4" y2="4" /></svg
					>constant ω (every fs/8)
				</li>
				<li>
					<svg width="24" height="8" aria-hidden="true"
						><line class="sigma aliased" x1="1" x2="23" y1="4" y2="4" /></svg
					>|ω| beyond fs/2
				</li>
				<li>
					<svg width="12" height="12" aria-hidden="true"
						><path class="x" d="M2,2l8,8M2,10l8,-8" /></svg
					>poles
				</li>
				<li>
					<svg width="12" height="12" aria-hidden="true"
						><circle class="mark" cx="6" cy="6" r="4" /></svg
					>{isBand ? 'centre frequency' : 'cutoff'} on the jω axis and its image
				</li>
			</ul>
			<p class="small muted">
				{#if view === 'bilinear' || view === 'bilinear-prewarp'}
					The whole left half-plane lands inside the unit circle and the entire jω axis on the
					circle itself — one-to-one, so there is no aliasing, but frequencies far up the axis crowd
					towards z = −1 (warping).{#if view === 'bilinear-prewarp'}
						Prewarping does not change the map: it moves the analog poles (here designed at the
						warped edge) so the cutoff lands on fc.{/if}
				{:else if usesExp(view)}
					z = e<sup>sT</sup> turns each horizontal strip of height fs into the whole z-plane: lines
					of constant σ become circles of radius e<sup>σT</sup>, lines of constant ω become rays at
					angle ωT. Lines beyond ±fs/2 fall exactly on top of lines inside the strip — that overlap
					is aliasing.
				{:else if view === 'forward-euler'}
					z = 1 + sT just shifts and scales the plane: the jω axis becomes the vertical line Re z =
					1, tangent to the unit circle, and much of the left half-plane lands outside the circle.
					Analog poles there become unstable digital poles.
				{:else}
					z = 1/(1 − sT) maps the jω axis onto the small circle through 0 and 1 (centre ½, radius
					½): every stable pole stays stable, but the frequency axis is no longer on the unit
					circle, so resonances are damped and the response is distorted.
				{/if}
			</p>
		</Card>

		<TimeCard
			entries={shown.map((m) => ({
				filter: { kind: 'digital' as const, fs, zpk: (results.get(m.id) as MethodResult).zpk },
				label: m.name,
				color: m.color
			}))}
			analog={[{ zpk: analog, label: 'Analog T·h(nT)', color: ANALOG_COLOR, dash: '6 4' }]}
			yLimits={timeLimits}
			subtitle="Impulse invariance matches the sampled analog impulse response exactly; the others only approximate it. An unstable result grows without bound."
		/>
	{/if}

	{#snippet theory()}
		<h2>Six ways from s to z</h2>
		<p>
			Turning an analog transfer function H(s) into a digital H(z) means replacing s by something in
			z. Two ideas dominate: treat the differential equation numerically (<em>Euler</em> and
			<em>bilinear</em>
			are integration rules), or match something about the poles or the impulse response through <Tex
				math={'z=e^{sT}'}
			/> (<em>matched-Z</em> and <em>impulse invariance</em>). With T = 1/f<sub>s</sub>:
		</p>
		<div class="table-wrap wide">
			<table>
				<thead
					><tr
						><th>Method</th><th>Mapping</th><th>Stable → stable?</th><th>Frequency axis</th><th
							>Use it for</th
						></tr
					></thead
				>
				<tbody>
					<tr
						><td>Forward Euler</td><td
							><Tex math={'s=\\frac{z-1}{T}\\ \\Leftrightarrow\\ z=1+sT'} /></td
						><td>No — only poles inside the circle |1 + pT| &lt; 1</td><td
							>jω → Re z = 1 (off the circle)</td
						><td>Rarely; explicit simulation with heavy oversampling</td></tr
					>
					<tr
						><td>Backward Euler</td><td
							><Tex math={'s=\\frac{z-1}{zT}\\ \\Leftrightarrow\\ z=\\frac{1}{1-sT}'} /></td
						><td>Yes (into the disc |z − ½| &lt; ½)</td><td>jω → small circle; extra damping</td><td
							>Robust simple controllers, stiff systems</td
						></tr
					>
					<tr
						><td>Bilinear (Tustin)</td><td><Tex math={'s=\\frac{2}{T}\\frac{z-1}{z+1}'} /></td><td
							>Yes, one-to-one</td
						><td>Warped: <Tex math={'\\omega_a=\\tfrac{2}{T}\\tan\\tfrac{\\omega_d T}{2}'} /></td
						><td>Frequency-selective filters; the default</td></tr
					>
					<tr
						><td>Bilinear + prewarp</td><td
							>analog edges at <Tex math={'\\tfrac{2}{T}\\tan\\tfrac{\\omega_c T}{2}'} /></td
						><td>Yes</td><td>Warped, but exact at the edge(s)</td><td
							>Meeting band edges exactly (what SciPy/MATLAB do)</td
						></tr
					>
					<tr
						><td>Impulse invariance</td><td><Tex math={'h[n]=T\\,h_a(nT)'} /></td><td
							>Yes (<Tex math={'p\\to e^{pT}'} />)</td
						><td>Linear but aliased</td><td
							>Band-limited low-pass/band-pass; time-domain modelling</td
						></tr
					>
					<tr
						><td>Matched-Z</td><td><Tex math={'z_i\\to e^{z_iT},\\ p_i\\to e^{p_iT}'} /></td><td
							>Yes</td
						><td>Poles exact, response approximate</td><td>Quick conversions, control loops</td></tr
					>
				</tbody>
			</table>
		</div>
		<h3>Warping versus aliasing</h3>
		<p>
			The bilinear transform is a <em>one-to-one</em> map of the whole jω axis onto the unit circle,
			so nothing overlaps, but the frequency scale is bent: <Tex
				math={'f_d=\\frac{f_s}{\\pi}\\arctan\\frac{\\pi f_a}{f_s}'}
			/>. Impulse invariance keeps the frequency scale linear but is <em>many-to-one</em>: sampling
			the impulse response makes the spectrum periodic,
		</p>
		<Tex
			display
			math={'H(e^{j\\omega T}) = \\sum_{k=-\\infty}^{\\infty} H_a\\!\\left(j\\Big(\\omega-k\\frac{2\\pi}{T}\\Big)\\right)'}
		/>
		<p>
			so whatever the analog filter passes above f<sub>s</sub>/2 folds back on top of the passband.
			That is harmless for a steep low-pass far below Nyquist, ruinous for a high-pass or band-stop
			(whose response never falls off), and the reason the method cannot even represent a direct
			feed-through term. The s → z plot above shows both effects geometrically: bilinear squeezes
			the grid towards z = −1, e<sup>sT</sup> stacks strips of height f<sub>s</sub> on top of each other.
		</p>
		<h3>Matched-Z and the Euler rules</h3>
		<p>
			Matched-Z maps poles and zeros individually with z = e<sup>sT</sup>, puts zeros at infinity at
			z = −1 and matches the gain at one frequency. Pole positions (and so time constants and
			resonances) are exact, but the magnitude between them is not preserved, and stopband zeros
			near Nyquist alias. Forward Euler is the explicit rectangle rule: cheap, but it maps the left
			half-plane onto Re z &lt; 1, so fast or lightly damped poles leave the unit circle unless f<sub
				>s</sub
			> is many times the pole frequency. Backward Euler is the implicit rule: unconditionally stable,
			but it pulls everything towards z = ½ and adds damping.
		</p>
		<h3>Which one?</h3>
		<p>
			For frequency-selective filters use the prewarped bilinear transform — it is what every
			filter-design package does. Use impulse invariance when the time-domain waveform matters and
			the analog response is band-limited (models of physical systems, low-pass synthesis).
			Matched-Z and Euler are mostly seen in control and simulation code, where they are simple to
			derive by hand; at high oversampling ratios all methods converge.
		</p>
		<Callout kind="try">
			<ul>
				<li>
					Raise fc towards fs/2: the unprewarped bilinear cutoff slides down, while impulse
					invariance keeps the cutoff but gains an aliasing floor near Nyquist.
				</li>
				<li>Switch to a high-pass and look at the impulse-invariance curve and its warning.</li>
				<li>
					Enable forward Euler at the default settings (Butterworth, fc = fs/4): unstable. Raise fs
					until the "Stability" column turns green.
				</li>
				<li>
					Choose Chebyshev II or elliptic with matched-Z: the stopband zeros near Nyquist are
					mapped, but the stopband no longer looks equiripple.
				</li>
				<li>
					In the s → z view pick impulse invariance: the lines beyond ±fs/2 land exactly on lines
					from inside the strip.
				</li>
			</ul>
		</Callout>
	{/snippet}
</ToolLayout>

<style>
	.methods {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.methods li {
		margin: 0;
	}
	.methods label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.88rem;
		cursor: pointer;
	}
	.methods input {
		accent-color: var(--accent);
		margin: 0;
	}
	.swatch {
		display: inline-block;
		flex: none;
		width: 1.1rem;
		height: 0.28rem;
		border-radius: 2px;
		margin-right: 0.4rem;
		vertical-align: middle;
	}
	.methods .swatch {
		margin-right: 0;
	}
	.tight {
		margin: 0;
	}
	.table-wrap {
		overflow-x: auto;
	}
	td.good {
		color: var(--good-ink);
		white-space: nowrap;
	}
	td.crit {
		color: var(--critical-ink);
		white-space: nowrap;
	}
	tr.off td {
		opacity: 0.6;
	}
	.planes {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
		gap: 1rem;
	}
	.gl {
		fill: none;
		stroke-width: 1.1;
	}
	.gl.sigma {
		stroke: var(--muted);
	}
	.gl.omega {
		stroke: var(--muted);
		stroke-dasharray: 4 3;
	}
	.gl.jw {
		stroke: var(--text);
		stroke-width: 2;
	}
	.gl.aliased {
		stroke: var(--s8);
		opacity: 0.8;
	}
	.strip {
		stroke: var(--text-2);
		stroke-width: 1;
		stroke-dasharray: 1 3;
	}
	.lbl {
		fill: var(--text-2);
		font-size: 11px;
		paint-order: stroke;
		stroke: var(--chart-surface);
		stroke-width: 3px;
	}
	.mark {
		fill: var(--chart-surface);
		stroke: var(--text);
		stroke-width: 2;
	}
	.legend {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 1.1rem;
		margin: 0.6rem 0 0.4rem;
		padding: 0;
		font-size: 0.8rem;
		color: var(--text-2);
	}
	.legend li {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0;
	}
	.legend line {
		stroke-width: 2;
	}
	.legend line.sigma {
		stroke: var(--muted);
	}
	.legend line.omega {
		stroke: var(--muted);
		stroke-dasharray: 4 3;
	}
	.legend line.jw {
		stroke: var(--text);
	}
	.legend line.aliased {
		stroke: var(--s8);
	}
	.legend .x {
		stroke: var(--s2);
		stroke-width: 2;
		stroke-linecap: round;
	}
</style>
