<script lang="ts">
	import { onMount } from 'svelte';
	import ToolLayout from '$lib/components/layout/ToolLayout.svelte';
	import ControlGroup from '$lib/components/layout/ControlGroup.svelte';
	import Card from '$lib/components/layout/Card.svelte';
	import Select from '$lib/components/controls/Select.svelte';
	import Segmented from '$lib/components/controls/Segmented.svelte';
	import Slider from '$lib/components/controls/Slider.svelte';
	import Toggle from '$lib/components/controls/Toggle.svelte';
	import Plot, { type Marker, type Series } from '$lib/components/plot/Plot.svelte';
	import { freqFormat } from '$lib/components/plot/scales';
	import StatGrid, { type Stat } from '$lib/components/content/StatGrid.svelte';
	import Callout from '$lib/components/content/Callout.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import ExportPanel from '$lib/components/content/ExportPanel.svelte';
	import {
		EQ_TYPES,
		MAX_BANDS,
		MAX_GAIN,
		MAX_Q,
		MIN_Q,
		PRESETS,
		analogBandDb,
		bandSection,
		bandsFromPreset,
		cascade,
		eqTypeInfo,
		freeSlot,
		gainFromLevel,
		markerLevel,
		maxFreq,
		sanitizeBand,
		slotColor,
		type EqBand,
		type EqType
	} from '$lib/features/parametric-eq/eq';
	import { evaluate, logspace } from '$lib/dsp/response';
	import { sos2zpk } from '$lib/dsp/convert';
	import { abs } from '$lib/dsp/complex';
	import { formatSI, trimNumber } from '$lib/dsp/units';
	import { readSharedState } from '$lib/share';

	let fs = $state(48000);
	let nextId = PRESETS[0].bands.length + 1;
	let bands = $state<EqBand[]>(bandsFromPreset(PRESETS[0], 1));
	let selectedId = $state<number | null>(3);
	let range = $state<12 | 24 | 48>(24);
	let showAnalog = $state(false);
	let presetId = $state(PRESETS[0].id);
	let capNote = $state(false);

	const shared = $derived({ fs, range, showAnalog, bands: bands.map(({ slot, type, f, q, gain, enabled }) => ({ slot, type, f, q, gain, enabled })) });
	onMount(() => {
		const st = readSharedState<typeof shared>();
		if (!st) return;
		if (typeof st.fs === 'number' && st.fs >= 8000 && st.fs <= 384000) fs = st.fs;
		if (st.range === 12 || st.range === 24 || st.range === 48) range = st.range;
		if (typeof st.showAnalog === 'boolean') showAnalog = st.showAnalog;
		if (Array.isArray(st.bands)) {
			const out: EqBand[] = [];
			for (const raw of st.bands.slice(0, MAX_BANDS)) {
				const b = sanitizeBand(raw, nextId);
				if (b && !out.some((o) => o.slot === b.slot)) {
					out.push(b);
					nextId++;
				}
			}
			bands = out;
			selectedId = out[0]?.id ?? null;
		}
	});

	// ----- derived responses -----
	const nyq = $derived(fs / 2);
	const grid = $derived(logspace(20, nyq, 640));
	const ordered = $derived([...bands].sort((a, b) => a.slot - b.slot));
	const sos = $derived(cascade(bands, fs));
	const filter = $derived({ kind: 'digital' as const, fs, sos });
	const total = $derived(evaluate(filter, grid));
	const bandDb = $derived(
		new Map(ordered.map((b) => [b.id, evaluate({ kind: 'digital', fs, sos: [bandSection(b, fs)] }, grid).magDb]))
	);
	const analogTotal = $derived.by(() => {
		if (!showAnalog) return null;
		const on = bands.filter((b) => b.enabled);
		return grid.map((f) => on.reduce((s, b) => s + analogBandDb(b, f), 0));
	});

	const selected = $derived(bands.find((b) => b.id === selectedId) ?? null);
	const selInfo = $derived(selected ? eqTypeInfo(selected.type) : null);

	const series = $derived.by((): Series[] => {
		const out: Series[] = [
			{ x: grid, y: total.magDb, label: 'Total', color: 'var(--text)', width: 3, format: (v) => `${trimNumber(Math.abs(v) < 0.0005 ? 0 : v, 4)} dB` }
		];
		if (analogTotal)
			out.push({ x: grid, y: analogTotal, label: 'Analog prototype (no cramping)', color: 'var(--muted)', dash: '6 4', format: (v) => `${trimNumber(v, 4)} dB` });
		for (const b of ordered) {
			if (!b.enabled) continue;
			out.push({
				x: grid,
				y: bandDb.get(b.id) ?? [],
				label: `${b.slot + 1} · ${eqTypeInfo(b.type).short}`,
				color: slotColor(b.slot),
				width: 1.5,
				opacity: 0.85,
				format: (v) => `${trimNumber(Math.abs(v) < 0.005 ? 0 : v, 3)} dB`
			});
		}
		return out;
	});

	const ownDbAt = (b: EqBand, f: number) => evaluate({ kind: 'digital', fs, sos: [bandSection(b, fs)] }, [f]).magDb[0];
	const markers = $derived<Marker[]>(
		ordered.map((b) => {
			const f = Math.min(b.f, maxFreq(fs));
			const lvl = markerLevel(b, eqTypeInfo(b.type).usesGain ? 0 : ownDbAt(b, f));
			const y = Number.isFinite(lvl) ? Math.max(-range + 1, Math.min(range - 1, lvl)) : -range + 1;
			return {
				id: b.id,
				x: f,
				y,
				color: b.enabled ? slotColor(b.slot) : 'var(--muted)',
				draggable: true,
				selected: b.id === selectedId,
				axis: eqTypeInfo(b.type).usesGain ? ('xy' as const) : ('x' as const)
			};
		})
	);

	// ----- interaction -----
	let lastDragEnd = 0;
	const tidyF = (f: number) => Number(Math.min(maxFreq(fs), Math.max(20, f)).toPrecision(4));

	function onDrag(id: string | number, x: number, y: number) {
		const b = bands.find((v) => v.id === id);
		if (!b) return;
		b.f = tidyF(x);
		if (eqTypeInfo(b.type).usesGain) b.gain = gainFromLevel(b, y);
	}
	function onWheel(id: string | number, dy: number) {
		const b = bands.find((v) => v.id === id);
		if (!b || dy === 0) return;
		b.q = Number(Math.min(MAX_Q, Math.max(MIN_Q, b.q * Math.pow(1.12, -Math.sign(dy)))).toPrecision(3));
		selectedId = b.id;
	}
	function onSelect(id: string | number) {
		selectedId = Number(id);
		capNote = false;
	}
	function onPlotClick(x: number, y: number) {
		// a click also fires at the end of every marker drag — ignore those
		if (performance.now() - lastDragEnd < 400) return;
		addBand('peaking', x, Math.round(Math.max(-range, Math.min(range, y)) * 10) / 10);
	}
	function addBand(type: EqType = 'peaking', f = 1000, gain = 0) {
		const slot = freeSlot(bands);
		if (bands.length >= MAX_BANDS || slot < 0) {
			capNote = true;
			return;
		}
		capNote = false;
		const b: EqBand = { id: nextId++, slot, type, f: tidyF(f), q: 1, gain: Math.max(-MAX_GAIN, Math.min(MAX_GAIN, gain)), enabled: true };
		bands.push(b);
		selectedId = b.id;
	}
	function removeBand(id: number) {
		const i = bands.findIndex((b) => b.id === id);
		if (i < 0) return;
		bands.splice(i, 1);
		capNote = false;
		if (selectedId === id) selectedId = bands[Math.min(i, bands.length - 1)]?.id ?? null;
	}
	function loadPreset(id: string) {
		const p = PRESETS.find((v) => v.id === id);
		if (!p) return;
		presetId = id;
		bands = bandsFromPreset(p, nextId);
		nextId += p.bands.length;
		selectedId = bands[0]?.id ?? null;
		capNote = false;
	}
	function update(patch: Partial<EqBand>) {
		const b = bands.find((v) => v.id === selectedId);
		if (b) Object.assign(b, patch);
	}

	// ----- stats -----
	const gdMs = $derived(total.groupDelay.map((g) => g * 1000));
	const stats = $derived.by((): Stat[] => {
		const db = total.magDb;
		let iMax = 0;
		let iMin = 0;
		for (let i = 1; i < db.length; i++) {
			if (db[i] > db[iMax]) iMax = i;
			if (db[i] < db[iMin]) iMin = i;
		}
		let iGd = 0;
		for (let i = 1; i < gdMs.length; i++) if (Math.abs(gdMs[i]) > Math.abs(gdMs[iGd]) || !Number.isFinite(gdMs[iGd])) iGd = i;
		const on = bands.filter((b) => b.enabled);
		let worst = 0;
		let fWorst = 0;
		for (let i = 0; i < grid.length; i++) {
			const a = on.reduce((s, b) => s + analogBandDb(b, grid[i]), 0);
			const d = db[i];
			if (!Number.isFinite(a) || !Number.isFinite(d) || Math.abs(a) > 60 || Math.abs(d) > 60) continue;
			if (Math.abs(d - a) > Math.abs(worst)) {
				worst = d - a;
				fWorst = grid[i];
			}
		}
		const zpk = sos2zpk(sos);
		const r = Math.max(0, ...zpk.p.map(abs));
		const at = (v: number, i: number) => (Number.isFinite(v) ? `${v > 0 ? '+' : ''}${trimNumber(v, 3)} dB @ ${formatSI(grid[i], 'Hz', 3)}` : '−∞ dB');
		return [
			{ label: 'Bands', value: `${on.length} on · ${bands.length}/${MAX_BANDS} used` },
			{ label: 'Largest boost', value: db[iMax] > 0.005 ? at(db[iMax], iMax) : 'none' },
			{ label: 'Deepest cut', value: db[iMin] < -0.005 ? at(db[iMin], iMin) : 'none' },
			{
				label: 'Peak group delay',
				value: Number.isFinite(gdMs[iGd]) ? `${trimNumber(gdMs[iGd], 3)} ms @ ${formatSI(grid[iGd], 'Hz', 3)}` : '—',
				hint: 'Minimum-phase EQ delays mostly where the magnitude changes fastest.'
			},
			{
				label: 'Cramping vs analog',
				value: on.length ? `${trimNumber(Math.abs(worst), 3)} dB${Math.abs(worst) > 0.05 ? ` @ ${formatSI(fWorst, 'Hz', 3)}` : ''}` : '—',
				status: on.length ? (Math.abs(worst) < 1 ? 'good' : 'warning') : undefined,
				hint: 'Largest difference between the digital EQ and its analog prototype (bilinear warping near fs/2).'
			},
			{ label: 'Stability', value: `${r < 1 ? 'stable' : 'unstable'}, |p| ≤ ${trimNumber(r, 4)}`, status: r < 1 ? 'good' : 'critical', hint: 'Largest pole radius of the cascade; must be below 1.' }
		];
	});

	const gdLimits = $derived.by((): [number, number] | undefined => {
		const vals = gdMs.filter(Number.isFinite).map(Math.abs).sort((a, b) => a - b);
		if (!vals.length) return undefined;
		const p = vals[Math.floor(vals.length * 0.98)] ?? vals[vals.length - 1];
		const lim = Math.max(p * 1.3, 0.01);
		return [-lim, lim];
	});

	const fsOptions = [16000, 22050, 32000, 44100, 48000, 88200, 96000, 192000].map((v) => ({ value: v, label: formatSI(v, 'Hz', 4) }));
	const typeOptions = EQ_TYPES.map((t) => ({ value: t.id, label: t.name }));
	const presetOptions = PRESETS.map((p) => ({ value: p.id, label: p.name }));
	const presetInfo = $derived(PRESETS.find((p) => p.id === presetId));
	const hzTip = (v: number) => formatSI(v, 'Hz', 4);
	const bandLabel = (b: EqBand) => {
		const t = eqTypeInfo(b.type);
		return `${formatSI(b.f, 'Hz', 3)}${t.usesGain ? ` · ${b.gain > 0 ? '+' : ''}${trimNumber(b.gain, 3)} dB` : ''} · Q ${trimNumber(b.q, 3)}`;
	};
</script>

<ToolLayout slug="parametric-eq" share={shared} wideControls related={['biquad', 'iir-designer', 'signal-lab', 'crossover', 'structures']}>
	{#snippet controls()}
		<ControlGroup title="Setup" columns={2}>
			<Select label="Preset" value={presetId} options={presetOptions} onchange={loadPreset} />
			<Select label="Sample rate" bind:value={fs} options={fsOptions} />
		</ControlGroup>
		{#if presetInfo}<p class="small muted tight">{presetInfo.description}</p>{/if}

		<ControlGroup title="Bands">
			{#if ordered.length}
				<ul class="bands" aria-label="EQ bands">
					{#each ordered as b (b.id)}
						<li class:selected={b.id === selectedId} class:off={!b.enabled}>
							<button type="button" class="pick" aria-pressed={b.id === selectedId} onclick={() => onSelect(b.id)}>
								<span class="dot" style:background={slotColor(b.slot)} aria-hidden="true"></span>
								<span class="name">{b.slot + 1}. {eqTypeInfo(b.type).short}</span>
								<span class="meta">{bandLabel(b)}</span>
							</button>
							<label class="en" title="Enable band {b.slot + 1}">
								<input type="checkbox" checked={b.enabled} onchange={(e) => (b.enabled = (e.target as HTMLInputElement).checked)} />
								<span class="visually-hidden">Enable band {b.slot + 1}</span>
							</label>
							<button type="button" class="btn ghost small del" onclick={() => removeBand(b.id)} aria-label="Delete band {b.slot + 1}">✕</button>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="small muted">No bands. Click anywhere on the plot or use the button below.</p>
			{/if}
			<button type="button" class="btn small add" onclick={() => addBand()} disabled={bands.length >= MAX_BANDS}>+ Add band</button>
		</ControlGroup>

		{#if selected && selInfo}
			<ControlGroup title="Band {selected.slot + 1}">
				<Select label="Type" value={selected.type} options={typeOptions} onchange={(v) => update({ type: v })} />
				<Slider label="Frequency" value={selected.f} min={20} max={maxFreq(fs)} log unit="Hz" onchange={(v) => update({ f: v })} />
				<Slider label="Q" value={selected.q} min={MIN_Q} max={MAX_Q} log onchange={(v) => update({ q: v })} />
				{#if selInfo.usesGain}
					<Slider label="Gain" value={selected.gain} min={-MAX_GAIN} max={MAX_GAIN} step={0.1} unit="dB" onchange={(v) => update({ gain: v })} />
				{/if}
				<Toggle checked={selected.enabled} label="Enabled" onchange={(v) => update({ enabled: v })} />
			</ControlGroup>
		{/if}
		<p class="small muted">
			Click empty plot space to add a bell, drag a handle to move it{selInfo?.usesGain !== false ? ' (up/down sets the gain)' : ''}, scroll over a
			handle to change its Q.
		</p>
	{/snippet}

	{#if capNote}
		<Callout kind="note">All {MAX_BANDS} bands are in use — delete one to add another.</Callout>
	{/if}

	<StatGrid {stats} />

	<Card>
		<Plot
			{series}
			xScale="log"
			xDomain={[20, nyq]}
			yDomain={[-range, range]}
			xLabel="Frequency (Hz)"
			yLabel="Gain (dB)"
			xFormat={freqFormat}
			xTooltipFormat={hzTip}
			title="EQ magnitude"
			height={360}
			{markers}
			onmarkerdrag={onDrag}
			onmarkerdragend={() => (lastDragEnd = performance.now())}
			onmarkerwheel={onWheel}
			onmarkerselect={onSelect}
			onplotclick={onPlotClick}
			exportName="eq-magnitude"
		>
			{#snippet toolbar()}
				<Toggle bind:checked={showAnalog} label="Analog prototype" />
				<Segmented
					size="small"
					bind:value={range}
					options={[
						{ value: 12, label: '±12 dB' },
						{ value: 24, label: '±24 dB' },
						{ value: 48, label: '±48 dB' }
					]}
				/>
			{/snippet}
		</Plot>
	</Card>

	<div class="pair">
		<Card>
			<Plot
				series={[{ x: grid, y: total.phaseDeg, label: 'Total', color: 'var(--text)', format: (v) => `${trimNumber(v, 4)}°` }]}
				xScale="log"
				xDomain={[20, nyq]}
				xLabel="Frequency (Hz)"
				yLabel="Phase (°)"
				xFormat={freqFormat}
				xTooltipFormat={hzTip}
				title="Phase of the total"
				minYSpan={10}
				height={240}
				exportName="eq-phase"
			/>
		</Card>
		<Card>
			<Plot
				series={[{ x: grid, y: gdMs, label: 'Total', color: 'var(--text)', format: (v) => `${trimNumber(v, 4)} ms` }]}
				xScale="log"
				xDomain={[20, nyq]}
				xLabel="Frequency (Hz)"
				yLabel="Delay (ms)"
				xFormat={freqFormat}
				xTooltipFormat={hzTip}
				title="Group delay of the total"
				yLimits={gdLimits}
				minYSpan={0.02}
				height={240}
				exportName="eq-group-delay"
			/>
		</Card>
	</div>

	<Card title="Export" subtitle="The whole EQ as a cascade of biquads, one section per enabled band (RBJ cookbook coefficients, a₀ = 1).">
		<ExportPanel kind="digital" {sos} {fs} name="eq" />
	</Card>

	{#snippet theory()}
		<h2>How a parametric EQ works</h2>
		<p>
			Each band is one second-order section — a biquad from Robert Bristow-Johnson's <em>Audio EQ Cookbook</em> — and the EQ is
			simply their cascade. Because the transfer functions multiply, their responses <strong>add in dB</strong> and their phases add:
		</p>
		<Tex display math={'H(z)=\\prod_{k=1}^{K} H_k(z)\\quad\\Rightarrow\\quad 20\\log_{10}|H| = \\sum_k 20\\log_{10}|H_k|,\\qquad \\varphi = \\sum_k \\varphi_k'} />
		<p>That is why the bold total curve is exactly the sum of the thin band curves.</p>
		<h3>The peaking (bell) filter and constant Q</h3>
		<p>Every RBJ band is an analog prototype mapped with the prewarped bilinear transform. For the bell, with A = 10<sup>G/40</sup> and s normalised to ω₀:</p>
		<Tex display math={'H(s)=\\frac{s^2+s\\,\\dfrac{A}{Q}+1}{s^2+\\dfrac{s}{AQ}+1}'} />
		<p>
			At ω₀ the gain is A² (G dB), far away it is 1 (0 dB). Solving <Tex math={'|H(j\\omega)|^2 = A^2'} /> — the points where the
			response reaches half the peak gain in dB — gives <Tex math={'(1-\\omega^2)^2 = \\omega^2/Q^2'} />, which does not depend on A:
			the half-gain bandwidth is ω₀/Q whatever the boost. This <em>constant-Q</em> behaviour means turning the gain knob does not
			change how wide the bell looks. Swapping A → 1/A swaps numerator and denominator, so a cut is the exact inverse of the same boost.
		</p>
		<h3>Shelves</h3>
		<Tex display math={'H_{\\text{low shelf}}(s)=A\\,\\frac{s^2+\\frac{\\sqrt A}{Q}s+A}{A s^2+\\frac{\\sqrt A}{Q}s+1}'} />
		<p>
			A low shelf has gain A² below ω₀ and 1 above, passing through half the dB gain at ω₀ (the handle sits there). Q sets the slope:
			Q = 0.707 is the steepest shelf without overshoot; larger Q adds a dip and a bump around the transition.
		</p>
		<h3>Minimum phase</h3>
		<p>
			Bells and shelves have all their poles and zeros inside the unit circle: they are <em>minimum phase</em>. For such filters the
			phase is fixed by the magnitude (they are a Hilbert-transform pair through ln|H|), so phase shift and group delay concentrate where
			the magnitude changes fastest and vanish where it is flat. The delay is short — fractions of a millisecond for typical bands — and
			there is no pre-ringing, unlike a linear-phase FIR EQ that delays everything by half its length. Notches, low-pass and high-pass
			bands are also minimum phase; the all-pass is not (its zeros mirror its poles outside the circle).
		</p>
		<h3>Cramping near Nyquist</h3>
		<p>
			The bilinear transform squeezes the whole analog frequency axis into 0…f<sub>s</sub>/2. Prewarping puts f₀ exactly where you
			asked, but the response at Nyquist is pinned to the analog response at infinity:
		</p>
		<Tex display math={'H\\big(e^{j\\pi}\\big) = H_a(j\\infty) = 1 \\quad\\text{(0 dB for a bell)}'} />
		<p>
			A wide bell or a high shelf near f<sub>s</sub>/2 is therefore forced back to 0 dB at Nyquist and comes out narrower and
			asymmetric — "cramped". Turn on <em>Analog prototype</em> to see the difference. Usual remedies: run the EQ oversampled (2× or 4×
			f<sub>s</sub>), use designs with a prescribed Nyquist gain (Orfanidis 1997) or magnitude-matched biquads (Vicanek's "matched
			second-order filters"), or accept it — at 96 kHz most of the audio band is far from Nyquist.
		</p>
		<Callout kind="try">
			<ul>
				<li>Load <em>Cramping demo</em>, switch on the analog prototype and drag the bell from 2 kHz up to 18 kHz.</li>
				<li>Set a bell to +9 dB, then −9 dB: the cut is the mirror image of the boost, and the half-gain width stays the same.</li>
				<li>In <em>Telephone band-limit</em>, change one of the two high-pass Q values (0.541 and 1.307) to 0.707: the corner is no longer Butterworth.</li>
				<li>Load <em>Mains hum notches</em> and look at the group delay: sharp spikes at each notch, flat elsewhere.</li>
				<li>Switch the sample rate from 48 kHz to 96 kHz and watch the cramping figure drop.</li>
			</ul>
		</Callout>
	{/snippet}
</ToolLayout>

<style>
	.tight {
		margin: -0.6rem 0 1rem;
	}
	.bands {
		list-style: none;
		margin: 0;
		padding: 0;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.bands li {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface);
		margin: 0;
		padding-right: 0.15rem;
		min-width: 0;
	}
	.add {
		justify-self: start;
	}
	.bands li.selected {
		border-color: var(--accent);
		background: var(--accent-wash);
	}
	.bands li.off .pick {
		opacity: 0.55;
	}
	.pick {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.45rem;
		border: none;
		background: transparent;
		padding: 0.35rem 0.5rem;
		cursor: pointer;
		text-align: left;
		font-size: 0.85rem;
	}
	.dot {
		flex: none;
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 50%;
	}
	.name {
		font-weight: 600;
		white-space: nowrap;
	}
	.meta {
		color: var(--text-2);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}
	.en {
		display: inline-flex;
		align-items: center;
		padding: 0.3rem;
		cursor: pointer;
	}
	.en input {
		width: 1rem;
		height: 1rem;
		accent-color: var(--accent);
		margin: 0;
	}
	.del {
		padding: 0.2rem 0.45rem;
	}
	.pair {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr));
		gap: 1.1rem;
	}
</style>
