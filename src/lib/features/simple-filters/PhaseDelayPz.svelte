<script lang="ts">
	/**
	 * Phase, group delay and z-plane cards for small filters. Unlike the shared
	 * ResponseView it keeps a minimum y-span (constant group delays of FIR
	 * filters would otherwise produce duplicated tick labels) and blanks the group
	 * delay at exact zeros on the unit circle, where it is undefined.
	 */
	import Plot, { type Series } from '$lib/components/plot/Plot.svelte';
	import PoleZeroPlot from '$lib/components/plot/PoleZeroPlot.svelte';
	import type { FilterEntry } from '$lib/components/plot/ResponseView.svelte';
	import { freqFormat, seriesColor } from '$lib/components/plot/scales';
	import { evaluate, linspace, logspace } from '$lib/dsp/response';
	import { digitalZpk } from '$lib/dsp/convert';
	import { formatSI, trimNumber } from '$lib/dsp/units';

	interface Props {
		entries: FilterEntry[];
		fs: number;
		scale: 'log' | 'linear';
		fmin?: number;
		height?: number;
	}
	let { entries, fs, scale, fmin, height = 240 }: Props = $props();

	const nyq = $derived(fs / 2);
	const lo = $derived(scale === 'log' ? (fmin ?? nyq / 2000) : 0);
	const grid = $derived(scale === 'log' ? logspace(lo, nyq, 600) : linspace(0, nyq, 600));
	const responses = $derived(entries.map((e) => evaluate(e.filter, grid)));
	const color = (i: number) => entries[i].color ?? seriesColor(i);

	const phase = $derived<Series[]>(
		responses.map((r, i) => ({ x: r.f, y: r.phaseDeg, label: entries[i].label, color: color(i), dash: entries[i].dash, format: (v: number) => `${trimNumber(v, 4)}°` }))
	);
	const delay = $derived<Series[]>(
		responses.map((r, i) => {
			let peak = 0;
			for (const m of r.mag) if (Number.isFinite(m) && m > peak) peak = m;
			return {
				x: r.f,
				y: r.groupDelay.map((g, k) => (r.mag[k] < peak * 1e-6 ? NaN : g * fs)),
				label: entries[i].label,
				color: color(i),
				dash: entries[i].dash,
				format: (v: number) => `${trimNumber(v, 4)} samples`
			};
		})
	);
	const delayLimits = $derived.by((): [number, number] | undefined => {
		const vals: number[] = [];
		for (const s of delay) for (let i = 0; i < s.y.length; i++) if (Number.isFinite(s.y[i])) vals.push(s.y[i]);
		if (!vals.length) return undefined;
		vals.sort((a, b) => a - b);
		const p = (q: number) => vals[Math.min(vals.length - 1, Math.floor(q * vals.length))];
		const a = p(0.01);
		const b = p(0.99);
		const pad = Math.max((b - a) * 0.4, 0.5);
		return [a - pad, b + pad];
	});

	const pz = $derived.by(() => {
		const first = entries[0]?.filter;
		if (!first || first.kind !== 'digital') return { z: [], p: [] };
		const zpk = digitalZpk(first);
		const p = [...zpk.p];
		while (p.length < zpk.z.length) p.push({ re: 0, im: 0 });
		return { z: zpk.z, p };
	});
	const hzTip = (v: number) => formatSI(v, 'Hz', 4);
</script>

<div class="grid">
	<div class="card">
		<Plot
			series={phase}
			xScale={scale}
			xDomain={[lo, nyq]}
			xLabel="Frequency (Hz)"
			yLabel="Phase (°)"
			xFormat={freqFormat}
			xTooltipFormat={hzTip}
			minYSpan={20}
			{height}
			title="Phase (unwrapped)"
			legend={false}
			exportName="phase"
		/>
	</div>
	<div class="card">
		<Plot
			series={delay}
			xScale={scale}
			xDomain={[lo, nyq]}
			xLabel="Frequency (Hz)"
			yLabel="Delay (samples)"
			xFormat={freqFormat}
			xTooltipFormat={hzTip}
			yLimits={delayLimits}
			minYSpan={1}
			{height}
			title="Group delay"
			legend={false}
			exportName="group-delay"
		/>
	</div>
	<div class="card">
		<PoleZeroPlot zeros={pz.z} poles={pz.p} domain="z" {fs} height={Math.max(height, 260)} title="Poles & zeros (z-plane)" />
	</div>
</div>

<style>
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
		gap: 1.1rem;
	}
	.card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		padding: 0.75rem 0.9rem 0.6rem;
		min-width: 0;
	}
</style>
