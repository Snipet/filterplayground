<script lang="ts">
	import ToolLayout from '$lib/components/layout/ToolLayout.svelte';
	import ControlGroup from '$lib/components/layout/ControlGroup.svelte';
	import Card from '$lib/components/layout/Card.svelte';
	import Select from '$lib/components/controls/Select.svelte';
	import Segmented from '$lib/components/controls/Segmented.svelte';
	import Slider from '$lib/components/controls/Slider.svelte';
	import Toggle from '$lib/components/controls/Toggle.svelte';
	import Plot, { type PlotContext, type Series } from '$lib/components/plot/Plot.svelte';
	import StatGrid, { type Stat } from '$lib/components/content/StatGrid.svelte';
	import Callout from '$lib/components/content/Callout.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import CodeBlock from '$lib/components/content/CodeBlock.svelte';
	import { designDigital } from '$lib/dsp/design';
	import { biquad } from '$lib/dsp/biquad';
	import { sos2tf } from '$lib/dsp/convert';
	import { evaluate, frequencyGrid } from '$lib/dsp/response';
	import { formatSI, trimNumber } from '$lib/dsp/units';
	import { freqFormat } from '$lib/components/plot/scales';
	import type { Complex } from '$lib/dsp/complex';
	import type { BandType, SOS, ZPK, Filter } from '$lib/dsp/types';
	import { num } from '$lib/export';
	import {
		coupledGrid,
		directFormGrid,
		limitCycle,
		lsb,
		qName,
		quantizeCoupled,
		quantizeDirect,
		quantizeSos,
		sosPoles,
		sosZeros,
		zeroInputResponse,
		type QuantSet,
		type RoundMode
	} from '$lib/features/quantization/quant';

	type Family = 'butter' | 'cheby1' | 'cheby2' | 'ellip' | 'biquad';
	let family = $state<Family>('ellip');
	let band = $state<BandType>('lowpass');
	let order = $state(6);
	let fs = $state(48000);
	let f1 = $state(1000);
	let f2 = $state(2000);
	let rp = $state(0.5);
	let rs = $state(60);
	let bqQ = $state(5);
	let bits = $state(16);
	let fmtMode = $state<'auto' | 'manual'>('auto');
	let manualInt = $state(1);
	let showDf = $state(true);
	let showSos = $state(true);
	let showCpl = $state(true);
	let pzView = $state<'circle' | 'zoom'>('zoom');
	let xScale = $state<'log' | 'linear'>('log');

	let gridBits = $state(5);
	let gridZoom = $state(false);

	let lcR = $state(0.95);
	let lcTheta = $state(20);
	let lcBits = $state(8);
	let lcMode = $state<RoundMode>('round');

	const COLORS = { orig: 'var(--s1)', df: 'var(--s2)', sos: 'var(--s3)', cpl: 'var(--s4)' };
	const isBand = $derived(band === 'bandpass' || band === 'bandstop');
	const nyq = $derived(fs / 2);

	// ---------------- design ----------------
	const design = $derived.by((): { sos: SOS; error: string | null } => {
		try {
			if (family === 'biquad') {
				const t =
					band === 'highpass'
						? 'highpass'
						: band === 'bandpass'
							? 'bandpass'
							: band === 'bandstop'
								? 'notch'
								: 'lowpass';
				return {
					sos: [biquad({ type: t, f0: Math.min(f1, nyq * 0.98), fs, q: bqQ })],
					error: null
				};
			}
			const lo = Math.min(f1, nyq * 0.95);
			const hi = Math.min(Math.max(f2, lo * 1.02), nyq * 0.98);
			const d = designDigital({ family, band, order, f1: lo, f2: hi, rp, rs, fs });
			return { sos: d.sos, error: null };
		} catch (e) {
			return { sos: [[1, 0, 0, 1, 0, 0]], error: e instanceof Error ? e.message : String(e) };
		}
	});
	const sos = $derived(design.sos);
	const tf = $derived(sos2tf(sos));
	const origPoles = $derived(sosPoles(sos));
	const origZeros = $derived(sosZeros(sos));
	const nOrder = $derived(origPoles.length);

	const mInt = $derived(fmtMode === 'manual' ? Math.min(manualInt, bits - 1) : null);
	const qDf = $derived(quantizeDirect(tf, bits, mInt));
	const qSos = $derived(quantizeSos(sos, bits, mInt));
	const qCpl = $derived(quantizeCoupled(origPoles, qSos.zpk.z, qSos.gain, bits, mInt));

	// ---------------- responses ----------------
	const grid = $derived(frequencyGrid(xScale === 'log' ? nyq / 2000 : 0, nyq, 700, xScale));
	const filters = $derived({
		orig: { kind: 'digital', fs, sos } as Filter,
		df: { kind: 'digital', fs, tf: qDf.tf } as Filter,
		sos: { kind: 'digital', fs, sos: qSos.sos } as Filter,
		cpl: { kind: 'digital', fs, zpk: qCpl.zpk } as Filter
	});
	const resp = $derived({
		orig: evaluate(filters.orig, grid),
		df: evaluate(filters.df, grid),
		sos: evaluate(filters.sos, grid),
		cpl: evaluate(filters.cpl, grid)
	});

	function passbandError(key: 'df' | 'sos' | 'cpl'): number {
		const o = resp.orig.magDb;
		const peak = Math.max(...o.filter(Number.isFinite));
		let worst = 0;
		for (let i = 0; i < o.length; i++) {
			if (!(o[i] >= peak - 3)) continue;
			const d = Math.abs(resp[key].magDb[i] - o[i]);
			if (Number.isFinite(d)) worst = Math.max(worst, d);
			else worst = Infinity;
		}
		return worst;
	}
	const errs = $derived({
		df: passbandError('df'),
		sos: passbandError('sos'),
		cpl: passbandError('cpl')
	});

	const magSeries = $derived.by((): Series[] => {
		const fmt = (v: number) => `${trimNumber(v, 4)} dB`;
		const s: Series[] = [
			{ x: grid, y: resp.orig.magDb, label: 'Original (double)', color: COLORS.orig, format: fmt }
		];
		if (showDf)
			s.push({
				x: grid,
				y: resp.df.magDb,
				label: `Direct form${qDf.stable ? '' : ' (unstable!)'}`,
				color: COLORS.df,
				format: fmt
			});
		if (showSos)
			s.push({
				x: grid,
				y: resp.sos.magDb,
				label: `Cascade SOS${qSos.stable ? '' : ' (unstable!)'}`,
				color: COLORS.sos,
				format: fmt
			});
		if (showCpl)
			s.push({
				x: grid,
				y: resp.cpl.magDb,
				label: `Coupled form${qCpl.stable ? '' : ' (unstable!)'}`,
				color: COLORS.cpl,
				format: fmt
			});
		return s;
	});
	const magDomain = $derived.by((): [number, number] => {
		const peak = Math.max(...resp.orig.magDb.filter(Number.isFinite));
		const top = Math.ceil((peak + 12) / 10) * 10;
		const floor = family === 'cheby2' || family === 'ellip' ? -(rs + 40) : -120;
		return [Math.min(floor, top - 40), top];
	});

	// ---------------- stats ----------------
	const statOf = (name: string, r: { stable: boolean; maxRadius: number }, err: number): Stat[] => [
		{
			label: name,
			value: r.stable
				? 'Stable'
				: r.maxRadius >= 1 && r.maxRadius < 1 + 1e-12
					? 'Marginal'
					: 'Unstable',
			status: r.stable ? 'good' : 'critical',
			hint: `Largest pole radius after quantisation: ${trimNumber(r.maxRadius, 7)}`
		},
		{
			label: `${name}: max |p|`,
			value: trimNumber(r.maxRadius, 6)
		},
		{
			label: `${name}: passband error`,
			value: err === Infinity ? '∞' : `${trimNumber(err, 3)} dB`,
			status: !r.stable || err > 1 ? 'critical' : err > 0.1 ? 'warning' : 'good',
			hint: 'Largest deviation from the unquantised response where that is within 3 dB of its peak'
		}
	];
	const stats = $derived<Stat[]>([
		...statOf('Direct form', qDf, errs.df),
		...statOf('Cascade SOS', qSos, errs.sos),
		...statOf('Coupled form', qCpl, errs.cpl)
	]);

	const formatRows = $derived<{ structure: string; set: QuantSet }[]>([
		...qDf.sets.map((set) => ({ structure: 'Direct form', set })),
		...qSos.sets.map((set) => ({ structure: 'Cascade SOS', set })),
		...qCpl.sets.map((set) => ({ structure: 'Coupled form', set }))
	]);

	// ---------------- pole-zero plot ----------------
	interface PzSet {
		key: string;
		label: string;
		color: string;
		zpk: ZPK;
		big?: boolean;
	}
	const pzSets = $derived.by((): PzSet[] => {
		const s: PzSet[] = [
			{
				key: 'orig',
				label: 'Original',
				color: COLORS.orig,
				zpk: { z: origZeros, p: origPoles, k: 1 },
				big: true
			}
		];
		if (showDf) s.push({ key: 'df', label: 'Direct form', color: COLORS.df, zpk: qDf.zpk });
		if (showSos) s.push({ key: 'sos', label: 'Cascade SOS', color: COLORS.sos, zpk: qSos.zpk });
		if (showCpl) s.push({ key: 'cpl', label: 'Coupled', color: COLORS.cpl, zpk: qCpl.zpk });
		return s;
	});
	const pzDomain = $derived.by((): { x: [number, number]; y: [number, number] } => {
		if (pzView === 'circle') return { x: [-1.25, 1.25], y: [-1.25, 1.25] };
		const core: Complex[] = [
			...origPoles,
			...(showSos ? qSos.zpk.p : []),
			...(showCpl ? qCpl.zpk.p : [])
		].filter((p) => Math.hypot(p.re, p.im) > 1e-9);
		if (!core.length) return { x: [-1.25, 1.25], y: [-1.25, 1.25] };
		// include zeros that sit close to the pole cluster (e.g. elliptic stopband zeros)
		const mx = core.reduce((acc, p) => acc + p.re, 0) / core.length;
		const reach = Math.max(0.05, ...core.map((p) => Math.abs(p.re - mx) + Math.abs(p.im)));
		const pts = [...core, ...origZeros.filter((z) => Math.hypot(z.re - mx, z.im) < 1.6 * reach)];
		let x0 = Math.min(...pts.map((p) => p.re));
		let x1 = Math.max(...pts.map((p) => p.re));
		let y0 = Math.min(...pts.map((p) => p.im));
		let y1 = Math.max(...pts.map((p) => p.im));
		const span = Math.max(x1 - x0, y1 - y0, 0.04);
		const cx = (x0 + x1) / 2;
		const cy = (y0 + y1) / 2;
		const h = span * 0.75;
		x0 = cx - h;
		x1 = cx + h;
		y0 = cy - h;
		y1 = cy + h;
		return { x: [x0, x1], y: [y0, y1] };
	});
	const dfOutside = $derived(
		showDf && pzView === 'zoom'
			? qDf.zpk.p.filter(
					(p) =>
						p.re < pzDomain.x[0] ||
						p.re > pzDomain.x[1] ||
						p.im < pzDomain.y[0] ||
						p.im > pzDomain.y[1]
				).length
			: 0
	);

	// ---------------- realisable grids ----------------
	const dfGrid = $derived(directFormGrid(gridBits));
	const cplGrid = $derived(coupledGrid(gridBits));
	const gridDomain = $derived(
		gridZoom
			? { x: [0.55, 1.05] as [number, number], y: [0, 0.5] as [number, number] }
			: { x: [-1.05, 1.05] as [number, number], y: [0, 1.05] as [number, number] }
	);
	const upperPoles = $derived(origPoles.filter((p) => p.im >= -1e-12));

	// ---------------- limit cycles ----------------
	const lcFrac = $derived(lcBits - 1);
	const lcA1 = $derived(-2 * lcR * Math.cos((lcTheta * Math.PI) / 180));
	const lcA2 = $derived(lcR * lcR);
	// The steady state comes from exact cycle detection, not from the plotted window, so a
	// slowly decaying transient (r → 1) is never mistaken for a limit cycle.
	const lcCycle = $derived(limitCycle(lcA1, lcA2, 0.5, lcFrac, lcMode, { saturate: true }));
	const LC_MIN = 240;
	const LC_MAX = 3000;
	// plot until a few periods of the steady state are visible
	const lcN = $derived(
		Math.min(
			LC_MAX,
			Math.max(LC_MIN, Math.ceil((lcCycle.onset + Math.max(80, 3 * lcCycle.period)) / 40) * 40)
		)
	);
	const lc = $derived(zeroInputResponse(lcA1, lcA2, 0.5, lcFrac, lcMode, lcN, { saturate: true }));
	const lcScale = $derived(Math.pow(2, lcFrac));
	const lcSeries = $derived<Series[]>([
		{
			x: lc.ideal.map((_, i) => i),
			y: lc.ideal.map((v) => v * lcScale),
			label: 'Ideal (double precision)',
			color: 'var(--s1)',
			format: (v) => `${trimNumber(v, 4)} LSB`
		},
		{
			x: lc.quantized.map((_, i) => i),
			y: lc.quantized.map((v) => v * lcScale),
			label: `Products rounded to ${lcBits} bits`,
			color: 'var(--s2)',
			kind: 'step',
			format: (v) => `${trimNumber(v, 4)} LSB`
		}
	]);
	const lcAmp = $derived(lcCycle.amplitude);
	const lcKind = $derived.by(() => {
		const s = lcCycle.samples;
		if (lcCycle.capped || lcAmp === 0) return '';
		if (lcCycle.period === 1) return 'constant (DC)';
		if (lcCycle.period === 2 && s[0] === -s[1]) return 'alternating (fs/2)';
		return `period ${lcCycle.period}`;
	});
	// Jackson's effective-value estimate for oscillating (a₂-type) cycles with rounding
	const lcDeadBand = $derived(0.5 / (1 - Math.abs(lcA2)));
	// constant / sign-alternating cycles: (1 − |a₁| + a₂)|y| ≤ |e₁ + e₂|, with |eᵢ| ≤ ½ LSB
	// per rounded product (< 1 LSB when truncating)
	const lcDcBound = $derived((lcMode === 'round' ? 1 : 2) / (1 - Math.abs(lcA1) + lcA2));
	const lcStats = $derived<Stat[]>([
		{ label: 'Coefficients', value: `a₁ = ${trimNumber(lcA1, 4)}, a₂ = ${trimNumber(lcA2, 4)}` },
		{
			label: `Ideal at n = ${lcN - 1}`,
			value: `${trimNumber(Math.abs(lc.ideal[lcN - 1]) * lcScale, 2)} LSB`,
			hint: 'The exact response decays geometrically to zero'
		},
		{
			label: 'Sustained oscillation',
			value: lcCycle.capped
				? `≥ ±${trimNumber(lcAmp, 3)} LSB (not settled)`
				: lcAmp === 0
					? 'none (decays to 0)'
					: lcCycle.period === 1
						? `${trimNumber(lcCycle.samples[0], 3)} LSB, ${lcKind}`
						: `±${trimNumber(lcAmp, 3)} LSB, ${lcKind}`,
			status: lcAmp > 0 ? 'warning' : 'good',
			hint: lcCycle.capped
				? 'The quantised state had not repeated within the step budget'
				: `Exact steady state of the quantised recursion: its state repeats, so y[n] is periodic from n = ${lcCycle.onset} on (period ${lcCycle.period}).`
		},
		...(lcMode === 'round'
			? [
					{
						label: 'Dead band (oscillating)',
						value: `≈ ${trimNumber(lcDeadBand, 3)} LSB`,
						hint: 'Jackson’s effective-value estimate for oscillating (a₂-type) limit cycles with rounding: |y| ≲ 0.5 / (1 − |a₂|) LSB. An estimate, not a guarantee.'
					}
				]
			: []),
		{
			label: 'Bound for DC / fs/2 cycles',
			value: `${lcMode === 'round' ? '≤' : '<'} ${trimNumber(lcDcBound, 3)} LSB`,
			hint: `Constant or sign-alternating (a₁-type) limit cycles satisfy (1 − |a₁| + a₂)·|y| ${
				lcMode === 'round'
					? '≤ 1 LSB with both products rounded'
					: '< 2 LSB with both products truncated'
			}.`
		}
	]);

	// ---------------- export ----------------
	const sosCode = $derived.by(() => {
		const [fb, fa] = qSos.sets.map((s) => s.format);
		const type = bits <= 8 ? 'int8_t' : bits <= 16 ? 'int16_t' : 'int32_t';
		return `/* ${qSos.ints.length} sections, ${bits}-bit coefficients.
 * Numerators (monic) in ${qName(fb)}: value = code / 2^${fb.frac}
 * Denominators in ${qName(fa)}:       value = code / 2^${fa.frac}
 * Row: { b0, b1, b2, a1, a2 } (a0 = 1).  Apply the overall gain once. */
#include <stdint.h>
static const ${type} sos_q[${qSos.ints.length}][5] = {
${qSos.ints.map((r) => `    { ${r.join(', ')} },`).join('\n')}
};
static const double gain = ${num(qSos.gain, 12)};`;
	});
	const dfCode = $derived.by(() => {
		const [fb, fa] = qDf.sets.map((s) => s.format);
		// full precision: every b_q, a_q value is exactly code / 2^F
		return `# Direct form, ${bits}-bit coefficients
# b_q: monic numerator in ${qName(fb)}; a_q: a1..a${qDf.aq.length} in ${qName(fa)} (a0 = 1 is implicit)
gain = ${num(qDf.gain)}
b_q = [${qDf.bq.map((v) => num(v)).join(', ')}]
a_q = [${qDf.aq.map((v) => num(v)).join(', ')}]
b = [gain * v for v in b_q]
a = [1.0] + a_q`;
	});

	const familyOptions = [
		{ value: 'ellip' as const, label: 'Elliptic' },
		{ value: 'cheby1' as const, label: 'Chebyshev I' },
		{ value: 'cheby2' as const, label: 'Chebyshev II' },
		{ value: 'butter' as const, label: 'Butterworth' },
		{ value: 'biquad' as const, label: 'Single RBJ biquad' }
	];
	const fsOptions = [8000, 16000, 44100, 48000, 96000, 192000].map((v) => ({
		value: v,
		label: formatSI(v, 'Hz', 4)
	}));
	const hzTip = (v: number) => formatSI(v, 'Hz', 4);
</script>

{#snippet pzOverlay(ctx: PlotContext)}
	{@const r = Math.abs(ctx.x(1) - ctx.x(0))}
	<line x1={ctx.left} x2={ctx.left + ctx.innerWidth} y1={ctx.y(0)} y2={ctx.y(0)} class="axis0" />
	<line y1={ctx.top} y2={ctx.top + ctx.innerHeight} x1={ctx.x(0)} x2={ctx.x(0)} class="axis0" />
	<circle cx={ctx.x(0)} cy={ctx.y(0)} {r} class="unit" />
	{#each pzSets as set (set.key)}
		{@const s = set.big ? 7 : 5}
		<g
			stroke={set.color}
			stroke-width={set.big ? 4.5 : 1.8}
			fill="none"
			opacity={set.big ? 0.4 : 1}
			stroke-linecap="round"
		>
			{#each set.zpk.z as z, i (i)}
				{#if Number.isFinite(z.re) && Number.isFinite(z.im)}<circle
						cx={ctx.x(z.re)}
						cy={ctx.y(z.im)}
						r={s}
					/>{/if}
			{/each}
			{#each set.zpk.p as p, i (i)}
				{#if Number.isFinite(p.re) && Number.isFinite(p.im)}
					<path
						d="M{ctx.x(p.re) - s},{ctx.y(p.im) - s}l{2 * s},{2 * s}M{ctx.x(p.re) - s},{ctx.y(p.im) +
							s}l{2 * s},{-2 * s}"
					/>
				{/if}
			{/each}
		</g>
	{/each}
{/snippet}

{#snippet gridOverlay(ctx: PlotContext, pts: Complex[])}
	{@const r = Math.abs(ctx.x(1) - ctx.x(0))}
	<path d="M{ctx.x(-1)},{ctx.y(0)} A{r},{r} 0 0 1 {ctx.x(1)},{ctx.y(0)}" class="unit" />
	<path
		class="gridpts"
		d={pts.map((p) => `M${ctx.x(p.re).toFixed(1)},${ctx.y(p.im).toFixed(1)}h0`).join('')}
	/>
	<g stroke="var(--s2)" stroke-width="2" fill="none">
		{#each upperPoles as p, i (i)}
			<path
				d="M{ctx.x(p.re) - 5},{ctx.y(p.im) - 5}l10,10M{ctx.x(p.re) - 5},{ctx.y(p.im) + 5}l10,-10"
			/>
		{/each}
	</g>
{/snippet}

<ToolLayout slug="quantization" related={['structures', 'tf-analyzer', 'iir-designer', 'biquad']}>
	{#snippet controls()}
		<ControlGroup title="Filter">
			<Select label="Design" bind:value={family} options={familyOptions} />
			<Segmented
				label="Response type"
				bind:value={band}
				options={[
					{ value: 'lowpass', label: 'LP' },
					{ value: 'highpass', label: 'HP' },
					{ value: 'bandpass', label: 'BP' },
					{ value: 'bandstop', label: 'BS' }
				]}
			/>
			{#if family !== 'biquad'}
				<Slider label="Order" bind:value={order} min={2} max={isBand ? 8 : 14} integer />
			{:else}
				<Slider label="Q" bind:value={bqQ} min={0.5} max={50} log />
			{/if}
			<Slider
				label={isBand && family !== 'biquad'
					? 'Lower edge f₁'
					: family === 'biquad'
						? 'Frequency f₀'
						: 'Cutoff fc'}
				bind:value={f1}
				min={10}
				max={nyq * 0.95}
				log
				unit="Hz"
			/>
			{#if isBand && family !== 'biquad'}
				<Slider label="Upper edge f₂" bind:value={f2} min={10} max={nyq * 0.98} log unit="Hz" />
			{/if}
			{#if family === 'cheby1' || family === 'ellip'}
				<Slider label="Passband ripple" bind:value={rp} min={0.05} max={3} log unit="dB" />
			{/if}
			{#if family === 'cheby2' || family === 'ellip'}
				<Slider
					label="Stopband attenuation"
					bind:value={rs}
					min={20}
					max={100}
					step={1}
					unit="dB"
				/>
			{/if}
			<Select label="Sample rate" bind:value={fs} options={fsOptions} />
			<p class="small muted hint">
				Low cutoffs relative to fs put the poles close to z = 1 — the sensitive case.
			</p>
		</ControlGroup>
		<ControlGroup title="Fixed point">
			<Slider label="Word length B" bind:value={bits} min={4} max={24} integer unit="bits" />
			<Segmented
				label="Q format"
				bind:value={fmtMode}
				options={[
					{ value: 'auto', label: 'Auto per set' },
					{ value: 'manual', label: 'Manual' }
				]}
			/>
			{#if fmtMode === 'manual'}
				<Slider
					label="Integer bits (all sets)"
					bind:value={manualInt}
					min={0}
					max={bits - 1}
					integer
				/>
				<p class="small muted hint">
					Format Q{Math.min(manualInt, bits - 1)}.{bits - 1 - Math.min(manualInt, bits - 1)} — coefficients
					that do not fit saturate.
				</p>
			{:else}
				<p class="small muted hint">
					Each coefficient set gets just enough integer bits for its largest value; the rest are
					fractional bits.
				</p>
			{/if}
		</ControlGroup>
		<ControlGroup title="Structures shown">
			<Toggle label="Direct form (one high-order b/a)" bind:checked={showDf} />
			<Toggle label="Cascade of second-order sections" bind:checked={showSos} />
			<Toggle label="Coupled-form sections" bind:checked={showCpl} />
		</ControlGroup>
	{/snippet}

	{#if design.error}
		<Callout kind="danger">{design.error}</Callout>
	{/if}

	<StatGrid {stats} columns={3} />

	{#if !qDf.stable && qSos.stable}
		<Callout kind="warning" title="The direct form has become unstable">
			Rounding the {nOrder}th-order denominator to {bits} bits moved a pole to radius {trimNumber(
				qDf.maxRadius,
				5
			)}. The cascade uses the same word length and stays within {trimNumber(errs.sos, 2)} dB of the ideal
			passband.
		</Callout>
	{/if}

	<Card
		title="Pole–zero locations"
		subtitle="× poles, ○ zeros. The unquantised filter is drawn as wide translucent marks underneath."
	>
		{#snippet actions()}
			<Segmented
				size="small"
				bind:value={pzView}
				options={[
					{ value: 'zoom', label: 'Zoom on poles' },
					{ value: 'circle', label: 'Unit circle' }
				]}
			/>
		{/snippet}
		<ul class="pz-legend" aria-label="Legend">
			{#each pzSets as set (set.key)}
				<li>
					<svg width="32" height="14" aria-hidden="true"
						><g
							stroke={set.color}
							stroke-width={set.big ? 3.5 : 2}
							opacity={set.big ? 0.45 : 1}
							fill="none"
							stroke-linecap="round"
							><path d="M2,3l8,8M2,11l8,-8" /><circle cx="23" cy="7" r="4.5" /></g
						></svg
					>{set.label}
				</li>
			{/each}
		</ul>
		<Plot
			series={[]}
			xDomain={pzDomain.x}
			yDomain={pzDomain.y}
			equalAspect
			crosshair={false}
			legend={false}
			xLabel="Re z"
			yLabel="Im z"
			height={380}
			overlay={pzOverlay}
		/>
		{#if dfOutside > 0}
			<p class="small muted">
				{dfOutside} direct-form pole{dfOutside > 1 ? 's are' : ' is'} outside this zoomed view — switch
				to “Unit circle”.
			</p>
		{/if}
	</Card>

	<Card title="Magnitude response">
		{#snippet actions()}
			<Segmented
				size="small"
				bind:value={xScale}
				options={[
					{ value: 'log', label: 'Log f' },
					{ value: 'linear', label: 'Linear f' }
				]}
			/>
		{/snippet}
		<Plot
			series={magSeries}
			{xScale}
			xDomain={[grid[0], nyq]}
			yDomain={magDomain}
			xLabel="Frequency (Hz)"
			yLabel="Magnitude (dB)"
			xFormat={freqFormat}
			xTooltipFormat={hzTip}
			height={340}
			exportName="quantized-magnitude"
		/>
		{#if !qDf.stable && showDf}<p class="small muted">
				The response of an unstable filter is a formal evaluation of H(e^jω): the actual output
				grows without bound.
			</p>{/if}
	</Card>

	<Card
		title="Q formats used"
		subtitle="B = {bits} bits: 1 sign bit, I integer bits, F = B − 1 − I fractional bits (Q I.F). The step between representable values is 2^−F."
	>
		<div class="table-wrap">
			<table>
				<thead
					><tr
						><th>Structure</th><th>Coefficient set</th><th class="num">Count</th><th class="num"
							>max |c|</th
						><th>Format</th><th class="num">Step</th><th>Saturated</th></tr
					></thead
				>
				<tbody>
					{#each formatRows as r, i (i)}
						<tr>
							<td>{r.structure}</td>
							<td>{r.set.name}</td>
							<td class="num">{r.set.count}</td>
							<td class="num">{trimNumber(r.set.maxAbs, 5)}</td>
							<td class="mono">{qName(r.set.format)}</td>
							<td class="num">{lsb(r.set.format).toExponential(2)}</td>
							<td
								>{#if r.set.saturated}<span class="bad">✕ {r.set.saturated}</span>{:else}<span
										class="ok">✓ none</span
									>{/if}</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="small muted">
			Numerators are written as gain × monic polynomial and the gain is applied separately
			(exactly), so the comparison isolates what rounding does to the pole and zero positions. The
			coupled form quantises the pole coordinates σ = r cos θ and ω = r sin θ directly; its zeros
			are those of the quantised cascade.
		</p>
		<div class="codes">
			<CodeBlock code={sosCode} language="c" maxHeight="16rem" />
			<CodeBlock code={dfCode} language="python" maxHeight="16rem" />
		</div>
	</Card>

	<Card
		title="Where can a quantised pole go?"
		subtitle="Every pole position a second-order section can realise with {gridBits}-bit coefficients (upper half plane)."
	>
		{#snippet actions()}
			<Toggle label="Zoom near z = 1" bind:checked={gridZoom} />
		{/snippet}
		<div class="grid-ctl">
			<Slider label="Grid word length" bind:value={gridBits} min={3} max={7} integer unit="bits" />
		</div>
		<ul class="pz-legend" aria-label="Legend">
			<li>
				<svg width="14" height="12" aria-hidden="true"
					><circle cx="7" cy="6" r="2.4" fill="var(--s1)" /></svg
				>Realisable pole position
			</li>
			<li>
				<svg width="14" height="12" aria-hidden="true"
					><path d="M2,1l10,10M2,11l10,-10" stroke="var(--s2)" stroke-width="2" /></svg
				>Poles of the filter above (unquantised)
			</li>
		</ul>
		<div class="two">
			<div>
				{#snippet dfOv(ctx: PlotContext)}{@render gridOverlay(ctx, dfGrid)}{/snippet}
				<Plot
					series={[]}
					xDomain={gridDomain.x}
					yDomain={gridDomain.y}
					equalAspect
					crosshair={false}
					legend={false}
					xLabel="Re z"
					yLabel="Im z"
					title="Direct form: a₁, a₂ in Q1.{gridBits - 2}"
					height={280}
					overlay={dfOv}
				/>
				<p class="small muted">
					{dfGrid.length} positions. Since a₂ = r² and a₁ = −2r cos θ, the grid is uniform in r² and in
					r cos θ — dense around z = ±j, sparse near z = ±1 where narrow low-pass and high-pass filters
					need their poles.
				</p>
			</div>
			<div>
				{#snippet cplOv(ctx: PlotContext)}{@render gridOverlay(ctx, cplGrid)}{/snippet}
				<Plot
					series={[]}
					xDomain={gridDomain.x}
					yDomain={gridDomain.y}
					equalAspect
					crosshair={false}
					legend={false}
					xLabel="Re z"
					yLabel="Im z"
					title="Coupled form: σ, ω in Q0.{gridBits - 1}"
					height={280}
					overlay={cplOv}
				/>
				<p class="small muted">
					{cplGrid.length} positions on a uniform square grid: the same resolution everywhere, at the
					cost of four multiplies per section instead of two.
				</p>
			</div>
		</div>
	</Card>

	<Card
		title="Limit cycles"
		subtitle="Zero-input response of the direct form y[n] = −a₁y[n−1] − a₂y[n−2] from y[−1] = 0.5 in a B-bit signal word (Q0.(B−1), full scale ±2^(B−1) LSB): every product is quantised to the word length and the sum saturates at full scale."
	>
		<div class="lc-ctl">
			<Slider label="Pole radius r" bind:value={lcR} min={0.5} max={0.999} step={0.001} />
			<Slider label="Pole angle θ" bind:value={lcTheta} min={1} max={179} step={1} unit="°" />
			<Slider label="Signal word length" bind:value={lcBits} min={4} max={16} integer unit="bits" />
			<Select
				label="Product quantiser"
				bind:value={lcMode}
				options={[
					{ value: 'round', label: 'Round to nearest' },
					{ value: 'floor', label: 'Truncate (two’s complement, floor)' },
					{ value: 'trunc', label: 'Magnitude truncation (toward 0)' }
				]}
			/>
		</div>
		<StatGrid stats={lcStats} />
		<Plot
			series={lcSeries}
			xLabel="Sample n"
			yLabel="y[n] (LSB)"
			height={260}
			exportName="limit-cycle"
		/>
		{#if lcCycle.capped || lcCycle.onset + lcCycle.period > lcN}
			<p class="small muted">
				The quantised response only settles {lcCycle.capped
					? 'after more samples than were simulated'
					: `at n = ${lcCycle.onset}`}, beyond the {lcN} samples plotted.
			</p>
		{/if}
	</Card>

	{#snippet theory()}
		<h2>Why coefficients cannot simply be rounded</h2>
		<p>
			A fixed-point coefficient with B bits in format Q I.F can only take values on a grid of step <Tex
				math={'2^{-F}'}
			/>, with <Tex math={'F=B-1-I'} />. Rounding moves it by up to half a step. What matters is how
			far that moves the <em>poles</em> — and that depends dramatically on the structure.
		</p>
		<h3>Coefficient sensitivity and clustered poles</h3>
		<p>
			For a direct-form denominator <Tex math={'A(z)=\\prod_j(1-p_jz^{-1})'} /> with simple poles, a perturbation
			of <Tex math="a_k" /> moves pole <Tex math="p_i" /> by
		</p>
		<Tex
			display
			math={'\\Delta p_i \\approx -\\frac{p_i^{\\,N-k}}{\\prod_{j\\ne i}(p_i-p_j)}\\,\\Delta a_k'}
		/>
		<p>
			A low-pass filter with cutoff far below fs/2 has all its poles packed near z = 1, so the
			product of pole distances in the denominator is tiny and the sensitivity is huge. At the same
			time the coefficients of a high-order A(z) are large (binomial-like: up to <Tex
				math={'\\binom{N}{N/2}'}
			/>), so they need many integer bits and leave few fractional bits. Both effects compound: in
			the default example a 16-bit direct form gets only 10 fractional bits and goes unstable.
		</p>
		<h3>Second-order sections</h3>
		<p>
			In a cascade each pole pair is set by its own <Tex math={'a_1=-2r\\cos\\theta'} /> and <Tex
				math={'a_2=r^2'}
			/>, which never exceed 2 and 1 in magnitude, so Q1.(B−2) always fits, and a rounding error
			only disturbs one pair. Pairing poles with the nearest zeros and ordering sections (usually by
			increasing pole radius, as SciPy does) keeps the internal gains moderate, which matters for
			overflow and round-off noise. In fixed point the gain is distributed across the sections
			(scaling) so that no internal node overflows, typically using an <Tex math={'L_\\infty'} /> or <Tex
				math={'L_2'}
			/> norm bound.
		</p>
		<h3>The realisable pole grid</h3>
		<p>
			With a₁ and a₂ on a uniform grid the reachable poles are <Tex math={'r=\\sqrt{a_2}'} />, <Tex
				math={'\\cos\\theta=-a_1/(2r)'}
			/>. Near z = 1 a small change in a₁ changes θ by a lot (cos θ is flat at θ = 0), so the
			reachable positions are sparse exactly where low-cutoff filters need them. The
			<strong>coupled (Gold–Rader) form</strong> uses the state equations
		</p>
		<Tex
			display
			math={'\\begin{bmatrix}s_1[n+1]\\\\ s_2[n+1]\\end{bmatrix}=\\begin{bmatrix}\\sigma & -\\omega\\\\ \\omega & \\sigma\\end{bmatrix}\\begin{bmatrix}s_1[n]\\\\ s_2[n]\\end{bmatrix}+\\dots,\\qquad p=\\sigma\\pm j\\omega'}
		/>
		<p>
			so the quantised coefficients are the pole coordinates themselves and the grid is uniform — at
			twice the multiplies.
		</p>
		<h3>Q formats and scaling</h3>
		<p>
			Q I.F (ARM notation) means one sign bit, I integer bits and F fractional bits: Q15 = Q0.15
			covers [−1, 1); Q2.13 covers [−4, 4) in steps of <Tex math={'2^{-13}'} />. Coefficients set
			the integer bits; <em>signals</em> are a separate question: each internal node must be scaled so
			that it cannot overflow, which is why fixed-point biquads usually keep a wide accumulator (e.g.
			32 or 40 bits) and only round when storing back to the state.
		</p>
		<h3>Round-off noise and limit cycles</h3>
		<p>
			Rounding the <em>products</em> each sample injects noise of variance <Tex
				math={'\\Delta^2/12'}
			/> per quantiser, shaped by the transfer function from that node to the output; poles near the unit
			circle amplify it (high-Q sections are noisy). Rounding is also a non-linearity: in a recursive
			section the rounded output can settle into a sustained oscillation even with zero input — a
			<strong>zero-input limit cycle</strong>. For a second-order section with rounding, Jackson’s
			effective-value argument estimates its size: an oscillation can persist where rounding makes
			a₂y behave as if a₂ were 1 — poles effectively on the unit circle — which happens inside the
			“dead band” <Tex math={'|y|\\lesssim \\frac{0.5}{1-|a_2|}'} /> LSB, so it is worst for poles close
			to the unit circle. That is an estimate, not a guarantee: with both products rounded, as in the
			demo, some oscillations are larger (r = 0.95, θ = 30°, 16 bits: 12 LSB against 5.1). Constant (DC)
			and sign-alternating (fs/2) limit cycles, the a₁ type, obey a bound of their own, <Tex
				math={'(1-|a_1|+a_2)\\,|y|\\le 1'}
			/> LSB with both products rounded (0.5 with a single quantiser after the accumulator). It allows
			far larger cycles when θ is near 0° or 180°: r = 0.9, θ = 5°, 12 bits locks onto a constant −35
			LSB, against a dead band of 2.6.
		</p>
		<p>
			Magnitude truncation (rounding toward zero) shrinks every product, but in the direct form that
			does not shrink the state, because |a₁| = 2r|cos θ| can approach 2. Once |a₁| ≥ 1, y = ±1 LSB
			is a constant (θ &lt; 90°) or alternating (θ &gt; 90°) limit cycle, since trunc(|a₁|) = 1 and
			trunc(a₂) = 0, and larger ones exist too (r = 0.8, θ = 15°, 8 bits: −6 LSB, against 1 LSB with
			rounding). Whether a response gets caught depends on its path. In the normal (coupled) form
			the state update is a rotation scaled by r &lt; 1, so truncating each state after its
			accumulator can only shrink the state: zero-input limit cycles cannot exist there (wave
			digital filters achieve the same through passivity). Truncation also adds a bias. Overflow
			limit cycles are prevented by saturation arithmetic, which the demo uses.
		</p>
		<Callout kind="try">
			<ul>
				<li>
					With the default 6th-order elliptic the direct form is unstable at every word length on
					the slider, even 24 bits (|p| ≈ 1.008; it first turns stable at 26 bits), while the
					cascade stays within 0.001 dB of the ideal passband. Set the order to 4: the direct form
					is now stable at 24 bits, and lowering B pushes a pole out of the unit circle at 17 bits
					while the cascade barely moves.
				</li>
				<li>
					Switch to a 4th-order Butterworth low-pass at 200 Hz and reduce B to 8 bits: even the
					cascade fails, because its poles fall between the sparse grid points near z = 1 — the
					coupled form survives.
				</li>
				<li>
					Use “Manual” Q format with 0 integer bits: the direct-form and SOS denominators saturate
					(a₁ ≈ −2 does not fit), which wrecks the response.
				</li>
				<li>In the pole grid, zoom near z = 1 and compare 5-bit direct and coupled forms.</li>
				<li>
					In the limit-cycle demo, rounding leaves a ±5 LSB oscillation; raise r to 0.99 and it
					grows to ±26 LSB. Switch the quantiser to magnitude truncation and the response now decays
					to zero — but back at r = 0.95 truncation sticks at a constant −1 LSB, and at r = 0.8, θ =
					15° at −6 LSB, worse than rounding.
				</li>
			</ul>
		</Callout>
	{/snippet}
</ToolLayout>

<style>
	.hint {
		margin: 0;
	}
	.table-wrap {
		overflow-x: auto;
	}
	.ok {
		color: var(--good-ink);
	}
	.bad {
		color: var(--critical-ink);
	}
	.pz-legend {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 1.1rem;
		margin: 0 0 0.3rem;
		padding: 0;
		font-size: 0.82rem;
		color: var(--text-2);
	}
	.pz-legend li {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		margin: 0;
	}
	.unit {
		fill: none;
		stroke: var(--axis);
		stroke-width: 1.3;
		stroke-dasharray: 5 4;
	}
	.axis0 {
		stroke: var(--axis);
		stroke-width: 1;
	}
	.gridpts {
		stroke: var(--s1);
		stroke-width: 2.6;
		stroke-linecap: round;
		fill: none;
		opacity: 0.75;
	}
	.two {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: 1rem;
	}
	.grid-ctl {
		max-width: 320px;
		margin-bottom: 0.5rem;
	}
	.lc-ctl {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 0.6rem 1rem;
		margin-bottom: 0.8rem;
	}
	.codes {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 0.8rem;
		margin-top: 0.6rem;
	}
</style>
