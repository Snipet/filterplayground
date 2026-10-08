<script lang="ts">
	import { onMount } from 'svelte';
	import ToolLayout from '$lib/components/layout/ToolLayout.svelte';
	import ControlGroup from '$lib/components/layout/ControlGroup.svelte';
	import Card from '$lib/components/layout/Card.svelte';
	import Select from '$lib/components/controls/Select.svelte';
	import Segmented from '$lib/components/controls/Segmented.svelte';
	import Slider from '$lib/components/controls/Slider.svelte';
	import NumberInput from '$lib/components/controls/NumberInput.svelte';
	import Toggle from '$lib/components/controls/Toggle.svelte';
	import ResponseView, { type FilterEntry } from '$lib/components/plot/ResponseView.svelte';
	import type { RefLine } from '$lib/components/plot/Plot.svelte';
	import StatGrid, { type Stat } from '$lib/components/content/StatGrid.svelte';
	import Callout from '$lib/components/content/Callout.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import ExportPanel, { type Recipe } from '$lib/components/content/ExportPanel.svelte';
	import TimeCard from '$lib/features/iir-designer/TimeCard.svelte';
	import {
		checkSpec,
		edgeCrossing,
		estimateCapped,
		float32Sensitivity,
		matlabRecipe,
		restoreSpecs,
		scipyRecipe,
		sectionInfo,
		type CappedEstimate,
		type RecipeSpec,
		type SpecTable
	} from '$lib/features/iir-designer/sections';
	import { FAMILIES, familyInfo, type AnalogFamily, type BesselNorm } from '$lib/dsp/analog';
	import {
		designAnalog,
		designDigital,
		type DigitalIIRResult,
		type SpecEdges
	} from '$lib/dsp/design';
	import { sos2tf } from '$lib/dsp/convert';
	import { evaluate } from '$lib/dsp/response';
	import { prewarp as prewarpRad } from '$lib/dsp/transforms';
	import { formatSI, trimNumber } from '$lib/dsp/units';
	import { abs, type Complex } from '$lib/dsp/complex';
	import type { BandType, DigitalFilter, ZPK } from '$lib/dsp/types';
	import { specRegions } from '$lib/specmask';
	import { num } from '$lib/export';
	import { readSharedState } from '$lib/share';
	import { toolHref } from '$lib/paths';

	type Method = 'bilinear' | 'matched' | 'impulse';
	type Overlay = 'target' | 'prototype' | 'none';

	let fs = $state(48000);
	let family = $state<AnalogFamily>('ellip');
	let band = $state<BandType>('lowpass');
	let mode = $state<'order' | 'spec'>('order');
	let order = $state(6);
	let f1 = $state(8000);
	let f2 = $state(12000);
	let rp = $state(1);
	let rs = $state(60);
	let besselNorm = $state<BesselNorm>('mag');
	let method = $state<Method>('bilinear');
	let prewarp = $state(true);
	let overlay = $state<Overlay>('target');

	let specs = $state<SpecTable>({
		lowpass: { fp: [8000, 8000], fs: [10000, 10000] },
		highpass: { fp: [4000, 4000], fs: [3000, 3000] },
		bandpass: { fp: [4000, 8000], fs: [3000, 10000] },
		bandstop: { fp: [3000, 10000], fs: [4000, 8000] }
	});

	const shared = $derived({
		fs,
		family,
		band,
		mode,
		order,
		f1,
		f2,
		rp,
		rs,
		besselNorm,
		method,
		prewarp,
		overlay,
		specs
	});
	onMount(() => {
		const st = readSharedState<typeof shared>();
		if (!st) return;
		const pos = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
		if (pos(st.fs)) fs = st.fs;
		if (st.family && FAMILIES.some((f) => f.id === st.family)) family = st.family;
		if (st.band && (Object.keys(specs) as unknown[]).includes(st.band)) band = st.band;
		if (st.mode === 'order' || st.mode === 'spec') mode = st.mode;
		if (typeof st.order === 'number' && Number.isFinite(st.order))
			order = Math.min(20, Math.max(1, Math.round(st.order)));
		if (pos(st.f1)) f1 = st.f1;
		if (pos(st.f2)) f2 = st.f2;
		if (pos(st.rp)) rp = st.rp;
		if (pos(st.rs)) rs = st.rs;
		if (st.besselNorm === 'mag' || st.besselNorm === 'phase' || st.besselNorm === 'delay')
			besselNorm = st.besselNorm;
		if (st.method === 'bilinear' || st.method === 'matched' || st.method === 'impulse')
			method = st.method;
		if (typeof st.prewarp === 'boolean') prewarp = st.prewarp;
		if (st.overlay === 'target' || st.overlay === 'prototype' || st.overlay === 'none')
			overlay = st.overlay;
		specs = restoreSpecs(specs, st.specs);
	});

	const MAX_ORDER = 20;
	const nyq = $derived(fs / 2);
	const info = $derived(familyInfo(family));
	const maxOrder = $derived(Math.min(info.maxOrder, MAX_ORDER));
	const isBand = $derived(band === 'bandpass' || band === 'bandstop');
	const spec = $derived(specs[band]);
	const warped = $derived(method === 'bilinear' && prewarp);

	const specEdges = $derived<SpecEdges>({
		band,
		fp: isBand ? [spec.fp[0], spec.fp[1]] : spec.fp[0],
		fstop: isBand ? [spec.fs[0], spec.fs[1]] : spec.fs[0],
		rp,
		rs,
		fs
	});

	const specError = $derived.by((): string | null => {
		if (mode !== 'spec') return null;
		const edges = isBand ? [...spec.fp, ...spec.fs] : [spec.fp[0], spec.fs[0]];
		if (edges.some((e) => !(e > 0) || e >= nyq))
			return `Every band edge must lie between 0 and the Nyquist frequency fs/2 = ${formatSI(nyq, 'Hz', 4)}.`;
		return null;
	});

	const est = $derived.by((): CappedEstimate | null => {
		if (mode !== 'spec' || specError) return null;
		try {
			// estimated under the page's cap, so the natural frequency is for the order used
			return estimateCapped(family, specEdges, { besselNorm, maxOrder });
		} catch (e) {
			return {
				order: 1,
				f1: spec.fp[0],
				f2: spec.fp[1],
				selectivity: NaN,
				capped: false,
				error: String(e)
			};
		}
	});

	const N = $derived(est && !est.error ? Math.min(est.order, maxOrder) : Math.min(order, maxOrder));
	const c1 = $derived(est && !est.error ? est.f1 : f1);
	const c2 = $derived(est && !est.error ? (est.f2 ?? f2) : f2);

	const edgeIssue = $derived.by((): string | null => {
		if (mode !== 'order') return null;
		if (isBand && !(f1 < f2)) return 'The lower band edge must be below the upper band edge.';
		const hi = isBand ? f2 : f1;
		if (hi >= nyq)
			return `The ${isBand ? 'upper edge' : 'cutoff'} must be below fs/2 = ${formatSI(nyq, 'Hz', 4)}; it was clamped just below Nyquist.`;
		return null;
	});

	const design = $derived.by(
		(): { r: DigitalIIRResult; error?: undefined } | { r?: undefined; error: string } => {
			if (specError) return { error: specError };
			if (mode === 'order' && isBand && !(f1 < f2))
				return { error: 'The lower band edge must be below the upper band edge.' };
			try {
				const r = designDigital({
					family,
					band,
					order: N,
					f1: c1,
					f2: c2,
					rp,
					rs,
					besselNorm,
					fs,
					method,
					prewarp
				});
				if (!r.sos.every((s) => s.every(Number.isFinite)))
					return { error: 'The design produced non-finite coefficients for these settings.' };
				return { r };
			} catch (e) {
				return { error: e instanceof Error ? e.message : String(e) };
			}
		}
	);

	const sos = $derived(design.r?.sos ?? [[1, 0, 0, 1, 0, 0]]);
	const filter = $derived<DigitalFilter>({ kind: 'digital', fs, sos });
	const zpk = $derived<ZPK>(design.r?.zpk ?? { z: [], p: [], k: 1 });
	const tf = $derived(sos2tf(sos));

	// ----- analog reference -----
	const targetAnalog = $derived.by((): ZPK | null => {
		try {
			return designAnalog({
				family,
				band,
				order: N,
				f1: Math.min(c1, nyq * 0.999999),
				f2: Math.min(c2, nyq * 0.999999),
				rp,
				rs,
				besselNorm
			});
		} catch {
			return null;
		}
	});
	const analogShown = $derived(
		overlay === 'none' ? null : overlay === 'prototype' ? (design.r?.analog ?? null) : targetAnalog
	);
	const analogLabel = $derived(
		overlay === 'prototype'
			? warped
				? 'Analog H(s), prewarped'
				: 'Analog H(s) discretised'
			: 'Analog design (same edges)'
	);

	const entries = $derived.by((): FilterEntry[] => {
		const out: FilterEntry[] = [{ filter, label: 'Digital H(z)', color: 'var(--s1)' }];
		if (analogShown)
			out.push({
				filter: { kind: 'analog', zpk: analogShown },
				label: analogLabel,
				color: 'var(--s2)',
				dash: '6 4'
			});
		return out;
	});

	const warpedHz = (f: number) => prewarpRad(Math.min(f, nyq * 0.999999), fs) / (2 * Math.PI);
	const vlines = $derived.by((): RefLine[] => {
		const out: RefLine[] = [];
		if (mode === 'order') {
			if (isBand) out.push({ value: c1, label: 'f₁' }, { value: c2, label: 'f₂' });
			else out.push({ value: c1, label: 'fc' });
		}
		if (warped && overlay === 'prototype') {
			const edges = isBand ? [c1, c2] : [c1];
			edges.forEach((e, i) => {
				const w = warpedHz(e);
				if (w < nyq)
					out.push({ value: w, label: isBand ? `f′${i === 0 ? '₁' : '₂'}` : 'f′c', dash: '2 3' });
			});
		}
		return out;
	});
	const regions = $derived(
		mode === 'spec' && !specError ? specRegions(band, specEdges.fp, specEdges.fstop, rp, rs) : []
	);

	// ----- stats -----
	const sections = $derived(sos.map((s) => sectionInfo(s)));
	const maxR = $derived(Math.max(0, ...zpk.p.map(abs)));
	// every method here maps a stable analog pole strictly inside the unit circle: one that
	// lands on it was rounded there (pole Q beyond what double precision can represent)
	const roundedOntoCircle = $derived(
		!!design.r && Math.abs(maxR - 1) < 1e-12 && design.r.analog.p.every((p) => p.re < 0)
	);
	const sens = $derived.by(() => {
		try {
			return float32Sensitivity(sos);
		} catch {
			return null;
		}
	});

	const stats = $derived.by((): Stat[] => {
		if (!design.r) return [];
		const out: Stat[] = [
			{ label: 'Prototype order', value: isBand ? `${N} (→ ${2 * N} poles)` : String(N) },
			{
				label: 'Biquad sections',
				value: String(sos.length),
				hint: 'Second-order sections in the exported cascade'
			}
		];
		if (band === 'lowpass' || band === 'highpass') {
			const f3 = edgeCrossing(filter, band);
			out.push({ label: '−3 dB frequency', value: f3 ? formatSI(f3, 'Hz', 4) : '—' });
		} else {
			out.push({ label: 'Centre (geometric)', value: formatSI(Math.sqrt(c1 * c2), 'Hz', 4) });
		}
		out.push({
			label: 'Stability',
			value: `${maxR < 1 ? 'stable' : 'unstable'} · max |p| = ${trimNumber(maxR, 6)}`,
			status: maxR < 1 ? 'good' : 'critical',
			hint: 'All poles must lie strictly inside the unit circle.'
		});
		if (mode === 'spec' && !specError) {
			const fp: [number, number] = isBand ? [spec.fp[0], spec.fp[1]] : [spec.fp[0], spec.fp[0]];
			const fst: [number, number] = isBand ? [spec.fs[0], spec.fs[1]] : [spec.fs[0], spec.fs[0]];
			const chk = checkSpec(filter, band, fp, fst);
			out.push({
				label: 'Passband: worst gain',
				value: `${trimNumber(chk.passMinDb, 4)} dB (spec ≥ −${trimNumber(rp, 3)})`,
				status: chk.passMinDb >= -rp - 0.01 ? 'good' : 'warning'
			});
			out.push({ label: 'Passband ripple', value: `${trimNumber(chk.passRippleDb, 3)} dB` });
			out.push({
				label: 'Stopband: attenuation',
				value: `${trimNumber(-chk.stopMaxDb, 4)} dB (spec ≥ ${trimNumber(rs, 3)})`,
				status: -chk.stopMaxDb >= rs - 0.01 ? 'good' : 'warning'
			});
		}
		if (sens) {
			out.push({
				label: 'One b/a in float32',
				value: `${sens.tfRadius < 1 ? 'stable' : 'unstable'} · max |p| = ${trimNumber(sens.tfRadius, 6)}`,
				status: sens.tfRadius < 1 ? 'good' : 'critical',
				hint: `Expanding the cascade into a single order-${sens.order} denominator and rounding it to 32-bit floats moves the poles to this radius. The same rounding applied per section gives ${trimNumber(sens.sosRadius, 6)}.`
			});
		}
		if (method === 'impulse' && design.r && (band === 'lowpass' || band === 'bandpass')) {
			const hN = evaluate({ kind: 'analog', zpk: design.r.analog }, [nyq]).magDb[0];
			out.push({
				label: 'Analog gain at fs/2',
				value: `${trimNumber(hN, 3)} dB`,
				hint: 'Whatever the analog response passes above fs/2 aliases back into the digital band.'
			});
		}
		return out;
	});

	// ----- formatting helpers for the table -----
	const deg = (rad: number) => (rad * 180) / Math.PI;
	function fmtRoots(rs: Complex[]): string {
		if (!rs.length) return '—';
		const parts: string[] = [];
		const used = new Array(rs.length).fill(false);
		for (let i = 0; i < rs.length; i++) {
			if (used[i]) continue;
			const r = rs[i];
			const isReal = Math.abs(r.im) < 1e-9 * Math.max(1, abs(r));
			if (isReal) {
				let mult = 1;
				for (let j = i + 1; j < rs.length; j++)
					if (!used[j] && Math.abs(rs[j].im) < 1e-9 && Math.abs(rs[j].re - r.re) < 1e-7) {
						used[j] = true;
						mult++;
					}
				parts.push(`${trimNumber(r.re, 5)}${mult > 1 ? ` (×${mult})` : ''}`);
			} else {
				if (r.im < 0) continue;
				for (let j = i + 1; j < rs.length; j++)
					if (!used[j] && Math.abs(rs[j].re - r.re) < 1e-9 && Math.abs(rs[j].im + r.im) < 1e-9)
						used[j] = true;
				const m = abs(r);
				const ang = Math.atan2(r.im, r.re);
				parts.push(`${trimNumber(m, 4)}∠±${trimNumber(deg(ang), 4)}°`);
			}
			used[i] = true;
		}
		return parts.join(', ');
	}

	// ----- export -----
	const recipeSpec = $derived<RecipeSpec>({
		family,
		band,
		order: N,
		f1: c1,
		f2: isBand ? c2 : undefined,
		rp,
		rs,
		fs,
		besselNorm,
		spec: mode === 'spec' ? { fp: specEdges.fp, fstop: specEdges.fstop } : undefined,
		capped: !!est?.capped,
		requiredOrder: est?.requiredOrder
	});
	const recipes = $derived.by((): Recipe[] => {
		if (!warped) {
			const why =
				method === 'bilinear'
					? 'the bilinear transform without prewarping'
					: method === 'matched'
						? 'the matched-Z transform'
						: 'impulse invariance';
			const note = `This design uses ${why}. SciPy's and MATLAB's IIR design functions always use the\nprewarped bilinear transform, so they would give a different filter.\nUse the SOS / poles-and-zeros tabs to reproduce this design exactly.`;
			return [
				{ label: 'SciPy', code: `# ${note.replace(/\n/g, '\n# ')}`, language: 'python' },
				{ label: 'MATLAB', code: `% ${note.replace(/\n/g, '\n% ')}`, language: 'matlab' }
			];
		}
		const py = scipyRecipe(recipeSpec);
		const m = matlabRecipe(recipeSpec);
		return [
			{
				label: 'SciPy',
				code:
					py ??
					`# ${info.name} filters are not available in scipy.signal.\n# Use the SOS export instead.`,
				language: 'python'
			},
			{
				label: 'MATLAB',
				code:
					m ??
					(family === 'bessel'
						? `% MATLAB has no digital Bessel design (besself is analog-only and uses a\n% different normalisation). Use the SOS or poles/zeros export instead.`
						: `% ${info.name} filters are not available in the Signal Processing Toolbox.\n% Use the SOS export instead.`),
				language: 'matlab'
			}
		];
	});

	const familyOptions = FAMILIES.map((f) => ({ value: f.id, label: f.name }));
	const FS_PRESETS = [8000, 16000, 22050, 32000, 44100, 48000, 96000, 192000];
	const fsOptions = [
		...FS_PRESETS.map((v) => ({ value: v, label: formatSI(v, 'Hz', 4) })),
		{ value: 0, label: 'Custom…' }
	];
	const fsSel = $derived(FS_PRESETS.includes(fs) ? fs : 0);
	const methodOptions: { value: Method; label: string }[] = [
		{ value: 'bilinear', label: 'Bilinear (Tustin)' },
		{ value: 'matched', label: 'Matched-Z' },
		{ value: 'impulse', label: 'Impulse invariance' }
	];
	const methodNote = $derived(
		{
			bilinear: prewarp
				? 'Maps the whole jω axis onto the unit circle; prewarping puts the band edges exactly where you asked.'
				: 'Without prewarping, every frequency is compressed by f = (fs/π)·atan(π·fₐ/fs) — the edges land low.',
			matched:
				'Maps each pole and zero with z = e^{sT}; zeros at infinity go to z = −1. Gain matched at a reference frequency.',
			impulse:
				'Samples the analog impulse response: h[n] = T·h(nT). Exact in time, but everything above fs/2 aliases.'
		}[method]
	);
</script>

<ToolLayout
	slug="iir-designer"
	share={shared}
	related={[
		'analog-designer',
		'discretization',
		'biquad',
		'quantization',
		'structures',
		'order-calculator'
	]}
>
	{#snippet controls()}
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

		<ControlGroup title="Filter">
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
			<p class="small muted tight">{info.summary}</p>
		</ControlGroup>

		<ControlGroup title="Design from">
			<Segmented
				bind:value={mode}
				options={[
					{ value: 'order', label: 'Order & cutoff' },
					{ value: 'spec', label: 'Specifications' }
				]}
			/>
		</ControlGroup>

		{#if mode === 'order'}
			<ControlGroup title="Order & frequencies">
				<Slider label="Order N" bind:value={order} min={1} max={maxOrder} integer />
				{#if isBand}
					<Slider label="Lower edge f₁" bind:value={f1} min={1} max={nyq * 0.999} log unit="Hz" />
					<Slider label="Upper edge f₂" bind:value={f2} min={1} max={nyq * 0.999} log unit="Hz" />
				{:else}
					<Slider label="Cutoff fc" bind:value={f1} min={1} max={nyq * 0.999} log unit="Hz" />
				{/if}
				<p class="small muted tight">
					For {info.name}, the cutoff is the {family === 'bessel'
						? {
								phase:
									'Butterworth-matched asymptote frequency (≈ phase midpoint, exact for N ≤ 2)',
								delay: 'unit-delay normalisation frequency',
								mag: '−3 dB frequency'
							}[besselNorm]
						: info.cutoffMeaning}.
				</p>
			</ControlGroup>
		{:else}
			<ControlGroup title="Band edges" columns={2}>
				{#if isBand}
					<NumberInput
						label="Passband f₁"
						bind:value={specs[band].fp[0]}
						unit="Hz"
						min={0.001}
						logStep={1.05}
					/>
					<NumberInput
						label="Passband f₂"
						bind:value={specs[band].fp[1]}
						unit="Hz"
						min={0.001}
						logStep={1.05}
					/>
					<NumberInput
						label="Stopband f₁"
						bind:value={specs[band].fs[0]}
						unit="Hz"
						min={0.001}
						logStep={1.05}
					/>
					<NumberInput
						label="Stopband f₂"
						bind:value={specs[band].fs[1]}
						unit="Hz"
						min={0.001}
						logStep={1.05}
					/>
				{:else}
					<NumberInput
						label="Passband edge"
						bind:value={specs[band].fp[0]}
						unit="Hz"
						min={0.001}
						logStep={1.05}
					/>
					<NumberInput
						label="Stopband edge"
						bind:value={specs[band].fs[0]}
						unit="Hz"
						min={0.001}
						logStep={1.05}
					/>
				{/if}
			</ControlGroup>
		{/if}

		<ControlGroup title="Ripple & attenuation">
			{#if info.usesRp || mode === 'spec'}
				<Slider label="Passband ripple Rp" bind:value={rp} min={0.01} max={6} log unit="dB" />
			{/if}
			{#if info.usesRs || mode === 'spec'}
				<Slider
					label="Stopband attenuation Rs"
					bind:value={rs}
					min={10}
					max={140}
					unit="dB"
					step={1}
				/>
			{/if}
			{#if family === 'bessel'}
				<Select
					label="Bessel normalisation"
					bind:value={besselNorm}
					options={[
						{ value: 'mag', label: '−3 dB at cutoff' },
						{ value: 'phase', label: 'Phase-matched: ≈ phase midpoint at cutoff (SciPy default)' },
						{ value: 'delay', label: 'Unit group delay' }
					]}
				/>
			{/if}
			{#if !info.usesRp && !info.usesRs && mode === 'order' && family !== 'bessel'}
				<p class="small muted tight">{info.name} has no ripple parameters.</p>
			{/if}
		</ControlGroup>

		<ControlGroup title="Analog → digital">
			<Select label="Discretisation method" bind:value={method} options={methodOptions} />
			{#if method === 'bilinear'}
				<Toggle
					bind:checked={prewarp}
					label="Prewarp band edges"
					help="Design the analog filter at 2fs·tan(πf/fs) so the edges land exactly."
				/>
			{/if}
			<p class="small muted tight">{methodNote}</p>
			<Select
				label="Analog overlay"
				bind:value={overlay}
				options={[
					{ value: 'target', label: 'Analog design at the same edges' },
					{ value: 'prototype', label: 'Analog H(s) actually discretised' },
					{ value: 'none', label: 'None' }
				]}
			/>
		</ControlGroup>
	{/snippet}

	{#if design.error}
		<Callout kind="danger">{design.error}</Callout>
	{/if}
	{#if est?.error}
		<Callout kind="danger">{est.error}</Callout>
	{:else if est?.capped}
		<Callout kind="warning" title="Specification not reachable">
			{info.name} needs {est.requiredOrder
				? `order ${est.requiredOrder}`
				: `more than order ${maxOrder}`} for this specification. Showing order {maxOrder} — try a steeper
			family or relax the specs.
		</Callout>
	{/if}
	{#if edgeIssue && !design.error}
		<Callout kind="warning">{edgeIssue}</Callout>
	{/if}
	{#if roundedOntoCircle}
		<Callout kind="warning" title="Poles rounded onto the unit circle">
			The analog design is stable, but some of its poles lie closer to the jω axis than double
			precision can carry through the transform, so they land on |z| = 1 and the filter cannot be
			realised. Lower the order or relax the ripple and attenuation.
		</Callout>
	{/if}
	{#if design.r?.warning}
		<Callout kind="warning" title="Impulse invariance">{design.r.warning}</Callout>
	{:else if method === 'impulse' && band === 'bandstop'}
		<Callout kind="warning" title="Impulse invariance"
			>Band-stop filters pass everything above the stopband, so the analog response never falls off
			before fs/2 — the aliasing is severe.</Callout
		>
	{/if}
	{#if mode === 'spec' && !warped && !specError}
		<Callout kind="note">
			The order estimate assumes the prewarped bilinear transform. With {method === 'bilinear'
				? 'prewarping off'
				: methodOptions.find((m) => m.value === method)?.label.toLowerCase()} the band edges move, so
			the mask may not be met — check the status of the passband and stopband figures.
		</Callout>
	{/if}

	<StatGrid {stats} />

	<ResponseView filters={entries} {regions} {vlines} views={['phase', 'groupDelay', 'pz']} />

	<TimeCard
		entries={[{ filter, label: 'Digital h[n]', color: 'var(--s1)' }]}
		analog={analogShown
			? [{ zpk: analogShown, label: `${analogLabel}, T·h(nT)`, color: 'var(--s2)', dash: '6 4' }]
			: []}
		subtitle="Digital impulse and step responses, with the analog filter sampled at the same instants."
	/>

	<Card
		title="Second-order sections"
		subtitle="The cascade as it runs: each row is one biquad (a₀ = 1). Poles closest to the unit circle are in the last section, with all the gain in the first — SciPy's ordering."
	>
		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<th>#</th>
						<th class="num">b₀</th>
						<th class="num">b₁</th>
						<th class="num">b₂</th>
						<th class="num">a₁</th>
						<th class="num">a₂</th>
						<th class="num">Pole |p|</th>
						<th class="num">Pole ∠</th>
						<th>Zeros (|z|∠θ)</th>
					</tr>
				</thead>
				<tbody>
					{#each sections as s, i (i)}
						<tr>
							<td>{i + 1}</td>
							{#each s.coef as v, j (j)}
								<td class="num mono small">{num(v, 7)}</td>
							{/each}
							<td class="num mono small">{s.poles.length ? trimNumber(s.poleR, 6) : '—'}</td>
							<td class="num small"
								>{s.poles.length
									? `${trimNumber(deg(s.poleAngle), 4)}° · ${formatSI((s.poleAngle / (2 * Math.PI)) * fs, 'Hz', 3)}`
									: '—'}</td
							>
							<td class="small">{fmtRoots(s.zeros)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="small muted">
			Overall: {zpk.p.length} poles, {zpk.z.length} zeros, k = {trimNumber(zpk.k, 6)}. The pole
			angle θ corresponds to the frequency θ/(2π)·fs; a radius near 1 means a sharp resonance and a
			long ring-down.
		</p>
	</Card>

	<Card title="Export">
		<ExportPanel
			kind="digital"
			{sos}
			{tf}
			zpk={design.r ? zpk : undefined}
			{fs}
			{recipes}
			name="iir"
		/>
	</Card>

	{#snippet theory()}
		<h2>From an analog prototype to a digital filter</h2>
		<p>
			Classic digital IIR filters are not designed from scratch: you take a well-understood analog
			prototype (Butterworth, Chebyshev, elliptic…) and map it from the s-plane to the z-plane. The
			workhorse is the <strong>bilinear transform</strong>, which comes from approximating
			integration with the trapezoidal rule:
		</p>
		<Tex
			display
			math={'s \\;=\\; 2f_s\\,\\frac{z-1}{z+1} \\;=\\; \\frac{2}{T}\\,\\frac{1-z^{-1}}{1+z^{-1}}, \\qquad z = \\frac{1+sT/2}{1-sT/2}'}
		/>
		<h3>Frequency warping</h3>
		<p>
			Put <Tex math={'z=e^{j\\omega_d}'} /> (ω<sub>d</sub> = 2πf/f<sub>s</sub> in rad/sample) into the
			transform and the unit circle lands on the imaginary axis, but with a nonlinear frequency scale:
		</p>
		<Tex
			display
			math={'\\omega_a = 2f_s\\tan\\frac{\\omega_d}{2}\\qquad\\Longleftrightarrow\\qquad f_d = \\frac{f_s}{\\pi}\\arctan\\frac{\\pi f_a}{f_s}'}
		/>
		<p>
			The infinite analog axis 0…∞ is squeezed into 0…f<sub>s</sub>/2. Near DC the mapping is almost
			the identity; towards Nyquist it compresses more and more, until the analog response at ω → ∞
			lands exactly on f<sub>s</sub>/2. Analog zeros at infinity land on z = −1, so all-pole
			low-passes (Butterworth, Chebyshev I, Bessel…) and odd-order elliptic and Chebyshev II ones
			reach −∞ dB exactly at f<sub>s</sub>/2. Even-order elliptic and Chebyshev II low-passes have
			no zeros at infinity: they end at their finite stopband level −R<sub>s</sub> (−60 dB for the
			default design). There is <em>no aliasing</em> — every analog frequency maps to exactly one digital
			one — but the frequency axis is distorted.
		</p>
		<p>
			<strong>Prewarping</strong> fixes the frequencies that matter: design the analog prototype
			with its critical frequency at
			<Tex math={'\\omega_{a,c} = 2f_s\\tan(\\pi f_c/f_s)'} />, and after warping it lands exactly
			on f<sub>c</sub>. Only one frequency per edge can be exact (two for band-pass/stop); the shape
			between them is still warped. Switch the overlay to
			<em>Analog H(s) actually discretised</em> to see the prewarped prototype, whose cutoff sits
			above f<sub>c</sub>.
		</p>
		<h3>Why the result is always stable</h3>
		<p>For <Tex math={'s=\\sigma+j\\omega'} /> the mapped point has</p>
		<Tex
			display
			math={'|z|^2=\\frac{(1+\\sigma T/2)^2+(\\omega T/2)^2}{(1-\\sigma T/2)^2+(\\omega T/2)^2}'}
		/>
		<p>
			which is below 1 exactly when σ &lt; 0. The left half-plane maps into the unit disc, the jω
			axis onto the unit circle: a stable analog filter always gives a stable digital filter of the
			same order, with no restrictions on the band type. Matched-Z and impulse invariance use z = e<sup
				>sT</sup
			>, which also preserves stability, but alias (impulse invariance) or only approximate the
			response (matched-Z) — compare all methods on the
			<a href={toolHref('discretization')}>Analog → Digital Mapping</a> page.
		</p>
		<h3>From digital specs to the analog order</h3>
		<p>
			A digital specification (passband edge f<sub>p</sub>, stopband edge f<sub>s,stop</sub>, ripple
			R<sub>p</sub>, attenuation R<sub>s</sub>) is turned into an analog one by prewarping every
			edge. For a low-pass, the prototype selectivity is
		</p>
		<Tex
			display
			math={'\\Omega_s = \\frac{\\tan(\\pi f_{\\text{stop}}/f_s)}{\\tan(\\pi f_p/f_s)}'}
		/>
		<p>
			and the usual analog order formulas apply (e.g. Butterworth <Tex
				math={'N\\ge \\log\\!\\big(\\tfrac{10^{R_s/10}-1}{10^{R_p/10}-1}\\big)/(2\\log\\Omega_s)'}
			/>). Because tan stretches frequencies near Nyquist, a transition band close to f<sub>s</sub
			>/2 is effectively wider than it looks and needs a lower order than the same ratio near DC.
		</p>
		<h3>Why second-order sections beat one big b/a</h3>
		<p>
			Multiplying the sections out into one polynomial <Tex math={'A(z)=\\sum a_k z^{-k}'} /> is mathematically
			harmless but numerically fragile. The sensitivity of a pole to a coefficient is
		</p>
		<Tex
			display
			math={'\\frac{\\partial p_i}{\\partial a_k} = -\\frac{p_i^{\\,N-k}}{\\prod_{j\\ne i}(p_i-p_j)}'}
		/>
		<p>
			Sharp, narrow filters have their poles clustered close together near the unit circle, so the
			denominator product is tiny and a rounding error of 10⁻⁷ can push a pole outside the circle.
			In a cascade of biquads each quadratic only holds one conjugate pair, so the sensitivity stays
			bounded. The <em>One b/a in float32</em> figure above rounds the expanded denominator to single
			precision and reports where the poles end up. SciPy-style pairing (each pole pair with its nearest
			zeros, highest-Q section last) also keeps intermediate signal levels and round-off noise under control.
		</p>
		<Callout kind="try">
			<ul>
				<li>
					Set a Butterworth low-pass cutoff to 0.4·fs and turn prewarping off: the −3 dB frequency
					lands well below what you asked for.
				</li>
				<li>
					Choose an elliptic band-pass of order 8 between 100 Hz and 200 Hz at 48 kHz: the single
					b/a in float32 becomes unstable while the SOS cascade is fine.
				</li>
				<li>
					In <em>Specifications</em> mode, keep the same ratio between stopband and passband edges but
					move the transition band towards fs/2 — the required order drops.
				</li>
				<li>
					Switch to impulse invariance with a high-pass: the method cannot represent the direct
					feed-through term, and the response is ruined.
				</li>
				<li>
					Compare the impulse responses of bilinear and impulse-invariant low-pass designs against
					the sampled analog T·h(nT).
				</li>
			</ul>
		</Callout>
	{/snippet}
</ToolLayout>

<style>
	.tight {
		margin: -0.2rem 0 0;
	}
	.table-wrap {
		overflow-x: auto;
	}
	td.small {
		font-size: 0.8rem;
	}
</style>
