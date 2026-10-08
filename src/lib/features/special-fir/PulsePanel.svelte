<script lang="ts">
	import Card from '$lib/components/layout/Card.svelte';
	import Plot, { type Series } from '$lib/components/plot/Plot.svelte';
	import ResponseView from '$lib/components/plot/ResponseView.svelte';
	import StatGrid, { type Stat } from '$lib/components/content/StatGrid.svelte';
	import ExportPanel from '$lib/components/content/ExportPanel.svelte';
	import { gaussianPulse, raisedCosine, rootRaisedCosine } from '$lib/dsp/fir';
	import { formatSI, trimNumber } from '$lib/dsp/units';
	import { conv, denseMag, eyeDiagram } from './special';

	interface Props {
		kind: 'rc' | 'gaussian';
		fs: number;
		sps: number;
		span: number;
		beta: number;
		bt: number;
		eyeMode: 'rc' | 'rrc';
	}
	let { kind, fs, sps, span, beta, bt, eyeMode }: Props = $props();

	const Rs = $derived(fs / sps);
	const COLOR = { rc: 'var(--s1)', rrc: 'var(--s2)', cascade: 'var(--s3)', gauss: 'var(--s1)' };

	const rc = $derived(kind === 'rc' ? raisedCosine(sps, beta, span) : []);
	const rrc = $derived(kind === 'rc' ? rootRaisedCosine(sps, beta, span) : []);
	const cascade = $derived(kind === 'rc' ? conv(rrc, rrc) : []);
	const gauss = $derived(kind === 'gaussian' ? gaussianPulse(sps, bt, span) : []);

	const tAxis = (h: number[]) => h.map((_, i) => (i - (h.length - 1) / 2) / sps);
	const peakNorm = (h: number[]) => {
		const p = h[(h.length - 1) / 2] || 1;
		return h.map((v) => v / p);
	};

	const pulseSeries = $derived.by((): Series[] => {
		if (kind === 'gaussian')
			return [
				{
					x: tAxis(gauss),
					y: peakNorm(gauss),
					label: `Gaussian, BT = ${bt}`,
					color: COLOR.gauss,
					format: (v: number) => trimNumber(v, 4)
				}
			];
		const inst = rc.map((_, i) => i).filter((i) => (i - (rc.length - 1) / 2) % sps === 0);
		return [
			{
				x: tAxis(rc),
				y: rc,
				label: 'Raised cosine',
				color: COLOR.rc,
				format: (v: number) => trimNumber(v, 4)
			},
			{
				x: tAxis(rrc),
				y: peakNorm(rrc),
				label: 'Root raised cosine',
				color: COLOR.rrc,
				format: (v: number) => trimNumber(v, 4)
			},
			{
				x: tAxis(cascade),
				y: peakNorm(cascade),
				label: 'RRC ∗ RRC',
				color: COLOR.cascade,
				dash: '6 4',
				format: (v: number) => trimNumber(v, 4)
			},
			{
				x: inst.map((i) => (i - (rc.length - 1) / 2) / sps),
				y: inst.map((i) => rc[i]),
				color: COLOR.rc,
				kind: 'points',
				hidden: true
			}
		];
	});

	const dcNorm = (h: number[]) => {
		const s = h.reduce((a, v) => a + v, 0) || 1;
		return h.map((v) => v / s);
	};
	const filters = $derived(
		kind === 'rc'
			? [
					{
						filter: { kind: 'digital' as const, fs, fir: dcNorm(rc) },
						label: 'Raised cosine',
						color: COLOR.rc
					},
					{
						filter: { kind: 'digital' as const, fs, fir: dcNorm(rrc) },
						label: 'Root raised cosine',
						color: COLOR.rrc
					}
				]
			: [
					{
						filter: { kind: 'digital' as const, fs, fir: gauss },
						label: `Gaussian, BT = ${bt}`,
						color: COLOR.gauss
					}
				]
	);
	const vlines = $derived(
		kind === 'rc'
			? [
					{ value: (Rs / 2) * (1 - beta), label: undefined },
					{ value: Rs / 2, label: 'Rs/2' },
					{ value: (Rs / 2) * (1 + beta), label: '(1+β)Rs/2' }
				].filter((v, i) => i === 1 || beta > 0.02)
			: [{ value: bt * Rs, label: 'BT·Rs' }]
	);

	// eye diagram
	const eyeH = $derived(kind === 'gaussian' ? gauss : eyeMode === 'rc' ? rc : cascade);
	const eye = $derived(eyeDiagram(eyeH, sps, kind === 'gaussian'));
	const eyeColor = $derived(
		kind === 'gaussian' ? COLOR.gauss : eyeMode === 'rc' ? COLOR.rc : COLOR.cascade
	);
	const eyeSeries = $derived<Series[]>(
		eye.traces.map((t) => ({ ...t, color: eyeColor, hidden: true, opacity: 0.45, width: 1.25 }))
	);

	const stats = $derived.by((): Stat[] => {
		const out: Stat[] = [
			{ label: 'Taps', value: `${span * sps + 1}`, hint: `span × sps + 1 = ${span} × ${sps} + 1` },
			{ label: 'Symbol rate Rs', value: formatSI(Rs, 'Bd', 4), hint: 'fs / samples per symbol' }
		];
		if (kind === 'rc') {
			out.push({
				label: 'Occupied bandwidth',
				value: formatSI(((1 + beta) * Rs) / 2, 'Hz', 4),
				hint: '(1 + β)·Rs/2 (one-sided)'
			});
			const m = denseMag(dcNorm(rrc), 8192);
			let worst = 0;
			m.f.forEach((f, i) => {
				if (f * sps > (1 + beta) / 2 + 0.05) worst = Math.max(worst, m.mag[i]);
			});
			out.push({
				label: 'RRC stopband',
				value: `${trimNumber(-20 * Math.log10(Math.max(worst, 1e-12)), 3)} dB`,
				hint: 'Attenuation beyond (1+β)·Rs/2 + 0.05·Rs: limited by truncating the pulse to the span'
			});
		} else {
			const m = denseMag(gauss, 8192);
			const k = m.mag.findIndex((v) => v < Math.SQRT1_2);
			out.push({
				label: '−3 dB bandwidth',
				value:
					k > 0 ? `${formatSI(m.f[k] * fs, 'Hz', 4)} (BT·Rs = ${formatSI(bt * Rs, 'Hz', 4)})` : '—'
			});
			const c = (gauss.length - 1) / 2;
			const isi = c + sps < gauss.length ? gauss[c + sps] / gauss[c] : 0;
			out.push({
				label: 'Pulse at ±T',
				value: `${trimNumber(100 * isi, 3)} % of peak`,
				hint: 'How much each symbol spills into its neighbours'
			});
		}
		out.push({
			label:
				kind === 'gaussian'
					? 'Peak ISI (NRZ)'
					: eyeMode === 'rc'
						? 'Peak ISI (RC)'
						: 'Peak ISI (RRC→RRC)',
			value: eye.peakIsi < 1e-9 ? '0 % (exact)' : `${trimNumber(100 * eye.peakIsi, 3)} %`,
			status:
				kind === 'gaussian'
					? undefined
					: eye.peakIsi < 1e-3
						? 'good'
						: eye.peakIsi < 0.05
							? 'warning'
							: 'critical',
			hint: 'Largest deviation of the samples at the symbol instants from ±1'
		});
		out.push({
			label: 'Eye opening',
			value: `${trimNumber(100 * eye.opening, 3)} %`,
			hint: 'Worst-case vertical opening at the sampling instant'
		});
		return out;
	});

	const exportH = $derived(kind === 'gaussian' ? gauss : eyeMode === 'rc' ? rc : rrc);
	const recipe = $derived(
		kind === 'gaussian'
			? `import numpy as np\n\nsps, span, BT = ${sps}, ${span}, ${bt}\nt = (np.arange(span * sps + 1) - span * sps / 2) / sps    # time in symbols\na = np.sqrt(np.log(2) / 2) / BT\nh = np.sqrt(np.pi) / a * np.exp(-(np.pi * t / a) ** 2)\nh /= h.sum()                                              # unit DC gain`
			: eyeMode === 'rc'
				? `import numpy as np\n\nsps, span, beta = ${sps}, ${span}, ${beta}\nt = (np.arange(span * sps + 1) - span * sps / 2) / sps    # time in symbols\nwith np.errstate(divide='ignore', invalid='ignore'):\n    h = np.sinc(t) * np.cos(np.pi * beta * t) / (1 - (2 * beta * t) ** 2)\nif beta > 0:\n    h[np.isclose(np.abs(t), 1 / (2 * beta))] = np.pi / 4 * np.sinc(1 / (2 * beta))\n# peak 1 at t = 0; zero at every other multiple of T`
				: `import numpy as np\n\nsps, span, beta = ${sps}, ${span}, ${beta}\nt = (np.arange(span * sps + 1) - span * sps / 2) / sps    # time in symbols\nh = np.empty_like(t)\nfor i, ti in enumerate(t):\n    if ti == 0:\n        h[i] = 1 + beta * (4 / np.pi - 1)\n    elif beta > 0 and np.isclose(abs(ti), 1 / (4 * beta)):\n        h[i] = beta / np.sqrt(2) * ((1 + 2 / np.pi) * np.sin(np.pi / (4 * beta)) + (1 - 2 / np.pi) * np.cos(np.pi / (4 * beta)))\n    else:\n        h[i] = (np.sin(np.pi * ti * (1 - beta)) + 4 * beta * ti * np.cos(np.pi * ti * (1 + beta))) / (np.pi * ti * (1 - (4 * beta * ti) ** 2))\nh /= np.sqrt(np.sum(h ** 2))                               # unit energy: RRC ∗ RRC peaks at 1`
	);
</script>

<StatGrid {stats} />

<Card
	title="Pulse shape"
	subtitle={kind === 'rc'
		? 'Time in symbol periods T. The raised cosine (dots) is zero at every non-zero multiple of T; the RRC alone is not — only RRC ∗ RRC is.'
		: 'Time in symbol periods T, normalised to a peak of 1.'}
>
	<Plot
		series={pulseSeries}
		xLabel="Time (symbols)"
		yLabel="Amplitude"
		height={250}
		exportName="pulse"
	/>
</Card>

<ResponseView
	{filters}
	views={[]}
	{vlines}
	title={kind === 'rc'
		? 'Magnitude (0 dB at DC; lines at (1−β)Rs/2, Rs/2, (1+β)Rs/2)'
		: 'Magnitude (0 dB at DC)'}
	dbRange={100}
/>

<Card
	title="Eye diagram"
	subtitle={kind === 'gaussian'
		? 'Random ±1 NRZ symbols through the Gaussian filter (the frequency trajectory of GMSK), overlaid two symbols at a time. The eye is not fully open: Gaussian pulses trade ISI for compact spectra.'
		: eyeMode === 'rc'
			? 'Random ±1 symbols through the raised cosine, overlaid two symbols at a time. All traces pass through ±1 at the sampling instant: zero ISI.'
			: 'Random ±1 symbols through RRC at the transmitter and RRC at the receiver (matched filter). The cascade is (almost) a raised cosine.'}
>
	<Plot
		series={eyeSeries}
		xDomain={[-1, 1]}
		vlines={[{ value: 0, label: 'sampling instant' }]}
		hlines={[
			{ value: 1, dash: '2 4' },
			{ value: -1, dash: '2 4' }
		]}
		xLabel="Time (symbols)"
		yLabel="Amplitude"
		crosshair={false}
		height={280}
	/>
</Card>

<Card
	title="Export ({kind === 'gaussian'
		? 'Gaussian'
		: eyeMode === 'rc'
			? 'raised cosine'
			: 'root raised cosine'})"
>
	<ExportPanel
		kind="digital"
		fir={exportH}
		{fs}
		recipes={[{ label: 'NumPy', code: recipe }]}
		name={kind === 'gaussian' ? 'gaussian' : eyeMode}
	/>
</Card>
