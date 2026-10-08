<script lang="ts">
	import ToolLayout from '$lib/components/layout/ToolLayout.svelte';
	import ControlGroup from '$lib/components/layout/ControlGroup.svelte';
	import Card from '$lib/components/layout/Card.svelte';
	import Select from '$lib/components/controls/Select.svelte';
	import Segmented from '$lib/components/controls/Segmented.svelte';
	import Slider from '$lib/components/controls/Slider.svelte';
	import Plot, { type Marker, type Region, type Series } from '$lib/components/plot/Plot.svelte';
	import StatGrid, { type Stat } from '$lib/components/content/StatGrid.svelte';
	import Callout from '$lib/components/content/Callout.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import { trimNumber } from '$lib/dsp/units';
	import { linspace } from '$lib/dsp/response';
	import {
		H_KINDS,
		X_KINDS,
		type HKind,
		type HParams,
		type XKind,
		type XParams,
		convolve,
		dtftMag,
		makeH,
		makeX,
		overlapTerms,
		sumTex
	} from '$lib/features/convolution/signals';

	// ---------------- state ----------------
	let mode = $state<'slide' | 'super'>('slide');
	let xKind = $state<XKind>('rect');
	let xLen = $state(20);
	let xp = $state<XParams>({ width: 8, period: 6, noise: 0.25, seed: 7 });
	let hKind = $state<HKind>('expDecay');
	let hp = $state<HParams>({ taps: 5, a: 0.7, delay: 6, gain: 0.6 });
	let custom = $state<number[]>([1, 0.6, 0.3, 0.1, -0.2]);
	let nState = $state(6);
	let kState = $state(3);
	let playing = $state(false);
	let speed = $state(4);

	// ---------------- signals ----------------
	const x = $derived(makeX(xKind, xLen, xp));
	const h = $derived(hKind === 'custom' ? custom : makeH(hKind, hp));
	const N = $derived(x.length);
	const M = $derived(h.length);
	const y = $derived(convolve(x, h));
	const L = $derived(N + M - 1);

	const nMin = -1;
	const nMax = $derived(L);
	const n = $derived(Math.min(nMax, Math.max(nMin, Math.round(nState))));
	const K = $derived(Math.min(N - 1, Math.max(0, Math.round(kState))));

	const slideDomain = $derived<[number, number]>([-M - 0.5, L + 0.5]);
	const superDomain = $derived<[number, number]>([-1.5, L + 0.5]);
	const idx = (len: number, from = 0) => Array.from({ length: len }, (_, i) => i + from);
	const pad = (lo: number, hi: number): [number, number] => {
		const a = Math.min(lo, 0);
		const b = Math.max(hi, 0);
		const span = b - a || 1;
		return [a - 0.12 * span, b + 0.12 * span];
	};

	const xDom = $derived(pad(Math.min(...x), Math.max(...x)));
	const hDom = $derived(pad(Math.min(...h), Math.max(...h)));
	// every possible product, so the product axis does not jump while sliding
	const prodDom = $derived.by(() => {
		let lo = 0;
		let hi = 0;
		const hmin = Math.min(...h);
		const hmax = Math.max(...h);
		for (const v of x) {
			lo = Math.min(lo, v * hmin, v * hmax);
			hi = Math.max(hi, v * hmin, v * hmax);
		}
		return pad(lo, hi);
	});
	const yDom = $derived(pad(Math.min(...y), Math.max(...y)));

	const fmt = (v: number) => trimNumber(v, 4);
	const terms = $derived(overlapTerms(x, h, n));
	const yn = $derived(n >= 0 && n < L ? y[n] : 0);

	// ---------------- flip & slide view ----------------
	const overlapRegion = $derived<Region[]>(
		terms.length
			? [
					{
						x0: terms[0].k - 0.5,
						x1: terms[terms.length - 1].k + 0.5,
						y0: -1e9,
						y1: 1e9,
						kind: 'neutral',
						label: 'overlap'
					}
				]
			: []
	);
	const nLine = $derived([{ value: n, label: `k = n = ${n}`, color: 'var(--text-2)' }]);

	const xSeries = $derived<Series[]>([
		{ x: idx(N), y: x, kind: 'stem', color: 'var(--s1)', label: 'x[k]', format: fmt }
	]);
	const hFlipSeries = $derived<Series[]>([
		{
			x: idx(M, n - M + 1),
			y: [...h].reverse(),
			kind: 'stem',
			color: 'var(--s2)',
			label: `h[${n}−k]`,
			format: fmt
		}
	]);
	const prodSeries = $derived<Series[]>([
		{
			x: terms.map((t) => t.k),
			y: terms.map((t) => t.product),
			kind: 'stem',
			color: 'var(--s3)',
			label: 'x[k]·h[n−k]',
			format: fmt
		}
	]);
	const doneCount = $derived(Math.max(0, Math.min(L, n + 1)));
	const ySlideSeries = $derived<Series[]>([
		{
			x: idx(L - doneCount, doneCount),
			y: y.slice(doneCount),
			kind: 'stem',
			color: 'var(--muted)',
			opacity: 0.5,
			label: 'still to come',
			format: fmt
		},
		{
			x: idx(doneCount),
			y: y.slice(0, doneCount),
			kind: 'stem',
			color: 'var(--s4)',
			label: 'y[m], m ≤ n',
			format: fmt
		}
	]);
	const yMarker = $derived<Marker[]>([
		{ id: 'n', x: n, y: yn, draggable: true, axis: 'x', color: 'var(--s4)', selected: true }
	]);

	// ---------------- superposition view ----------------
	const xSuperSeries = $derived<Series[]>([
		{
			x: idx(N - K - 1, K + 1),
			y: x.slice(K + 1),
			kind: 'stem',
			color: 'var(--muted)',
			opacity: 0.5,
			label: 'not yet added',
			format: fmt
		},
		{
			x: idx(K + 1),
			y: x.slice(0, K + 1),
			kind: 'stem',
			color: 'var(--s1)',
			label: 'x[k], k ≤ K',
			format: fmt
		}
	]);
	const xMarker = $derived<Marker[]>([
		{ id: 'K', x: K, y: x[K] ?? 0, draggable: true, axis: 'x', color: 'var(--s1)', selected: true }
	]);
	// the three most recent input samples that actually contribute (x[k] ≠ 0)
	const recentK = $derived.by(() => {
		const out: number[] = [];
		for (let k = K; k >= 0 && out.length < 3; k--) if (x[k] !== 0) out.push(k);
		return out;
	});
	const contributions = $derived(
		recentK.map((k) => ({
			k,
			xk: x[k],
			series: [
				{
					x: idx(M, k),
					y: h.map((v) => x[k] * v),
					kind: 'stem' as const,
					color: 'var(--s2)',
					label: `x[${k}]·h[m−${k}]`,
					format: fmt
				}
			]
		}))
	);
	const partial = $derived(convolve(x.slice(0, K + 1), h));
	const partialSeries = $derived<Series[]>([
		{
			x: idx(L),
			y,
			kind: 'stem',
			color: 'var(--muted)',
			opacity: 0.5,
			label: 'final y[m]',
			format: fmt
		},
		{
			x: idx(partial.length),
			y: partial,
			kind: 'stem',
			color: 'var(--s4)',
			label: `sum over k ≤ ${K}`,
			format: fmt
		}
	]);

	// ---------------- custom h editor ----------------
	const customMarkers = $derived<Marker[]>(
		custom.map((v, i) => ({ id: i, x: i, y: v, draggable: true, axis: 'y', color: 'var(--s2)' }))
	);
	function onCustomDrag(id: string | number, _x: number, v: number) {
		const i = Number(id);
		custom[i] = Math.max(-1.5, Math.min(1.5, Math.round(v * 20) / 20)) + 0;
	}
	function setCustomLength(len: number) {
		const next = custom.slice(0, len);
		while (next.length < len) next.push(0);
		custom = next;
	}
	function setHKind(v: HKind) {
		if (v === 'custom' && hKind !== 'custom')
			custom = h.slice(0, 24).map((t) => Math.round(t * 100) / 100);
		hKind = v;
	}

	// ---------------- playback ----------------
	const atEnd = $derived(mode === 'slide' ? n >= nMax : K >= N - 1);
	function stepBy(d: number) {
		if (mode === 'slide') nState = Math.min(nMax, Math.max(nMin, n + d));
		else kState = Math.min(N - 1, Math.max(0, K + d));
	}
	function toStart() {
		playing = false;
		if (mode === 'slide') nState = nMin;
		else kState = 0;
	}
	function toEnd() {
		playing = false;
		if (mode === 'slide') nState = nMax;
		else kState = N - 1;
	}
	function togglePlay() {
		if (playing) {
			playing = false;
			return;
		}
		if (atEnd) {
			if (mode === 'slide') nState = nMin;
			else kState = 0;
		}
		playing = true;
	}
	$effect(() => {
		if (!playing) return;
		const id = setInterval(() => {
			if (atEnd) playing = false;
			else stepBy(1);
		}, 1000 / speed);
		return () => clearInterval(id);
	});

	// ---------------- spectra ----------------
	const freqs = linspace(0, 0.5, 257);
	const dB = (v: number) => 20 * Math.log10(Math.max(v, 1e-6));
	const spectra = $derived.by((): Series[] => {
		const X = dtftMag(x, freqs).map(dB);
		const H = dtftMag(h, freqs).map(dB);
		const Y = dtftMag(y, freqs).map(dB);
		const f = (v: number) => `${trimNumber(v, 4)} dB`;
		return [
			{ x: freqs, y: X, label: '|X|', color: 'var(--s1)', format: f },
			{ x: freqs, y: H, label: '|H|', color: 'var(--s2)', format: f },
			{ x: freqs, y: Y, label: '|Y| = |X|·|H|', color: 'var(--s4)', format: f }
		];
	});

	// ---------------- stats ----------------
	const sum = (a: readonly number[]) => a.reduce((s, v) => s + v, 0);
	const stats = $derived<Stat[]>([
		{ label: 'Input length N', value: String(N) },
		{ label: 'Kernel length M', value: String(M) },
		{ label: 'Output length', value: `N + M − 1 = ${L}` },
		mode === 'slide'
			? { label: `y[${n}]`, value: trimNumber(yn, 4), hint: 'Current output sample' }
			: { label: `Inputs added`, value: `${K + 1} of ${N}` },
		mode === 'slide'
			? {
					label: 'Non-zero terms',
					value: String(terms.filter((t) => t.product !== 0).length),
					hint: `Products x[k]·h[n−k] contributing to y[${n}]`
				}
			: {
					label: 'Copies of h so far',
					value: String(x.slice(0, K + 1).filter((v) => v !== 0).length),
					hint: 'One scaled copy per non-zero input sample'
				},
		{
			label: 'Σy = Σx · Σh',
			value: `${trimNumber(sum(y), 4)} = ${trimNumber(sum(x), 4)} × ${trimNumber(sum(h), 4)}`,
			hint: 'Sums multiply: the DC gain of h scales the area of x'
		}
	]);

	const xParamControls = $derived(
		xKind === 'rect' ||
			xKind === 'train' ||
			xKind === 'sine' ||
			xKind === 'noisyStep' ||
			xKind === 'random'
	);
	const xOptions = X_KINDS.map((k) => ({ value: k.id, label: k.name }));
	const hOptions = H_KINDS.map((k) => ({ value: k.id, label: k.name }));
	const tex = $derived(sumTex(x, h, n));
</script>

<ToolLayout
	slug="convolution"
	related={['fir-designer', 'signal-lab', 'pole-zero', 'special-fir', 'structures']}
>
	{#snippet controls()}
		<ControlGroup title="View">
			<Segmented
				bind:value={mode}
				options={[
					{ value: 'slide', label: 'Flip & slide' },
					{ value: 'super', label: 'Superposition' }
				]}
			/>
			<p class="small muted tight">
				{mode === 'slide'
					? 'One output sample at a time: flip h, slide it to n, multiply, add.'
					: 'One input sample at a time: each x[k] launches a scaled copy of h starting at k.'}
			</p>
		</ControlGroup>

		<ControlGroup title="Input x[n]">
			<Select label="Signal" bind:value={xKind} options={xOptions} />
			<Slider label="Length N" bind:value={xLen} min={8} max={40} integer />
			{#if xParamControls}
				{#if xKind === 'rect'}
					<Slider
						label="Pulse width"
						bind:value={xp.width}
						min={1}
						max={xLen}
						integer
						unit="samples"
					/>
				{:else if xKind === 'train' || xKind === 'sine'}
					<Slider label="Period" bind:value={xp.period} min={2} max={20} integer unit="samples" />
				{:else}
					{#if xKind === 'noisyStep'}
						<Slider label="Noise σ" bind:value={xp.noise} min={0} max={1} step={0.01} />
					{/if}
					<div class="seed">
						<span class="small muted">Seed {xp.seed}</span>
						<button
							class="btn small"
							type="button"
							onclick={() => (xp.seed = (xp.seed * 7919 + 13) % 100000)}>New random draw</button
						>
					</div>
				{/if}
			{/if}
		</ControlGroup>

		<ControlGroup title="Impulse response h[n]">
			<Select label="Kernel" value={hKind} options={hOptions} onchange={(v) => setHKind(v)} />
			{#if hKind === 'movingAverage' || hKind === 'hann'}
				<Slider label="Taps" bind:value={hp.taps} min={2} max={16} integer />
			{:else if hKind === 'expDecay'}
				<Slider
					label="Decay a"
					bind:value={hp.a}
					min={0.1}
					max={0.85}
					step={0.01}
					help="h[n] = (1 − a)·aⁿ, truncated at 1 %"
				/>
			{:else if hKind === 'echo'}
				<Slider label="Delay D" bind:value={hp.delay} min={1} max={16} integer unit="samples" />
				<Slider
					label="Echo gain g"
					bind:value={hp.gain}
					min={-1}
					max={1}
					step={0.05}
					help="h[n] = δ[n] + g·δ[n − D]"
				/>
			{:else if hKind === 'custom'}
				<Slider
					label="Taps"
					value={custom.length}
					min={1}
					max={24}
					integer
					onchange={(v) => setCustomLength(v)}
				/>
				<p class="small muted tight">Drag the stems in the “Custom h[n]” plot up and down.</p>
			{:else if hKind === 'lowpass7'}
				<p class="small muted tight">
					firwin(7, 0.15·fs), Hamming window — the same windowed-sinc design as the FIR designer.
				</p>
			{:else if hKind === 'difference'}
				<p class="small muted tight">h = [1, −1]: y[n] = x[n] − x[n−1], a crude differentiator.</p>
			{/if}
		</ControlGroup>
	{/snippet}

	<StatGrid {stats} />

	<Card>
		<div class="playbar">
			<div class="buttons" role="group" aria-label="Playback">
				<button
					class="btn small icon"
					type="button"
					onclick={toStart}
					aria-label="Go to start"
					title="Start"
				>
					<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"
						><path
							d="M2 2v10M12 2 5 7l7 5z"
							fill="currentColor"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linejoin="round"
						/></svg
					>
				</button>
				<button
					class="btn small icon"
					type="button"
					onclick={() => stepBy(-1)}
					aria-label="Step back"
					title="Step back"
				>
					<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"
						><path d="M10 2 3 7l7 5z" fill="currentColor" /></svg
					>
				</button>
				<button
					class="btn small icon primary"
					type="button"
					onclick={togglePlay}
					aria-label={playing ? 'Pause' : 'Play'}
					title={playing ? 'Pause' : 'Play'}
				>
					{#if playing}
						<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"
							><path d="M3 2h3v10H3zM8 2h3v10H8z" fill="currentColor" /></svg
						>
					{:else}
						<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"
							><path d="M3 2l9 5-9 5z" fill="currentColor" /></svg
						>
					{/if}
				</button>
				<button
					class="btn small icon"
					type="button"
					onclick={() => stepBy(1)}
					aria-label="Step forward"
					title="Step forward"
				>
					<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"
						><path d="M4 2l7 5-7 5z" fill="currentColor" /></svg
					>
				</button>
				<button
					class="btn small icon"
					type="button"
					onclick={toEnd}
					aria-label="Go to end"
					title="End"
				>
					<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"
						><path
							d="M12 2v10M2 2l7 5-7 5z"
							fill="currentColor"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linejoin="round"
						/></svg
					>
				</button>
			</div>
			<div class="pos">
				{#if mode === 'slide'}
					<Slider
						label="Output index n"
						value={n}
						min={nMin}
						max={nMax}
						integer
						onchange={(v) => (nState = v)}
					/>
				{:else}
					<Slider
						label="Inputs added: k ≤ K"
						value={K}
						min={0}
						max={N - 1}
						integer
						onchange={(v) => (kState = v)}
					/>
				{/if}
			</div>
			<div class="speed">
				<Slider label="Speed" bind:value={speed} min={1} max={12} integer unit="steps/s" />
			</div>
		</div>
		{#if mode === 'slide'}
			<div class="sum" aria-live="polite"><Tex display math={tex} /></div>
		{:else}
			<p class="small super-note">
				{#if (x[K] ?? 0) !== 0}
					Adding the contribution of x[{K}] = {trimNumber(x[K], 4)}: a copy of h scaled by {trimNumber(
						x[K],
						4
					)} and shifted to start at m = {K}.
				{:else}
					x[{K}] = 0, so this input sample adds nothing.
				{/if}
				The output is the running sum of all such copies.
			</p>
		{/if}
	</Card>

	{#if hKind === 'custom'}
		<Card title="Custom h[n]" subtitle="Drag each stem up or down (steps of 0.05).">
			<Plot
				series={[
					{ x: idx(M), y: custom, kind: 'stem', color: 'var(--s2)', label: 'h[n]', format: fmt }
				]}
				xDomain={[-0.5, Math.max(M, 8) - 0.5]}
				yDomain={[-1.6, 1.6]}
				markers={customMarkers}
				onmarkerdrag={onCustomDrag}
				xLabel="n"
				height={220}
				crosshair={false}
			/>
		</Card>
	{/if}

	<div class="card stack">
		{#if mode === 'slide'}
			<Plot
				series={xSeries}
				xDomain={slideDomain}
				yDomain={xDom}
				regions={overlapRegion}
				vlines={nLine}
				height={140}
				title="x[k] — input"
			/>
			<Plot
				series={hFlipSeries}
				xDomain={slideDomain}
				yDomain={hDom}
				regions={overlapRegion}
				vlines={nLine}
				height={140}
				title="h[n − k] — kernel flipped and shifted to n = {n}"
			/>
			<Plot
				series={prodSeries}
				xDomain={slideDomain}
				yDomain={prodDom}
				regions={overlapRegion}
				vlines={nLine}
				height={140}
				title="x[k]·h[n − k] — products (overlap shaded)"
			/>
			<Plot
				series={ySlideSeries}
				xDomain={slideDomain}
				yDomain={yDom}
				vlines={nLine}
				markers={yMarker}
				onmarkerdrag={(_id, xv) => (nState = Math.round(xv))}
				height={170}
				xLabel="k (and output index n)"
				title="y[n] — output; drag the highlighted sample to scrub"
			/>
		{:else}
			<Plot
				series={xSuperSeries}
				xDomain={superDomain}
				yDomain={xDom}
				markers={xMarker}
				onmarkerdrag={(_id, xv) => (kState = Math.round(xv))}
				height={140}
				title="x[k] — input; drag the highlighted sample"
			/>
			{#each contributions as c (c.k)}
				<Plot
					series={c.series}
					xDomain={superDomain}
					yDomain={prodDom}
					vlines={[{ value: c.k, label: `k = ${c.k}`, color: 'var(--text-2)' }]}
					height={115}
					title={`${c.k === recentK[0] ? 'Latest copy' : 'Earlier copy'}: x[${c.k}]·h[m − ${c.k}], with x[${c.k}] = ${trimNumber(c.xk, 3)}`}
				/>
			{:else}
				<p class="small muted empty">
					All of x[0] … x[{K}] are zero — no copies of h have been added yet.
				</p>
			{/each}
			<Plot
				series={partialSeries}
				xDomain={superDomain}
				yDomain={yDom}
				height={170}
				xLabel="Output index m"
				title="Σ over k ≤ {K} of x[k]·h[m − k] — the output builds up"
			/>
		{/if}
	</div>

	<div class="card">
		<Plot
			series={spectra}
			xDomain={[0, 0.5]}
			yLimits={[-80, 80]}
			minYSpan={20}
			xLabel="Normalised frequency f / fs"
			yLabel="Magnitude (dB)"
			height={260}
			title="Spectra: convolution in time is multiplication in frequency"
			exportName="convolution-spectra"
		/>
		<p class="small muted note">
			In dB the products become sums: the |Y| curve is exactly |X| + |H| at every frequency.
		</p>
	</div>

	{#snippet theory()}
		<h2>Discrete convolution</h2>
		<p>
			The output of a linear time-invariant (LTI) system with impulse response h[n] to any input
			x[n] is the convolution sum
		</p>
		<Tex display math={'y[n] = (x * h)[n] = \\sum_{k=-\\infty}^{\\infty} x[k]\\,h[n-k]'} />
		<p>
			Read it the way the <em>Flip & slide</em> view animates it: to get one output sample, flip h around
			k = 0, slide it so its origin sits at k = n, multiply it sample by sample with x, and add up the
			products. Only the overlap of the two supports contributes.
		</p>

		<h3>Why: linearity and time invariance</h3>
		<p>
			Any signal is a sum of scaled, shifted impulses, and an LTI system maps each impulse to a
			scaled, shifted copy of h:
		</p>
		<Tex
			display
			math={'x[n] = \\sum_k x[k]\\,\\delta[n-k] \\quad\\xrightarrow{\\;\\text{LTI}\\;}\\quad y[n] = \\sum_k x[k]\\,h[n-k]'}
		/>
		<p>
			That is the <em>Superposition</em> view: each input sample launches its own copy of h, and the output
			is their sum. Both views compute the same numbers — they just organise the double sum by output
			sample or by input sample.
		</p>

		<h3>FIR filtering is convolution with the taps</h3>
		<p>An FIR filter with coefficients b₀ … b<sub>M−1</sub> computes</p>
		<Tex display math={'y[n] = \\sum_{m=0}^{M-1} b_m\\,x[n-m]'} />
		<p>
			which is the convolution sum with <Tex math={'h[m] = b_m'} />: the taps <em>are</em> the
			impulse response. Substituting
			<Tex math="m = n - k" /> shows that convolution is commutative, <Tex math={'x*h = h*x'} /> — you
			may flip either sequence. It is also associative, so cascading two filters is the same as one filter
			with impulse response <Tex math={'h_1 * h_2'} />.
		</p>

		<h3>Output length</h3>
		<p>
			If x has N samples (n = 0 … N−1) and h has M samples, the products are non-zero only for <Tex
				math={'0 \\le n \\le N+M-2'}
			/>, so
			<Tex math={'y'} /> has <strong>N + M − 1</strong> samples. The first and last M − 1 outputs
			are “ramp-up” and “ramp-down” transients where h only partially overlaps x. Summing the
			convolution over n gives <Tex math={'\\sum y = \\sum x \\cdot \\sum h'} />.
		</p>

		<h3>Convolution ↔ multiplication</h3>
		<p>
			Taking the discrete-time Fourier transform of the convolution sum turns it into a product of
			spectra:
		</p>
		<Tex
			display
			math={'Y(e^{j\\omega}) = X(e^{j\\omega})\\,H(e^{j\\omega}),\\qquad H(e^{j\\omega}) = \\sum_n h[n]\\,e^{-j\\omega n}'}
		/>
		<p>
			This is why a filter can be described by its frequency response: each frequency in the input
			is simply scaled by |H| and shifted in phase by ∠H. It is also why long convolutions are
			computed with FFTs — after zero-padding both sequences to at least N + M − 1 samples, since
			the DFT implements <em>circular</em> convolution.
		</p>

		<Callout kind="try">
			<ul>
				<li>
					Set x to <em>Unit impulse</em>: the output is exactly h — the reason it is called the
					impulse response.
				</li>
				<li>
					Use <em>Unit step</em> with a <em>Moving average</em>: y ramps up over M samples and
					settles at Σh, the DC gain.
				</li>
				<li>
					Pick an <em>Impulse train</em> and the <em>Echo</em> kernel, then switch to
					<em>Superposition</em>: copies of h land on every impulse and overlap when the echo delay
					exceeds the period.
				</li>
				<li>
					Feed a <em>Noisy step</em> through the <em>First difference</em> and then through the
					<em>Hann smoother</em>: one amplifies the noise, the other averages it away — compare
					their spectra below.
				</li>
				<li>
					Choose <em>Custom</em> and make h = [0, 0, 1]: convolution with a shifted impulse just delays
					the signal.
				</li>
			</ul>
		</Callout>
	{/snippet}
</ToolLayout>

<style>
	.tight {
		margin: 0;
	}
	.seed {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.playbar {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) minmax(0, 200px);
		gap: 0.6rem 1.2rem;
		align-items: end;
	}
	@media (max-width: 700px) {
		.playbar {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	.buttons {
		display: flex;
		gap: 0.3rem;
	}
	.icon {
		padding: 0.35rem 0.55rem;
	}
	.sum {
		margin-top: 0.6rem;
		min-height: 7.6rem;
		overflow-x: auto;
		overflow-y: hidden;
	}
	.sum :global(.tex-display) {
		margin: 0;
	}
	.super-note {
		margin: 0.6rem 0 0;
		color: var(--text-2);
	}
	.card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		padding: 0.75rem 0.9rem 0.6rem;
		min-width: 0;
	}
	.stack {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.note {
		margin: 0.4rem 0 0;
	}
	.empty {
		margin: 0.3rem 0;
	}
</style>
