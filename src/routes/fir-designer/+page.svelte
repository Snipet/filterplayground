<script lang="ts">
	import ToolLayout from '$lib/components/layout/ToolLayout.svelte';
	import ControlGroup from '$lib/components/layout/ControlGroup.svelte';
	import Card from '$lib/components/layout/Card.svelte';
	import Select from '$lib/components/controls/Select.svelte';
	import Segmented from '$lib/components/controls/Segmented.svelte';
	import Slider from '$lib/components/controls/Slider.svelte';
	import NumberInput from '$lib/components/controls/NumberInput.svelte';
	import Toggle from '$lib/components/controls/Toggle.svelte';
	import ResponseView, { type ResponseKind } from '$lib/components/plot/ResponseView.svelte';
	import Plot, { type Series } from '$lib/components/plot/Plot.svelte';
	import { freqFormat } from '$lib/components/plot/scales';
	import StatGrid, { type Stat } from '$lib/components/content/StatGrid.svelte';
	import Callout from '$lib/components/content/Callout.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import ExportPanel from '$lib/components/content/ExportPanel.svelte';
	import BandEditor from '$lib/features/fir-designer/BandEditor.svelte';
	import { WINDOWS, windowInfo, type WindowType } from '$lib/dsp/windows';
	import { formatSI, trimNumber } from '$lib/dsp/units';
	import type { BandType } from '$lib/dsp/types';
	import {
		METHODS,
		TYPE_NAMES,
		amplitudeAt,
		bandErrors,
		bandSeries,
		decimateMinMax,
		deltas,
		denseResponse,
		designFir,
		desiredAt,
		edgeLabels,
		effectiveSymmetry,
		forcedZeros,
		gapRegions,
		linearPhaseType,
		maskRegions,
		measureSpec,
		methodInfo,
		specBands,
		typeConflicts,
		validateBands,
		validateSpec,
		weightAt,
		type Band,
		type FirConfig,
		type FirDesign,
		type Method,
		type Shape,
		type Spec,
		type Symmetry
	} from '$lib/features/fir-designer/design';
	import { matlabRecipe, scipyRecipe } from '$lib/features/fir-designer/recipes';
	import { toolHref } from '$lib/paths';
	import PoleZeroPlot from '$lib/components/plot/PoleZeroPlot.svelte';
	import { firZerosFast } from '$lib/features/fir-designer/fastRoots';

	// ---------------- state ----------------
	let method = $state<Method>('pm');
	let shape = $state<Shape>('lowpass');
	let fs = $state(48000);
	let edges = $state<Record<BandType, number[]>>({
		lowpass: [6000, 8000],
		highpass: [6000, 8000],
		bandpass: [4000, 6000, 10000, 12000],
		bandstop: [4000, 6000, 10000, 12000]
	});
	let rp = $state(0.5);
	let rs = $state(60);
	let auto = $state(true);
	let numtaps = $state(61);
	let winType = $state<WindowType>('hamming');
	let winParams = $state<Partial<Record<WindowType, number>>>({});
	let symmetry = $state<Symmetry>('even');
	let relWeight = $state(false);
	let fsampFrac = $state(0.5);
	let customBands = $state<Band[]>([
		{ f1: 0, f2: 3600, d1: 1, d2: 1, weight: 1 },
		{ f1: 4800, f2: 8400, d1: 0, d2: 0, weight: 10 },
		{ f1: 9600, f2: 14400, d1: 0.5, d2: 0.5, weight: 1 },
		{ f1: 15600, f2: 24000, d1: 0, d2: 0, weight: 10 }
	]);

	const info = $derived(methodInfo(method));
	const shapeEff = $derived<Shape>(shape === 'custom' && !info.custom ? 'lowpass' : shape);
	const isCustom = $derived(shapeEff === 'custom');
	const band = $derived<BandType>(shapeEff === 'custom' ? 'lowpass' : shapeEff);
	const usesWindow = $derived(method === 'window' || method === 'fsamp');
	const winInfo = $derived(windowInfo(winType));
	const winParam = $derived(winInfo.param ? (winParams[winType] ?? winInfo.param.default) : undefined);
	const nyq = $derived(fs / 2);

	const spec = $derived<Spec>({ band, edges: [...edges[band]], rp, rs });

	// only read the inputs a method actually uses, so unrelated controls never trigger a redesign
	const cfg = $derived.by((): FirConfig => ({
		method,
		fs,
		shape: shapeEff,
		spec: isCustom ? { band: 'lowpass', edges: [1, 2], rp: 1, rs: 40 } : spec,
		bands: isCustom ? $state.snapshot(customBands) : [],
		numtaps: auto && !isCustom ? 0 : numtaps,
		auto: auto && !isCustom,
		window: usesWindow ? { type: winType, param: winParam } : { type: 'hamming' },
		symmetry: method === 'pm' && isCustom ? symmetry : 'even',
		relWeight: method === 'pm' && isCustom && symmetry === 'odd' ? relWeight : false,
		fsampFrac: method === 'fsamp' && !isCustom ? fsampFrac : undefined
	}));

	const inputErrors = $derived.by((): string[] => {
		if (isCustom) return validateBands(cfg.bands, fs, method);
		const e = validateSpec(spec, fs);
		return e ? [e] : [];
	});

	const result = $derived.by((): { d: FirDesign | null; error: string | null } => {
		if (inputErrors.length) return { d: null, error: null };
		try {
			return { d: designFir(cfg), error: null };
		} catch (e) {
			return { d: null, error: e instanceof Error ? e.message : String(e) };
		}
	});

	// keep the last good design on screen while the input is invalid
	let lastGood: FirDesign | null = null;
	const design = $derived.by(() => {
		if (result.d) lastGood = result.d;
		return result.d ?? lastGood;
	});

	const N = $derived(design?.numtaps ?? numtaps);
	const h = $derived(design?.h ?? [1]);
	const sym = $derived<Symmetry>(design?.symmetry ?? 'even');
	const lpType = $derived(linearPhaseType(N, sym));
	const filter = $derived({ kind: 'digital' as const, fs, fir: h });
	const conflicts = $derived(design ? typeConflicts(lpType, design.bands, fs) : []);

	const dense = $derived(denseResponse(h, fs, sym));
	const measure = $derived(design && !isCustom ? measureSpec(h, spec, fs, dense) : null);
	const errs = $derived(design && isCustom ? bandErrors(h, design.bands, fs, sym, cfg.relWeight, dense) : []);
	const { dp } = $derived(deltas(rp, rs));

	// ---------------- stats ----------------
	const stats = $derived.by((): Stat[] => {
		if (!design) return [];
		const delay = (N - 1) / 2;
		let zerosInHalf = 0;
		const peak = Math.max(...h.map(Math.abs));
		for (let i = 0; i < Math.ceil(N / 2); i++) if (Math.abs(h[i]) <= 1e-12 * peak) zerosInHalf++;
		const folded = Math.ceil(N / 2) - zerosInHalf;
		const out: Stat[] = [
			{
				label: 'Taps N',
				value: String(N),
				hint: design.auto ? `${design.auto.formula} estimate: ${design.auto.estimate} taps` : 'Length set manually'
			},
			{
				label: 'Linear-phase type',
				value: `${TYPE_NAMES[lpType]} (${N % 2 ? 'odd' : 'even'}, ${sym === 'even' ? 'symmetric' : 'antisymmetric'})`
			},
			{ label: 'Delay (N−1)/2', value: `${trimNumber(delay, 5)} samples · ${formatSI(delay / fs, 's', 3)}`, hint: 'Constant group delay of a linear-phase FIR' },
			{
				label: 'Multiplies / sample',
				value: `${N} → ${folded} folded`,
				hint: 'Direct form needs N multiplies; folding the symmetric pairs (h[k] = ±h[N−1−k]) needs about half'
			}
		];
		if (measure) {
			out.push({
				label: 'Passband ripple',
				value: `${trimNumber(measure.rippleDb, 3)} dB`,
				status: measure.passOk ? 'good' : 'warning',
				hint: `Measured on a dense grid. Spec: ±δp = ±${trimNumber(dp, 3)} around 1 (${rp} dB peak-to-peak)`
			});
			out.push({
				label: 'Stopband attenuation',
				value: `${trimNumber(measure.attenDb, 4)} dB`,
				status: measure.stopOk ? 'good' : 'warning',
				hint: `Measured minimum attenuation. Spec: ${rs} dB`
			});
		}
		if (design.auto) out.push({ label: `${design.auto.formula} estimate`, value: `${design.auto.estimate} taps`, hint: 'Length predicted by the formula, before checking the actual design' });
		if (design.beta !== undefined) out.push({ label: 'Kaiser β', value: trimNumber(design.beta, 4) });
		if (design.remez) {
			out.push({ label: 'Weighted ripple δ', value: trimNumber(design.remez.delta, 4), hint: 'Peak weighted error: every band deviates by δ / W' });
			out.push({
				label: 'Remez iterations',
				value: `${design.remez.iterations}${design.remez.converged ? '' : ' (not converged)'}`,
				status: design.remez.converged ? undefined : 'warning'
			});
		}
		return out;
	});

	// ---------------- plots ----------------
	const regions = $derived(isCustom ? gapRegions(design?.bands ?? [], fs) : maskRegions(spec, fs));
	// group delay is the constant (N−1)/2 by construction (shown in the stats), so it is not plotted;
	// zeros are drawn in their own card with the local fast root finder
	const views: ResponseKind[] = ['phase', 'impulse'];
	const MAX_ZERO_TAPS = 256;
	const zeros = $derived(N <= MAX_ZERO_TAPS ? firZerosFast(h) : []);
	const poles = $derived(zeros.map(() => ({ re: 0, im: 0 })));

	const passBands = $derived(design && !isCustom ? specBands(spec, fs).bands.filter((_, i) => specBands(spec, fs).kinds[i] === 'pass') : []);
	const passSeries = $derived.by((): Series[] => {
		if (!passBands.length) return [];
		const s = bandSeries(dense, passBands, (_f, _A, mag) => 20 * Math.log10(Math.max(mag, 1e-12)));
		return [{ ...s, label: '|H|', color: 'var(--s1)', format: (v: number) => `${trimNumber(v, 4)} dB` }];
	});
	const passLimits = $derived([
		{ value: 20 * Math.log10(1 + dp), label: `+${trimNumber(20 * Math.log10(1 + dp), 3)} dB` },
		{ value: 20 * Math.log10(1 - dp), label: `${trimNumber(20 * Math.log10(1 - dp), 3)} dB` }
	]);
	const passYDomain = $derived.by((): [number, number] => {
		const ys = passSeries[0]?.y ?? [];
		let lo = passLimits[1].value;
		let hi = passLimits[0].value;
		for (let i = 0; i < ys.length; i++)
			if (Number.isFinite(ys[i])) {
				lo = Math.min(lo, ys[i]);
				hi = Math.max(hi, ys[i]);
			}
		const pad = Math.max(0.01, (hi - lo) * 0.15);
		return [lo - pad, hi + pad];
	});
	const passDomain = $derived.by((): [number, number] => {
		if (!passBands.length) return [0, nyq];
		const lo = Math.min(...passBands.map((b) => b.f1));
		const hi = Math.max(...passBands.map((b) => b.f2));
		const pad = (hi - lo) * 0.02;
		return [Math.max(0, lo - pad), Math.min(nyq, hi + pad)];
	});

	// custom: amplitude vs desired
	const ampSeries = $derived.by((): Series[] => {
		if (!design || !isCustom) return [];
		const A = decimateMinMax(dense.f, dense.A, 900);
		const D = { x: [] as number[], y: [] as number[] };
		for (const b of design.bands) {
			D.x.push(b.f1, b.f2, b.f2);
			D.y.push(b.d1, b.d2, NaN);
		}
		return [
			{ ...A, label: 'Amplitude A(f)', color: 'var(--s1)' },
			{ ...D, label: 'Desired D(f)', color: 'var(--s2)', dash: '6 4', width: 2.5 }
		];
	});

	// Parks–McClellan weighted error
	const errorSeries = $derived.by((): Series[] => {
		if (!design?.remez) return [];
		const bands = design.bands;
		const rel = cfg.relWeight;
		const s = bandSeries(dense, bands, (f, A, _m, b) => {
			const D = desiredAt(b, f);
			return weightAt(b, D, rel) * (D - A);
		});
		const ex = design.remez.extremals;
		const ey = ex.map((f) => {
			const b = bands.find((bb) => f >= bb.f1 - 1e-9 && f <= bb.f2 + 1e-9) ?? bands[0];
			const D = desiredAt(b, f);
			return weightAt(b, D, rel) * (D - amplitudeAt(h, sym, f / fs));
		});
		return [
			{ ...decimateMinMax(s.x, s.y, 900), label: 'E(f)', color: 'var(--s1)', format: (v: number) => trimNumber(v, 4) },
			{ x: ex, y: ey, label: `Extremal frequencies (${ex.length})`, color: 'var(--s2)', kind: 'points', format: (v: number) => trimNumber(v, 4) }
		];
	});
	const deltaLines = $derived(
		design?.remez
			? [
					{ value: design.remez.delta, label: '+δ' },
					{ value: -design.remez.delta, label: '−δ' }
				]
			: []
	);

	// ---------------- export ----------------
	const recipes = $derived(
		design
			? [
					{ label: 'SciPy', code: scipyRecipe(cfg, design) },
					{ label: 'MATLAB', code: matlabRecipe(cfg, design), language: 'matlab' }
				]
			: []
	);

	// ---------------- actions ----------------
	function setFs(v: number) {
		if (!(v > 0) || v === fs) return;
		const k = v / fs;
		for (const key of Object.keys(edges) as BandType[]) edges[key] = edges[key].map((e) => Number((e * k).toPrecision(6)));
		for (const b of customBands) {
			b.f1 = Number((b.f1 * k).toPrecision(6));
			b.f2 = Number((b.f2 * k).toPrecision(6));
		}
		fs = v;
	}

	function setAuto(v: boolean) {
		if (!v && design) numtaps = design.numtaps;
	}

	function bumpLength() {
		auto = false;
		numtaps = N + 1;
	}

	type Preset = 'spec' | 'multiband' | 'differentiator' | 'hilbert';
	let preset = $state<Preset>('multiband');
	function applyPreset(p: Preset) {
		const q = (x: number) => Number((x * nyq).toPrecision(5));
		if (p === 'spec') {
			const sb = specBands({ band: shape === 'custom' ? 'lowpass' : (shape as BandType), edges: edges[shape === 'custom' ? 'lowpass' : (shape as BandType)], rp, rs }, fs);
			customBands = sb.bands.map((b) => ({ ...b, weight: Number(b.weight.toPrecision(4)) }));
			symmetry = 'even';
		} else if (p === 'multiband') {
			customBands = [
				{ f1: 0, f2: q(0.15), d1: 1, d2: 1, weight: 1 },
				{ f1: q(0.2), f2: q(0.35), d1: 0, d2: 0, weight: 10 },
				{ f1: q(0.4), f2: q(0.6), d1: 0.5, d2: 0.5, weight: 1 },
				{ f1: q(0.65), f2: nyq, d1: 0, d2: 0, weight: 10 }
			];
			symmetry = 'even';
		} else if (p === 'differentiator') {
			customBands = [{ f1: 0, f2: q(0.9), d1: 0, d2: Number((0.9 * Math.PI).toPrecision(6)), weight: 1 }];
			symmetry = 'odd';
			relWeight = true;
			numtaps = 32;
		} else {
			customBands = [{ f1: q(0.05), f2: q(0.95), d1: 1, d2: 1, weight: 1 }];
			symmetry = 'odd';
			relWeight = false;
			numtaps = 31;
		}
	}

	const methodOptions = METHODS.map((m) => ({ value: m.id, label: m.name }));
	const windowOptions = WINDOWS.map((w) => ({ value: w.id, label: w.name }));
	const shapeOptions = $derived([
		{ value: 'lowpass' as Shape, label: 'LP' },
		{ value: 'highpass' as Shape, label: 'HP' },
		{ value: 'bandpass' as Shape, label: 'BP' },
		{ value: 'bandstop' as Shape, label: 'BS' },
		{ value: 'custom' as Shape, label: 'Custom', disabled: !info.custom, title: info.custom ? 'Multiband / arbitrary bands' : 'Not available for this method' }
	]);
	const presetOptions = $derived([
		{ value: 'multiband' as Preset, label: 'Multiband (three levels)' },
		{ value: 'spec' as Preset, label: `From the ${shape === 'custom' ? 'low-pass' : shape} specification` },
		...(method === 'pm'
			? [
					{ value: 'differentiator' as Preset, label: 'Differentiator (antisymmetric ramp)' },
					{ value: 'hilbert' as Preset, label: 'Hilbert transformer (antisymmetric)' }
				]
			: [])
	]);
	const fz = $derived(forcedZeros(lpType));
</script>

<ToolLayout slug="fir-designer" related={['windows', 'special-fir', 'linear-phase', 'order-calculator', 'convolution']}>
	{#snippet controls()}
		<ControlGroup title="Method">
			<Select label="Design method" bind:value={method} options={methodOptions} />
			<p class="small muted desc">{info.summary}</p>
		</ControlGroup>

		<ControlGroup title="Response">
			<Segmented label="Band type" value={shapeEff} options={shapeOptions} onchange={(v) => (shape = v)} />
			<NumberInput label="Sample rate fs" value={fs} unit="Hz" si min={1} logStep={1.25} onchange={setFs} />
		</ControlGroup>

		{#if !isCustom}
			<ControlGroup title="Band edges">
				{#each edgeLabels(band) as lab, i (band + i)}
					<Slider label={lab} bind:value={edges[band][i]} min={0} max={nyq} step={nyq / 2400} unit="Hz" si digits={4} />
				{/each}
			</ControlGroup>
			<ControlGroup title="Ripple & attenuation">
				<Slider label="Passband ripple Rp" bind:value={rp} min={0.01} max={3} log unit="dB" />
				<Slider label="Stopband attenuation Rs" bind:value={rs} min={10} max={120} step={1} unit="dB" />
				<p class="small muted">δp = {trimNumber(dp, 3)}, δs = {trimNumber(Math.pow(10, -rs / 20), 3)} (linear deviations)</p>
			</ControlGroup>
		{/if}

		<ControlGroup title="Length">
			<Toggle label="Auto from specs" bind:checked={auto} disabled={isCustom} onchange={setAuto} help={isCustom ? 'Custom bands have no ripple spec: set N by hand.' : method === 'kaiser' ? "Kaiser's formula" : 'Smallest length that meets the spec'} />
			{#if auto && !isCustom}
				<Slider label="Taps N" value={N} min={3} max={info.maxTaps} integer disabled />
			{:else}
				<Slider
					label="Taps N"
					bind:value={numtaps}
					min={3}
					max={info.maxTaps}
					integer
					onchange={(v) => {
						if (method === 'ls' && v % 2 === 0) numtaps = Math.min(info.maxTaps, v + 1);
					}}
				/>
			{/if}
			{#if method === 'ls'}<p class="small muted">Least squares here is type I: even lengths are rounded up.</p>{/if}
		</ControlGroup>

		{#if method === 'fsamp' && !isCustom}
			<ControlGroup title="Desired response">
				<Slider
					label="Desired transition width"
					value={fsampFrac * 100}
					min={0}
					max={100}
					step={5}
					unit="%"
					onchange={(v) => (fsampFrac = v / 100)}
					help="Linear ramp in the sampled response, as a share of the spec's transition band (0 % = brick wall). The window smooths its corners, so it must be narrower than the spec."
				/>
			</ControlGroup>
		{/if}

		{#if usesWindow}
			<ControlGroup title="Window">
				<Select label="Window" bind:value={winType} options={windowOptions} />
				{#if winInfo.param}
					<Slider
						label={winInfo.param.label}
						value={winParam ?? winInfo.param.default}
						min={winInfo.param.min}
						max={winInfo.param.max}
						step={winInfo.param.step}
						onchange={(v) => (winParams[winType] = v)}
						help={winInfo.param.help}
					/>
				{/if}
			</ControlGroup>
		{/if}

		{#if method === 'pm' && isCustom}
			<ControlGroup title="Symmetry">
				<Segmented
					bind:value={symmetry}
					options={[
						{ value: 'even', label: 'Symmetric (I/II)' },
						{ value: 'odd', label: 'Antisymmetric (III/IV)' }
					]}
				/>
				{#if symmetry === 'odd'}
					<Toggle label="Differentiator weighting" bind:checked={relWeight} help="Weight W/|D| in sloped bands: equal relative error, as for differentiators." />
					<p class="small muted">Antisymmetric designs realise H = j·A(f)·e<sup>−jωM</sup>: a gain of 1 gives j·sgn(ω) (SciPy's “hilbert” convention).</p>
				{/if}
			</ControlGroup>
		{/if}
	{/snippet}

	{#if inputErrors.length && !isCustom}
		<Callout kind="danger" title="Invalid specification">{inputErrors[0]}</Callout>
	{/if}
	{#if result.error}
		<Callout kind="danger" title="Design failed">{result.error}</Callout>
	{/if}
	{#if design && result.d}
		{#if conflicts.length}
			<Callout kind="warning" title="{TYPE_NAMES[lpType]} cannot realise this response">
				{#each conflicts as c, i (i)}<p>{c}</p>{/each}
				<p>
					{#if sym === 'even'}
						An odd length gives a type I filter, which has no forced zeros.
					{:else}
						Antisymmetric filters always vanish at DC; type IV (even N) at least keeps fs/2 free.
					{/if}
				</p>
				<button class="btn small" type="button" onclick={bumpLength}>Use N = {N + 1} taps ({TYPE_NAMES[linearPhaseType(N + 1, sym)]})</button>
			</Callout>
		{/if}
		{#if design.auto && !design.auto.met}
			<Callout kind="warning" title="Specification not reached">
				{#if design.auto.capped && method !== 'kaiser'}
					No length up to {info.maxTaps} taps meets the mask with this method{usesWindow ? ` and the ${winInfo.name} window` : ''}.
					{#if method === 'window' && measure && !measure.stopOk}
						The window's sidelobes limit the attenuation to about {trimNumber(measure.attenDb, 3)} dB here — pick a window with lower sidelobes (or the Kaiser method).
					{:else if method === 'fsamp' && !isCustom}
						The window rounds off the corners of the sampled response, so the band edges miss their targets: make the desired transition narrower, or use a window with lower sidelobes.
					{:else}
						Relax the ripple or widen the transition band.
					{/if}
				{:else if method === 'kaiser'}
					Kaiser's formula is an estimate: at N = {N} the design misses the mask slightly ({measure && !measure.stopOk ? `${trimNumber(measure.attenDb, 3)} dB attenuation` : `${trimNumber(measure?.rippleDb ?? 0, 3)} dB ripple`}). Add a few taps by hand to close the gap.
				{/if}
			</Callout>
		{/if}
		{#if method === 'window' && design.auto?.met && design.numtaps > 2 * design.auto.estimate}
			<Callout kind="note" title="Window-limited design">
				The {winInfo.name} window's own sidelobes are not far enough below −{rs} dB, so the mask is met only by making the
				transition much narrower than required: N = {N} where a Kaiser window with the right β needs about {design.auto.estimate}.
				Try Blackman, Kaiser or the Kaiser method.
			</Callout>
		{/if}
		{#if design.remez && !design.remez.converged}
			<Callout kind="warning" title="Remez did not converge">
				The exchange stopped after {design.remez.iterations} iterations without equal ripple. The taps are usable but not optimal — this usually means a band is too narrow or the length too large for the grid. Try fewer taps or wider bands.
			</Callout>
		{/if}
	{/if}

	{#if isCustom}
		<Card title="Bands" subtitle="Desired amplitude per band (linear ramps allowed), with a weight for least squares and Parks–McClellan.">
			{#snippet actions()}
				<Select label="Start from" bind:value={preset} options={presetOptions} />
				<button class="btn small" type="button" onclick={() => applyPreset(preset)}>Load</button>
			{/snippet}
			<BandEditor bind:bands={customBands} {fs} showWeight={method !== 'fsamp'} errors={inputErrors} />
		</Card>
	{/if}

	<StatGrid {stats} />

	<ResponseView filters={[{ filter, label: `${info.name}, N = ${N}` }]} {regions} {views} dbRange={Math.max(100, isCustom ? 100 : rs + 50)} />

	<div class="two">
		<Card title="Zeros (z-plane)" subtitle={N <= MAX_ZERO_TAPS ? `${zeros.length} zeros; all poles at the origin. Stopband zeros sit on the unit circle; the rest come in mirror pairs z, 1/z*.` : `Not drawn above ${MAX_ZERO_TAPS} taps.`}>
			{#if N <= MAX_ZERO_TAPS}
				<PoleZeroPlot {zeros} {poles} domain="z" {fs} height={300} />
			{/if}
		</Card>
		{#if !isCustom && passSeries.length}
			<Card title="Passband detail" subtitle="The response zoomed into the passband{passBands.length > 1 ? 's' : ''}, with the ±δp limits of the mask.">
				<Plot series={passSeries} xDomain={passDomain} yDomain={passYDomain} hlines={passLimits} xLabel="Frequency (Hz)" yLabel="Magnitude (dB)" xFormat={freqFormat} xTooltipFormat={(v) => formatSI(v, 'Hz', 4)} height={300} minYSpan={0.05} exportName="passband" />
			</Card>
		{/if}
		{#if isCustom && ampSeries.length}
			<Card title="Amplitude vs desired" subtitle="The real (zero-phase) amplitude A(f) — it may go negative — against the desired response in each band.">
				<Plot series={ampSeries} xDomain={[0, nyq]} xLabel="Frequency (Hz)" yLabel="Amplitude" xFormat={freqFormat} xTooltipFormat={(v) => formatSI(v, 'Hz', 4)} height={240} exportName="amplitude" />
				<div class="table-wrap">
					<table class="errtab">
						<thead><tr><th>#</th><th>Range</th><th>Desired</th><th class="num">Max |A − D|</th></tr></thead>
						<tbody>
							{#each design?.bands ?? [] as b, i (i)}
								<tr>
									<td>{i + 1}</td>
									<td>{formatSI(b.f1, 'Hz', 4)} – {formatSI(b.f2, 'Hz', 4)}</td>
									<td>{b.d1 === b.d2 ? trimNumber(b.d1, 4) : `${trimNumber(b.d1, 4)} → ${trimNumber(b.d2, 4)}`}</td>
									<td class="num">{errs[i] ? `${trimNumber(errs[i].maxErr, 3)} (${trimNumber(20 * Math.log10(Math.max(errs[i].maxErr, 1e-12)), 3)} dB)` : '—'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</Card>
		{/if}
	</div>

	{#if design?.remez && errorSeries.length}
		<Card
			title="Weighted error E(f) = W(f)·[D(f) − A(f)]"
			subtitle="At the optimum the error equioscillates between ±δ. The dots are the final extremal frequencies of the Remez exchange."
		>
			<Plot series={errorSeries} xDomain={[0, nyq]} hlines={deltaLines} xLabel="Frequency (Hz)" yLabel="Weighted error" xFormat={freqFormat} xTooltipFormat={(v) => formatSI(v, 'Hz', 4)} height={240} exportName="remez-error" />
			<p class="small muted note">
				{design.remez.extremals.length} extremal frequencies = r + 1, where r = {design.remez.extremals.length - 1} is the number of cosine{sym === 'odd' ? '/sine' : ''} terms in A(f). {design.remez.converged ? `Converged in ${design.remez.iterations} iterations.` : `Stopped after ${design.remez.iterations} iterations without converging.`}
				δ = {trimNumber(design.remez.delta, 4)}{isCustom ? '' : ` → passband ±${trimNumber(design.remez.delta, 3)}, stopband ${trimNumber(design.remez.delta / (specBands(spec, fs).bands.find((_, i) => specBands(spec, fs).kinds[i] === 'stop')?.weight ?? 1), 3)}`}.
			</p>
		</Card>
	{/if}

	<Card title="Export">
		<ExportPanel kind="digital" fir={h} {fs} {recipes} name="fir" />
	</Card>

	{#snippet theory()}
		<h2>Designing FIR filters</h2>
		<p>
			An FIR filter computes <Tex math={'y[n]=\\sum_{k=0}^{N-1} h[k]\\,x[n-k]'} />: its N taps <em>are</em> the impulse response.
			Every method on this page solves the same problem — choose N numbers so that
			<Tex math={'H(e^{j\\omega})=\\sum_k h[k]e^{-j\\omega k}'} /> approximates a desired response — and differs only in how
			“approximates” is measured.
		</p>

		<h3>The ideal filter and the Gibbs phenomenon</h3>
		<p>The ideal low-pass with cutoff ω<sub>c</sub> = 2πf<sub>c</sub>/f<sub>s</sub> has an infinitely long sinc impulse response, here delayed by M = (N−1)/2:</p>
		<Tex display math={'h_d[n]=\\frac{\\sin\\big(\\omega_c (n-M)\\big)}{\\pi (n-M)}'} />
		<p>
			Truncating it to N taps multiplies it by a rectangle, which convolves the brick-wall response with the rectangle's
			transform (a Dirichlet kernel). The result overshoots by about 9 % near the edge — the <strong>Gibbs phenomenon</strong> — and
			the first stopband lobe sits near −21 dB no matter how large N is. More taps only squeeze the ripples closer to the edge.
		</p>

		<h3>Window method and Kaiser's formulas</h3>
		<p>
			Tapering with a smooth window, <Tex math={'h[n]=h_d[n]\\,w[n]'} />, trades a wider transition (the window's main lobe) for
			lower ripple (its sidelobes). For a given window the attenuation is roughly fixed and the transition width shrinks as 1/N:
		</p>
		<div class="table-wrap"><table>
			<thead><tr><th>Window</th><th class="num">Attenuation</th><th class="num">Transition Δf·N/f<sub>s</sub></th></tr></thead>
			<tbody>
				<tr><td>Rectangular</td><td class="num">≈ 21 dB</td><td class="num">0.9</td></tr>
				<tr><td>Hann</td><td class="num">≈ 44 dB</td><td class="num">3.1</td></tr>
				<tr><td>Hamming</td><td class="num">≈ 53 dB</td><td class="num">3.3</td></tr>
				<tr><td>Blackman</td><td class="num">≈ 74 dB</td><td class="num">5.5</td></tr>
			</tbody>
		</table></div>
		<p>
			The Kaiser window has a parameter β that slides along this trade-off. Kaiser fitted formulas that give β and the length
			from the attenuation <Tex math={'A=-20\\log_{10}\\min(\\delta_p,\\delta_s)'} /> (a window gives equal ripple in both
			bands) and the transition width <Tex math={'\\Delta\\omega=2\\pi\\,\\Delta f/f_s'} />:
		</p>
		<Tex display math={'\\beta=\\begin{cases}0.1102\\,(A-8.7) & A>50\\\\ 0.5842\\,(A-21)^{0.4}+0.07886\\,(A-21) & 21\\le A\\le 50\\\\ 0 & A<21\\end{cases}\\qquad N=\\left\\lceil\\frac{A-7.95}{2.285\\,\\Delta\\omega}+1\\right\\rceil'} />

		<h3>Frequency sampling</h3>
		<p>
			<code>firwin2</code> samples a piecewise-linear desired response D(f) on a dense grid, attaches the linear phase
			<Tex math={'e^{-j\omega M}'} />, inverse-FFTs it and keeps (and windows) the first N samples. Windowing is again a
			convolution in frequency, so the corners of D(f) are rounded off over about one main-lobe width: a ramp that spans the
			whole transition band can never reach the stopband target at the stopband edge. Narrowing the ramp leaves room for the
			smoothing; a gentle ramp, in turn, causes less ripple than a brick wall.
		</p>

		<h3>Least squares vs minimax</h3>
		<p>Writing the response of a linear-phase filter as a real amplitude A(ω) times a pure delay, the two optimal methods minimise different norms of the weighted error over the bands B:</p>
		<Tex display math={'\\text{LS: }\\min_h \\int_{B} W(\\omega)\\,\\big[A(\\omega)-D(\\omega)\\big]^2\\,d\\omega\\qquad\\qquad \\text{minimax: }\\min_h \\max_{\\omega\\in B} W(\\omega)\\,\\big|A(\\omega)-D(\\omega)\\big|'} />
		<p>
			Least squares is a linear system (the normal equations) and gives the smallest error <em>energy</em>, but its ripples grow
			towards the band edges. Minimax spreads the error evenly — equiripple — which is what a dB mask asks for, so it meets a
			given spec with the fewest taps. Weights set the ratio of the ripples: with W<sub>pass</sub> = 1 and
			W<sub>stop</sub> = δ<sub>p</sub>/δ<sub>s</sub> both bands hit their limits together.
		</p>

		<h3>The alternation theorem and the Remez exchange</h3>
		<p>
			For a type I filter, <Tex math={'A(\\omega)=\\sum_{k=0}^{r-1} a_k\\cos(k\\omega)'} /> with r = (N+1)/2. Chebyshev's alternation
			theorem says this is the unique best minimax approximation if and only if the weighted error
			<Tex math={'E(\\omega)=W(\\omega)[D(\\omega)-A(\\omega)]'} /> reaches its maximum magnitude δ with alternating sign at
			(at least) r + 1 frequencies. Parks and McClellan turned this into an algorithm:
		</p>
		<ol>
			<li>Guess r + 1 extremal frequencies ω<sub>i</sub> on a dense grid.</li>
			<li>Solve <Tex math={'W(\\omega_i)[D(\\omega_i)-A(\\omega_i)]=(-1)^i\\delta'} /> for the coefficients and δ (done with barycentric Lagrange interpolation).</li>
			<li>Evaluate E(ω) on the grid, move the extremal set to the new local peaks of |E| (keeping the alternation).</li>
			<li>Repeat until the peaks all have the same height. The error plot above shows the final set.</li>
		</ol>
		<p>
			Herrmann, Rabiner and Chan's estimate of the length for a low-pass equiripple design (Δf normalised to f<sub>s</sub>) is
			<Tex math={'N\\approx D_\\infty(\\delta_p,\\delta_s)/\\Delta f-f(\\delta_p,\\delta_s)\\,\\Delta f+1'} />; a simpler
			version of the same law is Kaiser's
			<Tex math={'N\\approx\\dfrac{-10\\log_{10}(\\delta_p\\delta_s)-13}{14.6\\,\\Delta f/f_s}+1'} />. With <em>Auto</em> on, this
			page starts from the estimate and searches for the smallest N that actually passes the mask.
		</p>

		<h3>Linear phase: the four types</h3>
		<p>
			Symmetric taps <Tex math={'h[n]=h[N-1-n]'} /> give <Tex math={'H=A(\\omega)e^{-j\\omega M}'} />; antisymmetric taps
			<Tex math={'h[n]=-h[N-1-n]'} /> give <Tex math={'H=jA(\\omega)e^{-j\\omega M}'} />. Either way the group delay is the
			constant M = (N−1)/2 samples. The symmetry forces zeros at z = ±1:
		</p>
		<div class="table-wrap"><table>
			<thead><tr><th>Type</th><th>N</th><th>Symmetry</th><th>Forced zeros</th><th>Cannot do</th></tr></thead>
			<tbody>
				<tr class:cur={lpType === 1}><td>I</td><td>odd</td><td>symmetric</td><td>none</td><td>— (any response)</td></tr>
				<tr class:cur={lpType === 2}><td>II</td><td>even</td><td>symmetric</td><td>z = −1 (H(f<sub>s</sub>/2) = 0)</td><td>high-pass, band-stop</td></tr>
				<tr class:cur={lpType === 3}><td>III</td><td>odd</td><td>antisymmetric</td><td>z = +1 and z = −1</td><td>low-pass, high-pass, band-stop</td></tr>
				<tr class:cur={lpType === 4}><td>IV</td><td>even</td><td>antisymmetric</td><td>z = +1 (H(0) = 0)</td><td>low-pass, band-stop</td></tr>
			</tbody>
		</table></div>
		<p class="small muted">
			The current design is {TYPE_NAMES[lpType]}{fz.dc || fz.nyq ? `, with ${[fz.dc ? 'H(0) = 0' : '', fz.nyq ? 'H(fs/2) = 0' : ''].filter(Boolean).join(' and ')}` : ' — no forced zeros'}.
			Types III and IV are what Hilbert transformers and differentiators use (see <a href={toolHref('special-fir')}>special-purpose FIRs</a>).
		</p>

		<h3>Transition width ↔ length</h3>
		<p>
			For every method the required length grows with the attenuation and inversely with the transition width:
			<Tex math={'N\\propto A/\\Delta f'} />. Halving the transition band doubles the taps (and the delay and the
			multiplications per sample); going from 60 to 80 dB of attenuation costs roughly 40 % more taps.
		</p>

		<Callout kind="try">
			<ul>
				<li>Keep the default spec and switch Parks–McClellan → Kaiser → Least squares → Window (Hamming): compare the tap counts the same mask needs.</li>
				<li>Drag the stopband edge towards the passband edge and watch N grow like 1/Δf. Then raise Rs from 60 to 80 dB.</li>
				<li>Window method with a Rectangular or Hann window: Auto cannot reach 60 dB, because the stopband floor is set by the window's sidelobes, not by N.</li>
				<li>Pick HP, turn Auto off and choose an even N: the type II zero at fs/2 wrecks the passband. Use the button to go to N + 1.</li>
				<li>Choose Custom with Parks–McClellan and load the differentiator preset: count the extremal dots and check they equal r + 1.</li>
			</ul>
		</Callout>
	{/snippet}
</ToolLayout>

<style>
	.desc {
		margin: -0.2rem 0 0;
	}
	.table-wrap {
		overflow-x: auto;
	}
	.errtab {
		margin-top: 0.6rem;
		font-size: 0.85rem;
	}
	.errtab td {
		white-space: nowrap;
	}
	.note {
		margin: 0.4rem 0 0;
	}
	tr.cur td {
		background: var(--accent-wash);
	}
	.two {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr));
		gap: 1.1rem;
	}
</style>
