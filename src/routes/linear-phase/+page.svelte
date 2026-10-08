<script lang="ts">
	import ToolLayout from '$lib/components/layout/ToolLayout.svelte';
	import ControlGroup from '$lib/components/layout/ControlGroup.svelte';
	import Card from '$lib/components/layout/Card.svelte';
	import Select from '$lib/components/controls/Select.svelte';
	import Segmented from '$lib/components/controls/Segmented.svelte';
	import Slider from '$lib/components/controls/Slider.svelte';
	import NumberInput from '$lib/components/controls/NumberInput.svelte';
	import Plot, { type Series } from '$lib/components/plot/Plot.svelte';
	import PoleZeroPlot from '$lib/components/plot/PoleZeroPlot.svelte';
	import ResponseView from '$lib/components/plot/ResponseView.svelte';
	import { freqFormat } from '$lib/components/plot/scales';
	import StatGrid, { type Stat } from '$lib/components/content/StatGrid.svelte';
	import Callout from '$lib/components/content/Callout.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import WindowPicker from '$lib/features/special-fir/WindowPicker.svelte';
	import type { WindowSpec } from '$lib/dsp/fir';
	import { firwin } from '$lib/dsp/fir';
	import { evaluate, linspace } from '$lib/dsp/response';
	import { formatSI, trimNumber } from '$lib/dsp/units';
	import {
		TYPE_ROMAN,
		amplitude,
		capabilities,
		demoTaps,
		energyCentroid,
		energyIndex,
		firZeros,
		forcedZeros,
		groupZeros,
		isAnti,
		isOddLength,
		magnitude,
		partialEnergy,
		phaseVersions,
		preRinging,
		randomTaps,
		type AntiShape,
		type LpType,
		type SymShape,
		type ZeroGroupKind
	} from '$lib/features/linear-phase/lp';

	// ---------------- state ----------------
	let fs = $state(48000);
	let lpType = $state<LpType>(1);
	let N = $state(21);
	let source = $state<'design' | 'random'>('design');
	let symShape = $state<SymShape>('lowpass');
	let antiShape = $state<AntiShape>('hilbert');
	let seed = $state(7);
	let win = $state<WindowSpec>({ type: 'hamming' });
	let quadIdx = $state(0);

	let N3 = $state(41);
	let fc3 = $state(0.12);
	let win3 = $state<WindowSpec>({ type: 'hamming' });

	// ---------------- part 1: the four types ----------------

	// the requested length, moved to the parity the type needs
	const nEff = $derived(isOddLength(lpType) === (N % 2 === 1) ? N : N + 1 <= 64 ? N + 1 : N - 1);
	const anti = $derived(isAnti(lpType));
	const shape = $derived(anti ? antiShape : symShape);
	const h = $derived(source === 'random' ? randomTaps(lpType, nEff, seed) : demoTaps(lpType, nEff, shape, win));
	const M = $derived((nEff - 1) / 2);
	const caps = $derived(capabilities(lpType));
	const fz = $derived(forcedZeros(lpType));
	const impossible = $derived(source === 'design' && !anti && !caps[symShape]);

	const tapSeries = $derived<Series[]>([{ x: h.map((_, i) => i), y: h, label: 'h[n]', color: 'var(--s1)', kind: 'stem', format: (v: number) => trimNumber(v, 5) }]);
	const grid = $derived(linspace(0, fs / 2, 400));
	const ampSeries = $derived<Series[]>([
		{ x: grid, y: grid.map((f) => amplitude(h, f / fs, anti)), label: 'Amplitude A(f)', color: 'var(--s1)', format: (v: number) => trimNumber(v, 4) },
		{ x: grid, y: grid.map((f) => magnitude(h, f / fs)), label: '|H(f)|', color: 'var(--s2)', dash: '6 4', format: (v: number) => trimNumber(v, 4) }
	]);

	// ---------------- part 2: zeros ----------------
	const zeros = $derived(firZeros(h));
	const groups = $derived(groupZeros(zeros));
	const quads = $derived(groups.filter((g) => g.kind === 'quad'));
	const quad = $derived(quads.length ? quads[((quadIdx % quads.length) + quads.length) % quads.length] : null);
	const poles = $derived(zeros.map(() => ({ re: 0, im: 0 })));
	const groupCount = (k: ZeroGroupKind) => groups.filter((g) => g.kind === k).length;
	const KIND_TEXT: Record<ZeroGroupKind, string> = {
		quad: 'Quadruples z, z*, 1/z, 1/z*',
		'unit-pair': 'Conjugate pairs on the unit circle',
		'real-pair': 'Reciprocal pairs r, 1/r on the real axis',
		plus1: 'Zero at z = +1',
		minus1: 'Zero at z = −1',
		origin: 'Zero at the origin',
		other: 'Unpaired (numerical)'
	};
	const kindsPresent = $derived((Object.keys(KIND_TEXT) as ZeroGroupKind[]).filter((k) => groupCount(k) > 0));

	const stats = $derived.by((): Stat[] => [
		{ label: 'Type', value: `${TYPE_ROMAN[lpType]} — N = ${nEff}, ${anti ? 'antisymmetric' : 'symmetric'}` },
		{ label: 'Group delay', value: `${trimNumber(M, 4)} samples (${formatSI(M / fs, 's', 3)})`, hint: 'Constant at every frequency: (N−1)/2' },
		{
			label: 'Forced zeros',
			value: fz.plus1 && fz.minus1 ? 'z = +1 and z = −1' : fz.plus1 ? 'z = +1 (DC)' : fz.minus1 ? 'z = −1 (fs/2)' : 'none'
		},
		{ label: 'H(0) / H(fs/2)', value: `${trimNumber(clean(magnitude(h, 0)), 3)} / ${trimNumber(clean(magnitude(h, 0.5)), 3)}` },
		{ label: 'Zeros', value: `${zeros.length}: ${groupCount('quad')} quadruples, ${groupCount('unit-pair')} unit-circle pairs` }
	]);
	const clean = (v: number) => (Math.abs(v) < 1e-10 ? 0 : v);

	// ---------------- part 3: minimum phase ----------------
	const hLin = $derived(firwin(N3 % 2 ? N3 : N3 + 1, [fc3], win3, true, 1));
	const versions = $derived(phaseVersions(hLin));
	const COLORS = { linear: 'var(--s1)', minimum: 'var(--s2)', maximum: 'var(--s3)' };
	const NAMES = { linear: 'Linear phase', minimum: 'Minimum phase', maximum: 'Maximum phase' };
	const DASH = { linear: undefined, minimum: '7 4', maximum: '2 3' };
	const KEYS = ['linear', 'minimum', 'maximum'] as const;
	const filters3 = $derived(KEYS.map((k) => ({ filter: { kind: 'digital' as const, fs, fir: versions[k] }, label: NAMES[k], color: COLORS[k], dash: DASH[k] })));
	const energySeries = $derived<Series[]>(
		KEYS.map((k) => ({ x: versions[k].map((_, i) => i), y: partialEnergy(versions[k]), label: NAMES[k], color: COLORS[k], dash: DASH[k], kind: 'step' as const, format: (v: number) => `${trimNumber(100 * v, 3)} %` }))
	);
	const minZeros = $derived(firZeros(versions.minimum));
	// group delay in and just beyond the passband (stopband nulls make it spike)
	const gdMax = $derived(Math.min(0.5, fc3 * 1.25) * fs);
	const gdSeries = $derived.by((): Series[] => {
		const g = linspace(0, gdMax, 300);
		return KEYS.map((k) => ({
			x: g,
			y: evaluate({ kind: 'digital', fs, fir: versions[k] }, g).groupDelay.map((v) => v * fs),
			label: NAMES[k],
			color: COLORS[k],
			dash: DASH[k],
			format: (v: number) => `${trimNumber(v, 4)} samples`
		}));
	});
	const compare = $derived(
		KEYS.map((k) => {
			const hh = versions[k];
			const gd = evaluate({ kind: 'digital', fs: 1, fir: hh }, [1e-4]).groupDelay[0];
			let pk = 0;
			for (let i = 1; i < hh.length; i++) if (Math.abs(hh[i]) > Math.abs(hh[pk])) pk = i;
			return { k, gd, pk, n90: energyIndex(partialEnergy(hh), 0.9), centroid: energyCentroid(hh), pre: preRinging(hh) };
		})
	);
	const magDiff = $derived.by(() => {
		let worst = 0;
		for (const f of linspace(0, fc3 * 0.9, 120)) worst = Math.max(worst, Math.abs(20 * Math.log10(magnitude(versions.minimum, f) / magnitude(hLin, f))));
		return worst;
	});

	const typeOptions = [
		{ value: 1 as LpType, label: 'I' },
		{ value: 2 as LpType, label: 'II' },
		{ value: 3 as LpType, label: 'III' },
		{ value: 4 as LpType, label: 'IV' }
	];
	const tick = (b: boolean) => (b ? '✓' : '✕');
</script>

<ToolLayout slug="linear-phase" related={['fir-designer', 'special-fir', 'pole-zero', 'windows']}>
	{#snippet controls()}
		<ControlGroup title="1 · Linear-phase type">
			<Segmented label="Type" bind:value={lpType} options={typeOptions} />
			<Slider label="Length N" value={nEff} min={3} max={64} integer onchange={(v) => (N = v)} help={isOddLength(lpType) ? 'Type I and III need an odd length.' : 'Type II and IV need an even length.'} />
			<Segmented
				label="Taps"
				bind:value={source}
				options={[
					{ value: 'design', label: 'Demo filter' },
					{ value: 'random', label: 'Random' }
				]}
			/>
			{#if source === 'design'}
				{#if anti}
					<Select
						label="Antisymmetric filter"
						bind:value={antiShape}
						options={[
							{ value: 'hilbert', label: 'Hilbert transformer' },
							{ value: 'differentiator', label: 'Differentiator' }
						]}
					/>
				{:else}
					<Select
						label="Symmetric filter"
						bind:value={symShape}
						options={[
							{ value: 'lowpass', label: 'Low-pass' },
							{ value: 'highpass', label: 'High-pass' },
							{ value: 'bandpass', label: 'Band-pass' },
							{ value: 'bandstop', label: 'Band-stop' }
						]}
					/>
				{/if}
				<WindowPicker bind:value={win} />
			{:else}
				<button class="btn small" type="button" onclick={() => (seed += 1)}>New random taps</button>
			{/if}
		</ControlGroup>

		<ControlGroup title="3 · Minimum-phase demo">
			<Slider label="Length (odd)" bind:value={N3} min={5} max={101} step={2} integer onchange={(v) => (N3 = v % 2 ? v : v + 1)} />
			<Slider label="Cutoff" bind:value={fc3} min={0.02} max={0.4} step={0.005} unit="·fs" />
			<WindowPicker bind:value={win3} />
		</ControlGroup>

		<ControlGroup title="Display">
			<NumberInput label="Sample rate fs" bind:value={fs} unit="Hz" si min={1} logStep={1.25} />
		</ControlGroup>
	{/snippet}

	<h2 class="part">1 · The four types</h2>
	<StatGrid {stats} />
	{#if impossible}
		<Callout kind="warning" title="Type {TYPE_ROMAN[lpType]} cannot be a {symShape === 'highpass' ? 'high-pass' : 'band-stop'}">
			Its forced zero at z = −1 pins the gain at fs/2 to zero, exactly where a {symShape === 'highpass' ? 'high-pass' : 'band-stop'} filter needs a passband. Look at the
			amplitude plot: A(f) is dragged to zero at fs/2. Use an odd length (type I).
		</Callout>
	{/if}

	<div class="two">
		<Card title="Impulse response" subtitle={anti ? 'Antisymmetric: h[n] = −h[N−1−n]' + (nEff % 2 ? ', so the centre tap is 0.' : '; the centre falls between two taps.') : 'Symmetric: h[n] = h[N−1−n]' + (nEff % 2 ? ' about the centre tap.' : '; the centre falls between two taps.')}>
			<Plot series={tapSeries} vlines={[{ value: M, label: `centre ${trimNumber(M, 3)}` }]} xLabel="n" height={240} exportName="taps" />
		</Card>
		<Card title="Amplitude A(f) and |H(f)|" subtitle={anti ? 'H = j·A(f)·e^(−jωM): A is real and may change sign; |H| = |A|.' : 'H = A(f)·e^(−jωM): A is real and may change sign; |H| = |A|.'}>
			<Plot series={ampSeries} xDomain={[0, fs / 2]} hlines={[{ value: 0, dash: '2 3' }]} xLabel="Frequency (Hz)" yLabel="Gain" xFormat={freqFormat} xTooltipFormat={(v) => formatSI(v, 'Hz', 4)} height={240} exportName="amplitude" />
		</Card>
	</div>

	<Card title="What each type can do" subtitle="Forced zeros decide which responses are possible. The current type is highlighted.">
		<div class="table-wrap">
			<table class="caps">
				<thead>
					<tr><th>Type</th><th>N</th><th>Symmetry</th><th>Forced zeros</th><th>LP</th><th>HP</th><th>BP</th><th>BS</th><th>Hilbert / diff.</th></tr>
				</thead>
				<tbody>
					{#each [1, 2, 3, 4] as const as t (t)}
						{@const c = capabilities(t)}
						{@const z = forcedZeros(t)}
						<tr class:cur={t === lpType}>
							<td><strong>{TYPE_ROMAN[t]}</strong></td>
							<td>{t % 2 ? 'odd' : 'even'}</td>
							<td>{isAnti(t) ? 'anti' : 'sym'}</td>
							<td>{z.plus1 && z.minus1 ? '+1, −1' : z.plus1 ? '+1' : z.minus1 ? '−1' : '—'}</td>
							<td class="mark" class:no={!c.lowpass}>{tick(c.lowpass)}</td>
							<td class="mark" class:no={!c.highpass}>{tick(c.highpass)}</td>
							<td class="mark" class:no={!c.bandpass}>{tick(c.bandpass)}</td>
							<td class="mark" class:no={!c.bandstop}>{tick(c.bandstop)}</td>
							<td class="mark small">{t === 3 ? '✓ band-limited' : t === 4 ? '✓ full band' : '✕'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="small muted note">
			Antisymmetric types (III, IV) add a constant 90° phase: they suit Hilbert transformers and differentiators, not ordinary selective filters. Type III vanishes at both ends,
			so its Hilbert transformers and differentiators must be band-limited; type IV reaches fs/2.
		</p>
	</Card>

	<h2 class="part">2 · Zero symmetry</h2>
	<div class="two">
		<Card title="Zeros of H(z)" subtitle={`${zeros.length} zeros; the poles all sit at the origin.${zeros.length < nEff - 1 ? ' The end taps are exactly zero here, so the filter is effectively shorter than N.' : ''}`}>
			<PoleZeroPlot zeros={zeros} {poles} domain="z" {fs} height={340}>
				{#snippet overlay({ X, Y, k })}
					{#if quad}
						{@const r = Math.hypot(quad.members[0].re, quad.members[0].im)}
						<circle cx={X(0)} cy={Y(0)} r={r * k} class="guide" />
						<circle cx={X(0)} cy={Y(0)} r={k / r} class="guide" />
						{#each quad.members as m, i (i)}
							<circle cx={X(m.re)} cy={Y(m.im)} r="11" class="ring" />
							<text x={X(m.re) + 13} y={Y(m.im) + (m.im >= 0 ? -8 : 16)} class="ring-label">{['z', 'z*', '1/z', '1/z*'][i]}</text>
						{/each}
					{/if}
					{#if fz.plus1}
						<circle cx={X(1)} cy={Y(0)} r="11" class="ring forced" />
						<text x={X(1) + 6} y={Y(0) + 24} class="ring-label">forced</text>
					{/if}
					{#if fz.minus1}
						<circle cx={X(-1)} cy={Y(0)} r="11" class="ring forced" />
						<text x={X(-1) - 6} y={Y(0) + 24} class="ring-label" text-anchor="end">forced</text>
					{/if}
				{/snippet}
			</PoleZeroPlot>
		</Card>
		<Card title="How the zeros come in groups" subtitle="Real coefficients pair z with z*; (anti)symmetric coefficients pair z with 1/z.">
			<div class="table-wrap">
				<table>
					<thead><tr><th>Group</th><th class="num">Count</th></tr></thead>
					<tbody>
						{#each kindsPresent as k (k)}
							<tr><td>{KIND_TEXT[k]}</td><td class="num">{groupCount(k)}</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if quads.length}
				<div class="stepper">
					<button class="btn small" type="button" onclick={() => (quadIdx -= 1)} aria-label="Previous quadruple">◀</button>
					<span class="small">Highlighting quadruple {((quadIdx % quads.length) + quads.length) % quads.length + 1} of {quads.length}: |z| = {trimNumber(Math.hypot(quad!.members[0].re, quad!.members[0].im), 4)}, 1/|z| = {trimNumber(1 / Math.hypot(quad!.members[0].re, quad!.members[0].im), 4)}</span>
					<button class="btn small" type="button" onclick={() => (quadIdx += 1)} aria-label="Next quadruple">▶</button>
				</div>
			{:else}
				<p class="small muted">No quadruples here — all zeros are on the unit circle or the real axis. Try random taps.</p>
			{/if}
			<p class="small muted note">
				A zero on the unit circle is its own reciprocal conjugate (1/z* = z), so those come as conjugate pairs only; a real zero is its own conjugate, so those pair as r and 1/r.
				Zeros of a linear-phase filter can only leave the unit circle in such mirror groups — which is why a linear-phase FIR is never minimum phase (unless all its zeros are on the circle).
			</p>
		</Card>
	</div>

	<h2 class="part">3 · Minimum and maximum phase</h2>
	<Card title="Same magnitude, different timing" subtitle="The linear-phase low-pass converted with the real-cepstrum (homomorphic) method; maximum phase is the minimum-phase response reversed in time.">
		<div class="table-wrap">
			<table class="cmp">
				<thead>
					<tr>
						<th>Version</th>
						<th class="num" title="Group delay at DC">Delay at DC</th>
						<th class="num" title="Index of the largest tap">Peak at n</th>
						<th class="num" title="Samples until 90 % of the energy has arrived">90 % energy by n</th>
						<th class="num" title="Σ n·h² / Σ h²">Energy centroid</th>
						<th class="num" title="Deepest dip of the step response below zero before the main peak, relative to the final value">Pre-ringing</th>
					</tr>
				</thead>
				<tbody>
					{#each compare as c (c.k)}
						<tr>
							<td><span class="swatch" style:background={COLORS[c.k]} aria-hidden="true"></span>{NAMES[c.k]}</td>
							<td class="num">{trimNumber(c.gd, 4)} samples</td>
							<td class="num">{c.pk}</td>
							<td class="num">{c.n90}</td>
							<td class="num">{trimNumber(c.centroid, 4)}</td>
							<td class="num">{trimNumber(100 * c.pre, 3)} %</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="small muted note">Passband magnitudes agree to within {trimNumber(magDiff, 2)} dB. Delays are in samples at fs; the minimum-phase delay is smallest at every frequency of the passband.</p>
	</Card>

	<ResponseView filters={filters3} views={['phase', 'impulse', 'step']} title="Magnitude: identical for all three" />

	<div class="two">
		<Card title="Group delay in the passband" subtitle="Constant (N−1)/2 for linear phase; small but frequency-dependent for minimum phase, rising towards the band edge.">
			<Plot series={gdSeries} xDomain={[0, gdMax]} vlines={[{ value: fc3 * fs, label: 'cutoff' }]} xLabel="Frequency (Hz)" yLabel="Delay (samples)" xFormat={freqFormat} xTooltipFormat={(v) => formatSI(v, 'Hz', 4)} height={250} exportName="group-delay" />
		</Card>
		<Card title="Partial energy" subtitle="Σₖ≤ₙ h[k]² / Σ h²: minimum phase delivers its energy first; linear phase is symmetric; maximum phase last.">
			<Plot series={energySeries} yDomain={[0, 1.02]} hlines={[{ value: 0.9, label: '90 %' }]} xLabel="n" yLabel="Fraction of energy" height={250} exportName="partial-energy" />
		</Card>
		<Card title="Zeros of the minimum-phase version" subtitle="Every zero outside the unit circle has been reflected to 1/z*; zeros on the circle stay put.">
			<PoleZeroPlot zeros={minZeros} poles={minZeros.map(() => ({ re: 0, im: 0 }))} domain="z" {fs} height={300} />
		</Card>
	</div>

	{#snippet theory()}
		<h2>Linear phase and its four types</h2>
		<p>
			A filter has <strong>linear phase</strong> when every frequency is delayed by the same time:
			<Tex math={'\\angle H(e^{j\\omega})=-\\omega M\\ (+\\text{const})'} />, so the group delay
			<Tex math={'\\tau_g=-\\tfrac{d\\angle H}{d\\omega}=M'} /> is constant and waveshapes pass through undistorted. For an FIR
			filter of length N this happens exactly when the taps are symmetric or antisymmetric about their centre:
		</p>
		<Tex display math={'h[n]=\\pm h[N-1-n]\\quad\\Longrightarrow\\quad H(e^{j\\omega})=e^{-j\\omega M}A(\\omega)\\ \\text{or}\\ jA(\\omega)e^{-j\\omega M},\\qquad M=\\frac{N-1}{2}'} />
		<p>
			A(ω) is real but can be negative (a sign flip is a phase jump of π, not a deviation from linearity). Pairing the taps shows
			what A can contain: for odd N it is a sum of <Tex math={'\\cos(k\\omega)'} /> (type I) or <Tex math={'\\sin(k\\omega)'} /> (type III);
			for even N of <Tex math={'\\cos((k-\\tfrac12)\\omega)'} /> (type II) or <Tex math={'\\sin((k-\\tfrac12)\\omega)'} /> (type IV). Every
			sine vanishes at ω = 0, every <Tex math={'\\sin(k\\omega)'} /> also at ω = π, and every <Tex math={'\\cos((k-\\tfrac12)\\omega)'} /> at
			ω = π — the forced zeros of the table above.
		</p>

		<h3>Where the zeros can be</h3>
		<p>Symmetry of the taps is a statement about the polynomial: reversing the coefficients maps z to 1/z,</p>
		<Tex display math={'H(z)=\\pm z^{-(N-1)}H(z^{-1})\\quad\\Longrightarrow\\quad H(z_0)=0\\ \\Leftrightarrow\\ H(1/z_0)=0'} />
		<p>
			Real coefficients add the conjugate, so a zero off the unit circle and off the real axis brings three companions
			<Tex math={'\\{z_0,\\ z_0^*,\\ 1/z_0,\\ 1/z_0^*\\}'} />. On the unit circle 1/z₀* = z₀, so zeros come in conjugate pairs —
			that is where stopband zeros live. On the real axis they come as r, 1/r. Odd numbers of zeros at z = ±1 are what the
			type II–IV constraints force: e.g. for type II, <Tex math={'H(-1)=-H(-1)'} />, so H(−1) = 0.
		</p>

		<h3>Minimum phase</h3>
		<p>
			Reflecting a zero to its reciprocal conjugate, <Tex math={'z_0\\to 1/z_0^*'} />, changes only the phase: the factor
			<Tex math={'(1-z_0 z^{-1})'} /> and <Tex math={'(z_0^*-z^{-1})'} /> have the same magnitude on the unit circle. Among all
			filters with the same |H|, the one with every zero inside (or on) the unit circle is <strong>minimum phase</strong>. It has
			the smallest group delay at every frequency and the fastest energy build-up of all of them:
			<Tex math={'\\sum_{k\\le n}h_{\\min}[k]^2\\ \\ge\\ \\sum_{k\\le n}h[k]^2'} /> for every n. Reversing it in time moves every
			zero outside and gives the <strong>maximum-phase</strong> version, with the same magnitude and the most delay.
		</p>
		<p>
			The <strong>homomorphic</strong> method computes it from the magnitude alone. Take the log magnitude, inverse-FFT it to get
			the real cepstrum c[n], fold the anti-causal part onto the causal part and transform back:
		</p>
		<Tex display math={'\\hat c[n]=\\begin{cases}c[0] & n=0\\\\ 2c[n] & n>0\\\\ 0 & n<0\\end{cases}\\qquad H_{\\min}(e^{j\\omega})=\\exp\\big(\\mathcal F\\{\\hat c\\}\\big)'} />
		<p>
			The fold makes log H causal, which is the cepstral statement of “all zeros inside the circle”. Zeros exactly on the
			unit circle (stopband nulls) make log|H| = −∞, so the method clips the magnitude at a floor; the result matches
			|H| down to that floor.
		</p>

		<h3>Why it matters: pre-ringing</h3>
		<p>
			A linear-phase low-pass rings symmetrically: half of its ringing comes <em>before</em> the main transient. In audio this
			pre-ringing is audible as a smeared attack, because nothing in nature rings before it is struck — the reason minimum-phase
			(or “apodising”) filters are popular in sample-rate converters and loudspeaker crossovers. The price is phase distortion
			and a frequency-dependent delay near the band edge, visible in the group-delay plot. Where waveform fidelity matters —
			data communication, image processing, measurement — linear phase wins.
		</p>

		<Callout kind="try">
			<ul>
				<li>Choose type II and a high-pass: the forced zero at z = −1 drags the response to zero at fs/2 — then switch to type I.</li>
				<li>Pick random taps for each type and find the forced zeros at ±1 in the z-plane; step through the quadruples and check the two dashed circles have radii |z| and 1/|z|.</li>
				<li>Compare the step responses in part 3: the linear-phase filter ripples before the edge, the minimum-phase one only after it.</li>
				<li>Raise the minimum-phase demo's length and lower its cutoff: the linear-phase delay grows as (N−1)/2 while the minimum-phase delay at DC stays small.</li>
				<li>Look at the minimum-phase zeros: the quadruples have collapsed onto double zeros inside the circle, with the stopband zeros unchanged on it.</li>
			</ul>
		</Callout>
	{/snippet}
</ToolLayout>

<style>
	.part {
		margin: 0.6rem 0 -0.3rem;
		font-size: 1.1rem;
	}
	.part:first-child {
		margin-top: 0;
	}
	.two {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr));
		gap: 1.1rem;
	}
	.table-wrap {
		overflow-x: auto;
	}
	.caps td,
	.caps th {
		white-space: nowrap;
	}
	.mark {
		font-weight: 600;
		color: var(--good-ink);
	}
	.mark.no {
		color: var(--critical-ink);
	}
	tr.cur td {
		background: var(--accent-wash);
	}
	.note {
		margin: 0.5rem 0 0;
	}
	.stepper {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.6rem;
	}
	.guide {
		fill: none;
		stroke: var(--muted);
		stroke-dasharray: 4 4;
	}
	.ring {
		fill: none;
		stroke: var(--text);
		stroke-width: 1.5;
	}
	.ring.forced {
		stroke-dasharray: 3 2;
	}
	.ring-label {
		fill: var(--text-2);
		font-size: 11px;
		paint-order: stroke;
		stroke: var(--chart-surface);
		stroke-width: 3px;
	}
	.swatch {
		display: inline-block;
		width: 14px;
		height: 4px;
		border-radius: 2px;
		margin-right: 0.45rem;
		vertical-align: middle;
	}
</style>
