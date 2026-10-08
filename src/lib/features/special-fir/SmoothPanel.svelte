<script lang="ts">
	import Card from '$lib/components/layout/Card.svelte';
	import Plot, { type Series } from '$lib/components/plot/Plot.svelte';
	import ResponseView, { type ResponseKind } from '$lib/components/plot/ResponseView.svelte';
	import StatGrid, { type Stat } from '$lib/components/content/StatGrid.svelte';
	import ExportPanel from '$lib/components/content/ExportPanel.svelte';
	import { movingAverage, savitzkyGolay } from '$lib/dsp/fir';
	import { evaluate, findCrossing, linspace } from '$lib/dsp/response';
	import { formatSI, trimNumber } from '$lib/dsp/units';
	import { centralDifference, smoothingDemo } from './special';

	interface Props {
		kind: 'savgol' | 'movavg';
		fs: number;
		/** Window length (odd for Savitzky–Golay). */
		L: number;
		order: number;
		deriv: number;
		noise: number;
	}
	let { kind, fs, L, order, deriv, noise }: Props = $props();

	const COLOR = { sg: 'var(--s1)', ma: 'var(--s2)', noisy: 'var(--s3)', clean: 'var(--s4)' };
	const isSg = $derived(kind === 'savgol');
	const win = $derived(isSg && L % 2 === 0 ? L + 1 : L);
	const d = $derived(isSg ? Math.min(deriv, order) : 0);
	const sg = $derived(isSg ? savitzkyGolay(win, Math.min(order, win - 1), d) : []);
	const ma = $derived(movingAverage(win));
	// for derivatives, compare with the plain central difference instead of a moving average
	const ref = $derived(d > 0 ? centralDifference(d) : ma);
	const refLabel = $derived(
		d > 0
			? `Central difference (${d === 1 ? '[½, 0, −½]' : '[1, −2, 1]'})`
			: `Moving average (L = ${win})`
	);
	const main = $derived(isSg ? sg : ma);
	const sgLabel = $derived(
		`Savitzky–Golay (${win}, order ${Math.min(order, win - 1)}${d ? `, d = ${d}` : ''})`
	);

	const filters = $derived(
		isSg
			? [
					{ filter: { kind: 'digital' as const, fs, fir: sg }, label: sgLabel, color: COLOR.sg },
					{ filter: { kind: 'digital' as const, fs, fir: ref }, label: refLabel, color: COLOR.ma }
				]
			: [
					{
						filter: { kind: 'digital' as const, fs, fir: ma },
						label: `Moving average (L = ${win})`,
						color: COLOR.ma
					}
				]
	);
	const views = $derived<ResponseKind[]>(
		isSg ? [] : win <= 64 ? ['pz', 'impulse', 'step'] : ['impulse', 'step']
	);
	const vlines = $derived(
		isSg ? [] : [{ value: fs / win, label: 'fs/L' }].filter((v) => v.value < fs / 2)
	);

	const demo = $derived(smoothingDemo(isSg ? [sg, ref] : [ma], d, noise));
	const demoSeries = $derived.by((): Series[] => {
		const s: Series[] = [];
		if (d === 0)
			s.push({
				x: demo.n,
				y: demo.noisy,
				label: 'Noisy input',
				color: COLOR.noisy,
				width: 1,
				opacity: 0.6
			});
		s.push({
			x: demo.n,
			y: demo.clean,
			label: d === 0 ? 'Clean signal' : `True ${d === 1 ? '1st' : '2nd'} derivative`,
			color: COLOR.clean,
			dash: '6 4'
		});
		if (isSg) {
			s.push({
				x: demo.outputs[1].x,
				y: demo.outputs[1].y,
				label: d > 0 ? 'Central difference' : 'Moving average',
				color: COLOR.ma
			});
			s.push({
				x: demo.outputs[0].x,
				y: demo.outputs[0].y,
				label: 'Savitzky–Golay',
				color: COLOR.sg
			});
		} else
			s.push({
				x: demo.outputs[0].x,
				y: demo.outputs[0].y,
				label: 'Moving average',
				color: COLOR.ma
			});
		return s;
	});

	const tapSeries = $derived<Series[]>([
		{
			x: main.map((_, i) => i - (main.length - 1) / 2),
			y: main,
			label: 'h',
			color: isSg ? COLOR.sg : COLOR.ma,
			kind: 'stem',
			format: (v: number) => trimNumber(v, 5)
		}
	]);

	const f3 = (h: number[]) => {
		const grid = linspace(0, fs / 2, 1200);
		const r = evaluate({ kind: 'digital', fs, fir: h }, grid);
		const peak = r.magDb[0];
		return findCrossing(
			grid,
			r.magDb.map((v) => v - peak),
			-3.0103
		);
	};
	const ng = (h: number[]) => Math.sqrt(h.reduce((s, v) => s + v * v, 0));

	const stats = $derived.by((): Stat[] => {
		const out: Stat[] = [
			{ label: 'Length', value: `${win} taps`, hint: 'Delay (L−1)/2 samples when run causally' }
		];
		if (isSg) {
			out.push({ label: 'Polynomial order', value: String(Math.min(order, win - 1)) });
			if (d === 0) {
				const a = f3(sg);
				const b = f3(ma);
				out.push({
					label: '−3 dB frequency',
					value: `SG ${a ? formatSI(a, 'Hz', 3) : '—'} · MA ${b ? formatSI(b, 'Hz', 3) : '—'}`
				});
			}
			out.push({
				label: 'White-noise gain',
				value: `SG ${trimNumber(20 * Math.log10(ng(sg)), 3)} dB · ${d ? 'diff' : 'MA'} ${trimNumber(20 * Math.log10(ng(ref)), 3)} dB`,
				hint: '20·log10 √Σh²: output noise relative to white input noise'
			});
			out.push({
				label: 'RMS error (demo)',
				value: `SG ${trimNumber(demo.outputs[0].rmsErr, 3)} · ${d ? 'diff' : 'MA'} ${trimNumber(demo.outputs[1].rmsErr, 3)}`,
				status: demo.outputs[0].rmsErr <= demo.outputs[1].rmsErr ? 'good' : 'warning',
				hint: 'Against the clean signal (or its exact derivative)'
			});
			if (d === 0)
				out.push({
					label: 'Narrow-peak error',
					value: `SG ${trimNumber(demo.outputs[0].peakErr, 3)} · MA ${trimNumber(demo.outputs[1].peakErr, 3)}`,
					hint: 'Smoothed peak height minus the true height at the narrowest peak (height 1, σ = 3 samples)'
				});
		} else {
			const a = f3(ma);
			out.push({
				label: '−3 dB frequency',
				value: a ? `${formatSI(a, 'Hz', 4)} ≈ 0.443·fs/L` : '—'
			});
			out.push({
				label: 'First null',
				value: formatSI(fs / win, 'Hz', 4),
				hint: 'Zeros at multiples of fs/L: it removes any signal periodic in L samples'
			});
			out.push({
				label: 'Noise reduction',
				value: `${trimNumber(10 * Math.log10(win), 3)} dB`,
				hint: 'White-noise variance falls by a factor L'
			});
			out.push({
				label: 'Cost',
				value: '1 add + 1 subtract',
				hint: 'As a running sum: y[n] = y[n−1] + (x[n] − x[n−L])/L'
			});
			out.push({ label: 'RMS error (demo)', value: trimNumber(demo.outputs[0].rmsErr, 3) });
		}
		return out;
	});

	const recipe = $derived(
		isSg
			? `import numpy as np\nfrom scipy import signal\n\nh = signal.savgol_coeffs(${win}, ${Math.min(order, win - 1)}, deriv=${d}, use='conv')\n# or filter directly (handles the edges too):\n# y = signal.savgol_filter(x, ${win}, ${Math.min(order, win - 1)}, deriv=${d})`
			: `import numpy as np\n\nL = ${win}\nh = np.ones(L) / L\n# running-sum implementation: y = np.convolve(x, h, mode='valid')`
	);
</script>

<StatGrid {stats} />

<ResponseView {filters} {views} {vlines} title="Magnitude response" />

<Card
	title="Demo: {d === 0
		? 'smoothing noisy peaks'
		: `estimating the ${d === 1 ? 'first' : 'second'} derivative of noisy peaks`}"
	subtitle={d === 0
		? 'Gaussian peaks of different widths plus white noise, filtered without delay (centred). Watch the narrow peak on the left.'
		: 'The same noisy peaks; derivative estimates against the exact derivative (per sample).'}
>
	<Plot
		series={demoSeries}
		xLabel="Sample n"
		yLabel={d === 0 ? 'Amplitude' : `d${d === 2 ? '²' : ''}x/dn${d === 2 ? '²' : ''}`}
		height={280}
		exportName="smoothing"
	/>
</Card>

{#if isSg}
	<Card
		title="Coefficients"
		subtitle="Savitzky–Golay taps (index relative to the centre). The negative side taps are what preserve peak heights."
	>
		<Plot
			series={tapSeries}
			xLabel="k (relative to centre)"
			height={200}
			legend={false}
			exportName="taps"
		/>
	</Card>
{/if}

<Card title="Export">
	<ExportPanel
		kind="digital"
		fir={main}
		{fs}
		recipes={[{ label: isSg ? 'SciPy' : 'NumPy', code: recipe }]}
		name={isSg ? 'savgol' : 'moving_average'}
	/>
</Card>
