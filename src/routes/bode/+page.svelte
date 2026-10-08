<script lang="ts">
	import ToolLayout from '$lib/components/layout/ToolLayout.svelte';
	import ControlGroup from '$lib/components/layout/ControlGroup.svelte';
	import Card from '$lib/components/layout/Card.svelte';
	import Select from '$lib/components/controls/Select.svelte';
	import Segmented from '$lib/components/controls/Segmented.svelte';
	import Toggle from '$lib/components/controls/Toggle.svelte';
	import Plot, {
		type PlotContext,
		type RefLine,
		type Series
	} from '$lib/components/plot/Plot.svelte';
	import StatGrid, { type Stat } from '$lib/components/content/StatGrid.svelte';
	import Callout from '$lib/components/content/Callout.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import { freqFormat, seriesColor } from '$lib/components/plot/scales';
	import { formatSI, trimNumber } from '$lib/dsp/units';
	import FactorEditor from './FactorEditor.svelte';
	import {
		FACTOR_TYPES,
		MAX_FACTORS,
		PRESETS,
		type Factor,
		type FactorType,
		type PhaseApprox,
		asymptote,
		autoRange,
		closedLoopStability,
		dcGainDb,
		exact,
		factorLabel,
		freeSlot,
		gainMargins,
		logGrid,
		loopMargins,
		makeFactor,
		slopes,
		totalAsymptote,
		totalExact,
		transferTex
	} from '$lib/features/bode/factors';

	let factors = $state<Factor[]>(PRESETS[0].build());
	let presetId = $state(PRESETS[0].id);
	let showFactors = $state<'off' | 'exact' | 'asymptote'>('asymptote');
	let approx = $state<PhaseApprox>('decade');
	let loop = $state(false);
	let addType = $state<FactorType>('realPole');

	const DEFAULTS: Record<FactorType, Partial<Factor>> = {
		gain: { gainDb: 20 },
		power: { n: -1, f: 100 },
		realPole: { f: 1000 },
		realZero: { f: 100 },
		complexPole: { f: 1000, zeta: 0.3 },
		complexZero: { f: 1000, zeta: 0.3 },
		delay: { T: 1e-3 }
	};

	function loadPreset(id: string) {
		const p = PRESETS.find((x) => x.id === id);
		if (!p) return;
		factors = p.build();
		presetId = id;
		loop = p.loop;
	}

	function addFactor() {
		const slot = freeSlot(factors);
		if (slot < 0) return;
		factors.push(makeFactor(addType, slot, DEFAULTS[addType]));
		presetId = 'custom';
	}

	function update(id: number, patch: Partial<Factor>) {
		const f = factors.find((x) => x.id === id);
		if (!f) return;
		Object.assign(f, patch);
		presetId = 'custom';
	}

	function remove(id: number) {
		factors = factors.filter((x) => x.id !== id);
		presetId = 'custom';
	}

	// ---------------- analysis ----------------
	// margins are searched well beyond the corners: a high loop gain can put f_gc decades above them
	const marg = $derived(loop ? loopMargins(factors) : null);
	// exact verdict (closed-loop poles, or a Nyquist count with a delay), not the signs of the margins
	const stab = $derived(loop ? closedLoopStability(factors, marg ?? undefined) : null);
	const gms = $derived(marg ? gainMargins(marg) : null);
	// gain margin(s) to report: for a stable loop how far the gain may rise (and, when it is
	// conditionally stable, how far it may fall); otherwise the phase crossover nearest 0 dB
	const gmMain = $derived(gms ? (stab?.stable ? gms.up : gms.nearest) : null);
	const gmDown = $derived(gms && stab?.stable ? gms.down : null);
	// widen the view to show the reported crossovers (not every phase crossing: with a delay there are infinitely many)
	const range = $derived(
		autoRange(factors, marg ? [marg.pm?.f ?? NaN, gmMain?.f ?? NaN, gmDown?.f ?? NaN] : [])
	);

	/** Log grid plus every breakpoint so the asymptotes have sharp corners. */
	const grid = $derived.by(() => {
		const [lo, hi] = range;
		const pts = logGrid(lo, hi, 600);
		for (const fc of factors) {
			if (fc.type === 'gain' || fc.type === 'delay' || fc.type === 'power') continue;
			const w =
				fc.type === 'complexPole' || fc.type === 'complexZero'
					? approx === 'zeta'
						? Math.pow(10, fc.zeta)
						: approx === 'decade'
							? 10
							: 1
					: 10;
			for (const b of [fc.f / w, fc.f, fc.f * w]) {
				if (b > lo && b < hi) pts.push(b * (1 - 1e-9), b, b * (1 + 1e-9));
			}
		}
		return pts.sort((a, b) => a - b);
	});

	const ex = $derived(grid.map((f) => totalExact(factors, f)));
	const as = $derived(grid.map((f) => totalAsymptote(factors, f, approx)));
	const parts = $derived(
		showFactors === 'off'
			? []
			: factors.map((fc) =>
					grid.map((f) => (showFactors === 'exact' ? exact(fc, f) : asymptote(fc, f, approx)))
				)
	);

	const dbFmt = (v: number) => `${trimNumber(v, 4)} dB`;
	const degFmt = (v: number) => `${trimNumber(v, 4)}°`;

	function makeSeries(key: 'db' | 'deg'): Series[] {
		const fmt = key === 'db' ? dbFmt : degFmt;
		const out: Series[] = parts.map((p, i) => ({
			x: grid,
			y: p.map((v) => v[key]),
			label: `${i + 1}. ${factorLabel(factors[i])}`,
			color: seriesColor(factors[i].slot),
			width: 1.5,
			dash: showFactors === 'asymptote' ? '2 3' : undefined,
			format: fmt
		}));
		out.push({
			x: grid,
			y: as.map((v) => v[key]),
			label: 'Asymptotic total',
			color: 'var(--text)',
			dash: '7 5',
			width: 2,
			format: fmt
		});
		out.push({
			x: grid,
			y: ex.map((v) => v[key]),
			label: 'Exact total',
			color: 'var(--text)',
			width: 3,
			format: fmt
		});
		return out;
	}
	const magSeries = $derived(makeSeries('db'));
	const phaseSeries = $derived(makeSeries('deg'));

	const magV = $derived<RefLine[]>(
		marg
			? [
					...(marg.pm ? [{ value: marg.pm.f, label: 'f_gc' }] : []),
					...[gmMain, gmDown].flatMap((c) => (c ? [{ value: c.f, label: 'f_pc' }] : []))
				]
			: []
	);

	const sl = $derived(slopes(factors));
	// K·Π ω_u^(−n): cancelling powers of s still leave a constant
	const dcDb = $derived(dcGainDb(factors));

	const maxErr = $derived.by(() => {
		let best = 0;
		let at = 0;
		for (let i = 0; i < grid.length; i++) {
			const e = ex[i].db - as[i].db;
			if (Number.isFinite(e) && Math.abs(e) > Math.abs(best)) {
				best = e;
				at = grid[i];
			}
		}
		return { err: best, f: at };
	});

	const stats = $derived.by((): Stat[] => {
		const out: Stat[] = [
			{
				label: 'Low-f slope',
				value: `${sl.low >= 0 ? '+' : ''}${sl.low} dB/dec`,
				hint: '20 dB/decade per integrator (−) or differentiator (+)'
			},
			{
				label: 'High-f slope',
				value: `${sl.high >= 0 ? '+' : ''}${sl.high} dB/dec`,
				hint: '20 dB/decade per (zeros − poles), counting powers of s'
			},
			{
				label: 'DC gain',
				value:
					sl.low < 0 ? '∞ (integrator)' : sl.low > 0 ? '0 (−∞ dB)' : `${trimNumber(dcDb, 4)} dB`
			},
			{
				label: 'Max asymptote error',
				value:
					maxErr.err === 0
						? '0 dB'
						: `${maxErr.err > 0 ? '+' : ''}${trimNumber(maxErr.err, 3)} dB at ${formatSI(maxErr.f, 'Hz', 3)}`,
				hint: 'Exact minus straight-line magnitude'
			}
		];
		if (marg) {
			const pm = marg.pm;
			const gm = gmMain;
			out.push({
				label: 'Gain crossover',
				value: pm ? formatSI(pm.f, 'Hz', 4) : 'none',
				hint: 'f_gc, where |L| = 0 dB'
			});
			out.push({
				label: 'Phase margin',
				value: pm ? `${trimNumber(pm.margin, 3)}°` : '—',
				status: pm
					? pm.margin >= 45
						? 'good'
						: pm.margin > 0
							? 'warning'
							: 'critical'
					: undefined,
				hint: '180° + ∠L at f_gc. ≥ 45° is a common target.'
			});
			out.push({
				label: 'Phase crossover',
				value: gm ? formatSI(gm.f, 'Hz', 4) : 'none',
				hint: 'f_pc, where ∠L = −180°'
			});
			out.push({
				label: 'Gain margin',
				value: gm ? `${trimNumber(gm.margin, 3)} dB` : '∞',
				status:
					stab?.stable === false
						? 'critical'
						: gm
							? gm.margin >= 6
								? 'good'
								: gm.margin > 0
									? 'warning'
									: 'critical'
							: 'good',
				hint: '−|L| in dB at f_pc: how far the gain can rise. ≥ 6 dB is a common target.'
			});
			if (gmDown)
				out.push({
					label: 'Gain-reduction margin',
					value: `${trimNumber(gmDown.margin, 3)} dB`,
					status: gmDown.margin <= -6 ? 'good' : 'warning',
					hint: `|L| > 1 at the phase crossover at ${formatSI(gmDown.f, 'Hz', 4)}: lowering the gain this far makes the loop unstable (conditionally stable)`
				});
		}
		return out;
	});

	const verdict = $derived.by(() => {
		if (!marg || !stab) return null;
		const out: string[] = [];
		if (!marg.pm) out.push('|L| never crosses 0 dB, so there is no phase margin to read.');
		// with a delay the closed loop has infinitely many poles, so they are counted, not computed
		const nyq =
			stab.method === 'nyquist'
				? ', by the Nyquist criterion (a delay leaves no polynomial to solve)'
				: '';
		if (stab.stable && gmDown) {
			const up = gmMain
				? `, as does raising it by more than ${trimNumber(gmMain.margin, 3)} dB`
				: '';
			out.push(
				`The closed loop 1/(1 + L) is stable, but only conditionally: |L| > 1 at a phase crossover, so lowering the loop gain by more than ${trimNumber(-gmDown.margin, 3)} dB makes it unstable${up}. A negative gain margin on its own does not mean instability.`
			);
		} else if (stab.stable) {
			out.push(
				stab.method === 'poles'
					? 'The closed loop 1/(1 + L) is stable: every closed-loop pole (root of 1 + L(s) = 0) is in the left half-plane.'
					: `The closed loop 1/(1 + L) is stable: none of its poles is in the right half-plane${nyq}.`
			);
		} else if (stab.stable === false) {
			const n = stab.rhp;
			out.push(
				n === Infinity
					? 'The closed loop 1/(1 + L) is unstable: with a delay, |L| ≥ 1 at high frequency puts infinitely many closed-loop poles in the right half-plane.'
					: `The closed loop 1/(1 + L) is unstable: ${n} closed-loop ${n === 1 ? 'pole is' : 'poles are'} in the right half-plane${nyq}.`
			);
		} else
			out.push(
				'The closed loop is on the edge of stability: L(jω) passes through −1, putting a closed-loop pole on the imaginary axis.'
			);
		return out.join(' ');
	});

	const tex = $derived(transferTex(factors));

	const addOptions = FACTOR_TYPES.map((t) => ({ value: t.id, label: t.name }));
	const presetOptions = [
		...PRESETS.map((p) => ({ value: p.id, label: p.label })),
		{ value: 'custom', label: 'Custom (edited)', disabled: true }
	];
	const presetInfo = $derived(PRESETS.find((p) => p.id === presetId));

	const approxText: Record<PhaseApprox, string> = {
		decade: 'second-order factors ±90°/decade from f_n/10 to 10·f_n',
		zeta: 'second-order factors linear from f_n/10^ζ to f_n·10^ζ',
		step: 'second-order factors step by ±180° at f_n'
	};

	// one row per factor for the summary table; sⁿ has no corner: its slope (20n dB/dec)
	// and phase (n·90°) are the same at every frequency, f_u is only where it is 0 dB
	const summary = $derived(
		factors.map((fc) => {
			if (fc.type === 'gain' || fc.type === 'delay' || fc.type === 'power')
				return { fc, corner: null, slope: 0, err: 0, ph: exact(fc, 1).deg };
			const e = exact(fc, fc.f);
			const a = asymptote(fc, fc.f, approx);
			const slope =
				fc.type === 'realPole'
					? -20
					: fc.type === 'realZero'
						? 20
						: fc.type === 'complexPole'
							? -40
							: 40;
			return { fc, corner: fc.f, slope, err: e.db - a.db, ph: e.deg };
		})
	);
	const hasPower = $derived(factors.some((fc) => fc.type === 'power'));
</script>

<ToolLayout
	slug="bode"
	related={['pole-zero', 'analog-designer', 'rlc', 'active-filters', 'tf-analyzer']}
	wideControls
>
	{#snippet controls()}
		<ControlGroup title="Preset">
			<Select
				label="Load a preset"
				value={presetId}
				options={presetOptions}
				onchange={(v) => loadPreset(v)}
			/>
			{#if presetInfo}<p class="small muted tight">{presetInfo.description}</p>{/if}
		</ControlGroup>

		<ControlGroup title="Factors ({factors.length}/{MAX_FACTORS})">
			{#each factors as fc, i (fc.id)}
				<FactorEditor
					factor={fc}
					index={i}
					onupdate={(p) => update(fc.id, p)}
					onremove={() => remove(fc.id)}
				/>
			{:else}
				<p class="small muted tight">No factors: H(s) = 1. Add one below.</p>
			{/each}
			<div class="add">
				<Select label="Add a factor" bind:value={addType} options={addOptions} />
				<button
					class="btn"
					type="button"
					onclick={addFactor}
					disabled={factors.length >= MAX_FACTORS}>Add</button
				>
			</div>
			{#if factors.length >= MAX_FACTORS}<p class="small muted tight">
					Eight factors is the maximum — remove one to add another.
				</p>{/if}
		</ControlGroup>

		<ControlGroup title="Display">
			<Segmented
				size="small"
				label="Individual factors"
				bind:value={showFactors}
				options={[
					{ value: 'off', label: 'Hide' },
					{ value: 'asymptote', label: 'Asymptotes' },
					{ value: 'exact', label: 'Exact' }
				]}
			/>
			<Select
				label="2nd-order phase asymptote"
				bind:value={approx}
				options={[
					{ value: 'decade', label: 'Linear, one decade either side of f_n' },
					{ value: 'zeta', label: 'Linear over f_n/10^ζ … f_n·10^ζ' },
					{ value: 'step', label: 'Step of 180° at f_n' }
				]}
			/>
			<Toggle
				bind:checked={loop}
				label="Open-loop analysis"
				help="Treat H as a loop gain L and find the gain and phase margins"
			/>
		</ControlGroup>
	{/snippet}

	<StatGrid {stats} />

	{#if loop && verdict}
		<Callout kind={stab?.stable ? 'note' : 'warning'} title="Closed-loop stability">
			{verdict}
			{#if stab?.openRhp}<strong>
					L itself has {stab.openRhp === 1
						? 'a right-half-plane pole'
						: `${stab.openRhp} right-half-plane poles`}, so the margins alone don't decide
					stability: by the Nyquist criterion L(jω) must encircle −1 counter-clockwise {stab.openRhp ===
					1
						? 'once'
						: `${stab.openRhp} times`}.</strong
				>{/if}
		</Callout>
	{/if}

	<Card
		title="Transfer function"
		subtitle="Each factor in Bode form (unity gain well below its corner); s in rad/s, ω = 2πf."
	>
		<Tex display math={tex} />
	</Card>

	<div class="card">
		<Plot
			series={magSeries}
			xScale="log"
			xDomain={range}
			xLabel="Frequency (Hz)"
			yLabel="Magnitude (dB)"
			xFormat={freqFormat}
			xTooltipFormat={(v) => formatSI(v, 'Hz', 4)}
			minYSpan={20}
			yLimits={[-300, 300]}
			height={340}
			title="Magnitude"
			hlines={loop ? [{ value: 0, label: '0 dB' }] : []}
			vlines={magV}
			overlay={magOverlay}
			exportName="bode-magnitude"
		/>
	</div>

	<div class="card">
		<Plot
			series={phaseSeries}
			xScale="log"
			xDomain={range}
			xLabel="Frequency (Hz)"
			yLabel="Phase (°)"
			xFormat={freqFormat}
			xTooltipFormat={(v) => formatSI(v, 'Hz', 4)}
			minYSpan={90}
			height={300}
			title="Phase"
			hlines={loop ? [{ value: -180, label: '−180°' }] : []}
			vlines={magV}
			overlay={phaseOverlay}
			exportName="bode-phase"
		/>
		<p class="small muted note">
			Asymptotic phase: first-order factors ±45°/decade from f/10 to 10·f; {approxText[approx]}; a
			time delay has no straight-line form, so its exact phase −360°·f·T is included in both totals.
		</p>
	</div>

	<Card
		title="Factor summary"
		subtitle="Where each factor bends the curve and how far the straight line is off at its corner."
	>
		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<th>Factor</th>
						<th class="num">Corner</th>
						<th class="num">Slope change</th>
						<th class="num">Exact − asymptote at corner</th>
						<th class="num">Phase at corner</th>
					</tr>
				</thead>
				<tbody>
					{#each summary as row, i (row.fc.id)}
						<tr>
							<td>
								<svg width="16" height="8" aria-hidden="true"
									><line
										x1="1"
										y1="4"
										x2="15"
										y2="4"
										stroke={seriesColor(row.fc.slot)}
										stroke-width="2.5"
										stroke-linecap="round"
									/></svg
								>
								{i + 1}. {factorLabel(row.fc)}
							</td>
							<td class="num">{row.corner ? formatSI(row.corner, 'Hz', 3) : '—'}</td>
							<td class="num"
								>{row.corner
									? `${row.slope > 0 ? '+' : ''}${row.slope} dB/dec`
									: row.fc.type === 'power'
										? 'none'
										: '—'}</td
							>
							<td class="num"
								>{row.corner ? `${row.err > 0 ? '+' : ''}${trimNumber(row.err, 3)} dB` : '—'}</td
							>
							<td class="num"
								>{row.corner
									? `${trimNumber(row.ph, 4)}°`
									: row.fc.type === 'delay'
										? '−360°·f·T'
										: `${row.ph}°`}</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		{#if hasPower}<p class="small muted note">
				sⁿ has no corner: it adds 20n dB/decade to the slope and n·90° to the phase at every
				frequency, passing through 0 dB at f<sub>u</sub>.
			</p>{/if}
	</Card>

	{#snippet theory()}
		<h2>Reading and drawing Bode plots</h2>
		<p>
			A Bode plot shows <Tex math={'20\\log_{10}|H(j\\omega)|'} /> and <Tex
				math={'\\angle H(j\\omega)'}
			/> against
			<Tex math={'\\log f'} />. Writing H as a product of simple factors makes both plots
			<em>sums</em>, because
		</p>
		<Tex
			display
			math={'20\\log_{10}\\Big|\\prod_i H_i\\Big| = \\sum_i 20\\log_{10}|H_i|\\qquad\\qquad \\angle\\prod_i H_i = \\sum_i \\angle H_i'}
		/>
		<p>
			So you can sketch any rational H by drawing each factor's straight-line approximation and
			adding them. A factor of 10 in magnitude is 20 dB; a factor of 2 is ≈ 6 dB; a decade is a
			factor of 10 in frequency.
		</p>

		<h3>The elementary factors</h3>
		<div class="table-wrap">
			<table class="wide">
				<thead><tr><th>Factor</th><th>Magnitude asymptote</th><th>Phase</th></tr></thead>
				<tbody>
					<tr
						><td><Tex math={'K'} /></td><td>flat at <Tex math={'20\\log_{10}|K|'} /></td><td
							>0° (or −180° if K &lt; 0)</td
						></tr
					>
					<tr
						><td><Tex math={'(s/\\omega_u)^{n}'} /></td><td
							>straight line, <Tex math={'20n'} /> dB/decade through 0 dB at ω<sub>u</sub></td
						><td><Tex math={'n\\cdot 90^\\circ'} /></td></tr
					>
					<tr
						><td><Tex math={'1/(1+s/\\omega_p)'} /></td><td
							>0 dB, then −20 dB/decade above ω<sub>p</sub></td
						><td>0° → −90°, −45° at ω<sub>p</sub></td></tr
					>
					<tr
						><td><Tex math={'1+s/\\omega_z'} /></td><td
							>0 dB, then +20 dB/decade above ω<sub>z</sub></td
						><td>0° → +90°, +45° at ω<sub>z</sub></td></tr
					>
					<tr
						><td><Tex math={'\\dfrac{1}{1+2\\zeta s/\\omega_n+(s/\\omega_n)^2}'} /></td><td
							>0 dB, then −40 dB/decade above ω<sub>n</sub></td
						><td>0° → −180°, −90° at ω<sub>n</sub></td></tr
					>
					<tr
						><td><Tex math={'e^{-sT}'} /></td><td>0 dB (all-pass)</td><td
							><Tex math={'-\\omega T'} /> — unbounded, curves down on a log axis</td
						></tr
					>
				</tbody>
			</table>
		</div>
		<p>
			Each order of pole bends the magnitude down by 20 dB/decade (≈ 6 dB/octave) at its corner;
			each order of zero bends it up by the same amount. The corner (break) frequency of a
			first-order factor is where its real and imaginary parts are equal.
		</p>

		<h3>How wrong are the straight lines?</h3>
		<p>For a first-order factor the largest magnitude error is at the corner itself:</p>
		<Tex
			display
			math={'\\big|1+j\\big| = \\sqrt2 \\quad\\Rightarrow\\quad \\pm 3.01\\text{ dB at } \\omega = \\omega_c'}
		/>
		<p>
			One octave either side the error is ±0.97 dB, and the straight-line phase is off by
			<Tex math={'\\arctan(0.1) = 5.7^\\circ'} /> at <Tex math={'\\omega_c/10'} /> and <Tex
				math={'10\\,\\omega_c'}
			/>.
		</p>
		<p>
			For a second-order factor the error depends on the damping. At <Tex math={'\\omega_n'} /> the exact
			magnitude is
			<Tex math={'-20\\log_{10}(2\\zeta)'} /> dB (poles), so a lightly damped pair rises far above the
			asymptote. For
			<Tex math={'\\zeta < 1/\\sqrt2'} /> there is a resonant peak
		</p>
		<Tex
			display
			math={'M_r = \\frac{1}{2\\zeta\\sqrt{1-\\zeta^2}}\\quad\\text{at}\\quad \\omega_r = \\omega_n\\sqrt{1-2\\zeta^2},'}
		/>
		<p>
			e.g. +14 dB for ζ = 0.1. The phase also falls more abruptly the smaller ζ is: the one-decade
			linear rule is exact only near ζ = 1, the <Tex
				math={'\\omega_n/10^{\\zeta}\\ldots\\omega_n 10^{\\zeta}'}
			/> rule tracks the damping, and the step is the limit ζ → 0. Pick one in <em>Display</em> to compare
			them.
		</p>

		<h3>Gain and phase are linked (minimum phase)</h3>
		<p>
			If every pole and zero is in the left half-plane and there is no delay, H is <strong
				>minimum phase</strong
			>
			and its phase is fixed by its magnitude (Bode's gain–phase relation). Roughly, a sustained slope
			of <Tex math={'20n'} /> dB/decade comes with a phase of about <Tex
				math={'n\\cdot 90^\\circ'}
			/>. A right-half-plane zero or a delay adds phase lag without changing |H| — which is why they
			are so harmful in feedback loops.
		</p>

		<h3>Stability margins of a feedback loop</h3>
		<p>
			With loop gain L(s), the closed loop <Tex math={'L/(1+L)'} /> becomes unstable when <Tex
				math={'L(j\\omega) = -1'}
			/>, i.e. |L| = 1 (0 dB) <em>and</em> ∠L = −180° at the same frequency. The margins measure how far
			the loop is from that point:
		</p>
		<Tex
			display
			math={'\\text{PM} = 180^\\circ + \\angle L(j\\omega_{gc}),\\qquad |L(j\\omega_{gc})| = 1'}
		/>
		<Tex
			display
			math={'\\text{GM} = -20\\log_{10}|L(j\\omega_{pc})|,\\qquad \\angle L(j\\omega_{pc}) = -180^\\circ'}
		/>
		<p>
			For a loop gain that is itself stable, positive margins mean a stable closed loop; typical
			design targets are PM ≥ 45° and GM ≥ 6 dB. Phase margin also predicts damping: PM ≈ 100·ζ
			degrees for a dominant second-order closed loop.
		</p>
		<p>
			The converse does not hold. A <strong>conditionally stable</strong> loop has |L| &gt; 1 at a
			phase crossover (a negative gain margin) and is still stable; for it, <em>lowering</em> the gain
			is what destabilises the loop. The verdict above is therefore decided from the closed-loop poles,
			the roots of 1 + L(s) = 0 (or by the Nyquist criterion when there is a delay), not from the signs
			of the margins.
		</p>

		<Callout kind="try">
			<ul>
				<li>
					Load <em>2nd-order resonance</em> and lower ζ: the exact curve pulls away from the
					asymptote by −20·log₁₀(2ζ) dB at f<sub>n</sub>, and the phase becomes a step.
				</li>
				<li>
					Load <em>Lead compensator</em> and move the pole away from the zero: the phase bump grows
					towards +90° and centres on the geometric mean √(f<sub>z</sub>·f<sub>p</sub>).
				</li>
				<li>
					Load <em>Integrator + two poles</em> (open-loop analysis turns on), then raise the 0 dB frequency
					of 1/s: the crossover moves up and the phase margin falls.
				</li>
				<li>
					Load <em>Loop with time delay</em> and lengthen T: the magnitude is untouched but the phase
					curve dives; near T ≈ 1.9 ms both margins reach zero and the closed loop goes unstable.
				</li>
				<li>
					Toggle <em>Right half-plane</em> on a real zero: the magnitude plot does not change at all,
					but the phase heads the other way.
				</li>
			</ul>
		</Callout>
	{/snippet}
</ToolLayout>

{#snippet marginMark(ctx: PlotContext, f: number, from: number, to: number, text: string)}
	{@const x = ctx.x(f)}
	{@const y0 = ctx.y(from)}
	{@const y1 = ctx.y(to)}
	{@const right = x < ctx.left + ctx.innerWidth * 0.7}
	{#if Number.isFinite(x) && Number.isFinite(y0) && Number.isFinite(y1)}
		<line class="mline" x1={x} x2={x} y1={y0} y2={y1} />
		<line class="mtick" x1={x - 5} x2={x + 5} y1={y0} y2={y0} />
		<line class="mtick" x1={x - 5} x2={x + 5} {y1} y2={y1} />
		<text
			class="mlabel"
			x={right ? x + 8 : x - 8}
			y={Math.max(ctx.top + 26, Math.min(ctx.top + ctx.innerHeight - 6, (y0 + y1) / 2 + 4))}
			text-anchor={right ? 'start' : 'end'}>{text}</text
		>
	{/if}
{/snippet}

{#snippet magOverlay(ctx: PlotContext)}
	{#each [gmMain, gmDown] as c, i (i)}
		{#if c}
			{@render marginMark(ctx, c.f, 0, -c.margin, `GM ${trimNumber(c.margin, 3)} dB`)}
		{/if}
	{/each}
{/snippet}

{#snippet phaseOverlay(ctx: PlotContext)}
	{#if marg?.pm}
		{@const ph = totalExact(factors, marg.pm.f).deg}
		{@render marginMark(
			ctx,
			marg.pm.f,
			ph - marg.pm.margin,
			ph,
			`PM ${trimNumber(marg.pm.margin, 3)}°`
		)}
	{/if}
{/snippet}

<style>
	.tight {
		margin: 0;
	}
	.add {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.5rem;
		align-items: end;
	}
	.card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		padding: 0.75rem 0.9rem 0.6rem;
		min-width: 0;
	}
	.note {
		margin: 0.4rem 0 0;
	}
	.table-wrap {
		overflow-x: auto;
		position: relative;
	}
	.table-wrap table:not(.wide) {
		min-width: 560px;
	}
	.table-wrap svg {
		margin-right: 0.3rem;
	}
	.table-wrap table:not(.wide) td:first-child {
		white-space: nowrap;
	}
	.mline {
		stroke: var(--text);
		stroke-width: 2;
	}
	.mtick {
		stroke: var(--text);
		stroke-width: 1.5;
	}
	.mlabel {
		fill: var(--text);
		font-size: 12px;
		font-weight: 600;
		paint-order: stroke;
		stroke: var(--chart-surface);
		stroke-width: 3px;
	}
</style>
