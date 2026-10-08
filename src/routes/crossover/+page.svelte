<script lang="ts">
	import { onMount } from 'svelte';
	import ToolLayout from '$lib/components/layout/ToolLayout.svelte';
	import ControlGroup from '$lib/components/layout/ControlGroup.svelte';
	import Card from '$lib/components/layout/Card.svelte';
	import Select from '$lib/components/controls/Select.svelte';
	import Segmented from '$lib/components/controls/Segmented.svelte';
	import Slider from '$lib/components/controls/Slider.svelte';
	import Toggle from '$lib/components/controls/Toggle.svelte';
	import NumberInput from '$lib/components/controls/NumberInput.svelte';
	import Plot, { type Series } from '$lib/components/plot/Plot.svelte';
	import { freqFormat } from '$lib/components/plot/scales';
	import StatGrid, { type Stat } from '$lib/components/content/StatGrid.svelte';
	import Callout from '$lib/components/content/Callout.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import ExportPanel from '$lib/components/content/ExportPanel.svelte';
	import { abs } from '$lib/dsp/complex';
	import { logspace } from '$lib/dsp/response';
	import { formatSI, trimNumber } from '$lib/dsp/units';
	import { num } from '$lib/export';
	import { readSharedState } from '$lib/share';
	import {
		buildWays,
		digitalSum,
		digitalWays,
		evaluateCrossover,
		passiveValues,
		phaseDifferenceDeg,
		recommendedInvert,
		XO_TYPES,
		xoInfo,
		type PassiveType,
		type WayId,
		type XoConfig,
		type XoType
	} from '$lib/features/crossover/crossover';

	let type = $state<XoType>('lr4');
	let ways = $state<2 | 3>(2);
	let fc = $state(2000);
	let f1 = $state(300);
	let f2 = $state(3000);
	let invert = $state<Record<WayId, boolean>>(recommendedInvert('lr4', 2));
	let delayMs = $state(0);
	let compensate = $state(false);
	let fs = $state(48000);
	let exportWay = $state<WayId>('low');
	let rDriver = $state(8);

	const shared = $derived({ type, ways, fc, f1, f2, invert, delayMs, compensate, fs, rDriver });
	onMount(() => {
		const st = readSharedState<typeof shared>();
		if (!st) return;
		if (st.type && XO_TYPES.some((t) => t.id === st.type)) type = st.type;
		if (st.ways === 2 || st.ways === 3) ways = st.ways;
		if (typeof st.fc === 'number' && st.fc > 0) fc = st.fc;
		if (typeof st.f1 === 'number' && st.f1 > 0) f1 = st.f1;
		if (typeof st.f2 === 'number' && st.f2 > 0) f2 = st.f2;
		if (st.invert && typeof st.invert === 'object')
			invert = { low: !!st.invert.low, mid: !!st.invert.mid, high: !!st.invert.high };
		if (typeof st.delayMs === 'number') delayMs = Math.max(-1, Math.min(1, st.delayMs));
		if (typeof st.compensate === 'boolean') compensate = st.compensate;
		if (typeof st.fs === 'number' && st.fs > 0) fs = st.fs;
		if (typeof st.rDriver === 'number' && st.rDriver > 0) rDriver = st.rDriver;
	});

	const info = $derived(xoInfo(type));
	function applyRecommended() {
		invert = recommendedInvert(type, ways);
	}
	const isRecommended = $derived.by(() => {
		const r = recommendedInvert(type, ways);
		return r.low === invert.low && r.high === invert.high && (ways === 2 || r.mid === invert.mid);
	});

	const freqs = $derived(ways === 2 ? [fc] : [f1, f2]);
	const freqError = $derived(ways === 3 && !(f2 > f1 * 1.05) ? 'The upper crossover f₂ must lie above the lower one f₁.' : null);

	const cfg = $derived<XoConfig>({
		type,
		ways,
		freqs,
		compensate: ways === 3 && compensate && info.allPass,
		invert,
		highDelay: delayMs / 1000
	});

	const built = $derived.by(() => {
		if (freqError) return { ways: null, error: freqError };
		try {
			return { ways: buildWays(cfg), error: null };
		} catch (e) {
			return { ways: null, error: e instanceof Error ? e.message : String(e) };
		}
	});

	// ---------------- responses ----------------
	const F = logspace(20, 20000, 800);
	const resp = $derived(built.ways ? evaluateCrossover(built.ways, F) : null);
	const atX = $derived(built.ways ? evaluateCrossover(built.ways, freqs) : null);

	const WAY_COLOR: Record<WayId, string> = { low: 'var(--s1)', mid: 'var(--s2)', high: 'var(--s3)' };
	const SUM_COLOR = 'var(--s4)';
	const POWER_COLOR = 'var(--s5)';
	const dbFmt = (v: number) => `${trimNumber(v, 4)} dB`;
	const degFmt = (v: number) => `${trimNumber(v, 4)}°`;
	const hzTip = (v: number) => formatSI(v, 'Hz', 4);

	const magSeries = $derived.by((): Series[] => {
		if (!resp) return [];
		return [
			...resp.ways.map((w) => ({ x: F, y: w.magDb, label: w.label, color: WAY_COLOR[w.id], format: dbFmt })),
			{ x: F, y: resp.sum.magDb, label: 'Sum', color: SUM_COLOR, format: dbFmt },
			{ x: F, y: resp.powerDb, label: 'Power Σ|Hᵢ|²', color: POWER_COLOR, dash: '6 4', format: dbFmt }
		];
	});
	const phaseSeries = $derived.by((): Series[] => {
		if (!resp) return [];
		return [
			...resp.ways.map((w) => ({ x: F, y: w.phaseDeg, label: w.label, color: WAY_COLOR[w.id], format: degFmt })),
			{ x: F, y: resp.sum.phaseDeg, label: 'Sum', color: SUM_COLOR, format: degFmt }
		];
	});
	const gdSeries = $derived.by((): Series[] =>
		resp ? [{ x: F, y: resp.sum.groupDelay.map((v) => v * 1000), label: 'Sum', color: SUM_COLOR, format: (v: number) => `${trimNumber(v, 4)} ms` }] : []
	);
	const gdLimits = $derived.by((): [number, number] | undefined => {
		if (!resp) return undefined;
		const v = resp.sum.groupDelay.filter(Number.isFinite).map((x) => x * 1000).sort((a, b) => a - b);
		if (!v.length) return undefined;
		const lo = v[Math.floor(v.length * 0.01)];
		const hi = v[Math.floor(v.length * 0.99)];
		const pad = Math.max((hi - lo) * 0.15, 0.05);
		return [Math.min(0, lo - pad), hi + pad];
	});

	/** True when every way has the same phase as the sum (mod 360°) — e.g. Linkwitz–Riley. */
	const phasesCoincide = $derived.by(() => {
		if (!resp) return false;
		for (const w of resp.ways)
			for (let i = 0; i < F.length; i += 8) {
				const d = Math.abs((((w.phaseDeg[i] - resp.sum.phaseDeg[i]) % 360) + 540) % 360 - 180);
				if (d > 0.5) return false;
			}
		return true;
	});

	const vlines = $derived(
		ways === 2
			? [{ value: fc, label: 'fc' }]
			: [
					{ value: f1, label: 'f₁' },
					{ value: f2, label: 'f₂' }
				]
	);

	// ---------------- stats ----------------
	const stats = $derived.by((): Stat[] => {
		if (!resp || !atX) return [];
		const sumDb = [...resp.sum.magDb, ...atX.sum.magDb];
		const mx = Math.max(...sumDb);
		const mn = Math.min(...sumDb);
		const dev = Math.max(Math.abs(mx), Math.abs(mn));
		const pmx = Math.max(...resp.powerDb);
		const pmn = Math.min(...resp.powerDb);
		const signed = (v: number) => (Math.abs(v) < 0.005 ? '0.00' : `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`);
		const deg = (v: number) => `${Math.abs(v) < 0.05 ? '0' : v.toFixed(1).replace('-', '−')}°`;
		const allPass = dev < 0.01;
		const out: Stat[] = [
			{
				label: 'Summed response',
				value: dev < 0.005 ? '±0.00 dB' : `${signed(mx)} / ${signed(mn)} dB`,
				status: dev <= 0.5 ? 'good' : dev <= 3.1 ? 'warning' : 'critical',
				hint: 'Maximum and minimum of |Σ Hᵢ| between 20 Hz and 20 kHz'
			},
			{
				label: 'Sum is all-pass',
				value: allPass ? 'Yes' : 'No',
				status: allPass ? 'good' : 'warning',
				hint: 'Flat magnitude (within ±0.01 dB) — only the phase is altered'
			},
			{ label: 'Power response', value: Math.max(Math.abs(pmx), Math.abs(pmn)) < 0.005 ? '±0.00 dB' : `${signed(pmx)} / ${signed(pmn)} dB`, hint: 'Σ|Hᵢ|² — what an off-axis or reverberant field hears' }
		];
		const w = atX.ways;
		if (ways === 2) {
			out.push({ label: 'Phase high − low at fc', value: deg(phaseDifferenceDeg(w[0].H[0], w[1].H[0])), hint: 'Includes polarity and delay. 0° = in phase, ±180° = cancelling' });
			out.push({ label: 'Each way at fc', value: `${(20 * Math.log10(abs(w[0].H[0]))).toFixed(2).replace('-', '−')} dB` });
		} else {
			out.push({ label: 'Phase mid − low at f₁', value: deg(phaseDifferenceDeg(w[0].H[0], w[1].H[0])) });
			out.push({ label: 'Phase high − mid at f₂', value: deg(phaseDifferenceDeg(w[1].H[1], w[2].H[1])) });
		}
		if (delayMs !== 0) out.push({ label: 'Acoustic offset', value: `${trimNumber(Math.abs(delayMs) * 343, 3)} mm`, hint: `High driver ${delayMs > 0 ? 'behind' : 'in front of'} the low driver (c = 343 m/s)` });
		return out;
	});

	// ---------------- digital export ----------------
	const fsOptions = [44100, 48000, 88200, 96000, 192000].map((v) => ({ value: v, label: formatSI(v, 'Hz', 4) }));
	const fsError = $derived(Math.max(...freqs) >= 0.45 * fs ? 'Crossover frequency too close to Nyquist for this sample rate.' : null);
	const digital = $derived.by(() => {
		if (!built.ways || fsError) return null;
		try {
			return digitalWays(cfg, fs);
		} catch {
			return null;
		}
	});
	const digitalDev = $derived.by(() => {
		if (!digital || !resp) return null;
		const top = Math.min(20000, 0.45 * fs);
		const idx = F.map((f, i) => i).filter((i) => F[i] <= top);
		const dsum = digitalSum(
			digital,
			fs,
			idx.map((i) => F[i])
		);
		let worst = 0;
		idx.forEach((i, k) => {
			worst = Math.max(worst, Math.abs(20 * Math.log10(Math.max(abs(dsum[k]), 1e-12)) - resp.sum.magDb[i]));
		});
		return { worst, top };
	});
	const exportOptions = $derived(
		(ways === 2 ? (['low', 'high'] as WayId[]) : (['low', 'mid', 'high'] as WayId[])).map((id) => ({ value: id, label: id[0].toUpperCase() + id.slice(1) }))
	);
	const exportSel = $derived(digital?.find((d) => d.id === exportWay) ?? digital?.[0] ?? null);
	const allWaysPy = $derived.by(() => {
		if (!digital) return '';
		const arr = (sos: number[][]) => `np.array([\n${sos.map((r) => `    [${r.map((v) => num(v)).join(', ')}],`).join('\n')}\n])`;
		const lines = ['import numpy as np', 'from scipy import signal', '', `fs = ${fs}`, ''];
		for (const d of digital) lines.push(`sos_${d.id} = ${arr(d.sos)}`, '');
		lines.push('# split a signal x into the driver feeds');
		for (const d of digital) {
			if (d.delaySamples > 0) lines.push(`y_${d.id} = np.concatenate([np.zeros(${d.delaySamples}), signal.sosfilt(sos_${d.id}, x)])[: len(x)]  # ${d.delaySamples}-sample delay`);
			else lines.push(`y_${d.id} = signal.sosfilt(sos_${d.id}, x)`);
		}
		if (digital.some((d) => d.delaySamples < 0))
			lines.push(`# negative offset: delay the other ways by ${-Math.min(...digital.map((d) => d.delaySamples))} samples instead`);
		return lines.join('\n');
	});

	// ---------------- passive ----------------
	const passiveType = $derived<PassiveType | null>(ways === 2 && (type === 'bw1' || type === 'bw2' || type === 'lr2') ? type : null);
	const passive = $derived(passiveType ? passiveValues(passiveType, fc, rDriver) : null);

	function onTypeChange() {
		applyRecommended();
	}
	function onWaysChange() {
		applyRecommended();
		if (!['low', 'mid', 'high'].includes(exportWay) || (ways === 2 && exportWay === 'mid')) exportWay = 'low';
	}
	const typeOptions = XO_TYPES.map((t) => ({
		value: t.id,
		label: t.name,
		group: t.family === 'butter' ? 'Butterworth' : t.family === 'lr' ? 'Linkwitz–Riley' : 'Bessel'
	}));
</script>

<ToolLayout slug="crossover" share={shared} related={['family-compare', 'lc-ladder', 'parametric-eq', 'analog-designer', 'iir-designer']}>
	{#snippet controls()}
		<ControlGroup title="Crossover">
			<Select label="Alignment" bind:value={type} options={typeOptions} onchange={onTypeChange} />
			<p class="small muted">
				{info.slope} dB/octave. {info.allPass ? 'Sums to an all-pass with the recommended polarity.' : 'Does not sum flat — see the summed response.'}
			</p>
			<Segmented
				label="Ways"
				bind:value={ways}
				options={[
					{ value: 2, label: '2-way' },
					{ value: 3, label: '3-way' }
				]}
				onchange={onWaysChange}
			/>
			{#if ways === 2}
				<Slider label="Crossover fc" bind:value={fc} min={40} max={12000} log unit="Hz" />
			{:else}
				<Slider label="Low / mid f₁" bind:value={f1} min={40} max={3000} log unit="Hz" />
				<Slider label="Mid / high f₂" bind:value={f2} min={200} max={12000} log unit="Hz" />
				<Toggle
					label="All-pass compensate the low way"
					bind:checked={compensate}
					disabled={!info.allPass}
					help={info.allPass ? 'Low = LP₁·AP₂, high = HP₁·HP₂: the sum becomes exactly AP₁·AP₂' : 'Only for alignments whose 2-way sum is an all-pass'}
				/>
			{/if}
		</ControlGroup>

		<ControlGroup title="Polarity & alignment">
			<Toggle label="Invert low" bind:checked={invert.low} />
			{#if ways === 3}<Toggle label="Invert mid" bind:checked={invert.mid} />{/if}
			<Toggle label="Invert high" bind:checked={invert.high} />
			<button class="btn small" type="button" onclick={applyRecommended} disabled={isRecommended}>
				{isRecommended ? 'Recommended polarity' : 'Use recommended polarity'}
			</button>
			<Slider
				label="High-driver delay"
				bind:value={delayMs}
				min={-0.5}
				max={0.5}
				step={0.005}
				unit="ms"
				help="Positive: tweeter acoustic centre behind the woofer's. 0.1 ms ≈ 34 mm"
			/>
		</ControlGroup>

		<ControlGroup title="Digital export">
			<Select label="Sample rate" bind:value={fs} options={fsOptions} />
		</ControlGroup>

		{#if passiveType}
			<ControlGroup title="Passive network">
				<NumberInput label="Driver impedance (resistive)" bind:value={rDriver} unit="Ω" min={0.5} max={1000} logStep={1.1} />
			</ControlGroup>
		{/if}
	{/snippet}

	{#if built.error}
		<Callout kind="danger">{built.error}</Callout>
	{:else}
		<StatGrid {stats} />

		<Card>
			<Plot
				title="Magnitude"
				series={magSeries}
				xScale="log"
				xFormat={freqFormat}
				xTooltipFormat={hzTip}
				xLabel="Frequency (Hz)"
				yLabel="Level (dB)"
				yDomain={[-36, 9]}
				hlines={[{ value: 0 }]}
				{vlines}
				height={320}
				exportName="crossover-magnitude"
			/>
		</Card>

		<div class="grid2">
			<Card>
				<Plot
					title="Phase (unwrapped)"
					series={phaseSeries}
					xScale="log"
					xFormat={freqFormat}
					xTooltipFormat={hzTip}
					xLabel="Frequency (Hz)"
					yLabel="Phase (°)"
					{vlines}
					height={270}
					exportName="crossover-phase"
				/>
				{#if phasesCoincide}
					<p class="small muted note">All curves coincide: the ways are in phase with each other (and with the sum) at every frequency.</p>
				{/if}
			</Card>
			<Card>
				<Plot
					title="Group delay of the sum"
					series={gdSeries}
					xScale="log"
					xFormat={freqFormat}
					xTooltipFormat={hzTip}
					xLabel="Frequency (Hz)"
					yLabel="Delay (ms)"
					yLimits={gdLimits}
					minYSpan={0.2}
					{vlines}
					height={270}
					exportName="crossover-group-delay"
				/>
			</Card>
		</div>

		<Card title="Digital filters" subtitle="Each way's analog filter mapped with the bilinear transform, pre-warped so every crossover frequency lands exactly.">
			{#if fsError}
				<Callout kind="danger">{fsError}</Callout>
			{:else if digital && exportSel}
				<div class="export-head">
					<Segmented label="Way" bind:value={exportWay} options={exportOptions} size="small" />
					{#if digitalDev}
						<p class="small muted">
							Digital sum vs analog up to {formatSI(digitalDev.top, 'Hz', 3)}: max difference {digitalDev.worst < 0.01 ? '< 0.01' : trimNumber(digitalDev.worst, 2)} dB.
							{#if exportSel.delaySamples !== 0}Delay: {exportSel.delaySamples} samples (rounded from {trimNumber(delayMs, 3)} ms).{/if}
						</p>
					{/if}
				</div>
				<ExportPanel
					kind="digital"
					sos={exportSel.sos}
					{fs}
					name="crossover_{exportSel.id}"
					recipes={[{ label: 'All ways (Python)', code: allWaysPy }]}
				/>
			{/if}
		</Card>

		{#if passive && passiveType}
			<Card title="Passive network" subtitle="{passiveType === 'bw1' ? 'First order: one series element per driver.' : 'Second order: a series element, then a shunt element across the driver.'} Assumes a purely resistive driver — real drivers need an impedance-compensation (Zobel) network first.">
				<div class="table-wrap">
					<table>
						<thead>
							<tr><th>Section</th><th>Series element</th><th>Across the driver</th><th>Formula</th></tr>
						</thead>
						<tbody>
							<tr>
								<td>Low-pass (woofer)</td>
								<td class="mono">L = {formatSI(passive.lowL, 'H', 4)}</td>
								<td class="mono">{passive.lowC !== undefined ? `C = ${formatSI(passive.lowC, 'F', 4)}` : '—'}</td>
								<td>
									{#if passive.q === undefined}<Tex math={'L = R/\\omega_c'} />{:else}<Tex math={'L = \\frac{R}{Q\\omega_c},\\ C = \\frac{Q}{R\\omega_c}'} />{/if}
								</td>
							</tr>
							<tr>
								<td>High-pass (tweeter)</td>
								<td class="mono">C = {formatSI(passive.highC, 'F', 4)}</td>
								<td class="mono">{passive.highL !== undefined ? `L = ${formatSI(passive.highL, 'H', 4)}` : '—'}</td>
								<td>
									{#if passive.q === undefined}<Tex math={'C = 1/(R\\omega_c)'} />{:else}same L and C{/if}
								</td>
							</tr>
						</tbody>
					</table>
				</div>
				<p class="small muted note">
					{#if passive.q !== undefined}Q = {trimNumber(passive.q, 4)} ({passiveType === 'lr2' ? 'Linkwitz–Riley' : 'Butterworth'}), ωc = 2π·{formatSI(fc, 'Hz', 4)}, R = {formatSI(rDriver, 'Ω', 3)}.{:else}ωc = 2π·{formatSI(fc, 'Hz', 4)}, R = {formatSI(rDriver, 'Ω', 3)}.{/if}
					{#if passiveType !== 'bw1'}Wire the tweeter with {invert.high ? 'inverted' : 'normal'} polarity, as in the plots.{/if}
				</p>
			</Card>
		{:else}
			<p class="small muted">Passive component values are shown for 2-way Butterworth 1st/2nd-order and LR2 alignments.</p>
		{/if}
	{/if}

	{#snippet theory()}
		<h2>Splitting the band, then putting it back together</h2>
		<p>
			A crossover feeds each driver only the band it reproduces well. In the air the driver outputs add up again as
			complex numbers, so what matters is not just each way's magnitude but the <em>sum</em>
		</p>
		<Tex display math={'H_\\Sigma(j\\omega) = \\sum_i \\pm H_i(j\\omega)\\,e^{-j\\omega\\tau_i},'} />
		<p>
			including each driver's polarity (±) and acoustic delay τ<sub>i</sub>. The power response <Tex math={'\\sum_i |H_i|^2'} />
			describes what you hear off-axis and in the reverberant field, where the outputs add with random phase.
		</p>

		<h3>Butterworth: flat power, +3 dB on axis</h3>
		<p>
			Butterworth low- and high-pass filters at the same fc satisfy <Tex math={'|H_{LP}|^2 + |H_{HP}|^2 = \\dfrac{1 + \\omega^{2N}}{1+\\omega^{2N}} = 1'} />:
			the power response is perfectly flat. At fc each output is −3 dB, so if they arrive in phase their voltages add to
			+3 dB. Odd orders put the outputs 90° (or 270°) apart, so the on-axis sum is flat too — first and third order sum to
			all-passes. Even orders are in phase or anti-phase: second order gives a deep notch at fc unless the tweeter is
			inverted, which turns it into the +3 dB bump; fourth order bumps with normal polarity and notches when inverted.
		</p>

		<h3>Linkwitz–Riley: two Butterworths in series</h3>
		<p>
			A Linkwitz–Riley filter of order 2n is a Butterworth of order n squared, so each output is −6 dB at fc and the outputs
			are exactly in phase there (with the right polarity). The sum is an all-pass:
		</p>
		<Tex display math={'\\frac{1}{B_n(s)^2} + (-1)^n\\frac{s^{2n}}{B_n(s)^2} = \\frac{B_n(s)B_n(-s)}{B_n(s)^2} = \\frac{B_n(-s)}{B_n(s)},'} />
		<p>
			because a Butterworth polynomial satisfies <Tex math={'B_n(s)B_n(-s) = 1 + (-1)^n s^{2n}'} />. The magnitude is flat;
			only the phase rotates (by n·180° across the band), so the group delay has a smooth bump around fc. The sign
			<Tex math={'(-1)^n'} /> is the polarity rule: LR2 (n = 1) needs the tweeter inverted, LR4 and LR8 (n even) use normal
			polarity. The price is a −3 dB dip in the power response at fc.
		</p>

		<h3>Three ways</h3>
		<p>
			The obvious tree — low = LP₁, mid = HP₁·LP₂, high = HP₂ — is not exactly flat even with LR filters, because the low
			way lacks the phase rotation that the upper split imposes on everything above it. Giving the low way the upper
			section's all-pass <Tex math={'AP_2 = LP_2 \\pm HP_2'} /> and the high way the lower high-pass makes the sum exactly
			<Tex math={'AP_1 \\cdot AP_2'} />. The error of the simple tree shrinks as the two crossover points move apart.
		</p>

		<h3>Phase, lobing and acoustic offsets</h3>
		<p>
			Off-axis, the path lengths to the two drivers differ, which adds a frequency-proportional phase difference
			<Tex math={'\\Delta\\varphi = 2\\pi f\\,\\Delta d/c'} /> to the outputs near fc. Where the outputs are in phase on
			axis (LR), the main lobe points straight ahead and stays symmetric; with outputs 90° apart (odd-order
			Butterworth) the lobe tilts up or down depending on polarity. The same happens on axis when the acoustic centres
			are not aligned: a tweeter mounted on a flat baffle usually sits a few centimetres in front of the woofer's
			acoustic centre. Use the delay slider to see how a fraction of a millisecond (0.1 ms ≈ 34 mm) turns a perfect LR4
			sum into a dip — and fix it with a matching digital delay.
		</p>

		<Callout kind="try">
			<ul>
				<li>With LR4, flip the high-way polarity: the all-pass sum turns into a deep notch at fc.</li>
				<li>Choose Butterworth 2nd order with the recommended (inverted) polarity: +3 dB on axis, yet the power response stays flat.</li>
				<li>Add 0.15 ms of tweeter delay to an LR4 crossover and watch the sum dip; then try LR2 and BW3 with the same offset.</li>
				<li>Switch to 3-way LR4 with f₁ = 500 Hz and f₂ = 1.5 kHz: the simple tree ripples — tick “All-pass compensate” and it is flat again.</li>
				<li>Compare the group delay of LR2, LR4 and LR8 at the same fc: steeper slopes cost more delay around the crossover.</li>
			</ul>
		</Callout>
	{/snippet}
</ToolLayout>

<style>
	.grid2 {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 380px), 1fr));
		gap: 1.1rem;
	}
	.export-head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 0.4rem 1rem;
		margin-bottom: 0.6rem;
	}
	.export-head p {
		margin: 0;
	}
	.table-wrap {
		overflow-x: auto;
		position: relative;
	}
	.note {
		margin: 0.6rem 0 0;
	}
</style>
