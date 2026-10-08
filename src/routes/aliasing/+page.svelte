<script lang="ts">
	import { onMount } from 'svelte';
	import ToolLayout from '$lib/components/layout/ToolLayout.svelte';
	import Card from '$lib/components/layout/Card.svelte';
	import Select from '$lib/components/controls/Select.svelte';
	import Segmented from '$lib/components/controls/Segmented.svelte';
	import Slider from '$lib/components/controls/Slider.svelte';
	import NumberInput from '$lib/components/controls/NumberInput.svelte';
	import Toggle from '$lib/components/controls/Toggle.svelte';
	import Plot, { type Series } from '$lib/components/plot/Plot.svelte';
	import { freqFormat } from '$lib/components/plot/scales';
	import StatGrid, { type Stat } from '$lib/components/content/StatGrid.svelte';
	import Callout from '$lib/components/content/Callout.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import { FAMILIES, estimateOrder, familyInfo, type AnalogFamily } from '$lib/dsp/analog';
	import { abs } from '$lib/dsp/complex';
	import { designAnalog, estimateFromSpecs } from '$lib/dsp/design';
	import { freqsZpk, linspace, logspace } from '$lib/dsp/response';
	import type { ZPK } from '$lib/dsp/types';
	import { formatSI, trimNumber } from '$lib/dsp/units';
	import {
		adcDynamicRange,
		aliasOf,
		aliasWave,
		foldingCurve,
		isMonotonicFamily,
		minOrderMonotonic,
		monotonicAttenuation,
		orderVsOsr,
		triangle
	} from '$lib/features/aliasing/aliasing';
	import { readSharedState } from '$lib/share';

	const TWO_PI = 2 * Math.PI;
	const hz = (v: number, d = 4) => formatSI(v, 'Hz', d);

	// =====================================================================
	// Part A — time domain
	// =====================================================================
	let fsA = $state(1000);
	let fA = $state(900);
	let phiDeg = $state(30);
	let nShow = $state(20);

	const fEff = $derived(Math.min(Math.max(fA, 0), 3 * fsA));
	const al = $derived(aliasOf(fEff, fsA));
	const wave = $derived(aliasWave(fEff, fsA, (phiDeg * Math.PI) / 180));

	const timeSeries = $derived.by((): Series[] => {
		const T = nShow / fsA;
		const phi = (phiDeg * Math.PI) / 180;
		const nDense = Math.min(8000, Math.max(800, Math.ceil(fEff * T * 40)));
		const td = linspace(0, T, nDense);
		const ts = Array.from({ length: nShow + 1 }, (_, n) => n / fsA);
		const ta = linspace(0, T, 800);
		const fmt = (v: number) => trimNumber(v, 3);
		return [
			{ x: td, y: td.map((t) => Math.cos(TWO_PI * fEff * t + phi)), label: `Input, ${hz(fEff, 3)}`, format: fmt },
			{ x: ts, y: ts.map((t) => Math.cos(TWO_PI * fEff * t + phi)), label: 'Samples', kind: 'stem', format: fmt },
			{ x: ta, y: ta.map((t) => Math.cos(TWO_PI * wave.fa * t + wave.phase)), label: `${al.folds ? 'Alias' : 'Lowest fit'}, ${hz(wave.fa, 3)}`, dash: '6 4', format: fmt }
		];
	});

	const folding = $derived.by(() => {
		const fmax = 3 * fsA;
		const c = foldingCurve(fsA, fmax);
		const series: Series[] = [{ x: c.x, y: c.y, label: 'Apparent frequency', format: (v) => hz(v) }];
		const vlines = Array.from({ length: 6 }, (_, i) => ({ value: ((i + 1) * fsA) / 2, label: ['fs/2', 'fs', '3fs/2', '2fs', '5fs/2', '3fs'][i] }));
		const regions = [1, 3, 5].map((i) => ({ x0: (i * fsA) / 2, x1: ((i + 1) * fsA) / 2, y0: 0, y1: fsA / 2, kind: 'neutral' as const, label: 'Even Nyquist zone (spectrum inverted)' }));
		return { series, vlines, regions, fmax };
	});

	const markerA = $derived([{ id: 'f', x: fEff, y: al.fa, draggable: true, axis: 'x' as const, color: 'var(--s2)' }]);
	function onFoldDrag(_id: string | number, x: number) {
		fA = Number(Math.min(3 * fsA, Math.max(0, x)).toPrecision(3));
	}

	const statsA = $derived.by((): Stat[] => [
		{ label: 'Nyquist fs/2', value: hz(fsA / 2) },
		{ label: 'Apparent fₐ', value: hz(al.fa), hint: 'fₐ = |f − fs·round(f/fs)|' },
		{ label: 'Status', value: al.folds ? 'Aliased' : 'No aliasing', status: al.folds ? 'warning' : 'good' },
		{ label: 'Nyquist zone', value: `${al.zone}${al.inverted ? ' (inverted)' : ''}`, hint: 'Zone n spans (n−1)·fs/2 … n·fs/2; even zones fold with the phase reversed' },
		{ label: 'Samples / cycle', value: fEff > 0 ? trimNumber(fsA / fEff, 3) : '∞', hint: 'Must exceed 2 to avoid aliasing' },
		{ label: 'Alias phase', value: `${trimNumber(((wave.phase * 180) / Math.PI + 540) % 360 - 180, 3)}°`, hint: 'Input phase φ, negated in even Nyquist zones' }
	]);

	// =====================================================================
	// Part B — spectrum, images and the anti-alias filter
	// =====================================================================
	let fsB = $state(48000);
	let bw = $state(20000);
	let toneOn = $state(true);
	let fTone = $state(30000);
	let toneAmp = $state(0.5);
	let aaOn = $state(true);
	let aaFamily = $state<AnalogFamily>('butter');
	let aaOrder = $state(4);
	let aaFc = $state(22000);
	let magMode = $state<'lin' | 'db'>('lin');

	const AA_FAMILIES: AnalogFamily[] = ['butter', 'cheby1', 'ellip', 'bessel'];
	const aaRp = 0.5;
	const aaRs = 60;

	const aa = $derived.by((): { zpk: ZPK | null; error: string | null } => {
		if (!aaOn) return { zpk: null, error: null };
		try {
			return { zpk: designAnalog({ family: aaFamily, band: 'lowpass', order: aaOrder, f1: aaFc, rp: aaRp, rs: aaRs, besselNorm: 'mag' }), error: null };
		} catch (e) {
			return { zpk: null, error: (e as Error).message };
		}
	});
	const aaMag = (f: number[]): number[] => (aa.zpk ? freqsZpk(aa.zpk, f.map((v) => TWO_PI * Math.abs(v))).map(abs) : f.map(() => 1));
	/** Spectrum after the anti-alias filter. */
	const filtered = (f: number[]): number[] => {
		const h = aaMag(f);
		return f.map((v, i) => triangle(v, bw) * h[i]);
	};
	const toDbArr = (a: number[]) => a.map((v) => (v > 1e-7 ? 20 * Math.log10(v) : NaN));

	const partB = $derived.by(() => {
		const fs = fsB;
		const nyq = fs / 2;
		const span = 2.5 * fs;
		const K = 2 + Math.ceil(bw / fs);
		// --- two-sided spectrum ---
		const grid = linspace(-span, span, 1601);
		const base = filtered(grid);
		const images = new Array(grid.length).fill(0);
		for (let k = -K; k <= K; k++) {
			if (k === 0) continue;
			const v = filtered(grid.map((f) => f - k * fs));
			for (let i = 0; i < grid.length; i++) images[i] += v[i];
		}
		const toneLevel = toneOn ? toneAmp * aaMag([fTone])[0] : 0;
		const tx: number[] = [];
		for (let k = -K; k <= K; k++) for (const sgn of [-1, 1]) {
			const f = sgn * fTone + k * fs;
			if (Math.abs(f) <= span) tx.push(f);
		}
		tx.sort((a, b) => a - b);
		const ty = tx.map(() => toneLevel);
		const db = magMode === 'db';
		const fmt = db ? (v: number) => `${trimNumber(v, 3)} dB` : (v: number) => trimNumber(v, 3);
		const two: Series[] = [
			{ x: grid, y: db ? toDbArr(base) : base, label: 'Baseband (k = 0)', kind: db ? 'line' : 'area', color: 'var(--s1)', format: fmt },
			{ x: grid, y: db ? toDbArr(images) : images, label: 'Images (k ≠ 0)', kind: db ? 'line' : 'area', color: 'var(--s2)', format: fmt },
			{ x: toneOn ? tx : [], y: db ? toDbArr(ty) : ty, label: 'Interferer tone + images', kind: db ? 'points' : 'stem', color: 'var(--s3)', format: fmt },
			{ x: aaOn ? grid : [], y: aaOn ? (db ? toDbArr(aaMag(grid)) : aaMag(grid)) : [], label: 'Anti-alias filter |H|', color: 'var(--s4)', dash: '6 4', format: fmt }
		];
		// --- what lands in 0 … fs/2 ---
		const g2 = linspace(0, nyq, 801);
		const wanted = filtered(g2);
		const aliased = new Array(g2.length).fill(0);
		for (let k = -K; k <= K; k++) {
			if (k === 0) continue;
			const v = filtered(g2.map((f) => f - k * fs));
			for (let i = 0; i < g2.length; i++) aliased[i] += v[i];
		}
		const ta = aliasOf(fTone, fs);
		const folded: Series[] = [
			{ x: g2, y: db ? toDbArr(wanted) : wanted, label: 'Wanted signal', kind: db ? 'line' : 'area', color: 'var(--s1)', format: fmt },
			{ x: g2, y: db ? toDbArr(aliased) : aliased, label: 'Aliased signal', kind: db ? 'line' : 'area', color: 'var(--s2)', format: fmt },
			{ x: toneOn ? [ta.fa] : [], y: toneOn ? (db ? toDbArr([toneLevel]) : [toneLevel]) : [], label: ta.folds ? 'Interferer tone (aliased)' : 'Interferer tone (in band)', kind: db ? 'points' : 'stem', color: 'var(--s3)', format: fmt }
		];
		let ew = 0;
		let ea = 0;
		for (let i = 0; i < g2.length; i++) {
			ew += wanted[i] * wanted[i];
			ea += aliased[i] * aliased[i];
		}
		const vlines2 = [
			{ value: -fs * 2, label: '' },
			{ value: -fs, label: '' },
			{ value: -nyq, label: '' },
			{ value: nyq, label: 'fs/2' },
			{ value: fs, label: 'fs' },
			{ value: 2 * fs, label: '2fs' }
		];
		return { two, folded, ew, ea, toneAlias: ta, toneLevel, vlines2, span, nyq };
	});

	const statsB = $derived.by((): Stat[] => {
		const fs = fsB;
		const att = (f: number) => -20 * Math.log10(aaMag([f])[0]);
		const out: Stat[] = [{ label: 'Nyquist fs/2', value: hz(fs / 2) }];
		out.push({
			label: 'Signal band',
			value: bw <= fs / 2 ? `fits (B ≤ fs/2)` : `folds above ${hz(fs - bw, 3)}`,
			status: bw <= fs / 2 ? 'good' : 'warning',
			hint: 'A band-limited signal survives sampling only if B ≤ fs/2'
		});
		if (aaOn && aa.zpk) {
			out.push({ label: 'AA loss at B', value: `${trimNumber(att(bw), 3)} dB`, hint: 'Passband droop of the anti-alias filter at the top of the signal band' });
			out.push({ label: 'AA rejection at fs − B', value: `${trimNumber(att(Math.max(fs - bw, 1e-9)), 3)} dB`, hint: 'Lowest frequency that folds back into the signal band' });
		}
		if (toneOn) {
			const ta = partB.toneAlias;
			out.push({
				label: 'Tone appears at',
				value: `${hz(ta.fa, 4)} · ${ta.folds ? (ta.fa <= bw ? 'aliased in band' : 'aliased') : 'not aliased'}`,
				status: ta.folds && ta.fa <= bw ? 'critical' : ta.folds ? 'warning' : undefined,
				hint: ta.folds ? (ta.fa <= bw ? 'Aliased into the signal band — cannot be removed after sampling' : 'Aliased, but outside the signal band') : 'Below fs/2: not aliased'
			});
			out.push({ label: 'Tone level at the ADC', value: `${trimNumber(20 * Math.log10(Math.max(partB.toneLevel, 1e-12)), 3)} dB`, hint: 'Relative to the signal peak (0 dB)' });
		}
		const sar = partB.ea > 0 ? 10 * Math.log10(partB.ew / partB.ea) : Infinity;
		out.push({ label: 'Signal-to-alias ratio', value: Number.isFinite(sar) ? `${trimNumber(sar, 3)} dB` : '∞ (no overlap)', hint: 'Energy of the wanted vs the folded signal spectrum in 0…fs/2 (tone excluded)' });
		return out;
	});

	// =====================================================================
	// Part C — anti-alias requirement calculator
	// =====================================================================
	let fbC = $state(20000);
	let fsC = $state(48000);
	let rejC = $state(98.08);
	let rpC = $state(0.1);
	let bits = $state(16);

	const osrC = $derived(fsC / (2 * fbC));
	const partC = $derived.by(() => {
		const fstop = fsC - fbC;
		if (!(fbC > 0 && fsC > 0)) return { error: 'Frequencies must be positive.', rows: [] };
		if (!(fstop > fbC)) return { error: `The sample rate must exceed 2·fb = ${hz(2 * fbC)}: content at fs − fb = ${hz(fstop)} would fold straight into the band.`, rows: [] };
		if (!(rejC > rpC)) return { error: 'The rejection must exceed the passband ripple.', rows: [] };
		const ws = fstop / fbC;
		const rows = FAMILIES.map((fam) => {
			const info = familyInfo(fam.id);
			if (isMonotonicFamily(fam.id)) {
				const m = minOrderMonotonic(fam.id, ws, rpC, rejC);
				return {
					id: fam.id,
					name: fam.name,
					order: m.order,
					capped: m.capped,
					cutoff: m.f3 * fbC,
					cutoffMeaning: '−3 dB',
					rejection: monotonicAttenuation(fam.id, m.order, rpC, ws),
					maxOrder: info.maxOrder,
					needed: NaN
				};
			}
			const est = estimateFromSpecs(fam.id, { band: 'lowpass', fp: fbC, fstop, rp: rpC, rs: rejC });
			const zpk = designAnalog({ family: fam.id, band: 'lowpass', order: est.order, f1: est.f1, rp: rpC, rs: rejC });
			const rejection = -20 * Math.log10(abs(freqsZpk(zpk, [TWO_PI * fstop])[0]));
			return {
				id: fam.id,
				name: fam.name,
				order: est.order,
				capped: est.capped,
				cutoff: est.f1,
				cutoffMeaning: fam.id === 'butter' ? '−3 dB' : fam.id === 'cheby2' ? 'stopband edge' : 'passband edge',
				rejection,
				maxOrder: info.maxOrder,
				// closed-form order, not capped by the designer's limit
				needed: estimateOrder(fam.id, ws, rpC, rejC).N
			};
		});
		return { error: null, rows };
	});

	const best = $derived.by(() => {
		const ok = partC.rows.filter((r) => !r.capped);
		return ok.length ? ok.reduce((a, b) => (b.order < a.order ? b : a)) : null;
	});

	const statsC = $derived.by((): Stat[] => [
		{ label: 'Oversampling ratio', value: trimNumber(osrC, 4), hint: 'OSR = fs / (2·fb)' },
		{ label: 'Stopband edge fs − fb', value: hz(fsC - fbC) },
		{ label: 'Transition ratio', value: fsC > 2 * fbC ? trimNumber((fsC - fbC) / fbC, 4) : '—', hint: '(fs − fb) / fb — the selectivity the filter must achieve' },
		{ label: 'Rejection needed', value: `${trimNumber(rejC, 4)} dB` },
		{ label: 'Lowest order', value: best ? `${best.order} · ${familyInfo(best.id).short}` : 'none within limits' }
	]);

	const PLOT_FAMILIES: AnalogFamily[] = ['butter', 'cheby1', 'ellip', 'bessel'];
	const orderPlot = $derived.by(() => {
		if (!(rejC > rpC)) return null;
		const osr = logspace(1.1, 16, 240);
		const series: Series[] = PLOT_FAMILIES.map((fam) => ({
			x: osr,
			y: orderVsOsr(fam, rpC, rejC, osr),
			label: familyInfo(fam).name,
			kind: 'step' as const,
			format: (v: number) => `order ${v}`
		}));
		let top = 0;
		for (const s of series) for (let i = 0; i < s.y.length; i++) if (Number.isFinite(s.y[i])) top = Math.max(top, s.y[i]);
		return { series, yMax: Math.min(40, top + 1) };
	});

	// =====================================================================
	// Share
	// =====================================================================
	const shared = $derived({ fsA, fA, phiDeg, nShow, fsB, bw, toneOn, fTone, toneAmp, aaOn, aaFamily, aaOrder, aaFc, magMode, fbC, fsC, rejC, rpC, bits });
	onMount(() => {
		const st = readSharedState<typeof shared>();
		if (!st) return;
		const pos = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
		if (pos(st.fsA)) fsA = st.fsA;
		if (typeof st.fA === 'number' && st.fA >= 0) fA = st.fA;
		if (typeof st.phiDeg === 'number') phiDeg = st.phiDeg;
		if (pos(st.nShow)) nShow = Math.round(st.nShow);
		if (pos(st.fsB)) fsB = st.fsB;
		if (pos(st.bw)) bw = st.bw;
		if (typeof st.toneOn === 'boolean') toneOn = st.toneOn;
		if (pos(st.fTone)) fTone = st.fTone;
		if (pos(st.toneAmp)) toneAmp = st.toneAmp;
		if (typeof st.aaOn === 'boolean') aaOn = st.aaOn;
		if (st.aaFamily && AA_FAMILIES.includes(st.aaFamily)) aaFamily = st.aaFamily;
		if (pos(st.aaOrder)) aaOrder = Math.min(12, Math.round(st.aaOrder));
		if (pos(st.aaFc)) aaFc = st.aaFc;
		if (st.magMode === 'lin' || st.magMode === 'db') magMode = st.magMode;
		if (pos(st.fbC)) fbC = st.fbC;
		if (pos(st.fsC)) fsC = st.fsC;
		if (pos(st.rejC)) rejC = st.rejC;
		if (pos(st.rpC)) rpC = st.rpC;
		if (pos(st.bits)) bits = Math.round(st.bits);
	});

	const aaFamilyOptions = AA_FAMILIES.map((f) => ({ value: f, label: familyInfo(f).name }));
	const msFormat = (v: number) => formatSI(v, 's', 3);
</script>

<ToolLayout slug="aliasing" share={shared} related={['analog-designer', 'iir-designer', 'order-calculator', 'rlc', 'signal-lab']}>
	<!-- ============================ Part A ============================ -->
	<Card title="A · A sinusoid, sampled" subtitle="Samples taken at fs cannot tell f apart from any f ± k·fs. The dashed curve is the lowest-frequency sinusoid through the same samples.">
		<div class="ctrl">
			<Slider label="Sample rate fs" bind:value={fsA} min={10} max={100000} log unit="Hz" onchange={(v) => (fA = Math.min(fA, 3 * v))} />
			<Slider label="Signal frequency f" bind:value={fA} min={0} max={3 * fsA} step={fsA / 1000} unit="Hz" />
			<Slider label="Phase φ" bind:value={phiDeg} min={-180} max={180} step={1} unit="°" />
			<Slider label="Samples shown" bind:value={nShow} min={6} max={60} integer />
		</div>
		<StatGrid stats={statsA} />
		<div class="two">
			<div class="cell">
				<Plot
					series={timeSeries}
					title="Time domain"
					xLabel="Time (s)"
					yLabel="Amplitude"
					xFormat={msFormat}
					xTooltipFormat={msFormat}
					yDomain={[-1.25, 1.25]}
					height={280}
					exportName="sampled-sinusoid"
				/>
			</div>
			<div class="cell">
				<Plot
					series={folding.series}
					title="Frequency folding"
					xLabel="Input frequency (Hz)"
					yLabel="Apparent (Hz)"
					xFormat={freqFormat}
					yFormat={freqFormat}
					xTooltipFormat={(v) => hz(v)}
					xDomain={[0, folding.fmax]}
					yDomain={[0, (fsA / 2) * 1.08]}
					vlines={folding.vlines}
					regions={folding.regions}
					markers={markerA}
					onmarkerdrag={onFoldDrag}
					height={280}
				/>
				<p class="small muted cap">Drag the handle to sweep f. Shaded (even) zones fold with the spectrum inverted.</p>
			</div>
		</div>
	</Card>

	<!-- ============================ Part B ============================ -->
	<Card title="B · Spectrum, images and folding" subtitle="Sampling copies the spectrum to every multiple of fs. Whatever lands in 0…fs/2 is all the converter can see.">
		<div class="ctrl">
			<Slider label="Sample rate fs" bind:value={fsB} min={1000} max={200000} log unit="Hz" />
			<Slider label="Signal bandwidth B" bind:value={bw} min={fsB * 0.05} max={fsB * 1.2} log unit="Hz" />
			<Toggle bind:checked={toneOn} label="Interfering tone" />
			{#if toneOn}
				<Slider label="Tone frequency" bind:value={fTone} min={fsB * 0.05} max={fsB * 2.4} log unit="Hz" />
				<Slider label="Tone amplitude" bind:value={toneAmp} min={0.05} max={1} step={0.05} />
			{/if}
		</div>
		<div class="ctrl aa">
			<Toggle bind:checked={aaOn} label="Anti-alias filter before sampling" />
			{#if aaOn}
				<Select label="Family" bind:value={aaFamily} options={aaFamilyOptions} />
				<Slider label="Order" bind:value={aaOrder} min={1} max={12} integer />
				<Slider label="Cutoff" bind:value={aaFc} min={fsB * 0.02} max={fsB * 2} log unit="Hz" />
			{/if}
			<Segmented
				label="Magnitude"
				bind:value={magMode}
				options={[
					{ value: 'lin', label: 'Linear' },
					{ value: 'db', label: 'dB' }
				]}
			/>
		</div>
		{#if aa.error}<Callout kind="danger">{aa.error}</Callout>{/if}
		<StatGrid stats={statsB} />
		<div class="gap"></div>
		<Plot
			series={partB.two}
			title="After sampling: baseband and its images"
			xLabel="Frequency (Hz)"
			yLabel={magMode === 'db' ? 'Magnitude (dB)' : 'Magnitude'}
			xFormat={freqFormat}
			xTooltipFormat={(v) => hz(v)}
			xDomain={[-partB.span, partB.span]}
			yDomain={magMode === 'db' ? [-100, 5] : [0, 1.1]}
			vlines={partB.vlines2}
			regions={[{ x0: -partB.nyq, x1: partB.nyq, y0: magMode === 'db' ? -100 : 0, y1: magMode === 'db' ? 5 : 1.1, kind: 'neutral', label: 'First Nyquist zone' }]}
			height={300}
			exportName="sampled-spectrum"
		/>
		<p class="small muted cap">
			Grey band: the first Nyquist zone, −fs/2…fs/2. {aaOn ? `Spectra are shown after the ${familyInfo(aaFamily).name} anti-alias filter${aaFamily === 'cheby1' || aaFamily === 'ellip' ? ` (Rp = ${aaRp} dB${aaFamily === 'ellip' ? `, Rs = ${aaRs} dB` : ''})` : ''}.` : 'No anti-alias filter: everything above fs/2 folds back unattenuated.'}
		</p>
		<Plot
			series={partB.folded}
			title="What the converter sees: 0 … fs/2"
			xLabel="Frequency (Hz)"
			yLabel={magMode === 'db' ? 'Magnitude (dB)' : 'Magnitude'}
			xFormat={freqFormat}
			xTooltipFormat={(v) => hz(v)}
			xDomain={[0, partB.nyq]}
			yDomain={magMode === 'db' ? [-100, 5] : [0, 1.1]}
			vlines={bw < fsB / 2 ? [{ value: bw, label: 'B' }] : []}
			height={260}
			exportName="folded-spectrum"
		/>
	</Card>

	<!-- ============================ Part C ============================ -->
	<Card title="C · How steep must the anti-alias filter be?" subtitle="Everything from fs − fb upward folds into the band 0…fb, so it must be attenuated below the converter's noise floor.">
		<div class="ctrl">
			<NumberInput label="Signal bandwidth fb" bind:value={fbC} unit="Hz" si min={1e-3} logStep={1.05} />
			<NumberInput label="Sample rate fs" bind:value={fsC} unit="Hz" si min={1e-3} logStep={1.05} />
			<NumberInput label="Alias rejection" bind:value={rejC} unit="dB" min={1} max={250} step={1} />
			<NumberInput label="Passband ripple / loss Rp" bind:value={rpC} unit="dB" min={0.001} max={3} logStep={1.25} />
			<div class="bits">
				<NumberInput label="ADC bits N" bind:value={bits} min={1} max={32} integer />
				<button type="button" class="btn small" onclick={() => (rejC = Number(adcDynamicRange(bits).toFixed(2)))}>Set rejection to 6.02·N + 1.76 dB</button>
			</div>
		</div>
		{#if partC.error}
			<Callout kind="danger">{partC.error}</Callout>
		{:else}
			<StatGrid stats={statsC} />
			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th>Family</th>
							<th class="num">Minimum order</th>
							<th class="num">Design cutoff</th>
							<th class="num">Rejection at fs − fb</th>
							<th>Spec</th>
						</tr>
					</thead>
					<tbody>
						{#each partC.rows as r (r.id)}
							<tr>
								<td>{r.name}</td>
								<td class="num">{r.capped ? (Number.isFinite(r.needed) ? r.needed : `> ${r.maxOrder}`) : r.order}</td>
								<td class="num">{r.capped ? '—' : `${hz(r.cutoff, 4)}`} <span class="muted small">{r.capped ? '' : r.cutoffMeaning}</span></td>
								<td class="num">{r.capped ? (Number.isFinite(r.needed) ? '—' : `${trimNumber(r.rejection, 4)} dB at N = ${r.maxOrder}`) : `${trimNumber(r.rejection, 4)} dB`}</td>
								<td class:ok={!r.capped} class:bad={r.capped}>{r.capped ? `✕ beyond max. order ${r.maxOrder}` : '✓ meets'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="small muted">
				Passband edge fb with at most Rp of loss, stopband edge fs − fb with at least the required rejection. Bessel, Legendre, Gaussian and
				critically damped filters are monotonic, so their cutoff is the −3 dB frequency; orders are capped at each family's maximum.
			</p>
		{/if}
		{#if orderPlot}
			<Plot
				series={orderPlot.series}
				title="Required order vs oversampling ratio"
				xScale="log"
				xDomain={[1.1, 16]}
				yDomain={[0, orderPlot.yMax]}
				xLabel="Oversampling ratio fs / (2·fb)"
				yLabel="Filter order"
				xFormat={(v) => trimNumber(v, 3)}
				xTooltipFormat={(v) => `OSR ${trimNumber(v, 3)}`}
				vlines={osrC >= 1.1 && osrC <= 16 ? [{ value: osrC, label: 'this design' }] : []}
				height={300}
				exportName="aa-order-vs-osr"
			/>
			<p class="small muted cap">
				For {trimNumber(rejC, 4)} dB rejection and {rpC} dB passband loss. Butterworth, Chebyshev and elliptic orders come from closed-form
				formulas and are drawn past the designers' order limits (curves leave the top of the chart); Bessel stops where it would need more than order {familyInfo('bessel').maxOrder}.
			</p>
		{/if}
	</Card>

	{#snippet theory()}
		<h2>Sampling, folding and anti-aliasing</h2>
		<p>
			Sampling x(t) every T = 1/fs seconds multiplies it by an impulse train. In the frequency domain that copies the spectrum to every
			multiple of the sample rate:
		</p>
		<Tex display math={'X_s(f) = f_s \\sum_{k=-\\infty}^{\\infty} X(f - k f_s)'} />
		<p>
			The copies at k ≠ 0 are the <strong>images</strong>. If x(t) contains nothing at or above fs/2 (the <em>Nyquist frequency</em>), the
			copies do not overlap and x(t) can be recovered exactly — the <strong>sampling theorem</strong>. Otherwise, energy from the images lands
			inside 0…fs/2 and is indistinguishable from real signal: <strong>aliasing</strong>.
		</p>
		<h3>The folding formula</h3>
		<p>A sinusoid at f produces exactly the same samples as one at</p>
		<Tex display math={'f_a = \\left| f - f_s\\cdot \\operatorname{round}\\!\\left(\\frac{f}{f_s}\\right)\\right| \\in \\left[0, \\tfrac{f_s}{2}\\right]'} />
		<p>
			because <Tex math={'\\cos(2\\pi f n/f_s + \\varphi) = \\cos(2\\pi (f - k f_s) n/f_s + \\varphi)'} /> for every integer k. Plotted against
			f, the apparent frequency is a triangle wave: the frequency axis folds like a paper fan at every multiple of fs/2. In the even Nyquist
			zones (fs/2…fs, 3fs/2…2fs, …) the signed frequency f − k·fs is negative, so the alias has its phase reversed and a band of
			frequencies comes out mirrored (spectral inversion).
		</p>
		<h3>Anti-alias filtering</h3>
		<p>
			Once aliased, unwanted content cannot be separated from the signal, so it must be removed <em>before</em> sampling by an analog
			low-pass. If the band of interest is 0…fb, the filter does not need to reach full attenuation at fs/2 — only at
			<Tex math={'f_s - f_b'} />, the lowest frequency that folds back <em>into</em> 0…fb (content between fs/2 and fs − fb folds onto fb…fs/2,
			which a digital filter can still remove). For an N-bit converter the folded energy should sit below the quantisation noise:
		</p>
		<Tex display math={'R_s \\approx 6.02\\,N + 1.76\\ \\text{dB}\\qquad\\text{(16 bits} \\rightarrow 98\\ \\text{dB)}'} />
		<h3>The oversampling trade-off</h3>
		<p>
			The filter must go from Rp loss at fb to Rs rejection at fs − fb, a selectivity of
			<Tex math={'\\Omega_s = \\frac{f_s - f_b}{f_b} = 2\\,\\text{OSR} - 1'} />. For a Butterworth filter
		</p>
		<Tex display math={'N \\ge \\frac{\\log_{10}\\big((10^{R_s/10}-1)/(10^{R_p/10}-1)\\big)}{2\\log_{10}(2\\,\\text{OSR}-1)}'} />
		<p>
			so the order falls roughly as 1/log(OSR). Audio at 48 kHz (OSR 1.2) would need an absurd analog filter for 16 bits, which is why modern
			converters oversample by 64× or more: a gentle 2nd–3rd-order analog filter does the anti-aliasing, and a sharp digital decimation filter
			then removes everything between fb and the final fs/2.
		</p>
		<h3>Reconstruction and zero-order hold</h3>
		<p>
			A DAC holds each sample for one period, which is a convolution with a rectangle of width T. Its frequency response is a sinc:
		</p>
		<Tex display math={'H_{ZOH}(f) = e^{-j\\pi f/f_s}\\,\\frac{\\sin(\\pi f/f_s)}{\\pi f/f_s},\\qquad |H_{ZOH}(f_s/2)| = \\frac{2}{\\pi} \\;(-3.92\\ \\text{dB})'} />
		<p>
			The hold attenuates the images (with nulls at every k·fs) but not enough; an analog reconstruction filter removes the rest, and the
			passband droop of up to 3.9 dB is often pre-compensated with an inverse-sinc digital filter.
		</p>
		<Callout kind="try">
			<ul>
				<li>In part A set f to exactly fs: every sample is identical, so the alias is DC. Nudge f slightly above fs and watch a very slow alias appear — the wagon-wheel effect.</li>
				<li>Drag the folding handle through fs/2 and back: the alias frequency retraces itself, and its phase flips sign in the shaded zones.</li>
				<li>In part B, turn the anti-alias filter off: the 30 kHz tone folds to 18 kHz, right inside the 20 kHz band. Turn it back on and compare a 4th-order Butterworth with a 6th-order elliptic.</li>
				<li>Raise the signal bandwidth B above fs/2 and watch the images overlap the baseband in the 0…fs/2 view.</li>
				<li>In part C, keep fb = 20 kHz and 16-bit rejection, then try fs = 48 kHz, 96 kHz and 192 kHz: the elliptic order drops quickly, the Butterworth order dramatically.</li>
			</ul>
		</Callout>
	{/snippet}
</ToolLayout>

<style>
	.ctrl {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 230px), 1fr));
		gap: 0.7rem 1.2rem;
		align-items: end;
		margin-bottom: 0.9rem;
	}
	.ctrl.aa {
		padding-top: 0.7rem;
		border-top: 1px solid var(--border);
	}
	.two {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr));
		gap: 1rem 1.2rem;
		margin-top: 0.9rem;
	}
	.cell {
		min-width: 0;
	}
	.cap {
		margin: 0.3rem 0 0.9rem;
	}
	.gap {
		height: 0.9rem;
	}
	.bits {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.bits .btn {
		white-space: normal;
		text-align: left;
	}
	.table-wrap {
		overflow-x: auto;
		margin: 0.9rem 0 0.4rem;
	}
	td.ok {
		color: var(--good-ink);
	}
	td.bad {
		color: var(--critical-ink);
	}
</style>
