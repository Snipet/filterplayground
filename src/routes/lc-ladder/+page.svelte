<script lang="ts">
	import { onMount } from 'svelte';
	import ToolLayout from '$lib/components/layout/ToolLayout.svelte';
	import ControlGroup from '$lib/components/layout/ControlGroup.svelte';
	import Card from '$lib/components/layout/Card.svelte';
	import Select from '$lib/components/controls/Select.svelte';
	import Segmented from '$lib/components/controls/Segmented.svelte';
	import Slider from '$lib/components/controls/Slider.svelte';
	import NumberInput from '$lib/components/controls/NumberInput.svelte';
	import Plot, { type Series } from '$lib/components/plot/Plot.svelte';
	import { freqFormat } from '$lib/components/plot/scales';
	import StatGrid, { type Stat } from '$lib/components/content/StatGrid.svelte';
	import Callout from '$lib/components/content/Callout.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import CodeBlock from '$lib/components/content/CodeBlock.svelte';
	import { abs } from '$lib/dsp/complex';
	import { freqsZpk, linspace, logspace } from '$lib/dsp/response';
	import { formatSI, toESeries, trimNumber, type ESeries } from '$lib/dsp/units';
	import { readSharedState } from '$lib/share';
	import LadderSchematic from './LadderSchematic.svelte';
	import {
		LADDER_FAMILIES,
		ladderPrototype,
		scaleLadder,
		simulateLadder,
		spiceNetlist,
		synthesizeLadder,
		targetZpk,
		type Branch,
		type LadderBand,
		type LadderFamily,
		type LadderForm,
		type LadderNetwork
	} from '$lib/features/lc-ladder/ladder';

	let family = $state<LadderFamily>('cheby1');
	let order = $state(5);
	let rp = $state(0.1);
	let form = $state<LadderForm>('shunt');
	let band = $state<LadderBand>('lowpass');
	let f0 = $state(30e6);
	let bw = $state(6e6);
	let r0 = $state(50);
	let series = $state<ESeries>('E12');

	const shared = $derived({ family, order, rp, form, band, f0, bw, r0, series });
	onMount(() => {
		const st = readSharedState<typeof shared>();
		if (!st) return;
		if (st.family && LADDER_FAMILIES.some((f) => f.id === st.family)) family = st.family;
		if (typeof st.order === 'number') order = Math.min(12, Math.max(1, Math.round(st.order)));
		if (typeof st.rp === 'number' && st.rp > 0) rp = Math.min(6, st.rp);
		if (st.form === 'series' || st.form === 'shunt') form = st.form;
		if (st.band === 'lowpass' || st.band === 'highpass' || st.band === 'bandpass') band = st.band;
		if (typeof st.f0 === 'number' && st.f0 > 0) f0 = st.f0;
		if (typeof st.bw === 'number' && st.bw > 0) bw = st.bw;
		if (typeof st.r0 === 'number' && st.r0 > 0) r0 = st.r0;
		if (st.series && ['E6', 'E12', 'E24', 'E48', 'E96', 'exact'].includes(st.series)) series = st.series;
	});

	const famInfo = $derived(LADDER_FAMILIES.find((f) => f.id === family)!);
	const isBP = $derived(band === 'bandpass');

	// ---------------- synthesis (normalised, independent of frequency/impedance) ----------------
	const synth = $derived.by(() => {
		try {
			const proto = ladderPrototype(family, order, rp);
			return { proto, syn: synthesizeLadder(proto), error: null };
		} catch (e) {
			return { proto: null, syn: null, error: e instanceof Error ? e.message : String(e) };
		}
	});

	const bwSafe = $derived(Math.max(1e-6 * f0, Math.min(bw, 4 * f0)));
	const scaleOpts = $derived({ form, band, r0, f0, bw: bwSafe });
	const exact = $derived<LadderNetwork | null>(synth.syn ? scaleLadder(synth.syn, scaleOpts) : null);
	const rounded = $derived<LadderNetwork | null>(
		exact
			? {
					...exact,
					branches: exact.branches.map((b) => ({
						...b,
						L: b.L === undefined ? undefined : toESeries(b.L, series),
						C: b.C === undefined ? undefined : toESeries(b.C, series)
					}))
				}
			: null
	);
	const target = $derived(synth.proto ? targetZpk(synth.proto, scaleOpts) : null);

	// band edges of a band-pass (geometric centre f0, width bw)
	const edges = $derived.by(() => {
		if (!isBP) return null;
		const lo = -bwSafe / 2 + Math.sqrt((bwSafe * bwSafe) / 4 + f0 * f0);
		return [lo, lo + bwSafe] as [number, number];
	});

	// ---------------- responses ----------------
	const range = $derived.by((): [number, number] => {
		if (isBP) {
			const span = Math.max(4, (8 * bwSafe) / f0);
			return [f0 / Math.min(span, 30), f0 * Math.min(span, 30)];
		}
		return [f0 / 30, f0 * 30];
	});
	const fGrid = $derived(logspace(range[0], range[1], 700));
	const passGrid = $derived.by(() => {
		if (band === 'lowpass') return linspace(0, 1.25 * f0, 500).slice(1);
		if (band === 'highpass') return logspace(0.8 * f0, 6 * f0, 500);
		const [a, b] = edges!;
		return linspace(Math.max(a - 0.25 * bwSafe, a / 2), b + 0.25 * bwSafe, 500);
	});

	const toDb = (m: number) => 20 * Math.log10(Math.max(m, 1e-12));
	function curves(fs: number[]) {
		if (!exact || !rounded || !target) return null;
		const ideal = freqsZpk(
			target,
			fs.map((f) => 2 * Math.PI * f)
		).map((h) => toDb(abs(h)));
		const ex = simulateLadder(exact, fs);
		const ro = simulateLadder(rounded, fs);
		return {
			ideal,
			exact: ex.s21.map((h) => toDb(abs(h))),
			rounded: ro.s21.map((h) => toDb(abs(h))),
			rlExact: ex.s11.map((h) => -toDb(abs(h))),
			rlRounded: ro.s11.map((h) => -toDb(abs(h)))
		};
	}
	const main = $derived(curves(fGrid));
	const pass = $derived(curves(passGrid));

	const showRounded = $derived(series !== 'exact');
	const dbFmt = (v: number) => `${trimNumber(v, 4)} dB`;
	const hzTip = (v: number) => formatSI(v, 'Hz', 4);

	const s21Series = $derived.by((): Series[] => {
		if (!main) return [];
		const out: Series[] = [
			{ x: fGrid, y: main.ideal, label: 'Ideal design', color: 'var(--s1)', format: dbFmt },
			{ x: fGrid, y: main.exact, label: 'Simulated (exact)', color: 'var(--s2)', dash: '6 4', format: dbFmt }
		];
		if (showRounded) out.push({ x: fGrid, y: main.rounded, label: `Simulated (${series})`, color: 'var(--s3)', format: dbFmt });
		return out;
	});
	const passSeries = $derived.by((): Series[] => {
		if (!pass) return [];
		const out: Series[] = [
			{ x: passGrid, y: pass.ideal, label: 'Ideal design', color: 'var(--s1)', format: dbFmt },
			{ x: passGrid, y: pass.exact, label: 'Simulated (exact)', color: 'var(--s2)', dash: '6 4', format: dbFmt }
		];
		if (showRounded) out.push({ x: passGrid, y: pass.rounded, label: `Simulated (${series})`, color: 'var(--s3)', format: dbFmt });
		return out;
	});
	const rlSeries = $derived.by((): Series[] => {
		if (!pass) return [];
		const out: Series[] = [{ x: passGrid, y: pass.rlExact, label: 'Exact', color: 'var(--s2)', format: dbFmt }];
		if (showRounded) out.push({ x: passGrid, y: pass.rlRounded, label: series, color: 'var(--s3)', format: dbFmt });
		return out;
	});
	const passDomain = $derived<[number, number]>([-Math.max(4, Math.ceil(2 * rp + 1.5)), 1]);

	const vlines = $derived(
		isBP && edges
			? [
					{ value: edges[0], label: 'f₁' },
					{ value: edges[1], label: 'f₂' }
				]
			: [{ value: f0, label: 'fc' }]
	);

	// ---------------- stats ----------------
	const passMask = $derived.by(() => {
		if (!pass) return [] as boolean[];
		const thr = family === 'cheby1' ? -rp - 1e-6 : -1;
		return pass.ideal.map((v) => v >= thr);
	});
	function maxOver(mask: boolean[], vals: number[], fn: (v: number, i: number) => number) {
		let m = -Infinity;
		mask.forEach((ok, i) => {
			if (ok) m = Math.max(m, fn(vals[i], i));
		});
		return m;
	}
	const stats = $derived.by((): Stat[] => {
		if (!exact || !synth.syn || !pass) return [];
		const nL = exact.branches.reduce((s, b) => s + (b.L !== undefined ? 1 : 0), 0);
		const nC = exact.branches.reduce((s, b) => s + (b.C !== undefined ? 1 : 0), 0);
		const unequal = Math.abs(exact.rl / exact.rs - 1) > 1e-6;
		const out: Stat[] = [
			{ label: 'Elements', value: `${nL} L + ${nC} C`, hint: form === 'series' ? 'Series-L first (T / minimum-capacitor form)' : 'Shunt-C first (Π / minimum-inductor form)' },
			{
				label: 'Load resistance',
				value: formatSI(exact.rl, 'Ω', 4),
				status: unequal ? 'warning' : undefined,
				hint: unequal ? 'Even-order Chebyshev ladders need unequal terminations' : 'Equal terminations'
			}
		];
		if (showRounded) {
			const dev = maxOver(passMask, pass.rounded, (v, i) => Math.abs(v - pass.ideal[i]));
			out.push({ label: `Passband error (${series})`, value: `${trimNumber(dev, 3)} dB`, hint: `Largest |S21| deviation from the ideal design inside the passband (${family === 'cheby1' ? 'the ripple band' : 'where the ideal |S21| ≥ −1 dB'}), caused by rounding to preferred values` });
		}
		const rlWorst = -maxOver(passMask, showRounded ? pass.rlRounded : pass.rlExact, (v) => -v);
		out.push({ label: 'Worst return loss', value: Number.isFinite(rlWorst) ? `${trimNumber(rlWorst, 3)} dB` : '—', hint: `Smallest −20·log|S11| in the passband (${family === 'cheby1' ? 'the ripple band' : 'where the ideal |S21| ≥ −1 dB, so at most 6.9 dB'}); higher is a better match` });
		const spread = Math.max(...synth.syn.g) / Math.min(...synth.syn.g);
		out.push({ label: 'g-value spread', value: `${trimNumber(spread, 3)} : 1`, hint: 'Ratio of the largest to the smallest normalised element' });
		return out;
	});

	// ---------------- tables ----------------
	interface Row {
		br: Branch;
		kind: 'L' | 'C';
		exact: number;
		rounded: number;
	}
	const rows = $derived.by((): Row[] => {
		if (!exact || !rounded) return [];
		const out: Row[] = [];
		exact.branches.forEach((b, i) => {
			const r = rounded.branches[i];
			if (b.L !== undefined) out.push({ br: b, kind: 'L', exact: b.L, rounded: r.L! });
			if (b.C !== undefined) out.push({ br: b, kind: 'C', exact: b.C, rounded: r.C! });
		});
		return out;
	});
	const position = (b: Branch) =>
		b.pos === 'series'
			? b.L !== undefined && b.C !== undefined
				? 'series resonator'
				: 'series'
			: b.L !== undefined && b.C !== undefined
				? 'shunt resonator'
				: 'shunt';

	const netlist = $derived(
		exact && rounded
			? spiceNetlist(
					showRounded ? rounded : exact,
					`${ordinal(order)}-order ${famInfo.name}${family === 'cheby1' ? ` ${rp} dB` : ''} ${band} ladder, ${formatSI(r0, 'Ohm', 4)}, ${isBP ? `f0 = ${formatSI(f0, 'Hz', 4)}, BW = ${formatSI(bwSafe, 'Hz', 4)}` : `fc = ${formatSI(f0, 'Hz', 4)}`}${showRounded ? ` (${series} values)` : ''}`,
					range[0],
					range[1]
				)
			: ''
	);

	function ordinal(n: number): string {
		const t = n % 100;
		if (t >= 11 && t <= 13) return `${n}th`;
		return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
	}

	const familyOptions = LADDER_FAMILIES.map((f) => ({ value: f.id, label: f.name }));
	const R_PRESETS = [50, 75, 600, 8];
</script>

<ToolLayout slug="lc-ladder" share={shared} related={['analog-designer', 'family-compare', 'rlc', 'crossover', 'active-filters']}>
	{#snippet controls()}
		<ControlGroup title="Prototype">
			<Select label="Family" bind:value={family} options={familyOptions} />
			<Slider label="Order N" bind:value={order} min={1} max={12} integer />
			{#if family === 'cheby1'}
				<Slider label="Passband ripple Rp" bind:value={rp} min={0.01} max={3} log unit="dB" />
			{/if}
			<p class="small muted">Cutoff = {famInfo.cutoff}.</p>
		</ControlGroup>

		<ControlGroup title="Network">
			<Segmented
				label="First element"
				bind:value={form}
				options={[
					{ value: 'series', label: 'Series L (T)', title: 'Series inductor first — minimum-capacitor form' },
					{ value: 'shunt', label: 'Shunt C (Π)', title: 'Shunt capacitor first — minimum-inductor form' }
				]}
			/>
			<Segmented
				label="Response"
				bind:value={band}
				options={[
					{ value: 'lowpass', label: 'Low-pass' },
					{ value: 'highpass', label: 'High-pass' },
					{ value: 'bandpass', label: 'Band-pass' }
				]}
			/>
		</ControlGroup>

		<ControlGroup title="Scaling">
			<Slider label={isBP ? 'Centre f₀ (geometric)' : 'Cutoff fc'} bind:value={f0} min={10} max={3e9} log si unit="Hz" />
			{#if isBP}
				<Slider label="Bandwidth f₂ − f₁" bind:value={bw} min={f0 / 1000} max={2 * f0} log si unit="Hz" />
			{/if}
			<NumberInput label="Impedance level R₀ (source)" bind:value={r0} unit="Ω" min={0.01} max={1e6} logStep={1.1} si />
			<div class="presets" role="group" aria-label="Impedance presets">
				{#each R_PRESETS as r (r)}
					<button class="btn small" class:active={r0 === r} type="button" onclick={() => (r0 = r)}>{r} Ω</button>
				{/each}
			</div>
		</ControlGroup>

		<ControlGroup title="Components">
			<Select
				label="Round values to"
				bind:value={series}
				options={[
					{ value: 'exact', label: 'Exact values' },
					{ value: 'E6', label: 'E6 (±20 %)' },
					{ value: 'E12', label: 'E12 (±10 %)' },
					{ value: 'E24', label: 'E24 (±5 %)' },
					{ value: 'E48', label: 'E48 (±2 %)' },
					{ value: 'E96', label: 'E96 (±1 %)' }
				]}
			/>
		</ControlGroup>
	{/snippet}

	{#if synth.error}
		<Callout kind="danger" title="Synthesis failed">{synth.error}</Callout>
	{:else if exact && synth.syn}
		{#if Math.abs(exact.rl / exact.rs - 1) > 1e-6}
			<Callout kind="warning" title="Unequal terminations required">
				Even-order Chebyshev responses have |S21| &lt; 1 at DC, so a lossless ladder cannot match equal resistors there.
				This design needs R<sub>L</sub> = {formatSI(exact.rl, 'Ω', 4)} (g<sub>{order + 1}</sub> = {trimNumber(synth.syn.gLoad, 5)}).
				Use an odd order for equal terminations, or follow the ladder with an impedance transformer.
			</Callout>
		{/if}

		<StatGrid {stats} />

		<Card title="Schematic" subtitle={showRounded ? `Values rounded to the ${series} series.` : 'Exact values.'}>
			<div class="schem-wrap">
				<LadderSchematic branches={(showRounded ? rounded : exact)!.branches} rs={exact.rs} rl={exact.rl} />
			</div>
		</Card>

		<Card title="Simulated response" subtitle="ABCD (chain-matrix) simulation of the actual components between Rs and RL. Transducer gain |S21| = 2·√(Rs/RL)·|V_L/V_S| — equal to 2·V_L/V_S for equal terminations, so a matched passband reads 0 dB.">
			<Plot
				title="Transducer gain |S21|"
				series={s21Series}
				xScale="log"
				xFormat={freqFormat}
				xTooltipFormat={hzTip}
				xLabel="Frequency (Hz)"
				yLabel="|S21| (dB)"
				yDomain={[-80, 5]}
				{vlines}
				height={300}
				exportName="ladder-s21"
			/>
			<div class="grid2">
				<Plot
					title="Passband detail"
					series={passSeries}
					xScale={band === 'highpass' ? 'log' : 'linear'}
					xFormat={freqFormat}
					xTooltipFormat={hzTip}
					xLabel="Frequency (Hz)"
					yLabel="|S21| (dB)"
					yDomain={passDomain}
					{vlines}
					height={250}
					exportName="ladder-passband"
				/>
				<Plot
					title="Input return loss"
					series={rlSeries}
					xScale={band === 'highpass' ? 'log' : 'linear'}
					xFormat={freqFormat}
					xTooltipFormat={hzTip}
					xLabel="Frequency (Hz)"
					yLabel="−20·log|S11| (dB)"
					yDomain={[0, 60]}
					{vlines}
					height={250}
					exportName="ladder-return-loss"
				/>
			</div>
		</Card>

		<Card title="Element values" subtitle="Normalised g-values (source = 1 Ω, cutoff = 1 rad/s) and the scaled components.">
			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th>Part</th>
							<th>Position</th>
							<th class="num">g<sub>k</sub></th>
							<th class="num">Exact</th>
							{#if showRounded}
								<th class="num">{series}</th>
								<th class="num">Error</th>
							{/if}
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>R<sub>S</sub></td>
							<td>source</td>
							<td class="num">g<sub>0</sub> = 1</td>
							<td class="num">{formatSI(exact.rs, 'Ω', 4)}</td>
							{#if showRounded}<td class="num">—</td><td class="num">—</td>{/if}
						</tr>
						{#each rows as r (`${r.br.index}${r.kind}`)}
							<tr>
								<td class="mono">{r.kind}{r.br.index}</td>
								<td>{position(r.br)}</td>
								<td class="num">{trimNumber(r.br.g, 6)}</td>
								<td class="num">{formatSI(r.exact, r.kind === 'L' ? 'H' : 'F', 5)}</td>
								{#if showRounded}
									<td class="num">{formatSI(r.rounded, r.kind === 'L' ? 'H' : 'F', 3)}</td>
									<td class="num">{(r.rounded / r.exact - 1) * 100 >= 0 ? '+' : ''}{trimNumber((r.rounded / r.exact - 1) * 100, 2)} %</td>
								{/if}
							</tr>
						{/each}
						<tr>
							<td>R<sub>L</sub></td>
							<td>load</td>
							<td class="num">g<sub>{order + 1}</sub> = {trimNumber(synth.syn.gLoad, 6)}</td>
							<td class="num">{formatSI(exact.rl, 'Ω', 5)}</td>
							{#if showRounded}<td class="num">—</td><td class="num">—</td>{/if}
						</tr>
					</tbody>
				</table>
			</div>
			<p class="small muted note">
				The same g-values serve both forms: in the dual form every series L becomes a shunt C and vice versa, and
				g<sub>{order + 1}</sub> is a load resistance after a shunt C or a load conductance after a series L.
				{#if synth.syn.method === 'cauer+newton'}Values were polished by a Levenberg–Marquardt step after the continued fraction.{/if}
			</p>
		</Card>

		<Card title="SPICE netlist">
			<CodeBlock code={netlist} language="spice" filename="ladder.cir" maxHeight="16rem" />
		</Card>
	{/if}

	{#snippet theory()}
		<h2>Doubly-terminated ladders</h2>
		<p>
			A passive LC ladder sits between a source resistance R<sub>S</sub> and a load R<sub>L</sub>. Inductors and capacitors
			dissipate no power, so whatever the source makes available either reaches the load or is reflected back. That is
			the whole design principle: shape the reflection, and the transmission follows.
		</p>
		<Tex display math={'|S_{21}(j\\omega)|^2 = \\frac{P_\\text{load}}{P_\\text{avail}} = \\frac{4R_S}{R_L}\\left|\\frac{V_L}{V_S}\\right|^2,\\qquad |S_{11}|^2 + |S_{21}|^2 = 1 .'} />
		<p>
			With R<sub>L</sub> = R<sub>S</sub> the transducer gain is simply <Tex math={'2V_L/V_S'} />: 0 dB means maximum power
			transfer, which is why a matched ladder's passband peaks at exactly 0 dB rather than −6 dB.
		</p>

		<h3>g-values and scaling</h3>
		<p>
			Tables list the normalised element values g<sub>1</sub>…g<sub>N</sub> for a 1 Ω source and a 1 rad/s cutoff. Scaling
			to your impedance R₀ and cutoff ω<sub>c</sub> = 2πf<sub>c</sub>:
		</p>
		<Tex display math={'L_k = \\frac{g_k R_0}{\\omega_c},\\qquad C_k = \\frac{g_k}{R_0\\,\\omega_c},\\qquad R_L = g_{N+1}R_0 \\ \\text{(or } R_0/g_{N+1}\\text{)}.'} />
		<p>
			For Butterworth there is a closed form, <Tex math={'g_k = 2\\sin\\frac{(2k-1)\\pi}{2N}'} />, and Chebyshev has a short
			recursion — this page synthesises every family from its transfer function instead and checks itself against both. A
			low-pass → high-pass transformation <Tex math={'s \\to \\omega_c/s'} /> turns every series L into a series capacitor
			<Tex math={'1/(g_k R_0\\omega_c)'} /> and every shunt C into a shunt inductor <Tex math={'R_0/(g_k\\omega_c)'} />; the
			band-pass transformation <Tex math={'s \\to (s^2+\\omega_0^2)/(Bs)'} /> turns them into series and parallel LC resonators
			tuned to ω₀.
		</p>

		<h3>Duality: T or Π</h3>
		<p>
			Every ladder has a dual with the same transfer function: swap series inductors for shunt capacitors with the same g,
			and impedances for admittances. The series-L-first form (T for odd N) uses fewer capacitors; the shunt-C-first form
			(Π) uses fewer inductors, which is usually preferred because good inductors are bulkier and lossier than
			capacitors.
		</p>

		<h3>Why ladders are so insensitive (Orchard's argument)</h3>
		<p>
			At every frequency where |S<sub>21</sub>| = 1 the network already delivers all available power. Any change of any
			element — up or down — can only reduce the transmission, so the derivative of |S<sub>21</sub>| with respect to every
			element is zero there. With several such points spread over the passband, the passband barely moves when components
			drift. That is why passive ladders (and the active filters that simulate them) tolerate component errors far better
			than cascades of high-Q biquads — and, seen from the other side, why recovering element values from a response is a
			numerically delicate problem.
		</p>

		<h3>Darlington synthesis in a few lines</h3>
		<p>For an all-pole target <Tex math={'H(s)=k/D(s)'} /> scaled so that its peak is 1:</p>
		<ol>
			<li>Set <Tex math={'|S_{21}(j\\omega)|^2 = |H(j\\omega)|^2'} />, so <Tex math={'S_{11}(s)S_{11}(-s) = \\dfrac{D(s)D(-s) - k^2}{D(s)D(-s)}'} />.</li>
			<li>Factor the numerator and keep the left-half-plane (and half of the jω-axis) roots: <Tex math={'S_{11}(s) = \\pm N(s)/D(s)'} />.</li>
			<li>The input impedance is <Tex math={'Z_\\text{in}(s) = R_S\\dfrac{1+S_{11}}{1-S_{11}} = R_S\\dfrac{D \\pm N}{D \\mp N}'} />. The sign picks the T or Π form.</li>
			<li>
				Expand it as a continued fraction around s = ∞:
				<Tex math={'Z_\\text{in} = sL_1 + \\cfrac{1}{sC_2 + \\cfrac{1}{sL_3 + \\cdots}}'} />. What remains at the end is R<sub>L</sub>.
			</li>
		</ol>
		<p>
			Even-order Chebyshev filters have <Tex math={'|S_{21}(0)|^2 = 1/(1+\\varepsilon^2) < 1'} />, which forces
			<Tex math={'R_L \\ne R_S'} /> (the load the continued fraction leaves behind is <Tex math={'g_{N+1} = \\coth^2(\\beta/4)'} />).
			Continued fractions lose about two digits per element, so this page expands from both ends of the ladder and then
			refines the values until the ladder's own poles match the target to machine precision.
		</p>

		<Callout kind="try">
			<ul>
				<li>Switch the Chebyshev filter from N = 5 to N = 4 and watch the load resistance jump away from 50 Ω.</li>
				<li>Round to E6 and compare the passband error of a 0.1 dB Chebyshev with a Butterworth of the same order — then compare their return loss.</li>
				<li>Toggle T ↔ Π: the response is identical, but the parts list changes from mostly inductors to mostly capacitors.</li>
				<li>Pick Bessel at N = 7 and look at the g-value spread: the tapered ladder ends in a tiny element.</li>
				<li>Make a band-pass filter with a narrow bandwidth (BW = f₀/50): the resonator inductances explode and the capacitances shrink — narrow-band ladders are impractical without coupled resonators.</li>
			</ul>
		</Callout>
	{/snippet}
</ToolLayout>

<style>
	.presets {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	.presets .btn.active {
		background: var(--accent-wash);
		border-color: var(--accent);
		color: var(--accent-ink);
	}
	.schem-wrap {
		overflow-x: auto;
	}
	.grid2 {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr));
		gap: 1.1rem;
		margin-top: 1rem;
	}
	.table-wrap {
		overflow-x: auto;
		position: relative;
	}
	.note {
		margin: 0.6rem 0 0;
	}
</style>
