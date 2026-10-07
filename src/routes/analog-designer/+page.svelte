<script lang="ts">
	import ToolLayout from '$lib/components/layout/ToolLayout.svelte';
	import ControlGroup from '$lib/components/layout/ControlGroup.svelte';
	import Card from '$lib/components/layout/Card.svelte';
	import Select from '$lib/components/controls/Select.svelte';
	import Segmented from '$lib/components/controls/Segmented.svelte';
	import Slider from '$lib/components/controls/Slider.svelte';
	import NumberInput from '$lib/components/controls/NumberInput.svelte';
	import ResponseView from '$lib/components/plot/ResponseView.svelte';
	import StatGrid, { type Stat } from '$lib/components/content/StatGrid.svelte';
	import Callout from '$lib/components/content/Callout.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import ExportPanel from '$lib/components/content/ExportPanel.svelte';
	import { FAMILIES, familyInfo, type AnalogFamily, type BesselNorm } from '$lib/dsp/analog';
	import { designAnalog, estimateFromSpecs, type SpecEdges } from '$lib/dsp/design';
	import { analogStages, zpk2tfAnalog } from '$lib/dsp/convert';
	import { evaluate, logspace, findCrossing } from '$lib/dsp/response';
	import { analogTimeResponse } from '$lib/dsp/time';
	import { formatSI, trimNumber } from '$lib/dsp/units';
	import { format as fmtC } from '$lib/dsp/complex';
	import type { BandType } from '$lib/dsp/types';
	import { specRegions } from '$lib/specmask';

	let family = $state<AnalogFamily>('butter');
	let band = $state<BandType>('lowpass');
	let mode = $state<'order' | 'spec'>('order');
	let order = $state(4);
	let f1 = $state(1000);
	let f2 = $state(4000);
	let rp = $state(1);
	let rs = $state(40);
	let besselNorm = $state<BesselNorm>('mag');

	// specification edges, kept per band type
	let specs = $state<Record<BandType, { fp: [number, number]; fs: [number, number] }>>({
		lowpass: { fp: [1000, 1000], fs: [2000, 2000] },
		highpass: { fp: [2000, 2000], fs: [1000, 1000] },
		bandpass: { fp: [1000, 2000], fs: [700, 3000] },
		bandstop: { fp: [700, 3000], fs: [1000, 2000] }
	});

	const info = $derived(familyInfo(family));
	const isBand = $derived(band === 'bandpass' || band === 'bandstop');
	const spec = $derived(specs[band]);

	const specEdges = $derived<SpecEdges>({
		band,
		fp: isBand ? [spec.fp[0], spec.fp[1]] : spec.fp[0],
		fstop: isBand ? [spec.fs[0], spec.fs[1]] : spec.fs[0],
		rp,
		rs
	});

	const est = $derived(mode === 'spec' ? estimateFromSpecs(family, specEdges, { besselNorm }) : null);

	const N = $derived(est ? est.order : order);
	const c1 = $derived(est ? est.f1 : f1);
	const c2 = $derived(est ? (est.f2 ?? f2) : f2);

	const zpk = $derived(designAnalog({ family, band, order: N, f1: c1, f2: c2, rp, rs, besselNorm }));
	const filter = $derived({ kind: 'analog' as const, zpk });
	const stages = $derived(analogStages(zpk));

	const regions = $derived(mode === 'spec' ? specRegions(band, specEdges.fp, specEdges.fstop, rp, rs) : []);
	const vlines = $derived(
		mode === 'order'
			? isBand
				? [
						{ value: c1, label: 'f₁' },
						{ value: c2, label: 'f₂' }
					]
				: [{ value: c1, label: 'fc' }]
			: []
	);

	// ----- summary numbers -----
	const stats = $derived.by((): Stat[] => {
		const centre = isBand ? Math.sqrt(c1 * c2) : c1;
		const grid = logspace(centre / 1000, centre * 1000, 4000);
		const r = evaluate(filter, grid);
		const peak = Math.max(...r.magDb.filter(Number.isFinite));
		const rel = r.magDb.map((v) => v - peak);
		const out: Stat[] = [{ label: 'Order', value: String(N), hint: 'Number of poles of the low-pass prototype' }];
		if (band === 'lowpass') {
			const f3 = findCrossing(r.f, rel, -3.0103);
			out.push({ label: '−3 dB frequency', value: f3 ? formatSI(f3, 'Hz', 4) : '—' });
		} else if (band === 'highpass') {
			// first crossing coming down from high frequencies
			const revF = [...r.f].reverse();
			const revM = [...rel].reverse();
			const f3 = findCrossing(revF, revM, -3.0103);
			out.push({ label: '−3 dB frequency', value: f3 ? formatSI(f3, 'Hz', 4) : '—' });
		} else {
			out.push({ label: 'Centre (geometric)', value: formatSI(centre, 'Hz', 4) });
			out.push({ label: 'Bandwidth', value: formatSI(Math.abs(c2 - c1), 'Hz', 4) });
		}
		if (mode === 'spec' && est) {
			const edges = [specEdges.fstop].flat() as number[];
			const att = evaluate(filter, edges).magDb.map((v) => -(v - peak));
			const worst = Math.min(...att);
			out.push({
				label: 'Attenuation at stop edge',
				value: `${trimNumber(worst, 4)} dB`,
				status: worst >= rs - 1e-6 ? 'good' : 'warning'
			});
		}
		const step = analogTimeResponse(zpk, 'step', undefined, 800);
		const final = step.y[step.y.length - 1];
		if (band === 'lowpass' && Math.abs(final) > 1e-6) {
			const over = (Math.max(...step.y) / final - 1) * 100;
			out.push({ label: 'Step overshoot', value: `${trimNumber(Math.max(0, over), 3)} %` });
		}
		if (band === 'lowpass') {
			const gd0 = evaluate(filter, [c1 / 1000]).groupDelay[0];
			out.push({ label: 'Group delay (DC)', value: formatSI(gd0, 's', 4) });
		}
		const maxQ = Math.max(...stages.map((s) => s.q));
		out.push({ label: 'Highest stage Q', value: trimNumber(maxQ, 4), hint: 'High Q stages are the most sensitive to component tolerances' });
		return out;
	});

	function stageKind(st: (typeof stages)[number]): string {
		const nz = st.zeros.length;
		const atOrigin = st.zeros.filter((z) => Math.hypot(z.re, z.im) < 1e-9 * st.w0).length;
		const onAxis = st.zeros.filter((z) => Math.abs(z.re) < 1e-9 * st.w0 && Math.abs(z.im) > 0).length;
		if (nz === 0) return 'low-pass';
		if (atOrigin === st.order && nz === st.order) return 'high-pass';
		if (atOrigin === 1 && nz === 1 && st.order === 2) return 'band-pass';
		if (onAxis === 2) return 'notch (zeros on jω)';
		return 'general';
	}

	// ----- export -----
	const tf = $derived(zpk2tfAnalog(zpk));
	const scipy = $derived.by(() => {
		const wn = isBand ? `2 * np.pi * np.array([${trimNumber(c1, 8)}, ${trimNumber(c2, 8)}])` : `2 * np.pi * ${trimNumber(c1, 8)}`;
		const bt = { lowpass: 'low', highpass: 'high', bandpass: 'band', bandstop: 'bandstop' }[band];
		const call: Record<string, string> = {
			butter: `signal.butter(${N}, ${wn}, btype='${bt}', analog=True, output='zpk')`,
			cheby1: `signal.cheby1(${N}, ${rp}, ${wn}, btype='${bt}', analog=True, output='zpk')`,
			cheby2: `signal.cheby2(${N}, ${rs}, ${wn}, btype='${bt}', analog=True, output='zpk')`,
			ellip: `signal.ellip(${N}, ${rp}, ${rs}, ${wn}, btype='${bt}', analog=True, output='zpk')`,
			bessel: `signal.bessel(${N}, ${wn}, btype='${bt}', analog=True, output='zpk', norm='${besselNorm}')`
		};
		if (!call[family]) return `# ${info.name} filters are not available in SciPy.\n# Use the pole/zero export instead.`;
		return `import numpy as np\nfrom scipy import signal\n\nz, p, k = ${call[family]}\nw, h = signal.freqs_zpk(z, p, k, worN=2 * np.pi * np.logspace(1, 5, 1000))`;
	});

	const familyOptions = FAMILIES.map((f) => ({ value: f.id, label: f.name }));
</script>

<ToolLayout slug="analog-designer" related={['family-compare', 'active-filters', 'lc-ladder', 'iir-designer', 'order-calculator']}>
	{#snippet controls()}
		<ControlGroup title="Filter">
			<Select label="Family" bind:value={family} options={familyOptions} />
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
			<p class="small muted fam">{info.summary}</p>
		</ControlGroup>

		<ControlGroup title="Design from">
			<Segmented
				bind:value={mode}
				options={[
					{ value: 'order', label: 'Order & cutoff' },
					{ value: 'spec', label: 'Specifications' }
				]}
			/>
		</ControlGroup>

		{#if mode === 'order'}
			<ControlGroup title="Order & frequencies">
				<Slider label="Order N" bind:value={order} min={1} max={info.maxOrder} integer />
				{#if isBand}
					<Slider label="Lower edge f₁" bind:value={f1} min={1} max={100000} log unit="Hz" />
					<Slider label="Upper edge f₂" bind:value={f2} min={1} max={100000} log unit="Hz" />
				{:else}
					<Slider label="Cutoff fc" bind:value={f1} min={1} max={100000} log unit="Hz" />
				{/if}
				<p class="small muted">For {info.name}, the cutoff is the {family === 'bessel' ? { phase: 'phase-midpoint frequency', delay: 'unit-delay normalisation frequency', mag: '−3 dB frequency' }[besselNorm] : info.cutoffMeaning}.</p>
			</ControlGroup>
		{:else}
			<ControlGroup title="Band edges" columns={2}>
				{#if isBand}
					<NumberInput label="Passband f₁" bind:value={specs[band].fp[0]} unit="Hz" min={0.001} logStep={1.05} />
					<NumberInput label="Passband f₂" bind:value={specs[band].fp[1]} unit="Hz" min={0.001} logStep={1.05} />
					<NumberInput label="Stopband f₁" bind:value={specs[band].fs[0]} unit="Hz" min={0.001} logStep={1.05} />
					<NumberInput label="Stopband f₂" bind:value={specs[band].fs[1]} unit="Hz" min={0.001} logStep={1.05} />
				{:else}
					<NumberInput label="Passband edge" bind:value={specs[band].fp[0]} unit="Hz" min={0.001} logStep={1.05} />
					<NumberInput label="Stopband edge" bind:value={specs[band].fs[0]} unit="Hz" min={0.001} logStep={1.05} />
				{/if}
			</ControlGroup>
		{/if}

		<ControlGroup title="Ripple & attenuation">
			{#if info.usesRp || mode === 'spec'}
				<Slider label="Passband ripple Rp" bind:value={rp} min={0.01} max={6} log unit="dB" />
			{/if}
			{#if info.usesRs || mode === 'spec'}
				<Slider label="Stopband attenuation Rs" bind:value={rs} min={10} max={140} unit="dB" step={1} />
			{/if}
			{#if family === 'bessel'}
				<Select
					label="Bessel normalisation"
					bind:value={besselNorm}
					options={[
						{ value: 'mag', label: '−3 dB at cutoff' },
						{ value: 'phase', label: 'Phase midpoint at cutoff (SciPy default)' },
						{ value: 'delay', label: 'Unit group delay (delay = 1/(2π fc))' }
					]}
				/>
			{/if}
			{#if !info.usesRp && !info.usesRs && mode === 'order' && family !== 'bessel'}
				<p class="small muted">{info.name} has no ripple parameters.</p>
			{/if}
		</ControlGroup>
	{/snippet}

	{#if est?.error}
		<Callout kind="danger">{est.error}</Callout>
	{:else if est?.capped}
		<Callout kind="warning" title="Specification not reachable">
			{info.name} cannot meet this specification within order {info.maxOrder}. Showing the maximum order — try a steeper
			family or relax the specs.
		</Callout>
	{/if}

	<StatGrid {stats} />

	<ResponseView filters={[{ filter }]} {regions} {vlines} />

	<Card title="Cascade stages" subtitle="The filter factored into first- and second-order sections, ordered by increasing Q — how you would build it from op-amp stages.">
		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<th>#</th>
						<th>Order</th>
						<th>Kind</th>
						<th class="num">f₀</th>
						<th class="num">Q</th>
						<th>Poles (rad/s)</th>
						<th>Zeros (rad/s)</th>
					</tr>
				</thead>
				<tbody>
					{#each stages as st, i (i)}
						<tr>
							<td>{i + 1}</td>
							<td>{st.order}</td>
							<td>{stageKind(st)}</td>
							<td class="num">{formatSI(st.w0 / (2 * Math.PI), 'Hz', 4)}</td>
							<td class="num">{st.order === 2 ? trimNumber(st.q, 4) : '—'}</td>
							<td class="mono small">{st.poles.filter((p) => p.im >= 0).map((p) => (Math.abs(p.im) > 0 ? fmtC(p, 5).replace(' + ', ' ± ') : fmtC(p, 5))).join(', ')}</td>
							<td class="mono small">{st.zeros.length ? st.zeros.filter((z) => z.im >= 0).map((z) => (Math.abs(z.im) > 0 ? fmtC(z, 5).replace(' + ', ' ± ') : fmtC(z, 5))).join(', ') : '—'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="small muted">Overall gain k = {trimNumber(zpk.k, 6)}. Q = |p| / (2·|Re p|) for each complex pole pair.</p>
	</Card>

	<Card title="Export">
		<ExportPanel kind="analog" {zpk} {tf} recipes={[{ label: 'SciPy', code: scipy }]} name="analog_filter" />
	</Card>

	{#snippet theory()}
		<h2>How analog filters are designed</h2>
		<p>
			Every classic analog filter starts life as a <strong>normalised low-pass prototype</strong> with its cutoff at
			ω = 1 rad/s. The families differ only in the <em>approximation</em> they use for the ideal brick-wall magnitude.
			A frequency transformation then moves the prototype to the cutoff and response type you need.
		</p>
		<h3>The approximations</h3>
		<table class="wide">
			<thead><tr><th>Family</th><th>Magnitude² of the prototype</th><th>Character</th></tr></thead>
			<tbody>
				<tr><td>Butterworth</td><td><Tex math={'\\dfrac{1}{1+\\omega^{2N}}'} /></td><td>Maximally flat at DC; poles evenly spaced on the unit circle.</td></tr>
				<tr><td>Chebyshev I</td><td><Tex math={'\\dfrac{1}{1+\\varepsilon^2 T_N^2(\\omega)}'} /></td><td>Equiripple passband; poles on an ellipse.</td></tr>
				<tr><td>Chebyshev II</td><td><Tex math={'\\dfrac{1}{1+\\dfrac{1}{\\varepsilon^2 T_N^2(1/\\omega)}}'} /></td><td>Flat passband, equiripple stopband with jω-axis zeros.</td></tr>
				<tr><td>Elliptic</td><td><Tex math={'\\dfrac{1}{1+\\varepsilon^2 R_N^2(\\xi,\\omega)}'} /></td><td>Equiripple in both bands; the steepest possible transition.</td></tr>
				<tr><td>Bessel</td><td><Tex math={'H(s)=\\dfrac{\\theta_N(0)}{\\theta_N(s)}'} /></td><td>Maximally flat group delay (θ is a reverse Bessel polynomial).</td></tr>
				<tr><td>Legendre</td><td><Tex math={'\\dfrac{1}{1+L_N(\\omega^2)}'} /></td><td>Steepest roll-off that is still monotonic.</td></tr>
			</tbody>
		</table>
		<p>
			Here <Tex math={'T_N'} /> is the Chebyshev polynomial (<Tex math={'T_N(x)=\\cos(N\\arccos x)'} /> for |x| ≤ 1),
			<Tex math={'\\varepsilon=\\sqrt{10^{R_p/10}-1}'} /> sets the ripple, and <Tex math={'R_N'} /> is a Chebyshev
			rational function built from Jacobi elliptic functions.
		</p>
		<h3>Frequency transformations</h3>
		<p>Substituting for <Tex math="s" /> in the prototype moves it to the desired band (ω<sub>c</sub>, ω<sub>0</sub> = √(ω₁ω₂), B = ω₂ − ω₁):</p>
		<Tex display math={'\\text{LP: } s\\to \\frac{s}{\\omega_c}\\qquad \\text{HP: } s\\to\\frac{\\omega_c}{s}\\qquad \\text{BP: } s\\to\\frac{s^2+\\omega_0^2}{Bs}\\qquad \\text{BS: } s\\to\\frac{Bs}{s^2+\\omega_0^2}'} />
		<p>Band-pass and band-stop transformations double the order: an N-th order prototype yields 2N poles.</p>
		<h3>Choosing the order</h3>
		<p>With the passband edge normalised to 1 and the stopband edge at the selectivity ratio <Tex math={'\\Omega_s'} />:</p>
		<Tex display math={'N_{\\text{Butter}} \\ge \\frac{\\log\\big((10^{R_s/10}-1)/(10^{R_p/10}-1)\\big)}{2\\log \\Omega_s}\\qquad N_{\\text{Cheby}} \\ge \\frac{\\operatorname{arccosh}\\sqrt{(10^{R_s/10}-1)/(10^{R_p/10}-1)}}{\\operatorname{arccosh}\\Omega_s}'} />
		<p>Elliptic filters use the ratio of complete elliptic integrals <Tex math={"N \\ge \\dfrac{K(k)\\,K'(k_1)}{K'(k)\\,K(k_1)}"} /> with <Tex math="k = 1/\Omega_s" /> and <Tex math={'k_1 = \\varepsilon_p/\\varepsilon_s'} />.</p>
		<Callout kind="try">
			<ul>
				<li>Switch to <em>Specifications</em> and compare the order each family needs for the same mask.</li>
				<li>Raise the order of a Chebyshev I filter and watch the step-response overshoot grow while the transition gets sharper.</li>
				<li>Look at the elliptic pole–zero plot: the zeros on the jω axis are what create its notches in the stopband.</li>
			</ul>
		</Callout>
	{/snippet}
</ToolLayout>

<style>
	.fam {
		margin: -0.2rem 0 0;
	}
	.table-wrap {
		overflow-x: auto;
	}
</style>
