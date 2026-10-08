<script lang="ts">
	import ToolLayout from '$lib/components/layout/ToolLayout.svelte';
	import ControlGroup from '$lib/components/layout/ControlGroup.svelte';
	import Card from '$lib/components/layout/Card.svelte';
	import Segmented from '$lib/components/controls/Segmented.svelte';
	import Slider from '$lib/components/controls/Slider.svelte';
	import Toggle from '$lib/components/controls/Toggle.svelte';
	import Plot, { type Series } from '$lib/components/plot/Plot.svelte';
	import { SERIES_COLORS } from '$lib/components/plot/scales';
	import StatGrid, { type Stat } from '$lib/components/content/StatGrid.svelte';
	import Callout from '$lib/components/content/Callout.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import WindowSlot, { type Slot } from '$lib/features/windows/WindowSlot.svelte';
	import { windowInfo, windowMetrics, windowSpectrum } from '$lib/dsp/windows';
	import { trimNumber } from '$lib/dsp/units';
	import {
		allWindowMetrics,
		makeWindow,
		resolveWeak,
		sliceDecimate,
		sortRows,
		twoTones,
		windowedSpectrum,
		type MetricKey,
		type ToneSetup
	} from '$lib/features/windows/analysis';

	// ---------------- state ----------------
	let slots = $state<Slot[]>([
		{ on: true, type: 'rectangular' },
		{ on: true, type: 'hann' },
		{ on: true, type: 'blackmanharris' },
		{ on: false, type: 'kaiser', param: 8.6 }
	]);
	let N = $state(64);
	let form = $state<'symmetric' | 'periodic'>('symmetric');
	const periodic = $derived(form === 'periodic');
	let range = $state<'full' | 'zoom'>('full');
	let showLobe = $state(true);

	// leakage demo
	let f1 = $state(10.3);
	let sep = $state(7.2);
	let weakDb = $state(-55);
	let pad = $state(16);
	let leakView = $state<'near' | 'full'>('near');

	const colorOf = (i: number) => SERIES_COLORS[i];

	function labelOf(s: Slot): string {
		const info = windowInfo(s.type);
		const short = info.name.replace(/ \(.*\)$/, '');
		if (!info.param) return short;
		const v = trimNumber(s.param ?? info.param.default, 3);
		return s.type === 'chebyshev' ? `${short} ${v} dB` : `${short} ${info.param.label}=${v}`;
	}

	// Each slot keeps its own colour, whether or not the others are shown.
	const active = $derived.by(() => {
		const out: { i: number; slot: Slot; label: string; color: string; w: number[] }[] = [];
		slots.forEach((s, i) => {
			if (!s.on) return;
			out.push({ i, slot: s, label: labelOf(s), color: colorOf(i), w: makeWindow({ type: s.type, param: s.param }, N, periodic) });
		});
		return out;
	});

	const analysed = $derived(
		active.map((a) => ({
			...a,
			spec: windowSpectrum(a.w, N >= 512 ? 32 : 64),
			metrics: windowMetrics(a.w)
		}))
	);

	// ---------------- plots ----------------
	const timeSeries = $derived<Series[]>(
		analysed.map((a) => ({
			x: a.w.map((_, n) => n),
			y: a.w,
			label: a.label,
			color: a.color,
			format: (v: number) => trimNumber(v, 4)
		}))
	);

	const xMax = $derived(range === 'full' ? N / 2 : Math.min(N / 2, 20));
	const specSeries = $derived<Series[]>(
		analysed.map((a) => ({
			...sliceDecimate(a.spec.bins, a.spec.db, 0, xMax, 800),
			label: a.label,
			color: a.color,
			format: (v: number) => `${trimNumber(v, 4)} dB`
		}))
	);
	const specFloor = $derived.by(() => {
		const psl = analysed.map((a) => a.metrics.peakSidelobeDb).filter(Number.isFinite);
		const lo = psl.length ? Math.min(...psl) : -60;
		return Math.max(-200, Math.min(-80, Math.floor((lo - 45) / 10) * 10));
	});

	const lobeMax = $derived.by(() => {
		const half = analysed.map((a) => a.metrics.mainLobeWidth / 2).filter(Number.isFinite);
		return Math.min(N / 2, Math.max(2, ...half) * 1.3);
	});
	const lobeSeries = $derived<Series[]>(
		analysed.map((a) => {
			const s = sliceDecimate(a.spec.bins, a.spec.db, 0, lobeMax, 600);
			return { x: s.x, y: s.y.map((d) => Math.pow(10, d / 20)), label: a.label, color: a.color, format: (v: number) => trimNumber(v, 4) };
		})
	);
	const lobeLines = [
		{ value: Math.SQRT1_2, label: '−3 dB' },
		{ value: 0.5, label: '−6 dB' }
	];

	// ---------------- leakage demo ----------------
	const f2 = $derived(f1 + sep);
	const setup = $derived<ToneSetup>({ N, f1, f2, weakDb, pad });
	const toneOk = $derived(f2 < N / 2 && f1 > 0);
	const xTones = $derived(twoTones(setup));
	const xStrong = $derived(twoTones(setup, false));
	const leak = $derived(
		toneOk
			? analysed.map((a) => {
					const spec = windowedSpectrum(xTones, a.w, pad);
					const strong = windowedSpectrum(xStrong, a.w, pad);
					return { ...a, lspec: spec, res: resolveWeak(spec, strong, setup, a.metrics.mainLobeWidth / 2) };
				})
			: []
	);
	const leakRange = $derived.by((): [number, number] => {
		if (leakView === 'full') return [0, N / 2];
		const lo = Math.max(0, Math.min(f1, f2) - Math.max(6, sep));
		const hi = Math.min(N / 2, Math.max(f1, f2) + Math.max(6, sep));
		return [lo, hi];
	});
	const leakSeries = $derived<Series[]>(
		leak.map((a) => ({
			...sliceDecimate(a.lspec.bins, a.lspec.db, leakRange[0], leakRange[1], 800),
			label: a.label,
			color: a.color,
			format: (v: number) => `${trimNumber(v, 4)} dB`
		}))
	);
	const leakFloor = $derived(Math.max(-200, Math.min(weakDb - 40, -80)));
	const leakVlines = $derived([
		{ value: f1, label: 'strong' },
		{ value: f2, label: 'weak' }
	]);
	const leakHlines = $derived([{ value: weakDb, label: `weak tone ${weakDb} dB` }]);

	// ---------------- stats ----------------
	const stats = $derived.by((): Stat[] => {
		const out: Stat[] = [
			{ label: 'Length N', value: `${N} (${periodic ? 'periodic' : 'symmetric'})` },
			{ label: 'Bin width', value: `1/N = ${trimNumber(1 / N, 3)} cycles/sample`, hint: 'One DFT bin: fs/N in Hz' }
		];
		if (analysed.length) {
			const best = [...analysed].sort((a, b) => a.metrics.peakSidelobeDb - b.metrics.peakSidelobeDb)[0];
			const narrow = [...analysed].sort((a, b) => a.metrics.width3dB - b.metrics.width3dB)[0];
			out.push({ label: 'Lowest sidelobes', value: `${best.label}: ${trimNumber(best.metrics.peakSidelobeDb, 3)} dB` });
			out.push({ label: 'Narrowest main lobe', value: `${narrow.label}: ${trimNumber(narrow.metrics.width3dB, 3)} bins (−3 dB)` });
		}
		if (leak.length) {
			const k = leak.filter((l) => l.res.resolved).length;
			out.push({
				label: 'Weak tone resolved by',
				value: `${k} of ${leak.length} window${leak.length > 1 ? 's' : ''}`,
				status: k === leak.length ? 'good' : k === 0 ? 'critical' : 'warning'
			});
		}
		return out;
	});

	// ---------------- reference table ----------------
	const REF_N = 64;
	let sortKey = $state<MetricKey | 'name'>('peakSidelobeDb');
	let sortDir = $state<1 | -1>(1);
	const refRows = $derived(sortRows(allWindowMetrics(REF_N, periodic), sortKey, sortDir));
	function sortBy(k: MetricKey | 'name') {
		if (sortKey === k) sortDir = sortDir === 1 ? -1 : 1;
		else {
			sortKey = k;
			sortDir = 1;
		}
	}
	const cols: { key: MetricKey; label: string; digits: number; hint: string }[] = [
		{ key: 'width3dB', label: '−3 dB width', digits: 3, hint: 'Full main-lobe width at −3 dB (bins)' },
		{ key: 'width6dB', label: '−6 dB width', digits: 3, hint: 'Full main-lobe width at −6 dB (bins)' },
		{ key: 'mainLobeWidth', label: 'Null–null', digits: 3, hint: 'Main-lobe width between the first nulls (bins)' },
		{ key: 'peakSidelobeDb', label: 'Peak sidelobe', digits: 3, hint: 'Highest sidelobe relative to the main lobe (dB)' },
		{ key: 'enbw', label: 'ENBW', digits: 3, hint: 'Equivalent noise bandwidth (bins)' },
		{ key: 'coherentGain', label: 'Coh. gain', digits: 3, hint: 'Coherent gain: mean of w[n], the factor a tone at a bin centre is scaled by' },
		{ key: 'scallopLossDb', label: 'Scalloping', digits: 3, hint: 'Scalloping loss: worst-case amplitude loss for a tone half-way between bins (dB)' }
	];
	const fmt = (v: number, d: number) => (Number.isFinite(v) ? trimNumber(v, d) : '—');
	const selectedTypes = $derived(new Set(active.map((a) => a.slot.type)));

	const reasonText = {
		resolved: 'Separate peak at the right level',
		mainlobe: 'Inside the strong tone’s main lobe',
		leakage: 'Buried under the strong tone’s sidelobe leakage',
		nopeak: 'No clean peak at the weak tone’s level'
	};
	const fmtDb = (v: number) => (v < -250 ? 'none (null)' : `${trimNumber(v, 3)} dB`);
</script>

<ToolLayout slug="windows" related={['fir-designer', 'aliasing', 'signal-lab', 'formulas']}>
	{#snippet controls()}
		<ControlGroup title="Windows (up to 4)">
			{#each slots as _s, i (i)}
				<WindowSlot bind:slot={slots[i]} index={i} color={colorOf(i)} />
			{/each}
		</ControlGroup>

		<ControlGroup title="Length & symmetry">
			<Slider label="Length N" bind:value={N} min={8} max={1024} log integer />
			<Segmented
				label="Form"
				bind:value={form}
				options={[
					{ value: 'symmetric', label: 'Symmetric' },
					{ value: 'periodic', label: 'Periodic' }
				]}
			/>
			<p class="small muted">Symmetric windows suit FIR design; periodic (DFT-even) windows suit spectral analysis.</p>
		</ControlGroup>

		<ControlGroup title="Spectrum view">
			<Segmented
				label="Frequency range"
				bind:value={range}
				options={[
					{ value: 'full', label: '0 – N/2' },
					{ value: 'zoom', label: '0 – 20 bins' }
				]}
			/>
			<Toggle label="Linear main-lobe zoom" bind:checked={showLobe} />
		</ControlGroup>

		<ControlGroup title="Leakage demo">
			<Slider label="Strong tone at" bind:value={f1} min={0.5} max={Math.max(1, N / 2 - 1)} step={0.05} unit="bins" />
			<Slider label="Separation" bind:value={sep} min={0.5} max={Math.max(1, N / 4)} step={0.05} unit="bins" />
			<Slider label="Weak tone level" bind:value={weakDb} min={-140} max={0} step={1} unit="dB" />
			<Segmented
				label="Zero padding"
				bind:value={pad}
				options={[
					{ value: 1, label: 'None (N-point DFT)' },
					{ value: 4, label: '4×' },
					{ value: 16, label: '16×' }
				]}
			/>
		</ControlGroup>
	{/snippet}

	<StatGrid {stats} />

	{#if analysed.length === 0}
		<Callout kind="note">Switch on at least one window on the left.</Callout>
	{:else}
		<Card title="Time domain" subtitle="The window values w[n] that multiply the signal (or the ideal impulse response).">
			<Plot series={timeSeries} xLabel="Sample n" yLabel="w[n]" height={230} exportName="windows-time" />
		</Card>

		<Card title="Spectrum" subtitle="|W(f)| normalised to 0 dB at DC, against frequency in DFT bins (1 bin = fs/N). The main lobe sets resolution; the sidelobes set leakage.">
			<Plot
				series={specSeries}
				xDomain={[0, xMax]}
				yDomain={[specFloor, 5]}
				xLabel="Frequency (bins)"
				yLabel="Magnitude (dB)"
				xTooltipFormat={(v) => `${trimNumber(v, 4)} bins`}
				height={320}
				exportName="windows-spectrum"
			/>
		</Card>

		{#if showLobe}
			<Card title="Main lobe (linear)" subtitle="Where each main lobe crosses −3 dB and −6 dB sets the half-power and half-amplitude bandwidths.">
				<Plot
					series={lobeSeries}
					xDomain={[0, lobeMax]}
					yDomain={[0, 1.05]}
					hlines={lobeLines}
					xLabel="Frequency (bins)"
					yLabel="|W| / W(0)"
					xTooltipFormat={(v) => `${trimNumber(v, 4)} bins`}
					height={230}
					exportName="windows-mainlobe"
				/>
			</Card>
		{/if}

		<Card title="Metrics" subtitle="For the windows above at N = {N}. Widths and ENBW in bins, sidelobe and scalloping in dB. Hover a heading for its definition.">
			<div class="table-wrap">
				<table class="metrics">
					<thead>
						<tr>
							<th>Window</th>
							{#each cols as c (c.key)}<th class="num" title={c.hint}>{c.label}</th>{/each}
						</tr>
					</thead>
					<tbody>
						{#each analysed as a (a.i)}
							<tr>
								<td><span class="swatch" style:background={a.color} aria-hidden="true"></span>{a.label}</td>
								{#each cols as c (c.key)}<td class="num">{fmt(a.metrics[c.key], c.digits)}</td>{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</Card>

		<Card
			title="Spectral leakage: can you see the weak tone?"
			subtitle="A unit-amplitude tone plus a weak tone {sep} bins away, windowed and FFT'd. The window decides whether the weak tone shows up as its own peak."
		>
			{#snippet actions()}
				<Segmented
					size="small"
					bind:value={leakView}
					options={[
						{ value: 'near', label: 'Around the tones' },
						{ value: 'full', label: '0 – N/2' }
					]}
				/>
			{/snippet}
			{#if !toneOk}
				<Callout kind="warning">Both tones must lie between 0 and N/2 = {N / 2} bins: lower the strong tone frequency or the separation.</Callout>
			{:else}
				<Plot
					series={leakSeries}
					xDomain={leakRange}
					yDomain={[leakFloor, 5]}
					vlines={leakVlines}
					hlines={leakHlines}
					xLabel="Frequency (bins)"
					yLabel="Level (dB re strong tone)"
					xTooltipFormat={(v) => `${trimNumber(v, 4)} bins`}
					height={320}
					exportName="leakage"
				/>
				<div class="table-wrap">
					<table class="verdict">
						<thead><tr><th>Window</th><th>Weak tone</th><th class="num">Leakage at weak tone</th><th class="num">Peak found</th><th>Why</th></tr></thead>
						<tbody>
							{#each leak as l (l.i)}
								<tr>
									<td><span class="swatch" style:background={l.color} aria-hidden="true"></span>{l.label}</td>
									<td class="st" class:good={l.res.resolved} class:bad={!l.res.resolved}>
										<span aria-hidden="true">{l.res.resolved ? '✓' : '✕'}</span>
										{l.res.resolved ? 'Resolved' : 'Hidden'}
									</td>
									<td class="num">{fmtDb(l.res.leakageDb)}</td>
									<td class="num">{l.res.peakDb === null ? '—' : `${trimNumber(l.res.peakDb, 3)} dB`}</td>
									<td class="small">{reasonText[l.res.reason]}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<p class="small muted note">
					Resolved means: the strong tone's leakage near the weak tone is at least 3 dB below it, and the spectrum has a local peak there at the weak tone's level.
					Levels are scaled by the coherent gain, so a tone at a bin centre reads its true amplitude.
				</p>
			{/if}
		</Card>
	{/if}

	<Card title="Reference: every window at N = {REF_N}" subtitle="Default parameters, {periodic ? 'periodic' : 'symmetric'} form; same units as above. Click a column to sort; the windows you selected are highlighted.">
		<div class="table-wrap">
			<table class="ref">
				<thead>
					<tr>
						<th aria-sort={sortKey === 'name' ? (sortDir === 1 ? 'ascending' : 'descending') : 'none'}>
							<button type="button" onclick={() => sortBy('name')}>Window {sortKey === 'name' ? (sortDir === 1 ? '▲' : '▼') : ''}</button>
						</th>
						{#each cols as c (c.key)}
							<th class="num" title={c.hint} aria-sort={sortKey === c.key ? (sortDir === 1 ? 'ascending' : 'descending') : 'none'}>
								<button type="button" onclick={() => sortBy(c.key)}>{c.label} {sortKey === c.key ? (sortDir === 1 ? '▲' : '▼') : ''}</button>
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each refRows as r (r.type)}
						<tr class:sel={selectedTypes.has(r.type)}>
							<td>{r.name}{r.param !== undefined ? ` (${windowInfo(r.type).param?.label} = ${r.param})` : ''}</td>
							{#each cols as c (c.key)}<td class="num">{fmt(r[c.key], c.digits)}</td>{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</Card>

	{#snippet theory()}
		<h2>Why windows matter</h2>
		<p>
			Any finite record is an infinitely long signal multiplied by a window — even “no window” is a rectangle. Multiplication
			in time is convolution in frequency, so every spectral line you analyse (or every ideal filter response you truncate)
			is smeared by the window's transform <Tex math={'W(e^{j\\omega})'} />:
		</p>
		<Tex display math={'x_w[n]=x[n]\\,w[n]\\quad\\Longleftrightarrow\\quad X_w(e^{j\\omega})=\\frac{1}{2\\pi}\\int_{-\\pi}^{\\pi}X(e^{j\\theta})\\,W(e^{j(\\omega-\\theta)})\\,d\\theta'} />
		<p>
			A single sinusoid therefore appears as a copy of W centred on its frequency. The <strong>main lobe</strong> limits how
			close two tones can be and still be told apart; the <strong>sidelobes</strong> leak energy from strong components
			into distant bins, where they can hide weak ones. No window can make both small: tapering the ends lowers the
			sidelobes but widens the main lobe. Choosing a window means choosing a point on that trade-off.
		</p>

		<h3>The metrics</h3>
		<p>With the window normalised to N samples and frequencies measured in bins (1 bin = f<sub>s</sub>/N):</p>
		<ul>
			<li><strong>Coherent gain</strong> <Tex math={'\\mathrm{CG}=\\frac{1}{N}\\sum_n w[n]'} /> — the factor by which a windowed tone's peak shrinks; divide by it to read amplitudes.</li>
			<li><strong>Equivalent noise bandwidth</strong> <Tex math={'\\mathrm{ENBW}=N\\,\\dfrac{\\sum_n w[n]^2}{\\left(\\sum_n w[n]\\right)^2}\\ \\text{bins}'} /> — the width of the rectangular filter that passes the same white-noise power. It is 1 for the rectangle, 1.5 for Hann.</li>
			<li><strong>Scalloping loss</strong> <Tex math={'\\mathrm{SL}=-20\\log_{10}\\dfrac{|W(\\tfrac12\\ \\mathrm{bin})|}{W(0)}'} /> — the worst-case drop for a tone half-way between two DFT bins (3.92 dB rectangular, 1.42 dB Hann, ≈ 0 for flat top).</li>
			<li><strong>−3 dB / −6 dB width</strong> — main-lobe widths at half power and half amplitude. Two equal tones are resolvable when they are roughly a −6 dB width apart.</li>
			<li><strong>Peak sidelobe level</strong> — the highest sidelobe relative to the main lobe; together with the sidelobe <em>decay rate</em> (6 dB/octave for a rectangle, 18 dB/octave for Hann) it sets how far leakage reaches.</li>
		</ul>

		<h3>Families</h3>
		<p>
			Cosine-sum windows <Tex math={'w[n]=\\sum_k (-1)^k a_k\\cos\\!\\big(\\tfrac{2\\pi k n}{N-1}\\big)'} /> (Hann, Hamming, Blackman,
			Blackman–Harris, Nuttall, flat top) place their coefficients either to cancel the nearest sidelobes (low peak level) or
			to make the window smooth at its ends (fast decay). Hamming is the classic example of the first kind: −43 dB, but the
			sidelobes barely decay, so far from the main lobe it leaks more than Hann.
		</p>
		<p>
			The <strong>Kaiser</strong> window <Tex math={'w[n]=I_0\\!\\left(\\beta\\sqrt{1-\\big(\\tfrac{2n}{N-1}-1\\big)^2}\\right)\\big/ I_0(\\beta)'} /> is a
			near-optimal approximation to the <strong>DPSS</strong> (Slepian) window, which maximises the fraction of energy inside a
			band |f| ≤ NW/N bins — the formal answer to “most concentrated main lobe”. The <strong>Dolph–Chebyshev</strong> window
			solves a different optimum: for a given sidelobe level it has the narrowest main lobe, and all its sidelobes sit
			exactly at that level (equiripple), because its transform is a Chebyshev polynomial
			<Tex math={'W(\\omega)\\propto T_{N-1}\\big(x_0\\cos(\\omega/2)\\big)'} />.
		</p>

		<h3>Symmetric or periodic?</h3>
		<p>
			A <em>symmetric</em> window has w[n] = w[N−1−n] and both ends equal — what FIR design needs, since it keeps the filter's
			linear phase. A <em>periodic</em> (DFT-even) window is the first N points of a symmetric window of length N + 1: it
			tiles seamlessly when repeated, and its DFT samples land exactly on the window's nulls, which gives the textbook
			values for ENBW and scalloping. Use periodic windows for FFT analysis and overlap-add (a periodic Hann at 50 % overlap
			sums to a constant).
		</p>

		<Callout kind="try">
			<ul>
				<li>In the leakage demo, the rectangle and Hamming hide the −55 dB tone while Hann shows it: far from the main lobe, sidelobe <em>decay</em> matters more than the first sidelobe.</li>
				<li>Reduce the separation to about 2.6 bins and raise the weak tone to −30 dB: now the wide Blackman–Harris main lobe swallows it and Hamming wins.</li>
				<li>Set the strong tone to exactly 10 bins and the separation to 6, with zero padding off and periodic windows: every window resolves the tone — the DFT samples land on the leakage nulls (coherent sampling).</li>
				<li>Put a Kaiser window in slot D and sweep β from 0 to 15: watch the sidelobes drop and the main lobe widen continuously.</li>
				<li>Switch to Dolph–Chebyshev and lower its sidelobe setting: all sidelobes stay exactly at that level.</li>
			</ul>
		</Callout>
	{/snippet}
</ToolLayout>

<style>
	.table-wrap {
		overflow-x: auto;
	}
	.swatch {
		display: inline-block;
		width: 14px;
		height: 4px;
		border-radius: 2px;
		margin-right: 0.45rem;
		vertical-align: middle;
	}
	td.num {
		white-space: nowrap;
	}
	td:first-child {
		min-width: 9rem;
	}
	.metrics th,
	.ref th {
		font-size: 0.8rem;
		white-space: nowrap;
	}
	.metrics td,
	.ref td {
		padding: 0.35em 0.5em;
	}
	.verdict {
		margin-top: 0.6rem;
	}
	.verdict td.small {
		white-space: normal;
		min-width: 12rem;
	}
	.st {
		font-weight: 600;
	}
	.st.good {
		color: var(--good-ink);
	}
	.st.bad {
		color: var(--critical-ink);
	}
	.note {
		margin: 0.5rem 0 0;
	}
	.ref th button {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		font-weight: 600;
		color: inherit;
		cursor: pointer;
		text-align: inherit;
		white-space: nowrap;
	}
	.ref th button:hover {
		color: var(--text);
	}
	.ref tr.sel td {
		background: var(--accent-wash);
	}
</style>
