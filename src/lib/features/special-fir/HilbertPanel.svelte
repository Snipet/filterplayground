<script lang="ts">
	import Card from '$lib/components/layout/Card.svelte';
	import Plot, { type Series } from '$lib/components/plot/Plot.svelte';
	import ResponseView from '$lib/components/plot/ResponseView.svelte';
	import { freqFormat } from '$lib/components/plot/scales';
	import StatGrid, { type Stat } from '$lib/components/content/StatGrid.svelte';
	import Callout from '$lib/components/content/Callout.svelte';
	import ExportPanel from '$lib/components/content/ExportPanel.svelte';
	import { hilbertFir, type WindowSpec } from '$lib/dsp/fir';
	import { remez } from '$lib/dsp/remez';
	import { linspace } from '$lib/dsp/response';
	import { formatSI, trimNumber } from '$lib/dsp/units';
	import { scipyWindow } from '$lib/features/fir-designer/recipes';
	import { amEnvelope, amplitude, analyticSpectra, foldedMultiplies } from './special';

	interface Props {
		fs: number;
		N: number;
		win: WindowSpec;
		edge: number;
		method: 'window' | 'equiripple';
		compensate: boolean;
		depth: number;
	}
	let { fs, N, win, edge, method, compensate, depth }: Props = $props();

	const n = $derived(N % 2 === 0 ? N + 1 : N);
	const M = $derived((n - 1) / 2);
	const hw = $derived(hilbertFir(n, win));
	const eq = $derived.by(() => {
		if (!(edge > 0 && edge < fs / 4)) return { h: null, error: `The band edge must lie between 0 and fs/4 = ${formatSI(fs / 4, 'Hz', 4)}.` };
		try {
			const r = remez(n, [{ f1: edge, f2: fs / 2 - edge, d1: 1, d2: 1, weight: 1 }], fs, { symmetry: 'odd' });
			return { h: r.h, error: r.converged ? null : 'Remez did not converge; the equiripple taps are not optimal.', r };
		} catch (e) {
			return { h: null, error: e instanceof Error ? e.message : String(e) };
		}
	});
	const he = $derived(eq.h ?? hw);
	const h = $derived(method === 'window' ? hw : he);
	const COLOR = { window: 'var(--s1)', equiripple: 'var(--s2)' };

	const filters = $derived([
		{ filter: { kind: 'digital' as const, fs, fir: hw }, label: 'Window method', color: COLOR.window },
		...(eq.h ? [{ filter: { kind: 'digital' as const, fs, fir: he }, label: 'Equiripple (Remez)', color: COLOR.equiripple }] : [])
	]);

	// spectrum of the analytic signal: negative frequencies suppressed
	const spectra = $derived(analyticSpectra(h, 1 / 8, 1 / 160, depth));
	const specSeries = $derived<Series[]>([
		{ x: spectra.f.map((f) => f * fs), y: spectra.real, label: 'Real signal x', color: 'var(--s3)', format: (v: number) => `${trimNumber(v, 3)} dB` },
		{ x: spectra.f.map((f) => f * fs), y: spectra.analytic, label: 'Analytic x + j·H{x}', color: COLOR[method], format: (v: number) => `${trimNumber(v, 3)} dB` }
	]);
	const suppression = $derived.by(() => {
		// image level near −fc relative to the peak
		let img = -Infinity;
		spectra.f.forEach((f, i) => {
			if (Math.abs(f + 1 / 8) < 0.02) img = Math.max(img, spectra.analytic[i]);
		});
		return -img;
	});

	const tapSeries = $derived<Series[]>([
		{ x: h.map((_, i) => i), y: h, label: 'h[n]', color: COLOR[method], kind: 'stem', format: (v: number) => trimNumber(v, 5) }
	]);

	// demo
	const fc = 1 / 8;
	const fm = 1 / 160;
	const demo = $derived(amEnvelope(h, fc, fm, depth, 360, compensate));
	const demoSeries = $derived<Series[]>([
		{ x: demo.n, y: demo.x, label: 'Signal x[n]', color: 'var(--s3)', width: 1.25 },
		{ x: demo.n, y: demo.trueEnv, label: 'True envelope', color: 'var(--s4)', dash: '6 4' },
		{ x: demo.n, y: demo.env, label: '|x + j·H{x}|', color: COLOR[method] }
	]);

	const ripple = (hh: number[]) => {
		let worst = 0;
		for (const f of linspace(edge, fs / 2 - edge, 400)) worst = Math.max(worst, Math.abs(amplitude(hh, f / fs, true) - 1));
		return worst;
	};
	const stats = $derived.by((): Stat[] => {
		const fm2 = foldedMultiplies(h);
		return [
			{ label: 'Taps N', value: `${n} (type III)`, hint: 'Odd length, antisymmetric: zeros at DC and fs/2. With the delay removed the phase is exactly −90° wherever A(f) > 0.' },
			{ label: 'Delay M', value: `${M} samples · ${formatSI(M / fs, 's', 3)}`, hint: 'The real path must be delayed by the same M samples' },
			{ label: 'Ripple, window', value: `±${trimNumber(ripple(hw), 3)}`, hint: `Max |A − 1| between ${formatSI(edge, 'Hz', 3)} and fs/2 − ${formatSI(edge, 'Hz', 3)}` },
			...(eq.h ? [{ label: 'Ripple, equiripple', value: `±${trimNumber(ripple(he), 3)}` }] : []),
			{ label: 'Multiplies / sample', value: `${fm2.folded} (folded)`, hint: `Every other tap is zero: ${fm2.nonzero} non-zero taps, antisymmetric pairs share a multiplier` },
			{
				label: 'Envelope error (demo)',
				value: trimNumber(demo.maxErr, 3),
				status: demo.maxErr < 0.05 ? 'good' : demo.maxErr < 0.2 ? 'warning' : 'critical',
				hint: 'Max |recovered − true| envelope after the start-up transient'
			}
		];
	});

	const scipy = $derived.by(() => {
		if (method === 'equiripple')
			return `import numpy as np\nfrom scipy import signal\n\nfs = ${fs}\nN = ${n}\n# SciPy returns the +j·sgn(ω) convention: negate for the standard −j·sgn(ω) Hilbert transformer\nh = -signal.remez(N, [${edge}, ${fs / 2 - edge}], [1], type='hilbert', fs=fs)\n\n# analytic signal: delay the real path by M = (N-1)/2 samples\nM = (N - 1) // 2\ny = signal.lfilter(h, 1.0, x)\nxa = x[:len(x) - M] + 1j * y[M:]\nenvelope = np.abs(xa)`;
		const w = scipyWindow(win, n) ?? "'hamming'";
		return `import numpy as np\nfrom scipy import signal\n\nN = ${n}\nm = np.arange(N) - (N - 1) // 2\nh = np.zeros(N)\nodd = m % 2 != 0\nh[odd] = 2 / (np.pi * m[odd])             # ideal Hilbert: 2/(πm) for odd m\nh *= signal.get_window(${w}, N, fftbins=False)\n\nM = (N - 1) // 2\ny = signal.lfilter(h, 1.0, x)\nxa = x[:len(x) - M] + 1j * y[M:]          # analytic signal\nenvelope = np.abs(xa)`;
	});
</script>

{#if eq.error}<Callout kind={eq.h ? 'warning' : 'danger'}>{eq.error}</Callout>{/if}
<StatGrid {stats} />

<ResponseView {filters} views={[]} magMode="linear" title="Magnitude (ideal: 1 everywhere except DC and fs/2)" />

<div class="two">
	<Card title="Spectrum of the analytic signal" subtitle={`Two-sided, from the AM demo. The analytic signal keeps only positive frequencies: the image at −fs/8 is ${trimNumber(suppression, 3)} dB down.`}>
		<Plot series={specSeries} xDomain={[-fs / 2, fs / 2]} yDomain={[-100, 5]} xLabel="Frequency (Hz)" yLabel="dB" xFormat={freqFormat} xTooltipFormat={(v) => formatSI(v, 'Hz', 4)} height={220} />
	</Card>
	<Card title="Taps ({method === 'window' ? 'window method' : 'equiripple'})" subtitle="Antisymmetric about the centre; every even offset is zero.">
		<Plot series={tapSeries} vlines={[{ value: M, label: 'centre' }]} xLabel="n" height={220} exportName="hilbert-taps" />
	</Card>
</div>

<Card title="Demo: envelope of an AM signal" subtitle={'x[n] = (1 + m·cos 2π·fm·n)·cos 2π·fc·n with fc = fs/8 and fm = fs/160. The magnitude of the analytic signal x + j·H{x} is the envelope.'}>
	<Plot series={demoSeries} xLabel="Sample n (input time)" yLabel="Amplitude" height={260} exportName="hilbert-envelope" />
	{#if !compensate}
		<p class="small muted note">Without delaying the real path by M = {M} samples, x and H{'{'}x{'}'} no longer form a quadrature pair: the “envelope” ripples at 2·f_c.</p>
	{/if}
</Card>

<Card title="Export">
	<ExportPanel kind="digital" fir={h} {fs} recipes={[{ label: 'SciPy', code: scipy }]} name="hilbert" />
</Card>

<style>
	.two {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr));
		gap: 1.1rem;
	}
	.note {
		margin: 0.4rem 0 0;
	}
</style>
