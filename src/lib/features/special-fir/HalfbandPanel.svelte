<script lang="ts">
	import Card from '$lib/components/layout/Card.svelte';
	import Plot, { type Series } from '$lib/components/plot/Plot.svelte';
	import ResponseView from '$lib/components/plot/ResponseView.svelte';
	import { freqFormat } from '$lib/components/plot/scales';
	import StatGrid, { type Stat } from '$lib/components/content/StatGrid.svelte';
	import Callout from '$lib/components/content/Callout.svelte';
	import ExportPanel from '$lib/components/content/ExportPanel.svelte';
	import { firwin, type WindowSpec } from '$lib/dsp/fir';
	import { linspace } from '$lib/dsp/response';
	import { formatSI, trimNumber } from '$lib/dsp/units';
	import { scipyWindow } from '$lib/features/fir-designer/recipes';
	import { amplitude, foldedMultiplies } from './special';
	import PoleZeroPlot from '$lib/components/plot/PoleZeroPlot.svelte';
	import { firZerosFast } from '$lib/features/fir-designer/fastRoots';

	interface Props {
		fs: number;
		N: number;
		win: WindowSpec;
		/** Passband edge as a fraction of fs (< 0.25). */
		fp: number;
	}
	let { fs, N, win, fp }: Props = $props();

	const n = $derived(N % 2 === 0 ? N + 1 : N);
	const M = $derived((n - 1) / 2);
	// unscaled windowed sinc: the centre tap is exactly 1/2, which makes A(f) + A(fs/2 − f) = 1
	const h = $derived(firwin(n, [fs / 4], win, true, fs, false));
	const filter = $derived({ kind: 'digital' as const, fs, fir: h });

	const peak = $derived(Math.max(...h.map(Math.abs)));
	const isZero = (v: number) => Math.abs(v) <= 1e-12 * peak;
	const tapSeries = $derived<Series[]>([
		{
			x: h.map((_, i) => i),
			y: h.map((v) => (isZero(v) ? NaN : v)),
			label: 'Non-zero taps',
			color: 'var(--s1)',
			kind: 'stem',
			format: (v: number) => trimNumber(v, 5)
		},
		{
			x: h.map((_, i) => i),
			y: h.map((v) => (isZero(v) ? 0 : NaN)),
			label: 'Zero taps',
			color: 'var(--s2)',
			kind: 'points',
			format: () => '0'
		}
	]);

	const grid = $derived(linspace(0, fs / 2, 600));
	const symSeries = $derived<Series[]>([
		{
			x: grid,
			y: grid.map((f) => amplitude(h, f / fs, false)),
			label: 'A(f)',
			color: 'var(--s1)',
			format: (v: number) => trimNumber(v, 5)
		},
		{
			x: grid,
			y: grid.map((f) => 1 - amplitude(h, (fs / 2 - f) / fs, false)),
			label: '1 − A(fs/2 − f)',
			color: 'var(--s2)',
			dash: '6 4',
			format: (v: number) => trimNumber(v, 5)
		}
	]);

	const ripple = $derived.by(() => {
		let pass = 0;
		let stop = 0;
		for (const f of linspace(0, fp * fs, 300))
			pass = Math.max(pass, Math.abs(amplitude(h, f / fs, false) - 1));
		for (const f of linspace((0.5 - fp) * fs, fs / 2, 300))
			stop = Math.max(stop, Math.abs(amplitude(h, f / fs, false)));
		return { pass, stop };
	});
	const fm = $derived(foldedMultiplies(h));
	const zeros = $derived(firZerosFast(h));
	const endZero = $derived(isZero(h[0]));

	const stats = $derived<Stat[]>([
		{ label: 'Taps N', value: `${n} (${fm.nonzero} non-zero)` },
		{ label: 'Centre tap', value: trimNumber(h[M], 6), hint: 'Exactly 1/2 for a half-band filter' },
		{
			label: 'Gain at fs/4',
			value: `${trimNumber(20 * Math.log10(Math.abs(amplitude(h, 0.25, false))), 4)} dB`,
			hint: 'A(fs/4) = 1/2: the response passes through −6.02 dB at the band centre'
		},
		{
			label: 'Ripple δ (pass / stop)',
			value: `${trimNumber(ripple.pass, 3)} / ${trimNumber(ripple.stop, 3)}`,
			hint: `Passband 0 … ${formatSI(fp * fs, 'Hz', 3)}, stopband ${formatSI((0.5 - fp) * fs, 'Hz', 3)} … fs/2. Equal by symmetry.`
		},
		{
			label: 'Stopband attenuation',
			value: `${trimNumber(-20 * Math.log10(Math.max(ripple.stop, 1e-12)), 3)} dB`
		},
		{
			label: 'Multiplies / output',
			value: `${fm.folded - 1} + a shift`,
			hint: `With folding the ${fm.nonzero} non-zero taps need ${fm.folded} distinct products, and the centre tap ½ is a bit shift. Decimating by 2 computes only every other output: ${trimNumber((fm.folded - 1) / 2, 3)} multiplies per input sample.`
		}
	]);

	const recipe = $derived(
		`from scipy import signal\n\nfs = ${fs}\n# half-band: cutoff fs/4, unscaled so the centre tap is exactly 1/2\nh = signal.firwin(${n}, fs / 4, window=${scipyWindow(win, n) ?? "'hamming'"}, scale=False, fs=fs)\n\n# decimate by 2: filter, then keep every other sample\n# y = signal.lfilter(h, 1.0, x)[::2]`
	);
</script>

{#if endZero}
	<Callout kind="note" title="Wasted end taps">
		With N = {n} = 4K + 1 the outermost taps fall on even offsets from the centre and are zero. Use N
		= 4K + 3 (here {n + 2} or {n - 2}) so that every stored tap does work.
	</Callout>
{/if}

<StatGrid {stats} />

<ResponseView
	filters={[{ filter, label: `Half-band, N = ${n}` }]}
	views={['phase']}
	vlines={[{ value: fs / 4, label: 'fs/4' }]}
/>

<div class="two">
	<Card title="Taps" subtitle="Every other tap is zero — except the centre tap, which is 1/2.">
		<Plot
			series={tapSeries}
			vlines={[{ value: M, label: 'centre' }]}
			xLabel="n"
			height={230}
			exportName="halfband-taps"
		/>
	</Card>
	<Card
		title="Zeros (z-plane)"
		subtitle="{zeros.length} zeros. Stopband zeros lie on the unit circle; the passband zeros come in mirror groups."
	>
		<PoleZeroPlot
			{zeros}
			poles={zeros.map(() => ({ re: 0, im: 0 }))}
			domain="z"
			{fs}
			height={260}
		/>
	</Card>
	<Card
		title="Symmetry about fs/4"
		subtitle="A(f) + A(fs/2 − f) = 1: the two curves coincide, so passband and stopband ripples are equal."
	>
		<Plot
			series={symSeries}
			xDomain={[0, fs / 2]}
			vlines={[{ value: fs / 4, label: 'fs/4' }]}
			hlines={[{ value: 0.5 }]}
			xLabel="Frequency (Hz)"
			yLabel="Amplitude"
			xFormat={freqFormat}
			xTooltipFormat={(v) => formatSI(v, 'Hz', 4)}
			height={230}
		/>
	</Card>
</div>

<Card title="Export">
	<ExportPanel
		kind="digital"
		fir={h}
		{fs}
		recipes={[{ label: 'SciPy', code: recipe }]}
		name="halfband"
	/>
</Card>

<style>
	.two {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr));
		gap: 1.1rem;
	}
</style>
