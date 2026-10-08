<script lang="ts">
	import Card from '$lib/components/layout/Card.svelte';
	import Plot, { type Series } from '$lib/components/plot/Plot.svelte';
	import { freqFormat } from '$lib/components/plot/scales';
	import StatGrid, { type Stat } from '$lib/components/content/StatGrid.svelte';
	import ExportPanel from '$lib/components/content/ExportPanel.svelte';
	import { differentiatorFir, type WindowSpec } from '$lib/dsp/fir';
	import { formatSI, trimNumber } from '$lib/dsp/units';
	import { scipyWindow } from '$lib/features/fir-designer/recipes';
	import { denseMag, differentiate } from './special';

	interface Props {
		fs: number;
		L: number;
		win: WindowSpec;
		sel: 'III' | 'IV';
		f0: number;
		noise: number;
	}
	let { fs, L, win, sel, f0, noise }: Props = $props();

	const n3 = $derived(L % 2 === 1 ? L : L + 1);
	const n4 = $derived(n3 + 1);
	const h3 = $derived(differentiatorFir(n3, win));
	const h4 = $derived(differentiatorFir(n4, win));
	const h = $derived(sel === 'III' ? h3 : h4);
	const N = $derived(h.length);
	const COLOR = { III: 'var(--s1)', IV: 'var(--s2)', ideal: 'var(--s3)', truth: 'var(--s3)' };

	const m3 = $derived(denseMag(h3, 2048));
	const m4 = $derived(denseMag(h4, 2048));
	const magSeries = $derived<Series[]>([
		{
			x: m3.f.map((f) => f * fs),
			y: m3.f.map((f) => 2 * Math.PI * f),
			label: 'Ideal |H| = ω',
			color: COLOR.ideal,
			dash: '6 4'
		},
		{ x: m3.f.map((f) => f * fs), y: m3.mag, label: `Type III (N = ${n3})`, color: COLOR.III },
		{ x: m4.f.map((f) => f * fs), y: m4.mag, label: `Type IV (N = ${n4})`, color: COLOR.IV }
	]);
	const errSeries = $derived<Series[]>(
		[
			{ m: m3, label: `Type III (N = ${n3})`, color: COLOR.III },
			{ m: m4, label: `Type IV (N = ${n4})`, color: COLOR.IV }
		].map((s) => ({
			x: s.m.f.slice(1).map((f) => f * fs),
			y: s.m.f
				.slice(1)
				.map((f, i) => 20 * Math.log10(Math.max(s.m.mag[i + 1], 1e-12) / (2 * Math.PI * f))),
			label: s.label,
			color: s.color,
			format: (v: number) => `${trimNumber(v, 3)} dB`
		}))
	);

	const stem = (hh: number[], color: string, label: string): Series[] => [
		{
			x: hh.map((_, i) => i),
			y: hh,
			label,
			color,
			kind: 'stem',
			format: (v: number) => trimNumber(v, 5)
		}
	];

	const d3 = $derived(differentiate(h3, f0 / fs, fs, noise, 240));
	const d4 = $derived(differentiate(h4, f0 / fs, fs, noise, 240));
	const demo = $derived(sel === 'III' ? d3 : d4);
	const demoSeries = $derived<Series[]>([
		{ x: demo.n, y: demo.truth, label: 'True derivative', color: COLOR.truth, dash: '6 4' },
		{ x: demo.n, y: demo.est, label: `Type ${sel} output × fs`, color: COLOR[sel] }
	]);

	const clean0 = (v: number) => (Math.abs(v) < 1e-9 ? 0 : v);
	const noiseGain = (hh: number[]) => Math.sqrt(hh.reduce((s, v) => s + v * v, 0));
	const stats = $derived<Stat[]>([
		{ label: 'Taps', value: `III: ${n3} · IV: ${n4}` },
		{
			label: 'Delay (N−1)/2',
			value: `${trimNumber((N - 1) / 2, 4)} samples`,
			hint: 'Type IV has a half-sample delay, so its output lies between input samples'
		},
		{
			label: 'Gain at fs/2',
			value: `III: ${trimNumber(clean0(m3.mag[m3.mag.length - 1]), 3)} · IV: ${trimNumber(clean0(m4.mag[m4.mag.length - 1]), 3)}`,
			hint: 'Ideal: π. Type III is forced to zero at fs/2.'
		},
		{
			label: 'Demo error (RMS)',
			value: `III: ${trimNumber((100 * d3.rmsErr) / d3.truthRms, 3)} % · IV: ${trimNumber((100 * d4.rmsErr) / d4.truthRms, 3)} %`,
			hint: 'Relative to the RMS of the true derivative'
		},
		{
			label: 'White-noise gain',
			value: `III: ${trimNumber(noiseGain(h3), 3)} · IV: ${trimNumber(noiseGain(h4), 3)}`,
			hint: '√Σh²: how much white input noise is amplified (per sample)'
		}
	]);

	const scipy = $derived(
		`import numpy as np\nfrom scipy import signal\n\nN = ${N}                      # ${N % 2 ? 'odd → type III' : 'even → type IV'}\nt = np.arange(N) - (N - 1) / 2\nwith np.errstate(divide='ignore', invalid='ignore'):\n    h = np.cos(np.pi * t) / t - np.sin(np.pi * t) / (np.pi * t**2)   # ideal jω (per sample)\nh[t == 0] = 0\nh *= signal.get_window(${scipyWindow(win, N) ?? "'hann'"}, N, fftbins=False)\n\n# derivative in units per second: fs * lfilter(h, 1, x), delayed by (N-1)/2 samples\n# fs = ${fs}\n# dxdt = fs * signal.lfilter(h, 1.0, x)`
	);
</script>

<StatGrid {stats} />

<Card
	title="Magnitude vs the ideal ω"
	subtitle="Gain per sample (rad/sample). An ideal differentiator rises linearly to π at fs/2."
>
	<Plot
		series={magSeries}
		xDomain={[0, fs / 2]}
		xLabel="Frequency (Hz)"
		yLabel="|H|"
		xFormat={freqFormat}
		xTooltipFormat={(v) => formatSI(v, 'Hz', 4)}
		height={280}
		exportName="differentiator-magnitude"
	/>
</Card>

<div class="two">
	<Card title="Error relative to ω" subtitle="20·log10(|H| / ω): 0 dB is perfect.">
		<Plot
			series={errSeries}
			xDomain={[0, fs / 2]}
			yDomain={[-20, 3]}
			xLabel="Frequency (Hz)"
			yLabel="dB"
			xFormat={freqFormat}
			xTooltipFormat={(v) => formatSI(v, 'Hz', 4)}
			height={220}
		/>
	</Card>
	<Card
		title="Taps"
		subtitle="Antisymmetric. Type III has a zero centre tap; type IV has no centre tap at all."
	>
		<div class="stack">
			<Plot
				series={stem(h3, COLOR.III, `Type III (N = ${n3})`)}
				vlines={[{ value: (n3 - 1) / 2 }]}
				legend={false}
				title="Type III"
				height={110}
			/>
			<Plot
				series={stem(h4, COLOR.IV, `Type IV (N = ${n4})`)}
				vlines={[{ value: (n4 - 1) / 2 }]}
				legend={false}
				title="Type IV"
				height={110}
				xLabel="n"
			/>
		</div>
	</Card>
</div>

<Card
	title="Demo: differentiating a {formatSI(f0, 'Hz', 3)} sine{noise > 0 ? ' with noise' : ''}"
	subtitle="Output scaled by fs to units per second and compared with the exact derivative at the filter's (possibly half-sample) delay."
>
	<Plot
		series={demoSeries}
		xLabel="Sample n (input time)"
		yLabel="dx/dt (1/s)"
		yFormat={(v) => formatSI(v, '', 3)}
		height={250}
		exportName="derivative"
	/>
</Card>

<Card title="Export (type {sel})">
	<ExportPanel
		kind="digital"
		fir={h}
		{fs}
		recipes={[{ label: 'SciPy', code: scipy }]}
		name="differentiator"
	/>
</Card>

<style>
	.two {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr));
		gap: 1.1rem;
	}
	.stack {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
</style>
