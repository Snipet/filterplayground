<script lang="ts">
	import { onMount } from 'svelte';
	import ToolLayout from '$lib/components/layout/ToolLayout.svelte';
	import ControlGroup from '$lib/components/layout/ControlGroup.svelte';
	import Card from '$lib/components/layout/Card.svelte';
	import Select from '$lib/components/controls/Select.svelte';
	import Segmented from '$lib/components/controls/Segmented.svelte';
	import Slider from '$lib/components/controls/Slider.svelte';
	import NumberInput from '$lib/components/controls/NumberInput.svelte';
	import Toggle from '$lib/components/controls/Toggle.svelte';
	import ResponseView from '$lib/components/plot/ResponseView.svelte';
	import Plot, { type Series } from '$lib/components/plot/Plot.svelte';
	import { freqFormat } from '$lib/components/plot/scales';
	import StatGrid, { type Stat } from '$lib/components/content/StatGrid.svelte';
	import Callout from '$lib/components/content/Callout.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import CodeBlock from '$lib/components/content/CodeBlock.svelte';
	import Schematic from '$lib/features/rlc/schematic/Schematic.svelte';
	import { FAMILIES, familyInfo, type AnalogFamily } from '$lib/dsp/analog';
	import { designAnalog } from '$lib/dsp/design';
	import { evaluate, findCrossing, logspace } from '$lib/dsp/response';
	import { formatSI, trimNumber, type ESeries } from '$lib/dsp/units';
	import {
		TOPOLOGIES,
		TOPOLOGY_NAMES,
		cascadeZpk,
		designStage,
		fillNote,
		monteCarlo,
		stageSpecs,
		type StageBand,
		type StageDesign,
		type StageSpec,
		type Topology
	} from '$lib/features/active-filters/design';
	import { stageDrawing, type PartLabel } from '$lib/features/active-filters/schematics';
	import { readSharedState } from '$lib/share';

	const ALLOWED: AnalogFamily[] = [
		'butter',
		'cheby1',
		'bessel',
		'legendre',
		'gaussian',
		'critical'
	];
	const TWO_PI = 2 * Math.PI;

	let mode = $state<'filter' | 'stage'>('filter');
	let family = $state<AnalogFamily>('butter');
	let band = $state<StageBand>('lowpass');
	let order = $state(4);
	let fc = $state(1000);
	let f1 = $state(500);
	let f2 = $state(2000);
	let rp = $state(1);
	let sBand = $state<StageBand>('lowpass');
	let f0 = $state(1000);
	let q = $state(2);
	let topology = $state<Topology>('sk-unity');
	let gain = $state(1);
	let baseC = $state(10e-9);
	let rSeries = $state<ESeries>('E24');
	let cSeries = $state<ESeries>('E12');
	let optimize = $state(true);
	let mc = $state(true);
	let tol = $state(0.05);

	// band-pass doubles the order, so its prototype is limited to N ≤ 6; `order`
	// keeps the user's value for LP/HP while the controls show and share N
	const maxOrder = $derived(band === 'bandpass' ? 6 : 10);
	const N = $derived(Math.min(order, maxOrder));

	const shared = $derived({
		mode,
		family,
		band,
		order: N,
		fc,
		f1,
		f2,
		rp,
		sBand,
		f0,
		q,
		topology,
		gain,
		baseC,
		rSeries,
		cSeries,
		optimize,
		mc,
		tol
	});
	onMount(() => {
		const st = readSharedState<typeof shared>();
		if (!st) return;
		const pos = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
		const bands = ['lowpass', 'highpass', 'bandpass'];
		const series = ['E6', 'E12', 'E24', 'E48', 'E96', 'exact'];
		if (st.mode === 'filter' || st.mode === 'stage') mode = st.mode;
		if (st.family && ALLOWED.includes(st.family)) family = st.family;
		if (st.band && bands.includes(st.band)) band = st.band;
		if (st.sBand && bands.includes(st.sBand)) sBand = st.sBand;
		if (pos(st.order)) order = Math.min(10, Math.max(1, Math.round(st.order)));
		if (pos(st.fc)) fc = st.fc;
		if (pos(st.f1)) f1 = st.f1;
		if (pos(st.f2)) f2 = st.f2;
		if (pos(st.rp)) rp = st.rp;
		if (pos(st.f0)) f0 = st.f0;
		if (pos(st.q)) q = st.q;
		// only the selectable topologies (not the internal stage types or inherited keys)
		const topo = TOPOLOGIES.find((t) => t === st.topology);
		if (topo) topology = topo;
		if (pos(st.gain)) gain = st.gain;
		if (pos(st.baseC)) baseC = st.baseC;
		if (st.rSeries && series.includes(st.rSeries)) rSeries = st.rSeries;
		if (st.cSeries && series.includes(st.cSeries)) cSeries = st.cSeries;
		if (typeof st.mc === 'boolean') mc = st.mc;
		if (typeof st.optimize === 'boolean') optimize = st.optimize;
		if (pos(st.tol)) tol = st.tol;
	});

	const effBand = $derived(mode === 'filter' ? band : sBand);

	// ---------------- design ----------------
	const result = $derived.by(() => {
		try {
			let specs: StageSpec[];
			if (mode === 'filter') {
				if (band === 'bandpass' && !(f2 > f1))
					throw new Error('The upper band edge must be above the lower edge.');
				const zpk = designAnalog({
					family,
					band,
					order: N,
					f1: band === 'bandpass' ? f1 : fc,
					f2,
					rp,
					besselNorm: 'mag'
				});
				specs = stageSpecs(zpk, band);
			} else {
				specs = [{ band: sBand, order: 2, w0: TWO_PI * f0, q }];
			}
			if (!(baseC > 0)) throw new Error('The base capacitor must be positive.');
			const stages = specs.map((s) =>
				designStage(s, { topology, gain, baseC, rSeries, cSeries, optimize })
			);
			for (const s of stages)
				for (const p of s.parts)
					if (Number.isNaN(p.exact) || p.exact <= 0)
						throw new Error(`Could not compute ${p.role} — check the inputs.`);
			return { stages, error: null };
		} catch (e) {
			return { stages: [] as StageDesign[], error: (e as Error).message };
		}
	});
	const stages = $derived(result.stages);

	const targetZpk = $derived(cascadeZpk(stages.map((s) => s.target)));
	const builtZpk = $derived(cascadeZpk(stages.map((s) => s.realized)));
	const target = $derived({ kind: 'analog' as const, zpk: targetZpk });
	const built = $derived({ kind: 'analog' as const, zpk: builtZpk });

	/** Reference frequency for stats and the Monte-Carlo view. */
	const fRef = $derived(mode === 'stage' ? f0 : band === 'bandpass' ? Math.sqrt(f1 * f2) : fc);

	// global designators: R1…, C1…, U1… numbered through the cascade
	const designators = $derived.by(() => {
		let r = 0;
		let cc = 0;
		return stages.map((st, i) => {
			const map: Record<string, string> = {};
			for (const p of [...st.parts].sort((a, b) =>
				a.role.localeCompare(b.role, 'en', { numeric: true })
			)) {
				if (p.kind === 'R') {
					if (Number.isFinite(p.exact)) map[p.role] = `R${++r}`;
					else map[p.role] = '—';
				} else map[p.role] = `C${++cc}`;
			}
			return { parts: map, opamp: `U${i + 1}` };
		});
	});

	const fmtV = (kind: 'R' | 'C', v: number, d = 3) =>
		Number.isFinite(v) ? formatSI(v, kind === 'R' ? 'Ω' : 'F', d) : 'open';
	const pctErr = (a: number, b: number) => (a / b - 1) * 100;
	const dbFmt = (v: number) => trimNumber(Math.abs(v) < 5e-4 ? 0 : v, 3);
	const pct = (v: number) => `${v >= 0 ? '+' : '−'}${trimNumber(Math.abs(v), 2)} %`;
	const bandName: Record<StageBand, string> = {
		lowpass: 'low-pass',
		highpass: 'high-pass',
		bandpass: 'band-pass'
	};
	function stageTitle(st: StageDesign): string {
		const b = bandName[st.spec.band];
		switch (st.topology) {
			case 'rc1':
				return `Buffered RC ${b} (first order)`;
			case 'sk-unity':
				return `Sallen–Key ${b}, unity gain`;
			case 'sk-equal':
				return `Sallen–Key ${b}, equal components`;
			case 'mfb':
				return `MFB ${b} (inverting)`;
			case 'mfb-bp':
				return 'MFB band-pass (inverting)';
		}
	}

	const drawings = $derived(
		stages.map((st, i) => {
			const labels: Record<string, PartLabel> = {};
			for (const p of st.parts)
				labels[p.role] = {
					name: designators[i].parts[p.role],
					value: fmtV(p.kind, p.value),
					open: !Number.isFinite(p.value)
				};
			const vin = i === 0 ? 'v_in' : `v_${i}`;
			const vout = i === stages.length - 1 ? 'v_out' : `v_${i + 1}`;
			return stageDrawing(st.topology, st.spec.band, labels, vin, vout, designators[i].opamp);
		})
	);

	// ---------------- stats ----------------
	const stats = $derived.by((): Stat[] => {
		if (!stages.length) return [];
		const out: Stat[] = [];
		const nOrder = stages.reduce((s, st) => s + st.spec.order, 0);
		out.push({ label: 'Order / op-amps', value: `${nOrder} / ${stages.length}` });
		const grid = logspace(fRef / 1000, fRef * 1000, 1200);
		const rt = evaluate(target, grid);
		const rb = evaluate(built, grid);
		const sign = stages.reduce((s, st) => s * Math.sign(st.realizedParams.gain || 1), 1);
		const passDb = (r: typeof rt) => {
			if (effBand === 'lowpass') return r.magDb[0];
			if (effBand === 'highpass') return r.magDb[r.magDb.length - 1];
			return evaluate(r === rt ? target : built, [fRef]).magDb[0];
		};
		const gT = passDb(rt);
		const gB = passDb(rb);
		out.push({
			label: effBand === 'bandpass' ? 'Gain at centre (built)' : 'Passband gain (built)',
			value: `${dbFmt(gB)} dB${sign < 0 ? ', inverting' : ''}`,
			hint: `Target ${dbFmt(gT)} dB`
		});
		if (effBand !== 'bandpass') {
			const cross = (r: typeof rt, g: number) => {
				const rel = r.magDb.map((v) => v - g);
				if (effBand === 'lowpass') return findCrossing(r.f, rel, -3.0103);
				return findCrossing([...r.f].reverse(), [...rel].reverse(), -3.0103);
			};
			const cT = cross(rt, gT);
			const cB = cross(rb, gB);
			if (cT && cB)
				out.push({
					label: '−3 dB frequency (built)',
					value: formatSI(cB, 'Hz', 4),
					hint: `Target ${formatSI(cT, 'Hz', 4)} (${pct(pctErr(cB, cT))})`
				});
		}
		const fe = Math.max(...stages.map((st) => Math.abs(pctErr(st.realizedParams.w0, st.spec.w0))));
		const second = stages.filter((st) => st.spec.order === 2);
		const qe = second.length
			? Math.max(...second.map((st) => Math.abs(pctErr(st.realizedParams.q, st.spec.q))))
			: 0;
		out.push({
			label: 'Worst f₀ error',
			value: `${trimNumber(fe, 2)} %`,
			status: fe < 1 ? 'good' : 'warning',
			hint: 'Largest stage natural-frequency error caused by standard values (✓ < 1 %)'
		});
		if (second.length)
			out.push({
				label: 'Worst Q error',
				value: `${trimNumber(qe, 2)} %`,
				status: qe < 1 ? 'good' : 'warning',
				hint: 'Largest stage Q error caused by standard values (✓ < 1 %)'
			});
		out.push({
			label: 'Highest stage Q',
			value: trimNumber(Math.max(...stages.map((st) => st.spec.q)), 4)
		});
		out.push({
			label: 'Op-amp GBW ≥',
			value: formatSI(Math.max(...stages.map((st) => st.gbw)), 'Hz', 3),
			hint: 'Largest per-stage rule-of-thumb requirement (see the stage table)'
		});
		if (mcData)
			out.push({
				label: `Spread at ${formatSI(fRef, 'Hz', 3)} (±${tol * 100} %)`,
				value: `${trimNumber(mcData.spread, 3)} dB`,
				hint: 'Max − min gain over the Monte-Carlo runs'
			});
		return out;
	});

	const vlines = $derived(
		mode === 'stage'
			? [{ value: f0, label: 'f₀' }]
			: band === 'bandpass'
				? [
						{ value: f1, label: 'f₁' },
						{ value: f2, label: 'f₂' }
					]
				: [{ value: fc, label: 'fc' }]
	);

	// ---------------- Monte-Carlo ----------------
	const mcData = $derived.by(() => {
		if (!mc || !stages.length) return null;
		const lo = fRef / (effBand === 'bandpass' ? Math.max(4, (f2 / f1) * 2) : 8);
		const hi = fRef * (effBand === 'bandpass' ? Math.max(4, (f2 / f1) * 2) : 8);
		const grid = logspace(lo, hi, 200);
		const runs = monteCarlo(stages, tol, grid, 40);
		const nominal = evaluate(built, grid).magDb;
		const tgt = evaluate(target, grid).magDb;
		const xs: number[] = [];
		const ys: number[] = [];
		for (const r of runs) {
			xs.push(...grid, NaN);
			ys.push(...r, NaN);
		}
		// same seed, so the same 40 builds as the curves, evaluated exactly at fRef
		const atRef = monteCarlo(stages, tol, [fRef], 40).map((r) => r[0]);
		let top = -Infinity;
		for (const r of runs) for (const v of r) if (Number.isFinite(v)) top = Math.max(top, v);
		top = Math.ceil(top + 1);
		const fmt = (v: number) => `${trimNumber(v, 4)} dB`;
		const series: Series[] = [
			{ x: xs, y: ys, color: 'var(--s3)', width: 1, opacity: 0.32, hidden: true },
			{ x: grid, y: tgt, label: 'Target', color: 'var(--s1)', dash: '6 4', format: fmt },
			{ x: grid, y: nominal, label: 'Built, nominal values', color: 'var(--s2)', format: fmt },
			{ x: [], y: [], label: `40 random builds (±${tol * 100} %)`, color: 'var(--s3)' }
		];
		return {
			series,
			domain: [lo, hi] as [number, number],
			yDomain: [top - 30, top] as [number, number],
			spread: Math.max(...atRef) - Math.min(...atRef)
		};
	});

	// ---------------- BOM ----------------
	const bom = $derived.by(() => {
		const rows: {
			ref: string;
			type: string;
			value: string;
			si: string;
			ideal: string;
			stage: number;
			fn: string;
		}[] = [];
		stages.forEach((st, i) => {
			for (const p of st.parts) {
				if (!Number.isFinite(p.value)) continue;
				rows.push({
					ref: designators[i].parts[p.role],
					type: p.kind === 'R' ? 'Resistor' : 'Capacitor',
					value: fmtV(p.kind, p.value),
					si: String(Number(p.value.toPrecision(6))),
					ideal: fmtV(p.kind, p.exact, 4),
					stage: i + 1,
					fn: p.desc
				});
			}
			rows.push({
				ref: designators[i].opamp,
				type: 'Op-amp',
				value: `GBW ≥ ${formatSI(st.gbw, 'Hz', 2)}`,
				si: String(Math.round(st.gbw)),
				ideal: '',
				stage: i + 1,
				fn: TOPOLOGY_NAMES[st.topology]
			});
		});
		const order = (r: (typeof rows)[number]) => ({ R: 0, C: 1, U: 2 })[r.ref[0] as 'R'] ?? 3;
		rows.sort((a, b) => order(a) - order(b) || Number(a.ref.slice(1)) - Number(b.ref.slice(1)));
		const csvEsc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
		const csv = [
			'Designator,Type,Value,Value (SI),Ideal value,Stage,Function',
			...rows.map((r) =>
				[r.ref, r.type, r.value, r.si, r.ideal, r.stage, r.fn]
					.map((v) => csvEsc(String(v)))
					.join(',')
			)
		].join('\n');
		return { rows, csv };
	});

	// ---------------- options ----------------
	const familyOptions = FAMILIES.map((f) => ({
		value: f.id,
		label: f.name,
		disabled: !ALLOWED.includes(f.id)
	}));
	const topologyOptions = [
		{ value: 'sk-unity' as Topology, label: 'Sallen–Key, unity gain' },
		{ value: 'sk-equal' as Topology, label: 'Sallen–Key, equal components (K = 3 − 1/Q)' },
		{ value: 'mfb' as Topology, label: 'Multiple feedback (MFB, inverting)' }
	];
	const seriesOptions = (['E6', 'E12', 'E24', 'E48', 'E96', 'exact'] as ESeries[]).map((s) => ({
		value: s,
		label: s === 'exact' ? 'Exact (no rounding)' : s
	}));
	const bandOptions = [
		{ value: 'lowpass' as StageBand, label: 'LP' },
		{ value: 'highpass' as StageBand, label: 'HP' },
		{ value: 'bandpass' as StageBand, label: 'BP' }
	];
	const tolOptions = [0.01, 0.02, 0.05, 0.1].map((t) => ({ value: t, label: `±${t * 100} %` }));
	const info = $derived(familyInfo(family));
	const usesGain = $derived(effBand === 'bandpass' || topology === 'mfb');
</script>

<ToolLayout
	slug="active-filters"
	share={shared}
	related={['analog-designer', 'family-compare', 'rlc', 'lc-ladder', 'bode']}
>
	{#snippet controls()}
		<ControlGroup title="Design">
			<Segmented
				bind:value={mode}
				options={[
					{ value: 'filter', label: 'Full filter' },
					{ value: 'stage', label: 'Single stage' }
				]}
			/>
		</ControlGroup>

		{#if mode === 'filter'}
			<ControlGroup title="Filter">
				<Select
					label="Family"
					bind:value={family}
					options={familyOptions}
					help="Chebyshev II and elliptic need notch stages and are not offered."
				/>
				<Segmented label="Response" bind:value={band} options={bandOptions} />
				<Slider
					label={band === 'bandpass' ? 'Prototype order N (2N poles)' : 'Order N'}
					bind:value={() => N, (v) => (order = v)}
					min={1}
					max={maxOrder}
					integer
					help={order > maxOrder
						? `Band-pass is limited to N = ${maxOrder} (${2 * maxOrder} poles).`
						: undefined}
				/>
				{#if band === 'bandpass'}
					<Slider label="Lower edge f₁" bind:value={f1} min={1} max={100000} log unit="Hz" />
					<Slider label="Upper edge f₂" bind:value={f2} min={1} max={100000} log unit="Hz" />
				{:else}
					<Slider label="Cutoff fc" bind:value={fc} min={1} max={100000} log unit="Hz" />
				{/if}
				{#if info.usesRp}
					<Slider label="Passband ripple Rp" bind:value={rp} min={0.01} max={3} log unit="dB" />
				{/if}
				<p class="small muted note">
					{family === 'bessel'
						? 'Bessel is normalised for −3 dB at the cutoff.'
						: `Cutoff = ${info.cutoffMeaning}.`}
				</p>
			</ControlGroup>
		{:else}
			<ControlGroup title="Stage">
				<Segmented label="Response" bind:value={sBand} options={bandOptions} />
				<Slider label="Natural frequency f₀" bind:value={f0} min={1} max={100000} log unit="Hz" />
				<Slider label="Quality factor Q" bind:value={q} min={0.3} max={30} log />
			</ControlGroup>
		{/if}

		<ControlGroup title="Circuit">
			{#if effBand === 'bandpass'}
				<p class="small muted note">
					Band-pass stages use the multiple-feedback band-pass circuit (inverting, with R3 to set f₀
					independently of the gain).
				</p>
			{:else}
				<Select
					label="Topology (second-order stages)"
					bind:value={topology}
					options={topologyOptions}
				/>
			{/if}
			{#if usesGain}
				<Slider
					label={effBand === 'bandpass' ? 'Centre gain per stage |H₀|' : 'Gain per stage |G|'}
					bind:value={gain}
					min={0.1}
					max={10}
					log
				/>
			{/if}
			{#if mode === 'filter' && effBand !== 'bandpass' && N % 2 === 1}
				<p class="small muted note">Odd order: the real pole is built as a buffered RC section.</p>
			{/if}
		</ControlGroup>

		<ControlGroup title="Components">
			<NumberInput
				label="Base capacitor"
				bind:value={baseC}
				unit="F"
				si
				min={1e-12}
				max={1e-3}
				logStep={1.2}
				help="Capacitors come in fewer values, so they are chosen first; resistors are computed."
			/>
			<Select label="Resistor series" bind:value={rSeries} options={seriesOptions} />
			<Select label="Capacitor series" bind:value={cSeries} options={seriesOptions} />
			<Toggle
				bind:checked={optimize}
				label="Optimise standard values"
				help="Tries neighbouring capacitor (or gain-resistor) values and rounding each resistor up or down; keeps the most accurate combination."
			/>
		</ControlGroup>

		<ControlGroup title="Tolerance analysis">
			<Toggle
				bind:checked={mc}
				label="Monte-Carlo (40 runs)"
				help="Every R and C scattered uniformly within the tolerance; fixed seed."
			/>
			{#if mc}
				<Segmented size="small" bind:value={tol} options={tolOptions} />
			{/if}
		</ControlGroup>
	{/snippet}

	{#if result.error}
		<Callout kind="danger">{result.error}</Callout>
	{/if}

	<StatGrid {stats} />

	{#if stages.length}
		<ResponseView
			filters={[
				{ filter: target, label: 'Target (ideal)' },
				{
					filter: built,
					label: `Built (${rSeries === 'exact' ? 'exact' : rSeries} R, ${cSeries === 'exact' ? 'exact' : cSeries} C)`
				}
			]}
			{vlines}
			views={['phase', 'step']}
		/>
	{/if}

	{#if mcData}
		<Card
			title="Tolerance analysis"
			subtitle="Each thin line is one possible build with every R and C off by up to ±{tol *
				100} % — the spread shows which stages are fragile."
		>
			<Plot
				series={mcData.series}
				xScale="log"
				xDomain={mcData.domain}
				yDomain={mcData.yDomain}
				xLabel="Frequency (Hz)"
				yLabel="Magnitude (dB)"
				xFormat={freqFormat}
				xTooltipFormat={(v) => formatSI(v, 'Hz', 4)}
				{vlines}
				height={300}
				exportName="monte-carlo"
			/>
		</Card>
	{/if}

	{#if stages.length}
		<Card
			title="Stages"
			subtitle="Cascade order: increasing Q. f₀ and Q are recomputed from the standard values actually used."
		>
			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th>#</th>
							<th>Type</th>
							<th>Circuit</th>
							<th class="num">f₀ target</th>
							<th class="num">f₀ built</th>
							<th class="num">Q target</th>
							<th class="num">Q built</th>
							<th class="num">Gain</th>
							<th class="num">GBW ≥</th>
						</tr>
					</thead>
					<tbody>
						{#each stages as st, i (i)}
							<tr>
								<td>{i + 1}</td>
								<td>{st.spec.order === 1 ? '1st-order ' : ''}{bandName[st.spec.band]}</td>
								<td>{TOPOLOGY_NAMES[st.topology]}</td>
								<td class="num">{formatSI(st.spec.w0 / TWO_PI, 'Hz', 4)}</td>
								<td class="num"
									>{formatSI(st.realizedParams.w0 / TWO_PI, 'Hz', 4)}
									<span class="err">({pct(pctErr(st.realizedParams.w0, st.spec.w0))})</span></td
								>
								<td class="num">{st.spec.order === 2 ? trimNumber(st.spec.q, 4) : '—'}</td>
								<td class="num"
									>{#if st.spec.order === 2}{trimNumber(st.realizedParams.q, 4)}
										<span class="err">({pct(pctErr(st.realizedParams.q, st.spec.q))})</span
										>{:else}—{/if}</td
								>
								<td class="num">{trimNumber(st.realizedParams.gain, 4)}</td>
								<td class="num" title="Rule: GBW ≥ {st.gbwRule}">{formatSI(st.gbw, 'Hz', 2)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="small muted">
				GBW rules of thumb (≈ 40 dB of loop gain at f₀): Sallen–Key 100·K·Q·f₀ (K = 1 for unity
				gain), MFB 100·(1+|G|)·Q·f₀, MFB band-pass 100·(1+2Q²)·f₀ (its noise gain at f₀ is 1 + 2Q²),
				buffered RC 100·f₀. Hover a value for its rule.
			</p>
		</Card>

		{#each stages as st, i (i)}
			<Card
				title="Stage {i + 1} · {stageTitle(st)}"
				subtitle="f₀ = {formatSI(st.spec.w0 / TWO_PI, 'Hz', 4)}{st.spec.order === 2
					? `, Q = ${trimNumber(st.spec.q, 4)}`
					: ''}, gain {trimNumber(st.gain, 4)}"
			>
				<div class="stage">
					<div class="stage-schem">
						<Schematic
							items={drawings[i].items}
							width={drawings[i].width}
							height={drawings[i].height}
							title="Stage {i + 1} schematic"
						/>
					</div>
					<div class="stage-parts">
						<div class="table-wrap">
							<table class="parts">
								<thead
									><tr
										><th>Part</th><th class="num">Value</th><th class="num">Ideal</th><th
											>Function</th
										></tr
									></thead
								>
								<tbody>
									{#each st.parts as p (p.role)}
										<tr>
											<td>{designators[i].parts[p.role]}</td>
											<td class="num">{fmtV(p.kind, p.value)}</td>
											<td class="num muted">{fmtV(p.kind, p.exact, 4)}</td>
											<td class="small">{p.desc}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
						<p class="small built">
							Built: f₀ {formatSI(st.realizedParams.w0 / TWO_PI, 'Hz', 4)} ({pct(
								pctErr(st.realizedParams.w0, st.spec.w0)
							)}){#if st.spec.order === 2}, Q {trimNumber(st.realizedParams.q, 4)} ({pct(
									pctErr(st.realizedParams.q, st.spec.q)
								)}){/if}, gain {trimNumber(st.realizedParams.gain, 4)}.
							{designators[i].opamp}: GBW ≥ {formatSI(st.gbw, 'Hz', 2)} ({st.gbwRule}).
						</p>
						{#each st.noteTemplates as n (n)}
							<Callout kind="warning">{fillNote(n, designators[i].parts)}</Callout>
						{/each}
					</div>
				</div>
			</Card>
		{/each}

		<Card
			title="Bill of materials"
			subtitle="Standard values per the selected E-series. Download as CSV for your parts list."
		>
			<div class="table-wrap">
				<table>
					<thead
						><tr
							><th>Ref</th><th>Type</th><th class="num">Value</th><th class="num">Ideal</th><th
								class="num">Stage</th
							><th>Function</th></tr
						></thead
					>
					<tbody>
						{#each bom.rows as r (r.ref + r.stage)}
							<tr
								><td>{r.ref}</td><td>{r.type}</td><td class="num">{r.value}</td><td
									class="num muted">{r.ideal}</td
								><td class="num">{r.stage}</td><td class="small">{r.fn}</td></tr
							>
						{/each}
					</tbody>
				</table>
			</div>
			<div class="csv">
				<CodeBlock
					code={bom.csv}
					language="csv"
					filename="active-filter-bom.csv"
					maxHeight="12rem"
				/>
			</div>
		</Card>
	{/if}

	{#snippet theory()}
		<h2>From transfer function to op-amp stages</h2>
		<p>
			An N-th order all-pole filter factors into ⌊N/2⌋ second-order sections plus, for odd N, one
			first-order section. Each second-order section is a pole pair with natural frequency ω₀ and
			quality factor Q, and is built with one op-amp:
		</p>
		<Tex
			display
			math={'H_{LP}(s) = \\frac{G\\,\\omega_0^2}{s^2 + \\frac{\\omega_0}{Q}s + \\omega_0^2}\\qquad H_{HP}(s) = \\frac{G\\,s^2}{s^2 + \\frac{\\omega_0}{Q}s + \\omega_0^2}\\qquad H_{BP}(s) = \\frac{G\\,\\frac{\\omega_0}{Q}s}{s^2 + \\frac{\\omega_0}{Q}s + \\omega_0^2}'}
		/>
		<p>
			Names below follow the stage-1 schematic (later stages continue the numbering). The
			first-order section is an RC divider followed by a voltage follower so the next stage does not
			load it.
		</p>

		<h3>Sallen–Key</h3>
		<p>
			A non-inverting amplifier of gain K = 1 + R4/R3 (K = 1 for the follower) with positive
			feedback through C1 (R1 for HP):
		</p>
		<Tex
			display
			math={'H_{LP}(s)=\\frac{K/(R_1R_2C_1C_2)}{s^2+s\\left(\\frac{1}{R_1C_1}+\\frac{1}{R_2C_1}+\\frac{1-K}{R_2C_2}\\right)+\\frac{1}{R_1R_2C_1C_2}}'}
		/>
		<Tex
			display
			math={'H_{HP}(s)=\\frac{K\\,s^2}{s^2+s\\left(\\frac{1}{R_2C_2}+\\frac{1}{R_2C_1}+\\frac{1-K}{R_1C_1}\\right)+\\frac{1}{R_1R_2C_1C_2}}'}
		/>
		<p>
			<strong>Unity-gain LP</strong>: pick C2, then C1 ≥ 4Q²C2 (the next standard value up), and
			solve the quadratic for the resistors:
		</p>
		<Tex
			display
			math={'R_{1,2} = \\frac{1}{2\\omega_0 Q C_2}\\left(1 \\mp \\sqrt{1 - \\frac{4Q^2 C_2}{C_1}}\\right)'}
		/>
		<p>
			<strong>Unity-gain HP</strong> with C1 = C2 = C: <Tex
				math={'R_1 = \\frac{1}{2Q\\omega_0 C},\\; R_2 = \\frac{2Q}{\\omega_0 C}'}
			/>.
		</p>
		<p>
			<strong>Equal components</strong> (R1 = R2 = R, C1 = C2 = C, LP or HP): <Tex
				math={'\\omega_0 = \\frac{1}{RC}'}
			/> and
			<Tex math={'Q = \\frac{1}{3-K}'} />, so <Tex math={'K = 3 - \\frac1Q'} />. Elegant, but the
			sensitivity of Q to the gain is
		</p>
		<Tex display math={'S^Q_K = \\frac{K}{Q}\\frac{\\partial Q}{\\partial K} = KQ = 3Q - 1'} />
		<p>
			— at Q = 10 a 1 % error in the gain K moves Q by about 29 %, and K → 3 makes the stage
			oscillate. K = 1 + R4/R3 comes from a resistor ratio, whose sensitivity is <Tex
				math={'S^Q_{R_4/R_3} = (K-1)Q = 2Q - 1'}
			/>: a 1 % error in R4/R3 still moves Q by about 19 % at Q = 10. In a unity-gain Sallen–Key
			every passive Q sensitivity is at most ½ in magnitude, and in an MFB stage at most 1; ω₀
			sensitivities are ½ or less everywhere. That is why those two are preferred for high Q.
		</p>

		<h3>Multiple feedback (MFB)</h3>
		<p>
			The op-amp works as an inverting integrator with two feedback paths; the non-inverting input
			is grounded:
		</p>
		<Tex
			display
			math={'H_{LP}(s)=\\frac{-1/(R_1R_3C_1C_2)}{s^2+\\frac{s}{C_1}\\left(\\frac{1}{R_1}+\\frac{1}{R_2}+\\frac{1}{R_3}\\right)+\\frac{1}{R_2R_3C_1C_2}},\\qquad H(0) = -\\frac{R_2}{R_1}'}
		/>
		<p>With gain G = R2/R1: choose C2, then <Tex math={'C_1 \\ge 4Q^2(1+G)\\,C_2'} /> and</p>
		<Tex
			display
			math={'R_2 = \\frac{1}{2\\omega_0QC_2}\\left(1-\\sqrt{1-\\frac{4Q^2(1+G)C_2}{C_1}}\\right),\\quad R_1 = \\frac{R_2}{G},\\quad R_3 = \\frac{1}{\\omega_0^2C_1C_2R_2}'}
		/>
		<p>The high-pass swaps the roles of R and C (gain −C1/C2):</p>
		<Tex
			display
			math={'H_{HP}(s)=\\frac{-(C_1/C_2)\\,s^2}{s^2+s\\frac{C_1+C_2+C_3}{R_2C_2C_3}+\\frac{1}{R_1R_2C_2C_3}}'}
		/>
		<Tex
			display
			math={'C_1=C_3=C,\\quad C_2=\\frac{C}{G},\\quad R_2=\\frac{Q(2G+1)}{\\omega_0C},\\quad R_1=\\frac{G}{\\omega_0CQ(2G+1)}'}
		/>
		<p>
			The band-pass has one capacitor in each feedback path and an optional shunt R3 that sets f₀
			independently of the gain:
		</p>
		<Tex
			display
			math={'H_{BP}(s)=\\frac{-s/(R_1C_2)}{s^2+s\\frac{C_1+C_2}{R_2C_1C_2}+\\frac{1/R_1+1/R_3}{R_2C_1C_2}}'}
		/>
		<Tex
			display
			math={'C_1=C_2=C:\\quad R_2=\\frac{2Q}{\\omega_0C},\\quad R_1=\\frac{Q}{|H_0|\\,\\omega_0C},\\quad R_3=\\frac{Q}{(2Q^2-|H_0|)\\,\\omega_0C}'}
		/>
		<p>
			The band-pass centre gain can be at most 2Q² (then R3 is left out). Every formula above is
			checked in this site's unit tests against a numerical nodal analysis of the circuit. With <em
				>Optimise standard values</em
			> on, the designer also tries neighbouring values for the capacitor that the equations leave free
			(or for R3 of the equal-component Sallen–Key) and rounds each resistor up or down, keeping the combination
			whose f₀ and Q land closest to the target.
		</p>

		<h3>Ordering, gain and op-amp limits</h3>
		<ul>
			<li>
				<strong>Order stages by increasing Q.</strong> A high-Q stage peaks by roughly Q near f₀; putting
				it last means the earlier, gentler stages have already removed out-of-band energy, so it is less
				likely to clip.
			</li>
			<li>
				<strong>Gain distribution.</strong> Gain early improves noise (later stages' noise is divided
				by it), but internal peaking and the output swing set an upper bound — leave headroom of about
				Q in the high-Q stages.
			</li>
			<li>
				<strong>Finite gain–bandwidth</strong> shifts f₀ down and inflates Q (Q enhancement),
				especially in Sallen–Key stages. Keep the op-amp's loop gain at f₀ around 40 dB: the GBW
				rules in the stage table do that. Also check slew rate (≥ 2π·f·V<sub>peak</sub>) and, for
				MFB, that the op-amp is stable at the stage's noise gain.
			</li>
			<li>
				<strong>Impedance level.</strong> Resistors between ~1 kΩ and ~100 kΩ keep op-amp loading, noise
				and bias-current errors small; change the base capacitor to move them into that window.
			</li>
		</ul>

		<Callout kind="try">
			<ul>
				<li>
					Design a 6th-order Chebyshev (1 dB) low-pass and switch between unity-gain and
					equal-component Sallen–Key: watch the Monte-Carlo spread explode for the high-Q stage.
				</li>
				<li>
					Set the capacitor series to E6 and the resistor series to E96: the resistors absorb the
					coarse capacitor values, so the f₀ and Q errors stay tiny.
				</li>
				<li>
					Use <em>Single stage</em>, set Q = 10 and compare the GBW requirement of MFB and
					Sallen–Key.
				</li>
				<li>
					Make a wide band-pass (f₁ = 200 Hz, f₂ = 5 kHz) and raise the centre gain: its low-Q
					stages hit the 2Q² limit almost at once (their shunt resistor R3 is left out). Then narrow
					the band to 900 Hz – 1.1 kHz: the stage Q rises and the limit moves far out of reach.
				</li>
				<li>
					Shrink the base capacitor to 100 pF and see the resistor values (and warnings) climb.
				</li>
			</ul>
		</Callout>
	{/snippet}
</ToolLayout>

<style>
	.note {
		margin: 0;
	}
	.table-wrap {
		overflow-x: auto;
	}
	.err {
		color: var(--muted);
		font-size: 0.85em;
	}
	.stage {
		display: grid;
		grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
		gap: 1rem 1.4rem;
		align-items: start;
	}
	.stage-schem,
	.stage-parts {
		min-width: 0;
	}
	.parts td,
	.parts th {
		padding: 0.3em 0.5em;
	}
	.built {
		margin: 0.6rem 0 0;
	}
	.csv {
		margin-top: 0.8rem;
	}
	@media (max-width: 1250px) {
		.stage {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
