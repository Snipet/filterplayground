<script lang="ts" module>
	import type { Filter } from '$lib/dsp/types';

	export interface FilterEntry {
		filter: Filter;
		label?: string;
		color?: string;
		dash?: string;
	}

	export type ResponseKind = 'phase' | 'groupDelay' | 'pz' | 'impulse' | 'step';
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import Plot, { type Marker, type RefLine, type Region, type Series } from './Plot.svelte';
	import PoleZeroPlot from './PoleZeroPlot.svelte';
	import Segmented from '../controls/Segmented.svelte';
	import { evaluate, linspace, logspace } from '$lib/dsp/response';
	import { digitalZpk } from '$lib/dsp/convert';
	import {
		analogTimeResponse,
		characteristicFrequency,
		digitalImpulseResponse,
		digitalStepResponse,
		suggestAnalogDuration,
		suggestDigitalLength
	} from '$lib/dsp/time';
	import { formatSI, trimNumber } from '$lib/dsp/units';
	import { freqFormat, magToDb, markerToMag, niceStep, regionToMag, seriesColor } from './scales';
	import type { Complex } from '$lib/dsp/complex';

	interface Props {
		filters: FilterEntry[];
		views?: ResponseKind[];
		fmin?: number;
		fmax?: number;
		xScale?: 'log' | 'linear';
		/**
		 * dB or linear magnitude axis. A page that passes magMode (usually via bind:) knows
		 * the active unit and supplies magDomain, regions, markers and reads drag/click y in
		 * it. Otherwise those are always in dB and are converted for the Linear view.
		 */
		magMode?: 'db' | 'linear';
		magDomain?: [number, number];
		/** Lowest dB shown by the auto range, relative to the peak. */
		dbRange?: number;
		regions?: Region[];
		vlines?: RefLine[];
		markers?: Marker[];
		onmarkerdrag?: (id: string | number, x: number, y: number) => void;
		onmarkerdragend?: (id: string | number) => void;
		onmarkerwheel?: (id: string | number, deltaY: number) => void;
		onmarkerselect?: (id: string | number) => void;
		onplotclick?: (x: number, y: number, ev: MouseEvent) => void;
		magHeight?: number;
		smallHeight?: number;
		points?: number;
		/** Analog time span (s) or digital sample count for time-domain views. */
		timeSpan?: number;
		pzHeatmap?: boolean;
		title?: string;
		/** Extra toolbar content for the magnitude card. */
		toolbar?: Snippet;
		/** Hide the log/linear and dB/linear toggles. */
		hideToggles?: boolean;
	}

	let {
		filters,
		views = ['phase', 'groupDelay', 'pz', 'impulse', 'step'],
		fmin,
		fmax,
		xScale = $bindable(),
		magMode = $bindable(),
		magDomain,
		dbRange = 120,
		regions = [],
		vlines = [],
		markers = [],
		onmarkerdrag,
		onmarkerdragend,
		onmarkerwheel,
		onmarkerselect,
		onplotclick,
		magHeight = 320,
		smallHeight = 230,
		points = 700,
		timeSpan,
		pzHeatmap = false,
		title = 'Magnitude response',
		toolbar: extraToolbar,
		hideToggles = false
	}: Props = $props();

	const first = $derived(filters[0]?.filter);
	const isAnalog = $derived(first?.kind === 'analog');
	const fs = $derived(first && first.kind === 'digital' ? first.fs : 0);
	// default x-scale: log for analog; linear for digital
	const scale = $derived<'log' | 'linear'>(xScale ?? (isAnalog ? 'log' : 'linear'));

	const range = $derived.by((): [number, number] => {
		if (!first) return [1, 1000];
		if (first.kind === 'analog') {
			const wc =
				Math.max(
					...filters
						.filter((f) => f.filter.kind === 'analog')
						.map((f) =>
							characteristicFrequency((f.filter as Extract<Filter, { kind: 'analog' }>).zpk)
						)
				) /
				(2 * Math.PI);
			const lo = fmin ?? Math.pow(10, Math.floor(Math.log10(wc)) - 2);
			const hi = fmax ?? Math.pow(10, Math.ceil(Math.log10(wc)) + 2);
			if (scale === 'linear') return [fmin ?? 0, fmax ?? wc * 4];
			return [lo, hi];
		}
		const nyq = first.fs / 2;
		if (scale === 'linear') return [fmin ?? 0, fmax ?? nyq];
		return [fmin ?? nyq / 2000, fmax ?? nyq];
	});

	const grid = $derived.by(() => {
		const [a, b] = range;
		if (scale === 'log') return logspace(Math.max(a, 1e-12), b, points);
		return linspace(a, b, points);
	});

	const responses = $derived(filters.map((f) => evaluate(f.filter, grid)));

	// Uncontrolled magMode: the page cannot know the unit, so its overlays stay in dB.
	let ownMagMode = $state<'db' | 'linear'>('db');
	const mode = $derived(magMode ?? ownMagMode);
	// dB overlays shown on the Linear axis are mapped to |H| (and drag/click y back to dB)
	const toMag = $derived(magMode === undefined && mode === 'linear');
	const plotRegions = $derived(toMag ? regions.map(regionToMag) : regions);
	const plotMarkers = $derived(toMag ? markers.map(markerToMag) : markers);
	const markerDrag = $derived(
		toMag && onmarkerdrag
			? (id: string | number, x: number, y: number) => onmarkerdrag(id, x, magToDb(y))
			: onmarkerdrag
	);
	const plotClick = $derived(
		toMag && onplotclick
			? (x: number, y: number, ev: MouseEvent) => onplotclick(x, magToDb(y), ev)
			: onplotclick
	);

	const colorOf = (i: number) => filters[i]?.color ?? seriesColor(i);

	const magSeries = $derived<Series[]>(
		responses.map((r, i) => ({
			x: r.f,
			y: mode === 'db' ? r.magDb : r.mag,
			label: filters[i].label,
			color: colorOf(i),
			dash: filters[i].dash,
			format:
				mode === 'db' ? (v: number) => `${trimNumber(v, 4)} dB` : (v: number) => trimNumber(v, 4)
		}))
	);

	const magDom = $derived.by((): [number, number] | undefined => {
		if (magDomain && !toMag) return magDomain;
		if (mode !== 'db') {
			// 0 … rounded peak, so (like the 10 dB steps below) dragging a handle does not
			// rescale the axis under the pointer on every move
			let peak = 0;
			for (const r of responses)
				for (const v of r.mag) if (Number.isFinite(v)) peak = Math.max(peak, v);
			if (!(peak > 0)) return undefined;
			const step = niceStep(peak, 5);
			return [0, Math.ceil((peak * 1.02) / step) * step];
		}
		let hi = -Infinity;
		let lo = Infinity;
		for (const r of responses)
			for (const v of r.magDb) {
				if (!Number.isFinite(v)) continue;
				hi = Math.max(hi, v);
				lo = Math.min(lo, v);
			}
		if (!Number.isFinite(hi)) return [-100, 10];
		const top = Math.ceil((hi + 3) / 10) * 10;
		const bottom = Math.max(Math.floor((lo - 3) / 10) * 10, top - dbRange);
		return [Math.min(bottom, top - 20), top];
	});

	const phaseSeries = $derived<Series[]>(
		responses.map((r, i) => ({
			x: r.f,
			y: r.phaseDeg,
			label: filters[i].label,
			color: colorOf(i),
			dash: filters[i].dash,
			format: (v: number) => `${trimNumber(v, 4)}°`
		}))
	);

	const gdSeries = $derived<Series[]>(
		responses.map((r, i) => ({
			x: r.f,
			y: isAnalog ? r.groupDelay : r.groupDelay.map((g) => g * fs),
			label: filters[i].label,
			color: colorOf(i),
			dash: filters[i].dash,
			format: isAnalog
				? (v: number) => formatSI(v, 's', 4)
				: (v: number) => `${trimNumber(v, 4)} samples`
		}))
	);

	const gdLimits = $derived.by((): [number, number] | undefined => {
		const vals: number[] = [];
		for (const s of gdSeries)
			for (let i = 0; i < s.y.length; i++) if (Number.isFinite(s.y[i])) vals.push(Math.abs(s.y[i]));
		if (!vals.length) return undefined;
		vals.sort((a, b) => a - b);
		const p = vals[Math.floor(vals.length * 0.97)] ?? vals[vals.length - 1];
		const lim = Math.max(p * 1.4, 1e-12);
		return [-lim, lim];
	});

	// Constant delays (linear phase) need a minimum span or the axis zooms into rounding noise.
	const gdMinSpan = $derived.by(() => {
		let m = 0;
		for (const s of gdSeries)
			for (let i = 0; i < s.y.length; i++)
				if (Number.isFinite(s.y[i])) m = Math.max(m, Math.abs(s.y[i]));
		return isAnalog ? Math.max(m * 0.5, 1e-12) : Math.max(2, m * 0.25);
	});

	// ---------------- pole-zero ----------------
	const pz = $derived.by((): { z: Complex[]; p: Complex[] } => {
		if (!first) return { z: [], p: [] };
		if (first.kind === 'analog') {
			const k = 1 / (2 * Math.PI);
			return {
				z: first.zpk.z.map((v) => ({ re: v.re * k, im: v.im * k })),
				p: first.zpk.p.map((v) => ({ re: v.re * k, im: v.im * k }))
			};
		}
		const zpk = digitalZpk(first);
		// make causal display: more zeros than poles → poles at origin
		const p = [...zpk.p];
		while (p.length < zpk.z.length) p.push({ re: 0, im: 0 });
		return { z: zpk.z, p };
	});

	const pzHeat = $derived.by(() => {
		if (!pzHeatmap || !first) return null;
		const { z, p } = pz;
		return (s: Complex) => {
			let num = 0;
			for (const q of z) num += Math.log10(Math.max(Math.hypot(s.re - q.re, s.im - q.im), 1e-12));
			for (const q of p) num -= Math.log10(Math.max(Math.hypot(s.re - q.re, s.im - q.im), 1e-12));
			return 20 * num;
		};
	});

	// ---------------- time domain ----------------
	const timeData = $derived.by(() => {
		if (!first || !(views.includes('impulse') || views.includes('step'))) return null;
		if (first.kind === 'analog') {
			const dur =
				timeSpan ??
				Math.max(
					...filters
						.filter((f) => f.filter.kind === 'analog')
						.map((f) =>
							suggestAnalogDuration((f.filter as Extract<Filter, { kind: 'analog' }>).zpk)
						)
				);
			const wantImp = views.includes('impulse');
			const wantStep = views.includes('step');
			const imp = filters.map((f) =>
				wantImp && f.filter.kind === 'analog'
					? analogTimeResponse(f.filter.zpk, 'impulse', dur, 500)
					: null
			);
			const stp = filters.map((f) =>
				wantStep && f.filter.kind === 'analog'
					? analogTimeResponse(f.filter.zpk, 'step', dur, 500)
					: null
			);
			// only analog entries can share an analog time axis
			const keep = (_: unknown, i: number) => filters[i].filter.kind === 'analog';
			return {
				impulse: imp
					.map((r, i) => ({
						x: r?.t ?? [],
						y: r?.y ?? [],
						label: filters[i].label,
						color: colorOf(i),
						dash: filters[i].dash
					}))
					.filter(keep),
				step: stp
					.map((r, i) => ({
						x: r?.t ?? [],
						y: r?.y ?? [],
						label: filters[i].label,
						color: colorOf(i),
						dash: filters[i].dash
					}))
					.filter(keep),
				dirac: imp.some((r) => r?.dirac),
				unit: 's'
			};
		}
		const n =
			timeSpan ??
			Math.max(
				...filters
					.filter((f) => f.filter.kind === 'digital')
					.map((f) => suggestDigitalLength(f.filter as Extract<Filter, { kind: 'digital' }>, 1024))
			);
		const idx = Array.from({ length: n }, (_, i) => i);
		const stem = n <= 72;
		const digitalOnly = (_: unknown, i: number) => filters[i].filter.kind === 'digital';
		return {
			impulse: filters
				.map((f, i) => ({
					x: idx,
					y:
						f.filter.kind === 'digital' && views.includes('impulse')
							? Array.from(digitalImpulseResponse(f.filter, n))
							: [],
					label: f.label,
					color: colorOf(i),
					dash: f.dash,
					kind: stem && filters.length === 1 ? ('stem' as const) : ('line' as const)
				}))
				.filter(digitalOnly),
			step: filters
				.map((f, i) => ({
					x: idx,
					y:
						f.filter.kind === 'digital' && views.includes('step')
							? Array.from(digitalStepResponse(f.filter, n))
							: [],
					label: f.label,
					color: colorOf(i),
					dash: f.dash,
					kind: stem && filters.length === 1 ? ('stem' as const) : ('line' as const)
				}))
				.filter(digitalOnly),
			dirac: false,
			unit: 'samples'
		};
	});

	const timeFormat = (v: number) => (isAnalog ? formatSI(v, 's', 3) : trimNumber(v, 4));
	const hzTooltip = (v: number) => formatSI(v, 'Hz', 4);
</script>

<div class="rv">
	<div class="card">
		<Plot
			series={magSeries}
			xScale={scale}
			xDomain={range}
			yDomain={magDom}
			xLabel="Frequency (Hz)"
			yLabel={mode === 'db' ? 'Magnitude (dB)' : 'Magnitude'}
			xFormat={freqFormat}
			xTooltipFormat={hzTooltip}
			height={magHeight}
			{title}
			regions={plotRegions}
			{vlines}
			markers={plotMarkers}
			onmarkerdrag={markerDrag}
			{onmarkerdragend}
			{onmarkerwheel}
			{onmarkerselect}
			onplotclick={plotClick}
			exportName="magnitude"
		>
			{#snippet toolbar()}
				{#if extraToolbar}{@render extraToolbar()}{/if}
				{#if !hideToggles}
					<Segmented
						size="small"
						value={scale}
						options={[
							{ value: 'log', label: 'Log f' },
							{ value: 'linear', label: 'Linear f' }
						]}
						onchange={(v) => (xScale = v)}
					/>
					<Segmented
						size="small"
						value={mode}
						options={[
							{ value: 'db', label: 'dB' },
							{ value: 'linear', label: 'Linear' }
						]}
						onchange={(v) => (magMode === undefined ? (ownMagMode = v) : (magMode = v))}
					/>
				{/if}
			{/snippet}
		</Plot>
	</div>

	{#if views.length}
		<div class="grid">
			{#if views.includes('phase')}
				<div class="card">
					<Plot
						series={phaseSeries}
						xScale={scale}
						xDomain={range}
						xLabel="Frequency (Hz)"
						yLabel="Phase (°)"
						xFormat={freqFormat}
						xTooltipFormat={hzTooltip}
						height={smallHeight}
						title="Phase (unwrapped)"
						legend={false}
						exportName="phase"
					/>
				</div>
			{/if}
			{#if views.includes('groupDelay')}
				<div class="card">
					<Plot
						series={gdSeries}
						xScale={scale}
						xDomain={range}
						xLabel="Frequency (Hz)"
						yLabel={isAnalog ? 'Delay (s)' : 'Delay (samples)'}
						yFormat={isAnalog ? (v) => formatSI(v, '', 3) : undefined}
						xFormat={freqFormat}
						xTooltipFormat={hzTooltip}
						yLimits={gdLimits}
						minYSpan={gdMinSpan}
						height={smallHeight}
						title="Group delay"
						legend={false}
						exportName="group-delay"
					/>
				</div>
			{/if}
			{#if views.includes('pz')}
				<div class="card">
					<PoleZeroPlot
						zeros={pz.z}
						poles={pz.p}
						domain={isAnalog ? 's' : 'z'}
						sHz={isAnalog}
						fs={fs || undefined}
						height={Math.max(smallHeight, 260)}
						heatmap={pzHeat}
						title={isAnalog ? 'Poles & zeros (s-plane)' : 'Poles & zeros (z-plane)'}
					/>
					{#if filters.length > 1}<p class="note">
							Showing {filters[0].label ?? 'the first filter'}.
						</p>{/if}
				</div>
			{/if}
			{#if views.includes('impulse') && timeData}
				<div class="card">
					<Plot
						series={timeData.impulse}
						xLabel={isAnalog ? 'Time (s)' : 'Sample n'}
						xFormat={timeFormat}
						height={smallHeight}
						title="Impulse response"
						legend={false}
						exportName="impulse"
					/>
					{#if timeData.dirac}<p class="note">
							Plus a Dirac impulse at t = 0 (H(s) has a direct feed-through term).
						</p>{/if}
				</div>
			{/if}
			{#if views.includes('step') && timeData}
				<div class="card">
					<Plot
						series={timeData.step}
						xLabel={isAnalog ? 'Time (s)' : 'Sample n'}
						xFormat={timeFormat}
						height={smallHeight}
						title="Step response"
						legend={false}
						exportName="step"
					/>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.rv {
		display: flex;
		flex-direction: column;
		gap: 1.1rem;
		min-width: 0;
	}
	.card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		padding: 0.75rem 0.9rem 0.6rem;
		min-width: 0;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr));
		gap: 1.1rem;
	}
	.note {
		margin: 0.3rem 0 0;
		font-size: 0.78rem;
		color: var(--muted);
	}
</style>
