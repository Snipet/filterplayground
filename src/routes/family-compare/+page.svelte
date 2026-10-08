<script lang="ts">
	import { onMount } from 'svelte';
	import ToolLayout from '$lib/components/layout/ToolLayout.svelte';
	import ControlGroup from '$lib/components/layout/ControlGroup.svelte';
	import Card from '$lib/components/layout/Card.svelte';
	import Slider from '$lib/components/controls/Slider.svelte';
	import Segmented from '$lib/components/controls/Segmented.svelte';
	import Select from '$lib/components/controls/Select.svelte';
	import Plot, { type Series } from '$lib/components/plot/Plot.svelte';
	import { freqFormat } from '$lib/components/plot/scales';
	import StatGrid, { type Stat } from '$lib/components/content/StatGrid.svelte';
	import Callout from '$lib/components/content/Callout.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import { FAMILIES, type AnalogFamily, type BesselNorm } from '$lib/dsp/analog';
	import { freqsZpk, groupDelayAnalogZpk, linspace, logspace, unwrap } from '$lib/dsp/response';
	import { analogTimeResponse, type TimeResponse } from '$lib/dsp/time';
	import { formatSI, trimNumber } from '$lib/dsp/units';
	import { abs } from '$lib/dsp/complex';
	import { readSharedState } from '$lib/share';
	import type { ZPK } from '$lib/dsp/types';
	import {
		designNormalised,
		familyMetrics,
		FAMILY_COLOR,
		type CompareSettings,
		type CutoffMode,
		type FamilyMetrics
	} from '$lib/features/family-compare/compare';

	// ---------------- state ----------------
	const ALL_IDS = FAMILIES.map((f) => f.id);
	const CLASSIC: AnalogFamily[] = ['butter', 'cheby1', 'cheby2', 'ellip', 'bessel'];
	let enabled = $state<Record<AnalogFamily, boolean>>(
		Object.fromEntries(ALL_IDS.map((id) => [id, CLASSIC.includes(id)])) as Record<
			AnalogFamily,
			boolean
		>
	);
	let order = $state(5);
	let fc = $state(1000);
	let rp = $state(1);
	let rs = $state(60);
	let mode = $state<CutoffMode>('3db');
	let besselNative = $state<BesselNorm>('phase');

	const shared = $derived({
		fams: ALL_IDS.filter((id) => enabled[id]),
		order,
		fc,
		rp,
		rs,
		mode,
		besselNative
	});
	onMount(() => {
		const st = readSharedState<typeof shared>();
		if (!st) return;
		if (Array.isArray(st.fams)) for (const id of ALL_IDS) enabled[id] = st.fams.includes(id);
		if (typeof st.order === 'number') order = Math.min(12, Math.max(1, Math.round(st.order)));
		if (typeof st.fc === 'number' && st.fc > 0) fc = st.fc;
		if (typeof st.rp === 'number' && st.rp > 0) rp = Math.min(6, st.rp);
		if (typeof st.rs === 'number' && st.rs > 0) rs = Math.min(140, st.rs);
		if (st.mode === 'native' || st.mode === '3db') mode = st.mode;
		if (st.besselNative === 'phase' || st.besselNative === 'delay' || st.besselNative === 'mag')
			besselNative = st.besselNative;
	});

	const shown = $derived(FAMILIES.filter((f) => enabled[f.id]));
	const usesRp = $derived(enabled.cheby1 || enabled.ellip);
	const usesRs = $derived(enabled.cheby2 || enabled.ellip);

	// ---------------- designs (normalised: cutoff at 1 rad/s; independent of fc) ----------------
	const settings = $derived<CompareSettings>({ order, rp, rs, mode, besselNative });

	interface Curves {
		magDb: number[];
		passDb: number[];
		phase: number[];
		gd: number[];
	}
	interface Entry {
		id: AnalogFamily;
		key: string;
		name: string;
		short: string;
		color: string;
		zpk: ZPK;
		m: FamilyMetrics;
		c: Curves;
	}

	const U_LOG = logspace(0.02, 50, 600);
	const U_LIN = linspace(0, 2, 401);
	const U_GD = logspace(0.02, 10, 500);
	const W = 2 * Math.PI;

	function computeCurves(zpk: ZPK): Curves {
		const Hl = freqsZpk(zpk, U_LOG);
		const Hp = freqsZpk(zpk, U_LIN);
		const peak = Math.max(...Hp.map(abs), abs(Hl[0]));
		return {
			magDb: Hl.map((h) => 20 * Math.log10(Math.max(abs(h), 1e-12))),
			passDb: Hp.map((h) => 20 * Math.log10(Math.max(abs(h) / peak, 1e-12))),
			phase: unwrap(Hl.map((h) => Math.atan2(h.im, h.re))).map((v) => (v * 180) / Math.PI),
			gd: groupDelayAnalogZpk(zpk, U_GD)
		};
	}

	// Per-family results depend only on the parameters that family uses, so a cache keyed
	// on those keeps sliders smooth (dragging Rp only recomputes Chebyshev I and elliptic).
	// Plain (non-reactive) maps: they are memo tables, not state.
	const entryCache = new Map<string, Entry | string>();
	const timeCache = new Map<string, { step: TimeResponse; imp: TimeResponse }>();
	function familyKey(id: AnalogFamily, s: CompareSettings): string {
		const parts: (string | number)[] = [id, s.order, s.mode];
		if (id === 'cheby1' || id === 'ellip') parts.push(s.rp);
		if (id === 'cheby2' || id === 'ellip') parts.push(s.rs);
		if (id === 'bessel' && s.mode === 'native') parts.push(s.besselNative);
		return parts.join('|');
	}
	function getEntry(f: (typeof FAMILIES)[number], s: CompareSettings): Entry | string {
		const key = familyKey(f.id, s);
		const hit = entryCache.get(key);
		if (hit !== undefined) return hit;
		let out: Entry | string;
		try {
			const zpk = designNormalised(f.id, s);
			if (!zpk.p.every((p) => Number.isFinite(p.re) && Number.isFinite(p.im) && p.re < 0))
				throw new Error('unstable or invalid poles');
			out = {
				id: f.id,
				key,
				name: f.name,
				short: f.short,
				color: FAMILY_COLOR[f.id],
				zpk,
				m: familyMetrics(zpk),
				c: computeCurves(zpk)
			};
		} catch (e) {
			out = `${f.name}: ${e instanceof Error ? e.message : String(e)}`;
		}
		if (entryCache.size > 400) entryCache.clear();
		entryCache.set(key, out);
		return out;
	}

	const designs = $derived.by(() => {
		const out: Entry[] = [];
		const errors: string[] = [];
		for (const f of shown) {
			const e = getEntry(f, settings);
			if (typeof e === 'string') errors.push(e);
			else out.push(e);
		}
		return { list: out, errors };
	});
	const list = $derived(designs.list);

	// ---------------- frequency-domain curves ----------------
	const curves = $derived(list.map((e) => ({ e, ...e.c })));

	const fLog = $derived(U_LOG.map((u) => u * fc));
	const fLin = $derived(U_LIN.map((u) => u * fc));
	const fGd = $derived(U_GD.map((u) => u * fc));
	const tScale = $derived(1 / (W * fc)); // normalised time → seconds

	const dbFmt = (v: number) => `${trimNumber(v, 4)} dB`;
	const degFmt = (v: number) => `${trimNumber(v, 4)}°`;
	const sFmt = (v: number) => formatSI(v, 's', 4);
	const hzTip = (v: number) => formatSI(v, 'Hz', 4);

	const magSeries = $derived<Series[]>(
		curves.map((c) => ({ x: fLog, y: c.magDb, label: c.e.short, color: c.e.color, format: dbFmt }))
	);
	const passSeries = $derived<Series[]>(
		curves.map((c) => ({ x: fLin, y: c.passDb, label: c.e.short, color: c.e.color, format: dbFmt }))
	);
	const phaseSeries = $derived<Series[]>(
		curves.map((c) => ({ x: fLog, y: c.phase, label: c.e.short, color: c.e.color, format: degFmt }))
	);
	const gdSeries = $derived<Series[]>(
		curves.map((c) => ({
			x: fGd,
			y: c.gd.map((v) => v * tScale),
			label: c.e.short,
			color: c.e.color,
			format: sFmt
		}))
	);
	const gdLimits = $derived.by((): [number, number] | undefined => {
		const vals: number[] = [];
		for (const c of curves) for (const v of c.gd) if (Number.isFinite(v)) vals.push(v * tScale);
		if (!vals.length) return undefined;
		vals.sort((a, b) => a - b);
		const hi = vals[Math.floor(vals.length * 0.98)] ?? vals[vals.length - 1];
		return [0, hi * 1.25];
	});
	const magFloor = $derived(-Math.max(80, Math.ceil((usesRs ? rs + 30 : 80) / 10) * 10));

	// ---------------- time domain ----------------
	// normalised time span, snapped to a few values so it rarely changes while dragging
	const SPANS = [8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 80];
	const tSpan = $derived.by(() => {
		const settles = list.map((e) => e.m.settle).filter((v) => Number.isFinite(v));
		const want = Math.min(Math.max((settles.length ? Math.max(...settles) : 20) * 1.25, 8), 80);
		return SPANS.find((v) => v >= want) ?? 80;
	});
	const timeData = $derived(
		list.map((e) => {
			const key = `${e.key}|${tSpan}`;
			let r = timeCache.get(key);
			if (!r) {
				r = {
					step: analogTimeResponse(e.zpk, 'step', tSpan, 500),
					imp: analogTimeResponse(e.zpk, 'impulse', tSpan, 500)
				};
				if (timeCache.size > 400) timeCache.clear();
				timeCache.set(key, r);
			}
			return { e, ...r };
		})
	);
	const stepSeries = $derived<Series[]>(
		timeData.map((d) => ({
			x: d.step.t.map((t) => t * tScale),
			y: d.step.y,
			label: d.e.short,
			color: d.e.color
		}))
	);
	// impulse response in 1/s: h(t) = ωc·h_n(ωc t)
	const impSeries = $derived<Series[]>(
		timeData.map((d) => ({
			x: d.imp.t.map((t) => t * tScale),
			y: d.imp.y.map((v) => v / tScale),
			label: d.e.short,
			color: d.e.color
		}))
	);
	const timeFmt = (v: number) => formatSI(v, 's', 3);

	// ---------------- s-plane ----------------
	const pzSeries = $derived<Series[]>(
		list.map((e) => {
			const pts = [...e.zpk.p].sort((a, b) => a.re - b.re);
			return {
				x: pts.map((p) => p.re),
				y: pts.map((p) => p.im),
				label: e.short,
				color: e.color,
				kind: 'points' as const
			};
		})
	);
	const pzDomain = $derived.by(() => {
		let minRe = -1.2;
		let maxIm = 1.2;
		for (const e of list)
			for (const p of e.zpk.p) {
				minRe = Math.min(minRe, p.re * 1.12);
				maxIm = Math.max(maxIm, Math.abs(p.im) * 1.12);
			}
		return {
			x: [minRe, Math.max(0.35, -minRe * 0.25)] as [number, number],
			y: [-maxIm, maxIm] as [number, number]
		};
	});

	// ---------------- comparison table ----------------
	type Col = { key: keyof FamilyMetrics; better: 'max' | 'min' };
	const COLS: Col[] = [
		{ key: 'att2', better: 'max' },
		{ key: 'att10', better: 'max' },
		{ key: 'ripple', better: 'min' },
		{ key: 'overshoot', better: 'min' },
		{ key: 'rise', better: 'min' },
		{ key: 'settle', better: 'min' },
		{ key: 'gdVar', better: 'min' },
		{ key: 'maxQ', better: 'min' }
	];
	const best = $derived.by(() => {
		const out: Partial<Record<keyof FamilyMetrics, number>> = {};
		for (const c of COLS) {
			const vals = list.map((e) => e.m[c.key]).filter((v) => Number.isFinite(v));
			if (vals.length) out[c.key] = c.better === 'max' ? Math.max(...vals) : Math.min(...vals);
		}
		return out;
	});
	function isBest(key: keyof FamilyMetrics, v: number): boolean {
		const b = best[key];
		if (b === undefined || !Number.isFinite(v) || list.length < 2) return false;
		const tol =
			key === 'ripple' || key === 'overshoot' ? 1e-3 : 1e-3 * Math.max(Math.abs(b), 1e-12);
		return Math.abs(v - b) <= tol;
	}

	const fmtDb = (v: number) => (Number.isFinite(v) ? `${trimNumber(v, 3)} dB` : '—');
	const fmtPct = (v: number) =>
		Number.isFinite(v) ? `${v < 0.005 ? '0' : trimNumber(v, 3)} %` : '—';
	const fmtT = (v: number) => (Number.isFinite(v) ? formatSI(v * tScale, 's', 3) : '—');
	const fmtRipple = (v: number) => (v < 5e-4 ? '0 dB' : `${trimNumber(v, 3)} dB`);

	const leader = (key: keyof FamilyMetrics, better: 'max' | 'min') => {
		let bestE: Entry | null = null;
		for (const e of list) {
			const v = e.m[key];
			if (!Number.isFinite(v)) continue;
			if (!bestE || (better === 'max' ? v > bestE.m[key] : v < bestE.m[key])) bestE = e;
		}
		return bestE;
	};

	const stats = $derived.by((): Stat[] => {
		const out: Stat[] = [
			{ label: 'Families shown', value: `${list.length} of ${FAMILIES.length}` }
		];
		if (!list.length) return out;
		const sharp = leader('att2', 'max');
		const calm = leader('overshoot', 'min');
		const flat = leader('gdVar', 'min');
		const fast = leader('settle', 'min');
		if (sharp)
			out.push({
				label: 'Sharpest (at 2·fc)',
				value: `${sharp.short} · ${trimNumber(sharp.m.att2, 3)} dB`,
				hint: 'Largest attenuation one octave above the cutoff'
			});
		if (calm)
			out.push({ label: 'Least overshoot', value: `${calm.short} · ${fmtPct(calm.m.overshoot)}` });
		if (flat)
			out.push({
				label: 'Flattest delay',
				value: `${flat.short} · Δτ ${formatSI(flat.m.gdVar * tScale, 's', 3)}`,
				hint: 'Smallest group-delay spread across the passband (DC to −3 dB)'
			});
		if (fast)
			out.push({
				label: 'Fastest settling (2 %)',
				value: `${fast.short} · ${fmtT(fast.m.settle)}`
			});
		return out;
	});

	const familyOrderNote = $derived(
		mode === 'native' ? 'Native cutoff definitions' : 'All −3 dB at fc'
	);
</script>

{#snippet cell(key: keyof FamilyMetrics, v: number, text: string, sub?: string)}
	{@const b = isBest(key, v)}
	<td class="num" class:best={b}>
		{#if b}<strong>{text}</strong><span class="visually-hidden"> (best)</span>{:else}{text}{/if}
		{#if sub}<span class="subval">{sub}</span>{/if}
	</td>
{/snippet}

<ToolLayout
	slug="family-compare"
	share={shared}
	related={['analog-designer', 'order-calculator', 'lc-ladder', 'active-filters', 'crossover']}
>
	{#snippet controls()}
		<ControlGroup title="Families">
			<div class="fams">
				{#each FAMILIES as f (f.id)}
					<label class="fam" class:on={enabled[f.id]}>
						<input type="checkbox" bind:checked={enabled[f.id]} />
						<span class="swatch" style:background={FAMILY_COLOR[f.id]} aria-hidden="true"></span>
						<span>{f.short}</span>
					</label>
				{/each}
			</div>
			<div class="quick">
				<button
					class="btn small"
					type="button"
					onclick={() => ALL_IDS.forEach((id) => (enabled[id] = true))}>All</button
				>
				<button
					class="btn small"
					type="button"
					onclick={() => ALL_IDS.forEach((id) => (enabled[id] = CLASSIC.includes(id)))}
					>Classic five</button
				>
				<button
					class="btn small"
					type="button"
					onclick={() =>
						ALL_IDS.forEach(
							(id) =>
								(enabled[id] = ['butter', 'bessel', 'legendre', 'gaussian', 'critical'].includes(
									id
								))
						)}>Monotonic</button
				>
			</div>
		</ControlGroup>

		<ControlGroup title="Common parameters">
			<Slider label="Order N" bind:value={order} min={1} max={12} integer />
			<Slider label="Cutoff fc" bind:value={fc} min={10} max={100000} log unit="Hz" />
			{#if usesRp}
				<Slider
					label="Passband ripple Rp"
					bind:value={rp}
					min={0.01}
					max={6}
					log
					unit="dB"
					help="Chebyshev I and elliptic"
				/>
			{/if}
			{#if usesRs}
				<Slider
					label="Stopband attenuation Rs"
					bind:value={rs}
					min={10}
					max={120}
					step={1}
					unit="dB"
					help="Chebyshev II and elliptic"
				/>
			{/if}
		</ControlGroup>

		<ControlGroup title="What fc means">
			<Segmented
				bind:value={mode}
				options={[
					{ value: '3db', label: 'All −3 dB at fc' },
					{ value: 'native', label: 'Native' }
				]}
			/>
			{#if mode === '3db'}
				<p class="small muted">
					Every prototype is rescaled so its −3 dB point (relative to its passband peak) sits
					exactly at fc — the fair way to compare shapes.
				</p>
			{:else}
				<p class="small muted">
					Each family uses its own textbook meaning of the cutoff: Chebyshev I and elliptic put the
					end of the ripple band at fc, Chebyshev II puts the start of the stopband (Rs) there{#if enabled.bessel},
						Bessel follows the normalisation chosen below{/if}, and Butterworth, Legendre, Gaussian
					and critically damped are −3 dB at fc.
				</p>
				{#if enabled.bessel}
					<Select
						label="Bessel normalisation"
						bind:value={besselNative}
						options={[
							{ value: 'phase', label: 'Phase-matched: ≈ phase midpoint at fc (SciPy default)' },
							{ value: 'delay', label: 'Unit delay: τ(0) = 1/(2π fc)' },
							{ value: 'mag', label: '−3 dB at fc' }
						]}
					/>
				{/if}
			{/if}
		</ControlGroup>
	{/snippet}

	{#if designs.errors.length}
		<Callout kind="danger">
			{#each designs.errors as e (e)}<div>{e}</div>{/each}
		</Callout>
	{/if}
	{#if !list.length}
		<Callout kind="note">Switch on at least one family to compare.</Callout>
	{/if}

	<StatGrid {stats} />

	<div class="grid2">
		<Card>
			<Plot
				title="Magnitude"
				series={magSeries}
				xScale="log"
				xFormat={freqFormat}
				xTooltipFormat={hzTip}
				xLabel="Frequency (Hz)"
				yLabel="Magnitude (dB)"
				yDomain={[magFloor, 5]}
				vlines={[{ value: fc, label: 'fc' }]}
				height={300}
				exportName="family-magnitude"
			/>
		</Card>
		<Card>
			<Plot
				title="Passband detail"
				series={passSeries}
				xFormat={freqFormat}
				xTooltipFormat={hzTip}
				xLabel="Frequency (Hz)"
				yLabel="Relative to peak (dB)"
				yDomain={[-6, 0.5]}
				hlines={[{ value: -3.0103, label: '−3 dB' }]}
				vlines={[{ value: fc, label: 'fc' }]}
				height={300}
				exportName="family-passband"
			/>
		</Card>
		<Card>
			<Plot
				title="Phase (unwrapped)"
				series={phaseSeries}
				xScale="log"
				xFormat={freqFormat}
				xTooltipFormat={hzTip}
				xLabel="Frequency (Hz)"
				yLabel="Phase (°)"
				vlines={[{ value: fc, label: 'fc' }]}
				height={260}
				exportName="family-phase"
			/>
		</Card>
		<Card>
			<Plot
				title="Group delay"
				series={gdSeries}
				xScale="log"
				xFormat={freqFormat}
				xTooltipFormat={hzTip}
				xLabel="Frequency (Hz)"
				yLabel="Delay (s)"
				yFormat={(v) => formatSI(v, '', 3)}
				yLimits={gdLimits}
				vlines={[{ value: fc, label: 'fc' }]}
				height={260}
				exportName="family-group-delay"
			/>
		</Card>
		<Card>
			<Plot
				title="Step response"
				series={stepSeries}
				xLabel="Time (s)"
				xFormat={timeFmt}
				yLabel="Output"
				hlines={[{ value: 1 }]}
				height={260}
				exportName="family-step"
			/>
		</Card>
		<Card>
			<Plot
				title="Impulse response"
				series={impSeries}
				xLabel="Time (s)"
				xFormat={timeFmt}
				yLabel="h(t) (1/s)"
				yFormat={(v) => formatSI(v, '', 3)}
				height={260}
				exportName="family-impulse"
			/>
		</Card>
	</div>

	<Card
		title="Poles in the s-plane"
		subtitle="Normalised to the cutoff (s/ωc). The dashed circle is |s| = ωc, where Butterworth poles sit when normalised to −3 dB."
	>
		<Plot
			series={pzSeries}
			xDomain={pzDomain.x}
			yDomain={pzDomain.y}
			equalAspect
			crosshair={false}
			xLabel="σ / ωc"
			yLabel="jω / ωc"
			vlines={[{ value: 0, label: 'jω' }]}
			hlines={[{ value: 0 }]}
			height={340}
			exportName="family-poles"
		>
			{#snippet overlay(ctx)}
				<ellipse
					class="unit"
					cx={ctx.x(0)}
					cy={ctx.y(0)}
					rx={Math.abs(ctx.x(1) - ctx.x(0))}
					ry={Math.abs(ctx.y(0) - ctx.y(1))}
				/>
			{/snippet}
		</Plot>
	</Card>

	<Card
		title="Comparison"
		subtitle="{familyOrderNote} · order {order} · fc = {formatSI(
			fc,
			'Hz',
			4
		)}. Bold = best in its column."
	>
		<div class="table-wrap">
			<table class="cmp">
				<thead>
					<tr>
						<th>Family</th>
						{#if mode === 'native'}<th class="num">−3 dB at</th>{/if}
						<th class="num">Atten. at 2·fc</th>
						<th class="num">Atten. at 10·fc</th>
						<th class="num">Passband ripple</th>
						<th class="num">Step overshoot</th>
						<th class="num">Rise 10–90 %</th>
						<th class="num">Settling 2 %</th>
						<th class="num">Δτ in passband</th>
						<th class="num">Highest Q</th>
					</tr>
				</thead>
				<tbody>
					{#each list as e (e.id)}
						<tr>
							<th scope="row" class="famcell" title={e.name}>
								<span class="swatch" style:background={e.color} aria-hidden="true"></span>{e.short}
							</th>
							{#if mode === 'native'}<td class="num"
									>{Number.isFinite(e.m.f3) ? formatSI(e.m.f3 * fc, 'Hz', 4) : '—'}</td
								>{/if}
							{@render cell('att2', e.m.att2, fmtDb(e.m.att2))}
							{@render cell('att10', e.m.att10, fmtDb(e.m.att10))}
							{@render cell('ripple', e.m.ripple, fmtRipple(e.m.ripple))}
							{@render cell('overshoot', e.m.overshoot, fmtPct(e.m.overshoot))}
							{@render cell('rise', e.m.rise, fmtT(e.m.rise))}
							{@render cell('settle', e.m.settle, fmtT(e.m.settle))}
							{@render cell(
								'gdVar',
								e.m.gdVar,
								formatSI(e.m.gdVar * tScale, 's', 3),
								`${trimNumber((100 * e.m.gdVar) / e.m.gd0, 2)} % of τ(0)`
							)}
							{@render cell('maxQ', e.m.maxQ, trimNumber(e.m.maxQ, 3))}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="small muted note">
			Attenuation is relative to the passband peak. Ripple is measured up to the last passband
			maximum. Δτ is the spread of group delay from DC to the −3 dB point, also given relative to
			the DC delay τ(0). Highest Q is the worst pole pair — a measure of how hard the filter is to
			build accurately. The step of an even-order Chebyshev II or elliptic filter jumps to H(∞) at t
			= 0⁺; when that is already above 10 % (low Rs), the rise time is counted from t = 0.
		</p>
	</Card>

	{#snippet theory()}
		<h2>One budget, three things to spend it on</h2>
		<p>
			For a given order N, an all-pole low-pass has N poles to place. Where you put them decides
			three properties that pull against each other:
		</p>
		<ul>
			<li>
				<strong>Selectivity</strong> — how fast the magnitude falls after the cutoff (and how flat it
				stays before it).
			</li>
			<li>
				<strong>Phase linearity</strong> — how constant the group delay <Tex
					math={'\\tau(\\omega) = -\\mathrm{d}\\varphi/\\mathrm{d}\\omega'}
				/> is across the passband, i.e. whether all frequencies are delayed equally.
			</li>
			<li>
				<strong>Time response</strong> — overshoot, ringing and settling of the step response.
			</li>
		</ul>
		<p>
			Poles close to the jω axis (high Q) make a sharp knee but ring for a long time and bend the
			phase near the cutoff; poles spread towards the real axis give a clean step but a soft knee. A
			pole pair at
			<Tex math={'p = -\\sigma \\pm j\\omega_d'} /> adds a ringing term <Tex
				math={'e^{-\\sigma t}\\cos(\\omega_d t)'}
			/> to the step response and a group-delay bump near <Tex
				math={'\\omega \\approx \\omega_d'}
			/>:
		</p>
		<Tex
			display
			math={'Q = \\frac{|p|}{2\\sigma},\\qquad \\tau_{\\text{peak}} \\approx \\frac{1}{\\sigma} = \\frac{2Q}{|p|}.'}
		/>
		<p>
			The magnitude at high frequency only depends on the order (every all-pole filter ends at −20N
			dB/decade), so the families differ in what happens in the first octave or two around fc.
			Rational functions with zeros on the jω axis (Chebyshev II, elliptic) can do better there: the
			zeros create notches that make the transition steeper, at the price of a stopband that bounces
			back up to −Rs.
		</p>
		<p>
			Normalisation matters for a fair comparison. Chebyshev and elliptic designs are traditionally
			specified at the end of the ripple band, inverse Chebyshev at the start of the stopband and
			Bessel at a phase or delay reference. Comparing them “at the same fc” with these native
			definitions mixes up genuinely different cutoffs — the default here rescales every prototype <Tex
				math={'H(s) \\to H(s\\,\\omega_{3\\text{dB}})'}
			/> so that all of them pass −3 dB at fc.
		</p>

		<h3>The families</h3>
		<dl class="portraits">
			<dt>Butterworth</dt>
			<dd>
				<Tex math={'|H|^2 = 1/(1+\\omega^{2N})'} />: maximally flat at DC, poles on a circle.
				Moderate overshoot (4 % at N = 2, 11 % at N = 4). The default for anti-aliasing and
				general-purpose filtering when you have no strong reason to pick something else.
			</dd>
			<dt>Chebyshev I</dt>
			<dd>
				Trades an equiripple passband (Rp) for a steeper knee; poles on an ellipse close to the jω
				axis. Long ringing and a big group-delay peak at the edge — the peak overshoot is not always
				worse than Butterworth's (at N = 5 with 1 dB ripple it is lower), but the settling time is
				several times longer. Good when the magnitude spec is everything: IF and channel filters, RF
				pre-selection, anti-aliasing with a tight transition.
			</dd>
			<dt>Chebyshev II (inverse)</dt>
			<dd>
				Flat passband, equiripple stopband floor at −Rs thanks to jω-axis zeros. Less overshoot than
				Chebyshev I for a similar transition; useful when you need a guaranteed floor (e.g.
				rejecting a known interferer) and a clean passband.
			</dd>
			<dt>Elliptic (Cauer)</dt>
			<dd>
				Ripple in both bands; the steepest transition possible for a given order. Worst phase
				linearity and highest Q. The choice for demanding magnitude-only specs: anti-aliasing in
				front of an ADC with little oversampling, telecom channel filters, RF filter banks.
			</dd>
			<dt>Bessel (Thomson)</dt>
			<dd>
				Maximally flat group delay: <Tex math={'H(s) = \\theta_N(0)/\\theta_N(s)'} /> with a reverse Bessel
				polynomial. Almost no overshoot (&lt; 1 %), waveshape preserved, but the gentlest knee. Use it
				for pulses and measurements: oscilloscope front ends, data acquisition of transients, audio where
				phase matters more than steepness.
			</dd>
			<dt>Legendre (Optimum-L)</dt>
			<dd>
				The steepest possible cutoff while the magnitude stays monotonic — between Butterworth and
				Chebyshev I. A good compromise when ripple is unacceptable but you still want a sharp knee
				(e.g. audio band-limiting).
			</dd>
			<dt>Gaussian</dt>
			<dd>
				Approximates <Tex math={'|H| = e^{-a\\omega^2}'} />, whose impulse response is also
				Gaussian: no overshoot and the shortest combined time × bandwidth. Used for pulse shaping
				(GMSK), spectrum-analyser resolution filters and measurement filters.
			</dd>
			<dt>Critically damped</dt>
			<dd>
				N identical real poles — a cascade of buffered RC stages. No overshoot by construction and
				very soft knee. Simple smoothing, envelope detectors, control loops.
			</dd>
		</dl>

		<h3>Reading the table</h3>
		<p>
			A rule of thumb for the 10–90 % rise time of a low-pass is <Tex
				math={'t_r \\approx 0.35 / f_{3\\text{dB}}'}
			/> — at equal −3 dB bandwidth the families rise in roughly the same time, so the real differences
			are overshoot and settling. Settling to 2 % is dominated by the highest-Q pole pair, whose envelope
			decays as <Tex math={'e^{-|p| t / 2Q}'} />.
		</p>

		<Callout kind="try">
			<ul>
				<li>
					Set N = 6 and look at the step responses: elliptic and Chebyshev I ring for many cycles,
					Bessel and Gaussian barely overshoot. Compare their highest-Q values in the table.
				</li>
				<li>
					Switch to “Native” and watch the Chebyshev II curve jump: its native fc is the start of
					the stopband, not the −3 dB point.
				</li>
				<li>
					Raise Rp from 0.1 dB to 3 dB: the Chebyshev I knee sharpens (more attenuation at 2·fc)
					while its group-delay peak, highest Q and settling time grow. The overshoot only grows at
					even orders (N = 6: 18 % → 39 %); at odd orders such as the default N = 5 it shrinks (15 %
					→ 2 %), because the step settles to the DC gain, which for odd N sits on a ripple peak
					rather than Rp below one.
				</li>
				<li>
					Switch to “Monotonic” and compare Legendre with Butterworth: same smooth passband, but
					Legendre buys several dB more at 2·fc.
				</li>
				<li>
					Lower Rs on the elliptic filter to 20 dB: the transition becomes even steeper, but the
					stopband only stays 20 dB down.
				</li>
			</ul>
		</Callout>
	{/snippet}
</ToolLayout>

<style>
	.fams {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.3rem;
	}
	.fam {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.3rem 0.45rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		font-size: 0.86rem;
		cursor: pointer;
		color: var(--text-2);
		min-width: 0;
	}
	.fam.on {
		border-color: var(--border-strong);
		background: var(--surface-2);
		color: var(--text);
	}
	.fam input {
		margin: 0;
		accent-color: var(--accent);
	}
	.swatch {
		display: inline-block;
		flex: none;
		width: 14px;
		height: 4px;
		border-radius: 2px;
	}
	.quick {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-top: 0.1rem;
	}
	.grid2 {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 380px), 1fr));
		gap: 1.1rem;
	}
	.table-wrap {
		overflow-x: auto;
		/* contains the absolutely-positioned visually-hidden labels */
		position: relative;
	}
	.cmp {
		font-size: 0.85rem;
	}
	.cmp th,
	.cmp td {
		padding: 0.4em 0.5em;
	}
	.cmp td {
		white-space: nowrap;
	}
	.cmp thead th {
		vertical-align: bottom;
		white-space: normal;
		min-width: 4.2rem;
	}
	.cmp .famcell {
		white-space: nowrap;
	}
	.subval {
		display: block;
		font-size: 0.78em;
		color: var(--muted);
		font-weight: 400;
	}
	.famcell {
		background: none;
		color: var(--text);
		font-weight: 600;
	}
	.famcell .swatch {
		margin-right: 0.5rem;
		vertical-align: middle;
	}
	td.best {
		background: var(--accent-wash);
	}
	.note {
		margin: 0.6rem 0 0;
	}
	.unit {
		fill: none;
		stroke: var(--muted);
		stroke-width: 1;
		stroke-dasharray: 4 4;
	}
	.portraits dt {
		font-weight: 650;
		margin-top: 0.6rem;
	}
	.portraits dd {
		margin: 0.15rem 0 0 0;
	}
</style>
