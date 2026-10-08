<script lang="ts">
	import Card from '$lib/components/layout/Card.svelte';
	import Plot, { type Series } from '$lib/components/plot/Plot.svelte';
	import { freqFormat } from '$lib/components/plot/scales';
	import StatGrid, { type Stat } from '$lib/components/content/StatGrid.svelte';
	import Callout from '$lib/components/content/Callout.svelte';
	import ExportPanel from '$lib/components/content/ExportPanel.svelte';
	import { cicFir } from '$lib/dsp/fir';
	import { linspace } from '$lib/dsp/response';
	import { formatSI, trimNumber } from '$lib/dsp/units';
	import { cicMag, cicStats } from './special';

	interface Props {
		fs: number;
		R: number;
		M: number;
		N: number;
		/** Band of interest as a fraction of the output Nyquist frequency. */
		bw: number;
		inBits: number;
	}
	let { fs, R, M, N, bw, inBits }: Props = $props();

	const fsOut = $derived(fs / R);
	const fc = $derived((bw * fsOut) / 2); // Hz
	const h = $derived(cicFir(R, M, N));
	const st = $derived(cicStats(R, M, N, fc / fs, inBits));
	const db = (v: number) => 20 * Math.log10(Math.max(v, 1e-15));

	const floor = $derived(Math.max(-200, Math.floor((-13.46 * N - 50) / 10) * 10));
	const grid = $derived(linspace(0, fs / 2, 3000));
	const magSeries = $derived<Series[]>([
		{
			x: grid,
			y: grid.map((f) => db(cicMag(f / fs, R, M, N))),
			label: 'CIC',
			color: 'var(--s1)',
			format: (v: number) => `${trimNumber(v, 4)} dB`
		}
	]);
	const regions = $derived([
		{ x0: 0, x1: fc, y0: -1e4, y1: 1e4, kind: 'allowed' as const, label: 'Band of interest' },
		...st.aliasBands.map(([lo, hi]) => ({
			x0: lo * fs,
			x1: hi * fs,
			y0: -1e4,
			y1: 1e4,
			kind: 'forbidden' as const,
			label: 'Folds onto the band of interest after decimation'
		}))
	]);
	const outLines = $derived(
		Array.from({ length: Math.min(8, Math.floor(R / 2)) }, (_, k) => ({
			value: ((k + 1) * fs) / R,
			label: k === 0 ? 'fs/R' : undefined,
			dash: '2 4'
		}))
	);

	const droopGrid = $derived(linspace(0, fsOut / 2, 400));
	const droopSeries = $derived<Series[]>([
		{
			x: droopGrid,
			y: droopGrid.map((f) => db(cicMag(f / fs, R, M, N))),
			label: 'CIC',
			color: 'var(--s1)',
			format: (v: number) => `${trimNumber(v, 4)} dB`
		}
	]);

	const impSeries = $derived<Series[]>([
		{
			x: h.map((_, i) => i),
			y: h,
			label: 'h[n]',
			color: 'var(--s1)',
			kind: h.length <= 80 ? 'stem' : 'line',
			format: (v: number) => trimNumber(v, 5)
		}
	]);

	const stats = $derived<Stat[]>([
		{
			label: 'DC gain (R·M)^N',
			value: `${st.dcGain.toLocaleString('en-US')} (${trimNumber(db(st.dcGain), 4)} dB)`,
			hint: 'Gain of the integer implementation; the taps below are normalised by it'
		},
		{
			label: 'Bit growth',
			value: `${st.bitGrowth} bits → ${st.outBits}-bit registers`,
			hint: `⌈N·log2(R·M)⌉ = ⌈${trimNumber(N * Math.log2(R * M), 4)}⌉ on top of ${inBits} input bits`
		},
		{ label: 'Output rate', value: formatSI(fsOut, 'Hz', 4) },
		{
			label: 'First null',
			value: formatSI(fs / (R * M), 'Hz', 4),
			hint: 'Nulls at every multiple of fs/(R·M) — exactly the frequencies that fold to DC'
		},
		{
			label: `Droop at ${formatSI(fc, 'Hz', 3)}`,
			value: `${trimNumber(st.droopDb, 3)} dB`,
			status: st.droopDb > -1 ? 'good' : st.droopDb > -4 ? 'warning' : 'critical',
			hint: 'Passband loss at the edge of the band of interest'
		},
		{
			label: 'Worst alias rejection',
			value: `${trimNumber(st.aliasAttenDb, 3)} dB`,
			hint: 'Minimum attenuation over the bands that fold onto the band of interest'
		},
		{
			label: 'Equivalent FIR',
			value: `${h.length} taps`,
			hint: 'N·(R·M − 1) + 1 — but the CIC needs only N integrators, N combs and no multipliers'
		}
	]);

	const recipe = $derived(
		`import numpy as np\n\nR, M, N = ${R}, ${M}, ${N}\nh = np.ones(R * M)\nfor _ in range(N - 1):\n    h = np.convolve(h, np.ones(R * M))\nh /= (R * M) ** N              # unit DC gain\n\n# hardware form: N integrators at fs, decimate by R, N combs (delay M) at fs/R\n# y = np.convolve(x, h)[::R]`
	);
</script>

{#if bw >= 1}
	<Callout kind="note"
		>With the band of interest reaching fs_out/2 the alias bands touch it; real designs keep it well
		below — typically under a quarter of the output rate.</Callout
	>
{/if}

<StatGrid {stats} />

<Card
	title="Magnitude at the input rate"
	subtitle="The green band is the band of interest; red bands are the frequencies that fold onto it when the output is decimated by R. The CIC's nulls sit right in their middles."
>
	<Plot
		series={magSeries}
		{regions}
		vlines={outLines}
		xDomain={[0, fs / 2]}
		yDomain={[floor, 5]}
		xLabel="Frequency (Hz)"
		yLabel="Magnitude (dB)"
		xFormat={freqFormat}
		xTooltipFormat={(v) => formatSI(v, 'Hz', 4)}
		height={300}
		exportName="cic"
	/>
</Card>

<div class="two">
	<Card
		title="Passband droop"
		subtitle="0 … fs_out/2. The sinc^N roll-off usually needs a compensating FIR after decimation."
	>
		<Plot
			series={droopSeries}
			xDomain={[0, fsOut / 2]}
			vlines={[{ value: fc, label: 'band edge' }]}
			xLabel="Frequency (Hz)"
			yLabel="dB"
			xFormat={freqFormat}
			xTooltipFormat={(v) => formatSI(v, 'Hz', 4)}
			height={220}
		/>
	</Card>
	<Card
		title="Impulse response"
		subtitle="N moving sums of length R·M convolved: a box, triangle, then ever smoother B-spline shapes."
	>
		<Plot series={impSeries} xLabel="n" height={220} legend={false} exportName="cic-impulse" />
	</Card>
</div>

<Card title="Export (equivalent FIR, normalised)">
	<ExportPanel
		kind="digital"
		fir={h}
		{fs}
		recipes={[{ label: 'NumPy', code: recipe }]}
		name="cic"
	/>
</Card>

<style>
	.two {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr));
		gap: 1.1rem;
	}
</style>
