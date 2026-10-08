<script lang="ts" module>
	import type { DigitalFilter, ZPK } from '$lib/dsp/types';

	export interface TimeEntry {
		filter: DigitalFilter;
		label?: string;
		color?: string;
		dash?: string;
	}
	export interface AnalogTimeRef {
		zpk: ZPK;
		label: string;
		color?: string;
		dash?: string;
	}
</script>

<script lang="ts">
	/**
	 * Impulse / step response card for one or more digital filters, optionally
	 * overlaid with an analog filter sampled at t = nT (impulse scaled by T so it
	 * is directly comparable with h[n]).
	 */
	import Card from '$lib/components/layout/Card.svelte';
	import Plot, { type Series } from '$lib/components/plot/Plot.svelte';
	import Segmented from '$lib/components/controls/Segmented.svelte';
	import { seriesColor } from '$lib/components/plot/scales';
	import { digitalImpulseResponse, digitalStepResponse, suggestDigitalLength, analogTimeResponse } from '$lib/dsp/time';
	import { trimNumber } from '$lib/dsp/units';

	interface Props {
		entries: TimeEntry[];
		analog?: AnalogTimeRef[];
		/** Number of samples; suggested from the slowest pole when omitted. */
		n?: number;
		title?: string;
		subtitle?: string;
		/** Clamp the auto y-range (useful when an entry is unstable). */
		yLimits?: [number, number];
		height?: number;
	}
	let { entries, analog = [], n, title = 'Time response', subtitle, yLimits, height = 240 }: Props = $props();

	let mode = $state<'impulse' | 'step'>('impulse');

	const fs = $derived(entries[0]?.filter.fs ?? 1);
	const N = $derived(
		n ?? Math.max(16, ...entries.map((e) => suggestDigitalLength(e.filter, 1024)))
	);

	const series = $derived.by((): Series[] => {
		const idx = Array.from({ length: N }, (_, i) => i);
		const stem = entries.length === 1 && analog.length === 0 && N <= 72;
		const out: Series[] = entries.map((e, i) => {
			let y: number[];
			try {
				y = Array.from(mode === 'impulse' ? digitalImpulseResponse(e.filter, N) : digitalStepResponse(e.filter, N));
			} catch {
				y = [];
			}
			return {
				x: idx,
				y,
				label: e.label,
				color: e.color ?? seriesColor(i),
				dash: e.dash,
				kind: stem ? ('stem' as const) : ('line' as const),
				format: (v: number) => trimNumber(v, 5)
			};
		});
		for (const a of analog) {
			try {
				const r = analogTimeResponse(a.zpk, mode, (N - 1) / fs, N);
				const scale = mode === 'impulse' ? 1 / fs : 1;
				out.push({
					x: idx,
					y: r.y.map((v) => v * scale),
					label: a.label,
					color: a.color ?? 'var(--muted)',
					dash: a.dash ?? '5 4',
					format: (v: number) => trimNumber(v, 5)
				});
			} catch {
				/* analog reference unavailable */
			}
		}
		return out;
	});

	const hasDirac = $derived(mode === 'impulse' && analog.some((a) => a.zpk.z.length >= a.zpk.p.length));
</script>

<Card {title} {subtitle}>
	{#snippet actions()}
		<Segmented
			size="small"
			bind:value={mode}
			options={[
				{ value: 'impulse', label: 'Impulse' },
				{ value: 'step', label: 'Step' }
			]}
		/>
	{/snippet}
	<Plot {series} xLabel="Sample n" yLabel={mode === 'impulse' ? 'h[n]' : 'Step response'} {height} {yLimits} exportName={mode} />
	{#if analog.length && mode === 'impulse'}
		<p class="small muted note">
			Analog curves show T·h(nT) — the analog impulse response sampled at the same instants and scaled by T = 1/fs, which
			is exactly what impulse invariance reproduces.{#if hasDirac}{' '}The analog response also has a Dirac impulse at t = 0 (a direct feed-through term) that sampling cannot capture.{/if}
		</p>
	{/if}
</Card>

<style>
	.note {
		margin: 0.4rem 0 0;
	}
</style>
