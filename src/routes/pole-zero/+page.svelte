<script lang="ts">
	import { onMount } from 'svelte';
	import ToolLayout from '$lib/components/layout/ToolLayout.svelte';
	import ControlGroup from '$lib/components/layout/ControlGroup.svelte';
	import Card from '$lib/components/layout/Card.svelte';
	import Segmented from '$lib/components/controls/Segmented.svelte';
	import Select from '$lib/components/controls/Select.svelte';
	import Slider from '$lib/components/controls/Slider.svelte';
	import NumberInput from '$lib/components/controls/NumberInput.svelte';
	import Toggle from '$lib/components/controls/Toggle.svelte';
	import PoleZeroPlot, {
		type PzContext,
		type PzHandle
	} from '$lib/components/plot/PoleZeroPlot.svelte';
	import ResponseView from '$lib/components/plot/ResponseView.svelte';
	import StatGrid, { type Stat } from '$lib/components/content/StatGrid.svelte';
	import Callout from '$lib/components/content/Callout.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import ExportPanel from '$lib/components/content/ExportPanel.svelte';
	import type { Complex } from '$lib/dsp/complex';
	import type { Filter, SOS, TF } from '$lib/dsp/types';
	import { zpk2sos, zpk2tf, zpk2tfAnalog } from '$lib/dsp/convert';
	import { linspace, logspace } from '$lib/dsp/response';
	import { formatSI, trimNumber } from '$lib/dsp/units';
	import {
		type Domain,
		type GainMode,
		type PzItem,
		type RootKind,
		S_PRESETS,
		Z_PRESETS,
		characteristicMagnitude,
		dampedPair,
		dbAt,
		evalRoots,
		findPeak,
		freqPoint,
		geometric,
		makeItem,
		minimumPhase,
		normalizeGain,
		planeGain,
		planeRoots,
		stability,
		texNum,
		toZpk,
		transferTex,
		zpkGain
	} from '$lib/features/pole-zero/model';

	const TWO_PI = 2 * Math.PI;
	const DEFAULT_FS = 48000;
	const initZ = Z_PRESETS[0].build(DEFAULT_FS);
	const initS = S_PRESETS[0].build(DEFAULT_FS);

	// ---------------- state ----------------
	let domain = $state<Domain>('z');
	let sets = $state<Record<Domain, PzItem[]>>({ z: initZ, s: initS });
	let selectedIds = $state<Record<Domain, number | null>>({ z: initZ[0].id, s: initS[0].id });
	let presetIds = $state<Record<Domain, string>>({ z: Z_PRESETS[0].id, s: S_PRESETS[0].id });
	let fs = $state(DEFAULT_FS);
	let gainMode = $state<GainMode>('peak');
	let manualK = $state<Record<Domain, number>>({ z: 1, s: 1 });
	let showHeat = $state(false);
	let showProbe = $state(true);
	let snapOn = $state(false);
	let clickMode = $state<'select' | 'pole' | 'zero'>('select');
	let probeF = $state<Record<Domain, number>>({ z: 6000, s: 980 });
	let scales = $state<Record<Domain, 'log' | 'linear'>>({ z: 'linear', s: 'log' });
	let magMode = $state<'db' | 'linear'>('db');
	/** View extent / frequency range frozen while a handle is being dragged. */
	let freeze = $state<{ extent: number; range: [number, number] } | null>(null);
	let handlePressed = false;
	let pzWidth = $state(0);

	// ---------------- roots, gain, filter ----------------
	const items = $derived(sets[domain]);
	const selectedId = $derived(selectedIds[domain]);
	const sel = $derived(items.find((it) => it.id === selectedId) ?? null);
	const roots = $derived(planeRoots(items, domain));
	const nz = $derived(roots.zeros.length);
	const np = $derived(roots.poles.length);
	const improper = $derived(domain === 's' && nz > np);

	function niceUp(v: number) {
		const p = Math.pow(10, Math.floor(Math.log10(v)));
		for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v * (1 - 1e-12)) return m * p;
		return 10 * p;
	}

	const autoExtent = $derived.by(() => {
		let m = 0;
		for (const it of items) m = Math.max(m, Math.hypot(it.re, it.pair ? it.im : 0));
		if (domain === 'z') {
			for (const s of [1.3, 1.6, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (s >= m * 1.15) return s;
			return niceUp(m * 1.15);
		}
		return m > 0 ? niceUp(m * 1.25) : 1500;
	});
	const extent = $derived(freeze?.extent ?? autoExtent);

	const gain = $derived.by(() => {
		try {
			return normalizeGain(roots, domain, gainMode, fs, planeGain(manualK[domain], domain, nz, np));
		} catch (e) {
			return { K: 1, note: String(e) };
		}
	});
	const K = $derived(gain.K);
	const k = $derived(zpkGain(K, domain, nz, np));
	const zpk = $derived(toZpk(roots, K, domain));
	const filter = $derived<Filter>(
		domain === 'z' ? { kind: 'digital', fs, zpk } : { kind: 'analog', zpk }
	);

	// ---------------- frequency ranges & probe ----------------
	const scale = $derived(scales[domain]);
	const autoRange = $derived.by((): [number, number] => {
		if (domain === 'z') return scale === 'log' ? [fs / 4000, fs / 2] : [0, fs / 2];
		if (scale === 'linear') return [0, extent];
		const fc = characteristicMagnitude(roots, 1000);
		return [
			Math.pow(10, Math.floor(Math.log10(fc)) - 2),
			Math.pow(10, Math.ceil(Math.log10(fc)) + 2)
		];
	});
	const range = $derived(domain === 's' && freeze ? freeze.range : autoRange);

	const probeRange = $derived<[number, number]>(domain === 'z' ? [0, fs / 2] : range);
	const probe = $derived(Math.min(probeRange[1], Math.max(probeRange[0], probeF[domain])));
	const probePoint = $derived(freqPoint(domain, probe, fs));
	const geo = $derived(geometric(roots, K, probePoint));
	const probeOutOfView = $derived(domain === 's' && probe > extent);

	// magnitude on the plotted grid: sets the dB axis so the probe marker always sits inside it
	const displayGrid = $derived(
		scale === 'log'
			? logspace(Math.max(range[0], 1e-9), range[1], 700)
			: linspace(range[0], range[1], 700)
	);
	const displayDb = $derived(
		displayGrid.map((f) => dbAt(roots.zeros, roots.poles, K, freqPoint(domain, f, fs)))
	);
	const dbDomain = $derived.by((): [number, number] => {
		let hi = -Infinity;
		let lo = Infinity;
		for (const v of displayDb) {
			if (!Number.isFinite(v) || v < -280 || v > 280) continue;
			hi = Math.max(hi, v);
			lo = Math.min(lo, v);
		}
		if (!Number.isFinite(hi)) return [-60, 10];
		const top = Math.ceil((hi + 3) / 10) * 10;
		const bottom = Math.max(Math.floor((lo - 3) / 10) * 10, top - 100);
		return [Math.min(bottom, top - 20), top];
	});
	const peakDisplayDb = $derived.by(() => {
		let hi = -Infinity;
		for (const v of displayDb) if (Number.isFinite(v) && v < 280) hi = Math.max(hi, v);
		return Number.isFinite(hi) ? hi : 0;
	});

	const probeMarker = $derived.by(() => {
		const x = scale === 'log' ? Math.max(probe, range[0]) : probe;
		const m = geo.mag;
		let y: number;
		if (magMode === 'db') {
			const d = m > 0 ? 20 * Math.log10(m) : -Infinity;
			y = Math.min(
				dbDomain[1],
				Math.max(dbDomain[0], Number.isFinite(d) ? d : d > 0 ? dbDomain[1] : dbDomain[0])
			);
		} else {
			const top = Math.max(
				...displayDb.filter(Number.isFinite).map((v) => Math.pow(10, v / 20)),
				1e-12
			);
			y = Number.isFinite(m) ? Math.min(m, top) : top;
		}
		return [{ id: 'probe', x, y, draggable: true, axis: 'x' as const, color: 'var(--text)' }];
	});

	function setProbe(f: number) {
		probeF[domain] = Number(Math.min(probeRange[1], Math.max(probeRange[0], f)).toPrecision(5));
	}

	// ---------------- stats ----------------
	const magAtF = (f: number) => {
		const h = evalRoots(roots.zeros, roots.poles, freqPoint(domain, f, fs));
		return Math.abs(K) * Math.hypot(h.re, h.im);
	};

	const fmtDb = (m: number) =>
		m === 0 ? '−∞ dB' : !Number.isFinite(m) ? '∞' : `${trimNumber(20 * Math.log10(m), 4)} dB`;
	const fmtHz = (f: number) => formatSI(f, 'Hz', 4);

	const stab = $derived(stability(roots.poles, domain, domain === 'z' ? 1 : extent));
	const minPh = $derived(minimumPhase(roots.zeros, domain, domain === 'z' ? 1 : extent));

	const stats = $derived.by((): Stat[] => {
		const out: Stat[] = [];
		const region = domain === 'z' ? 'inside the unit circle' : 'in the left half-plane';
		out.push({
			label: 'Stability',
			value: stab === 'stable' ? 'Stable' : stab === 'marginal' ? 'Marginal' : 'Unstable',
			status: stab === 'stable' ? 'good' : stab === 'marginal' ? 'warning' : 'critical',
			hint: `Stable when every pole is strictly ${region}.`
		});
		out.push({
			label: 'Poles / zeros',
			value: `${np} / ${nz}${roots.implied ? ` (${roots.implied} at z = 0)` : ''}`,
			hint: roots.implied
				? 'Poles at the origin are added automatically so the filter is causal.'
				: undefined
		});
		out.push({
			label: 'Minimum phase',
			value:
				minPh.status === 'yes'
					? 'Yes'
					: minPh.status === 'boundary'
						? `Boundary (${minPh.on} on ${domain === 'z' ? 'circle' : 'jω axis'})`
						: `No (${minPh.outside} zero${minPh.outside > 1 ? 's' : ''} outside)`,
			hint: `Minimum phase: all zeros strictly ${region}.`
		});
		const peak = findPeak(roots, domain, fs);
		const inf = !Number.isFinite(peak.mag);
		const pk = peak.mag * Math.abs(K);
		const pkF = peak.f;
		out.push({ label: 'DC gain', value: fmtDb(magAtF(0)) });
		if (domain === 'z')
			out.push({
				label: 'Nyquist gain',
				value: fmtDb(magAtF(fs / 2)),
				hint: 'Gain at fs/2 (z = −1)'
			});
		else {
			const hf = nz < np ? 0 : nz === np ? Math.abs(K) : Infinity;
			out.push({
				label: 'Gain as f → ∞',
				value: fmtDb(hf),
				hint: 'Set by the relative degree: more poles than zeros → falls to zero.'
			});
		}
		out.push({
			label: 'Peak',
			value: inf ? `∞ at ${fmtHz(pkF)}` : `${fmtDb(pk)} at ${fmtHz(pkF)}`
		});
		out.push({
			label: domain === 'z' ? 'Gain k' : 'Gain k (rad/s form)',
			value: trimNumber(k, 4),
			hint: 'H = k·Π(x − zᵢ)/Π(x − pᵢ)'
		});
		// slowest decay
		if (domain === 'z') {
			const rmax = Math.max(0, ...roots.poles.map((p) => Math.hypot(p.re, p.im)));
			let v = '—';
			if (rmax === 0) v = np ? `FIR — ends after ${np + 1} samples` : 'FIR';
			else if (rmax < 1) {
				const n60 = Math.log(1e-3) / Math.log(rmax);
				v = `${trimNumber(n60, 3)} samples (${formatSI(n60 / fs, 's', 3)})`;
			} else v = 'never (grows)';
			out.push({
				label: 'Decay to −60 dB',
				value: v,
				hint: 'Set by the pole closest to the unit circle: n ≈ ln(10⁻³)/ln r'
			});
		} else {
			const smax = Math.max(-Infinity, ...roots.poles.map((p) => p.re));
			let v = '—';
			if (np === 0) v = '—';
			else if (smax < 0) v = formatSI(Math.log(1000) / (TWO_PI * -smax), 's', 3);
			else v = 'never (grows)';
			out.push({
				label: 'Decay to −60 dB',
				value: v,
				hint: 'Set by the pole closest to the jω axis: t ≈ ln(1000)/|σ|'
			});
		}
		return out;
	});

	// ---------------- plot handles & interaction ----------------
	const handles = $derived<PzHandle[]>(
		items.map((it) => ({
			id: it.id,
			kind: it.kind,
			value: { re: it.re, im: it.pair ? Math.abs(it.im) : 0 },
			realOnly: !it.pair,
			selected: it.id === selectedId
		}))
	);

	const quantum = $derived(
		domain === 'z' ? 1e-4 : Math.pow(10, Math.floor(Math.log10(extent)) - 3)
	);
	const q = (v: number) => Number((Math.round(v / quantum) * quantum).toPrecision(10));

	function markEdited() {
		presetIds[domain] = 'custom';
	}

	function updateItem(id: number, patch: Partial<PzItem>) {
		const it = sets[domain].find((x) => x.id === id);
		if (!it) return;
		Object.assign(it, patch);
		if (!it.pair) it.im = 0;
		markEdited();
	}

	function onHandleMove(id: string | number, v: Complex) {
		const it = sets[domain].find((x) => x.id === Number(id));
		if (!it) return;
		it.re = q(v.re);
		if (it.pair) it.im = q(Math.abs(v.im));
		markEdited();
	}

	function onHandleSelect(id: string | number | null) {
		if (id === null) {
			selectedIds[domain] = null;
			return;
		}
		handlePressed = true;
		freeze = { extent, range };
		selectedIds[domain] = Number(id);
	}

	function onPlotClick(v: Complex) {
		// the click that ends a handle press bubbles to the plane: ignore it
		if (handlePressed) {
			handlePressed = false;
			return;
		}
		if (clickMode === 'select') {
			selectedIds[domain] = null;
			return;
		}
		const nearAxis = Math.abs(v.im) < 0.03 * extent;
		addItem(makeItem(clickMode, q(v.re), nearAxis ? 0 : q(Math.abs(v.im)), !nearAxis));
	}

	function addItem(it: PzItem) {
		sets[domain].push(it);
		selectedIds[domain] = it.id;
		markEdited();
	}

	function addDefault(kind: RootKind, pair: boolean) {
		const n = sets[domain].filter((it) => it.kind === kind && it.pair === pair).length;
		let re: number;
		let im = 0;
		if (domain === 'z') {
			if (pair) {
				const r = kind === 'pole' ? 0.8 : 1;
				const deg = ((kind === 'pole' ? 60 : 135) + 25 * n) % 180;
				re = r * Math.cos((deg * Math.PI) / 180);
				im = r * Math.sin((deg * Math.PI) / 180);
			} else re = kind === 'pole' ? Math.max(-0.95, 0.6 - 0.25 * n) : Math.min(1, -1 + 0.4 * n);
		} else {
			const S = characteristicMagnitude(roots, 1000);
			if (pair) {
				if (kind === 'pole') [re, im] = dampedPair(S * (1 + 0.6 * n), 0.3);
				else [re, im] = [0, S * (1.8 + 0.6 * n)];
			} else re = kind === 'pole' ? -S * (0.4 + 0.3 * n) : -S * (2.5 + 0.8 * n);
		}
		addItem(makeItem(kind, q(re), q(im), pair));
	}

	function deleteSelected() {
		const id = selectedIds[domain];
		if (id === null) return;
		removeItem(id);
	}

	function removeItem(id: number) {
		const list = sets[domain];
		const idx = list.findIndex((it) => it.id === id);
		if (idx < 0) return;
		list.splice(idx, 1);
		if (selectedIds[domain] === id) selectedIds[domain] = null;
		markEdited();
	}

	function clearAll() {
		sets[domain] = [];
		selectedIds[domain] = null;
		markEdited();
	}

	const presets = $derived(domain === 'z' ? Z_PRESETS : S_PRESETS);
	const presetInfo = $derived(presets.find((p) => p.id === presetIds[domain]));
	const presetOptions = $derived([
		...presets.map((p) => ({ value: p.id, label: p.label })),
		{ value: 'custom', label: 'Custom (edited)', disabled: true }
	]);

	function loadPreset(id: string) {
		const p = presets.find((x) => x.id === id);
		if (!p) return;
		const list = p.build(fs);
		sets[domain] = list;
		presetIds[domain] = id;
		const first = p.select ? list.find((it) => it.kind === p.select) : undefined;
		selectedIds[domain] = first?.id ?? null;
		// park the probe on the most resonant pole pair
		const pole = list.find((it) => it.kind === 'pole' && it.pair);
		if (pole) {
			probeF[domain] =
				domain === 'z'
					? Number(((Math.atan2(pole.im, pole.re) / TWO_PI) * fs).toPrecision(5))
					: Number(pole.im.toPrecision(5));
		}
	}

	function setGainMode(v: GainMode) {
		if (v === 'manual') manualK[domain] = Number(k.toPrecision(4));
		gainMode = v;
	}

	onMount(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== 'Delete' && e.key !== 'Backspace') return;
			const t = e.target as HTMLElement | null;
			if (
				t &&
				(t.tagName === 'INPUT' ||
					t.tagName === 'TEXTAREA' ||
					t.tagName === 'SELECT' ||
					t.isContentEditable)
			)
				return;
			if (selectedIds[domain] === null) return;
			e.preventDefault();
			deleteSelected();
		};
		const onUp = () =>
			setTimeout(() => {
				handlePressed = false;
				freeze = null;
			}, 0);
		window.addEventListener('keydown', onKey);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onUp);
		return () => {
			window.removeEventListener('keydown', onKey);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onUp);
		};
	});

	// ---------------- heatmap ----------------
	const heatFn = $derived.by(() => {
		if (!showHeat) return null;
		const z = roots.zeros;
		const p = roots.poles;
		const KK = K;
		return (x: Complex) => dbAt(z, p, KK, x);
	});
	const heatRange = $derived<[number, number]>([
		Math.round(peakDisplayDb) - 40,
		Math.round(peakDisplayDb) + 20
	]);
	const pzHeight = $derived(Math.round(Math.min(540, Math.max(300, pzWidth || 400))));

	// ---------------- selected-root controls ----------------
	const selPolar = $derived.by(() => {
		if (!sel) return null;
		const im = sel.pair ? sel.im : 0;
		const r = Math.hypot(sel.re, im);
		return { r, theta: Math.atan2(im, sel.re) };
	});

	function setZPolar(r: number, theta: number) {
		if (!sel) return;
		updateItem(sel.id, { re: q(r * Math.cos(theta)), im: q(r * Math.sin(theta)) });
	}
	function setSPair(f0: number, zeta: number) {
		if (!sel) return;
		const [re, im] = dampedPair(f0, zeta);
		updateItem(sel.id, { re: q(re), im: q(im) });
	}

	// ---------------- transfer function ----------------
	const tfTex = $derived.by(() => {
		const sc = domain === 's' ? TWO_PI : 1;
		const conv = (it: PzItem) => ({ re: it.re * sc, im: it.pair ? it.im * sc : 0, pair: it.pair });
		const zs = items.filter((it) => it.kind === 'zero').map(conv);
		const ps = items.filter((it) => it.kind === 'pole').map(conv);
		for (let i = 0; i < roots.implied; i++) ps.push({ re: 0, im: 0, pair: false });
		return transferTex(domain, zs, ps, k);
	});

	const exportData = $derived.by((): { sos?: SOS; tf?: TF; error?: string } => {
		try {
			if (domain === 'z') return { sos: zpk2sos(zpk), tf: zpk2tf(zpk) };
			return { tf: zpk2tfAnalog(zpk) };
		} catch (e) {
			return { error: e instanceof Error ? e.message : String(e) };
		}
	});

	// ---------------- geometric readout ----------------
	const deg = (rad: number) => (rad * 180) / Math.PI;
	const fmtDeg = (rad: number) => `${trimNumber(deg(rad), 4)}^\\circ`;
	const lenList = (kind: RootKind) => {
		const v = geo.vectors.filter((x) => x.kind === kind);
		if (!v.length) return '1';
		if (v.length > 4) return texNum(kind === 'zero' ? geo.prodZ : geo.prodP, 4);
		return v.map((x) => texNum(x.len, 3)).join('\\cdot ');
	};
	const pointTex = $derived(domain === 'z' ? 'e^{j\\omega}' : 'jf');
	const magTex = $derived.by(() => {
		const lhs = domain === 'z' ? '|H(e^{j\\omega})|' : '|H(j2\\pi f)|';
		const symbolic = `|K|\\,\\dfrac{\\prod_i |${pointTex}-z_i|}{\\prod_i |${pointTex}-p_i|}`;
		const val = Number.isFinite(geo.mag)
			? `${texNum(geo.mag, 4)}\\;\\;(${geo.mag > 0 ? trimNumber(20 * Math.log10(geo.mag), 4) + '\\text{ dB}' : '-\\infty\\text{ dB}'})`
			: Number.isNaN(geo.mag)
				? '\\text{undefined (pole and zero coincide)}'
				: '\\infty';
		return `\\begin{aligned}${lhs} &= ${symbolic}\\\\ &= ${texNum(Math.abs(K), 4)}\\cdot\\dfrac{${lenList('zero')}}{${lenList('pole')}}\\\\ &= ${val}\\end{aligned}`;
	});
	const phaseTex = $derived.by(() => {
		const parts = `\\textstyle\\sum\\theta_{z} - \\sum\\theta_{p}${K < 0 ? ' + 180^\\circ' : ''}`;
		const nums = `${fmtDeg(geo.sumZ)} ${geo.sumP < 0 ? '+' : '-'} ${fmtDeg(Math.abs(geo.sumP))}${K < 0 ? ' + 180^\\circ' : ''}`;
		if (!Number.isFinite(geo.phase))
			return `\\angle H\\ \\text{is undefined: a root sits on the probe point}`;
		return `\\begin{aligned}\\angle H &= ${parts}\\\\ &= ${nums}\\\\ &\\equiv ${fmtDeg(geo.phase)}\\end{aligned}`;
	});

	function arcPath(ctx: PzContext, P: Complex) {
		return `M${ctx.X(1)},${ctx.Y(0)} A${ctx.k},${ctx.k} 0 0 0 ${ctx.X(P.re)},${ctx.Y(P.im)}`;
	}

	const fmtCoord = (v: number) => trimNumber(v, 4);
	const rootLabel = (it: PzItem) => `${it.pair ? '' : 'real '}${it.kind}${it.pair ? ' pair' : ''}`;

	const responseViews = $derived(
		improper
			? (['phase', 'groupDelay'] as const)
			: (['phase', 'groupDelay', 'impulse', 'step'] as const)
	);
</script>

<ToolLayout
	slug="pole-zero"
	related={['bode', 'biquad', 'iir-designer', 'tf-analyzer', 'discretization', 'convolution']}
>
	{#snippet controls()}
		<ControlGroup title="Plane">
			<Segmented
				bind:value={domain}
				options={[
					{ value: 's', label: 's-plane (analog)' },
					{ value: 'z', label: 'z-plane (digital)' }
				]}
			/>
			<p class="small muted tight">Each plane keeps its own set of poles and zeros.</p>
		</ControlGroup>

		<ControlGroup title="Preset">
			<Select
				label="Load a preset"
				value={presetIds[domain]}
				options={presetOptions}
				onchange={(v) => loadPreset(v)}
			/>
			{#if presetInfo}<p class="small muted tight">{presetInfo.description}</p>{/if}
		</ControlGroup>

		<ControlGroup title="Selected root">
			{#if sel && selPolar}
				<p class="small sel-title">
					<span class="sym-wrap"
						><svg width="12" height="12" aria-hidden="true"
							>{#if sel.kind === 'pole'}<path
									class="sym pole"
									d="M2,2l8,8M2,10l8,-8"
								/>{:else}<circle class="sym zero" cx="6" cy="6" r="4" />{/if}</svg
						></span
					>{rootLabel(sel)}
				</p>
				{#if domain === 'z'}
					{#if sel.pair}
						<Slider
							label="Radius r"
							value={selPolar.r}
							min={0}
							max={1.5}
							step={0.001}
							onchange={(v) => setZPolar(v, selPolar.theta)}
						/>
						<Slider
							label="Angle as frequency"
							value={(selPolar.theta / TWO_PI) * fs}
							min={0}
							max={fs / 2}
							unit="Hz"
							onchange={(v) => setZPolar(selPolar.r, (TWO_PI * v) / fs)}
						/>
						<p class="small muted tight">θ = {trimNumber(deg(selPolar.theta), 4)}°</p>
						{#if sel.kind === 'pole' && selPolar.r < 1 && selPolar.r > 0.5}
							<p class="small muted tight">
								−3 dB bandwidth ≈ (1 − r)·fs/π = {formatSI(
									((1 - selPolar.r) * fs) / Math.PI,
									'Hz',
									3
								)}
							</p>
						{/if}
					{:else}
						<Slider
							label="Position on real axis"
							value={sel.re}
							min={-1.5}
							max={1.5}
							step={0.001}
							onchange={(v) => updateItem(sel.id, { re: q(v) })}
						/>
					{/if}
				{:else if sel.pair}
					{@const f0 = selPolar.r}
					{@const zeta = f0 > 0 ? -sel.re / f0 : 0}
					<Slider
						label="Natural frequency f₀"
						value={Math.max(f0, 1)}
						min={1}
						max={1e6}
						log
						unit="Hz"
						onchange={(v) => setSPair(v, zeta)}
					/>
					<Slider
						label="Damping ζ"
						value={zeta}
						min={-1}
						max={1}
						step={0.001}
						onchange={(v) => setSPair(f0, v)}
					/>
					<p class="small muted tight">
						Q = 1/(2ζ) = {Math.abs(zeta) > 1e-9 ? trimNumber(1 / (2 * zeta), 4) : '∞'}{zeta < 0
							? ' (right half-plane)'
							: ''}
					</p>
					{#if sel.kind === 'pole' && zeta > 0 && zeta < 0.5}
						<p class="small muted tight">
							−3 dB bandwidth ≈ 2ζf₀ = {formatSI(2 * zeta * f0, 'Hz', 3)}
						</p>
					{/if}
				{:else}
					<Slider
						label="Corner frequency |σ|/2π"
						value={Math.max(Math.abs(sel.re), 0.1)}
						min={0.1}
						max={1e6}
						log
						unit="Hz"
						onchange={(v) => updateItem(sel.id, { re: q((sel.re > 0 ? 1 : -1) * v) })}
					/>
					<Segmented
						size="small"
						label="Half-plane"
						value={sel.re > 0 ? 'rhp' : 'lhp'}
						options={[
							{ value: 'lhp', label: 'Left (σ < 0)' },
							{ value: 'rhp', label: 'Right (σ > 0)' }
						]}
						onchange={(v) => updateItem(sel.id, { re: (v === 'rhp' ? 1 : -1) * Math.abs(sel.re) })}
					/>
				{/if}
			{:else}
				<p class="small muted tight">
					Click a pole (×) or zero (○) handle on the plane — or a row of the table — to edit it
					here.
				</p>
			{/if}
		</ControlGroup>

		<ControlGroup title="Gain">
			<Segmented
				size="small"
				value={gainMode}
				options={[
					{ value: 'peak', label: '0 dB peak' },
					{ value: 'dc', label: '0 dB at DC' },
					{ value: 'manual', label: 'Manual k' }
				]}
				onchange={(v) => setGainMode(v)}
			/>
			{#if gainMode === 'manual'}
				<NumberInput
					label={domain === 'z' ? 'k' : 'k (H(s) in rad/s)'}
					bind:value={manualK[domain]}
				/>
			{/if}
			{#if gain.note}<p class="small note-text">{gain.note}</p>{/if}
		</ControlGroup>

		<ControlGroup title="Display">
			<Toggle
				bind:checked={showProbe}
				label="Geometric evaluation vectors"
				help="Lines from every root to the probe point on the frequency axis"
			/>
			<Toggle
				bind:checked={showHeat}
				label="|H| heatmap over the plane"
				help="The frequency response is the slice along the {domain === 'z'
					? 'unit circle'
					: 'jω axis'}"
			/>
			<Toggle bind:checked={snapOn} label="Snap to grid" />
		</ControlGroup>

		{#if domain === 'z'}
			<ControlGroup title="Sampling">
				<NumberInput
					label="Sample rate fs"
					bind:value={fs}
					unit="Hz"
					si
					min={1}
					logStep={2}
					help="Angles on the unit circle map to frequencies f = θ·fs/2π."
				/>
			</ControlGroup>
		{/if}
	{/snippet}

	<StatGrid {stats} />

	<Card
		title={domain === 'z' ? 'z-plane' : 's-plane (in Hz: σ/2π, ω/2π)'}
		subtitle="Drag the handles. Poles ×, zeros ○; conjugate partners follow automatically."
	>
		<div class="toolbar" role="toolbar" aria-label="Edit poles and zeros">
			<button class="btn small" type="button" onclick={() => addDefault('pole', true)}
				>+ Pole pair</button
			>
			<button class="btn small" type="button" onclick={() => addDefault('zero', true)}
				>+ Zero pair</button
			>
			<button class="btn small" type="button" onclick={() => addDefault('pole', false)}
				>+ Real pole</button
			>
			<button class="btn small" type="button" onclick={() => addDefault('zero', false)}
				>+ Real zero</button
			>
			<button
				class="btn small"
				type="button"
				disabled={selectedId === null}
				onclick={deleteSelected}
				title="Delete the selected root (Delete / Backspace)">Delete</button
			>
			<button class="btn small" type="button" disabled={!items.length} onclick={clearAll}
				>Clear</button
			>
			<span class="spacer"></span>
			<Segmented
				size="small"
				label="Click on the plane to"
				bind:value={clickMode}
				options={[
					{ value: 'select', label: 'Select' },
					{ value: 'pole', label: 'Add pole' },
					{ value: 'zero', label: 'Add zero' }
				]}
			/>
		</div>

		<div class="pz-layout">
			<div class="pz-grid">
				<div class="pz-area" class:select-mode={clickMode === 'select'} bind:clientWidth={pzWidth}>
					<PoleZeroPlot
						zeros={roots.zeros}
						poles={roots.poles}
						{domain}
						{handles}
						sHz={domain === 's'}
						fs={domain === 'z' ? fs : undefined}
						{extent}
						height={pzHeight}
						heatmap={heatFn}
						{heatRange}
						snap={snapOn ? (domain === 'z' ? 0.05 : extent / 20) : 0}
						onhandlemove={onHandleMove}
						onhandleselect={onHandleSelect}
						onplotclick={onPlotClick}
						overlay={probeOverlay}
					/>
					{#if showHeat}
						<div class="heat-legend" aria-label="Heatmap colour scale">
							<span>{heatRange[0]} dB</span>
							<span class="ramp"></span>
							<span>{heatRange[1]} dB</span>
						</div>
					{/if}
					{#if clickMode !== 'select'}
						<p class="small muted tight">
							Click to place a {clickMode} pair; click on the real axis for a single real {clickMode}.
						</p>
					{/if}
				</div>

				<div class="geo">
					<h4>Geometric evaluation</h4>
					<Slider
						label="Probe frequency f"
						value={probe}
						min={domain === 'z' || scale === 'linear'
							? probeRange[0]
							: Math.max(probeRange[0], 1e-6)}
						max={probeRange[1]}
						log={domain === 's' && scale === 'log'}
						unit="Hz"
						onchange={(v) => setProbe(v)}
					/>
					<p class="small muted tight">
						{#if domain === 'z'}
							The probe sits at e<sup>jω</sup> with ω = 2πf/fs = {trimNumber(
								deg((TWO_PI * probe) / fs),
								4
							)}°.
						{:else}
							The probe sits at s = j2πf on the jω axis{#if probeOutOfView}&nbsp;— above the visible
								plane{/if}.
						{/if}
						Each line is a factor of H.
					</p>
					{#if !showProbe}
						<p class="small muted">Turn on “Geometric evaluation vectors” to see the lines.</p>
					{/if}
					<div class="geo-tex"><Tex display math={magTex} /></div>
					<div class="geo-tex"><Tex display math={phaseTex} /></div>
					{#if domain === 's' && nz !== np}
						<p class="small muted tight">
							Lengths are measured in Hz on this plane, so K = k·(2π)<sup>{nz - np}</sup> = {trimNumber(
								K,
								4
							)}, where k is the gain of H(s) written in rad/s.
						</p>
					{/if}
					<div class="vec-wrap">
						<table class="vec-table">
							<thead>
								<tr><th>Root</th><th class="num">Length</th><th class="num">Angle</th></tr>
							</thead>
							<tbody>
								{#each geo.vectors as v, i (i)}
									<tr>
										<td>
											<svg width="11" height="11" aria-hidden="true"
												>{#if v.kind === 'pole'}<path
														class="sym pole"
														d="M1.5,1.5l8,8M1.5,9.5l8,-8"
													/>{:else}<circle class="sym zero" cx="5.5" cy="5.5" r="4" />{/if}</svg
											>
											<span class="mono"
												>{fmtCoord(v.root.re)}{v.root.im !== 0
													? ` ${v.root.im < 0 ? '−' : '+'} ${fmtCoord(Math.abs(v.root.im))}j`
													: ''}</span
											>
											{#if v.implied}<span class="muted">(causal)</span>{/if}
										</td>
										<td class="num">{trimNumber(v.len, 4)}</td>
										<td class="num"
											>{Number.isFinite(v.angle) ? `${trimNumber(deg(v.angle), 4)}°` : '—'}</td
										>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
					<p class="small muted tight">
						Drag the dot on the magnitude plot (or click it) to move the probe.
					</p>
				</div>
			</div>
		</div>

		{#if roots.implied > 0}
			<p class="small muted note-line">
				ⓘ {roots.implied} more zero{roots.implied > 1 ? 's' : ''} than poles: a causal H(z) needs {roots.implied}
				pole{roots.implied > 1 ? 's' : ''} at z = 0 (drawn at the origin). They leave |H| on the unit
				circle unchanged and only add delay.
			</p>
		{:else if domain === 'z' && np > nz}
			<p class="small muted note-line">
				ⓘ {np - nz} more pole{np - nz > 1 ? 's' : ''} than zeros: the impulse response starts {np -
					nz} sample{np - nz > 1 ? 's' : ''} late (a pure delay z<sup>−{np - nz}</sup>). Zeros at z
				= 0 would remove the delay without changing |H|.
			</p>
		{/if}
	</Card>

	{#if improper}
		<Callout kind="warning" title="Improper transfer function">
			There are more zeros ({nz}) than poles ({np}): |H| grows without bound as f → ∞ and H(s)
			cannot be built from a finite circuit. Time responses are not defined — add poles to make it
			proper.
		</Callout>
	{/if}

	<ResponseView
		filters={[{ filter, label: 'H' }]}
		views={[...responseViews]}
		bind:xScale={scales[domain]}
		bind:magMode
		fmin={domain === 's' ? range[0] : undefined}
		fmax={domain === 's' ? range[1] : undefined}
		magDomain={magMode === 'db' ? dbDomain : undefined}
		markers={showProbe ? probeMarker : []}
		onmarkerdrag={(_id, x) => setProbe(x)}
		onplotclick={(x) => setProbe(x)}
		title={domain === 'z' ? 'Magnitude along the unit circle' : 'Magnitude along the jω axis'}
	/>

	<Card
		title="Poles and zeros"
		subtitle={domain === 'z'
			? 'Type exact values. Pairs are entered by their upper root (Im ≥ 0).'
			: 'Coordinates in Hz (σ/2π, ω/2π). Pairs are entered by their upper root.'}
	>
		<div class="table-wrap">
			<table class="roots">
				<thead>
					<tr>
						<th>Root</th>
						{#if domain === 'z'}
							<th>Re</th><th>Im</th><th>Radius r</th><th>Angle θ (°)</th>
						{:else}
							<th>σ/2π (Hz)</th><th>ω/2π (Hz)</th><th>f₀ (Hz)</th><th>ζ</th>
						{/if}
						<th><span class="visually-hidden">Delete</span></th>
					</tr>
				</thead>
				<tbody>
					{#each items as it, i (it.id)}
						{@const r = Math.hypot(it.re, it.pair ? it.im : 0)}
						<tr class:selected={it.id === selectedId}>
							<td>
								<button
									class="root-btn"
									type="button"
									onclick={() => (selectedIds[domain] = it.id)}
									aria-pressed={it.id === selectedId}
								>
									<svg width="11" height="11" aria-hidden="true"
										>{#if it.kind === 'pole'}<path
												class="sym pole"
												d="M1.5,1.5l8,8M1.5,9.5l8,-8"
											/>{:else}<circle class="sym zero" cx="5.5" cy="5.5" r="4" />{/if}</svg
									>
									{rootLabel(it)}
								</button>
							</td>
							<td>
								<label class="visually-hidden" for="re-{it.id}">Real part of root {i + 1}</label>
								<NumberInput
									id="re-{it.id}"
									value={it.re}
									digits={6}
									onchange={(v) => updateItem(it.id, { re: v })}
								/>
							</td>
							<td>
								{#if it.pair}
									<label class="visually-hidden" for="im-{it.id}"
										>Imaginary part of root {i + 1}</label
									>
									<NumberInput
										id="im-{it.id}"
										value={it.im}
										digits={6}
										min={0}
										onchange={(v) => updateItem(it.id, { im: Math.abs(v) })}
									/>
								{:else}<span class="muted">0</span>{/if}
							</td>
							{#if domain === 'z'}
								<td>
									<label class="visually-hidden" for="r-{it.id}">Radius of root {i + 1}</label>
									<NumberInput
										id="r-{it.id}"
										value={r}
										digits={6}
										min={0}
										onchange={(v) => {
											const th = Math.atan2(it.pair ? it.im : 0, it.re);
											updateItem(
												it.id,
												it.pair
													? { re: v * Math.cos(th), im: v * Math.sin(th) }
													: { re: (it.re < 0 ? -1 : 1) * v }
											);
										}}
									/>
								</td>
								<td>
									{#if it.pair}
										<label class="visually-hidden" for="th-{it.id}"
											>Angle of root {i + 1} in degrees</label
										>
										<NumberInput
											id="th-{it.id}"
											value={deg(Math.atan2(it.im, it.re))}
											digits={5}
											min={0}
											max={180}
											onchange={(v) =>
												updateItem(it.id, {
													re: r * Math.cos((v * Math.PI) / 180),
													im: r * Math.sin((v * Math.PI) / 180)
												})}
										/>
									{:else}<span class="muted">{it.re < 0 ? 180 : 0}</span>{/if}
								</td>
							{:else}
								<td>
									{#if it.pair}
										<label class="visually-hidden" for="f0-{it.id}"
											>Natural frequency of root {i + 1}</label
										>
										<NumberInput
											id="f0-{it.id}"
											value={r}
											digits={6}
											min={0}
											onchange={(v) => {
												const [re, im] = dampedPair(v, r > 0 ? -it.re / r : 0);
												updateItem(it.id, { re, im });
											}}
										/>
									{:else}<span class="muted">{formatSI(Math.abs(it.re), '', 4)}</span>{/if}
								</td>
								<td>
									{#if it.pair}
										<label class="visually-hidden" for="zeta-{it.id}">Damping of root {i + 1}</label
										>
										<NumberInput
											id="zeta-{it.id}"
											value={r > 0 ? -it.re / r : 0}
											digits={4}
											min={-1}
											max={1}
											step={0.01}
											onchange={(v) => {
												const [re, im] = dampedPair(r, v);
												updateItem(it.id, { re, im });
											}}
										/>
									{:else}<span class="muted">{it.re < 0 ? '1' : it.re > 0 ? '−1' : '—'}</span>{/if}
								</td>
							{/if}
							<td>
								<button
									class="btn ghost small"
									type="button"
									aria-label="Delete {rootLabel(it)} {i + 1}"
									onclick={() => removeItem(it.id)}>✕</button
								>
							</td>
						</tr>
					{:else}
						<tr
							><td colspan="6" class="muted"
								>No poles or zeros — H is just the constant k. Add some with the buttons above.</td
							></tr
						>
					{/each}
				</tbody>
			</table>
		</div>
	</Card>

	<Card
		title="Transfer function"
		subtitle={domain === 'z'
			? 'Factored, in positive powers of z.'
			: 'Factored, with s in rad/s (the plane above shows s/2π).'}
	>
		<Tex display math={tfTex} />
		{#if exportData.error}
			<Callout kind="danger">{exportData.error}</Callout>
		{:else}
			<ExportPanel
				kind={domain === 'z' ? 'digital' : 'analog'}
				{zpk}
				sos={exportData.sos}
				tf={exportData.tf}
				{fs}
				name="pole_zero"
			/>
		{/if}
	</Card>

	{#snippet theory()}
		<h2>Poles, zeros and the frequency response</h2>
		<p>
			Any rational transfer function can be factored into its roots. In the s-domain (continuous
			time) and the z-domain (discrete time):
		</p>
		<Tex
			display
			math={'H(s) = k\\,\\frac{\\prod_i (s - z_i)}{\\prod_i (s - p_i)}\\qquad\\qquad H(z) = k\\,\\frac{\\prod_i (z - z_i)}{\\prod_i (z - p_i)}'}
		/>
		<p>
			The <strong>zeros</strong>
			<Tex math="z_i" /> are where H vanishes; the <strong>poles</strong>
			<Tex math="p_i" /> are where it blows up. Apart from the scalar gain k, the poles and zeros determine
			the filter completely. For a real filter (real coefficients) every complex root comes with its complex
			conjugate, which is why this editor moves roots in pairs mirrored about the real axis.
		</p>

		<h3>Stability</h3>
		<p>
			Each pole contributes a mode to the impulse response: <Tex math={'e^{p t}'} /> in continuous time,
			<Tex math={'p^n'} /> in discrete time. The mode decays only if
		</p>
		<Tex
			display
			math={'\\operatorname{Re}(p) < 0 \\;\\;\\text{(left half-plane)}\\qquad\\qquad |p| < 1 \\;\\;\\text{(inside the unit circle)}'}
		/>
		<p>
			A pole on the boundary (jω axis or unit circle) gives a sustained oscillation — marginal
			stability — and a pole beyond it gives a response that grows without limit. Zeros can sit
			anywhere without affecting stability.
		</p>

		<h3>Geometric evaluation</h3>
		<p>
			The frequency response is H evaluated along the frequency axis: <Tex math={'s = j\\omega'} /> for
			analog filters,
			<Tex math={'z = e^{j\\omega}'} /> (the unit circle, with <Tex
				math={'\\omega = 2\\pi f/f_s'}
			/>) for digital ones. Each factor
			<Tex math={'(e^{j\\omega}-q)'} /> is a vector from the root q to the point on the axis, so
		</p>
		<Tex
			display
			math={'|H(e^{j\\omega})| = |k|\\,\\frac{\\prod_i \\big|e^{j\\omega}-z_i\\big|}{\\prod_i \\big|e^{j\\omega}-p_i\\big|}\\qquad \\angle H(e^{j\\omega}) = \\sum_i \\angle\\big(e^{j\\omega}-z_i\\big) - \\sum_i \\angle\\big(e^{j\\omega}-p_i\\big)'}
		/>
		<p>
			When the probe passes close to a pole, its vector becomes short and the magnitude peaks; close
			to a zero, the magnitude dips — exactly to zero if the zero lies on the axis. The heatmap
			shows <Tex math={'20\\log_{10}|H|'} /> over the whole plane: the magnitude response is the slice
			of that landscape along the unit circle or the jω axis.
		</p>

		<h3>s-plane and z-plane: z = e<sup>sT</sup></h3>
		<p>
			Sampling a mode <Tex math={'e^{p t}'} /> every <Tex math={'T = 1/f_s'} /> seconds gives <Tex
				math={'(e^{pT})^n'}
			/>, so an analog pole <Tex math={'p = \\sigma + j\\omega'} /> corresponds to the digital pole
		</p>
		<Tex
			display
			math={'z = e^{pT} = e^{\\sigma T}\\,e^{j\\omega T}\\qquad\\Rightarrow\\qquad r = |z| = e^{\\sigma T},\\quad \\theta = \\omega T = 2\\pi f/f_s'}
		/>
		<p>
			The left half-plane maps inside the unit circle, the jω axis onto the circle itself (DC at z =
			1, Nyquist at z = −1), and lines of constant damping become spirals. Impulse invariance and
			the matched-z transform place digital poles exactly this way; the bilinear transform maps the
			same regions onto each other but warps the frequency axis.
		</p>

		<h3>Resonance: pole radius and damping</h3>
		<p>
			A pole pair close to the axis makes a resonant peak at its angle (or its imaginary part in the
			s-plane). Its sharpness is set by the distance to the axis. In the s-plane a pair at <Tex
				math={'-\\zeta\\omega_0 \\pm j\\omega_0\\sqrt{1-\\zeta^2}'}
			/>
			has <Tex math={'Q = 1/(2\\zeta)'} /> and a −3 dB bandwidth of about <Tex
				math={'2\\zeta\\omega_0 = 2|\\sigma|'}
			/>. In the z-plane, for r close to 1,
		</p>
		<Tex
			display
			math={'B_{-3\\,\\text{dB}} \\approx \\frac{(1-r)\\,f_s}{\\pi}\\ \\text{Hz},\\qquad \\text{decay to } -60\\text{ dB after } n \\approx \\frac{\\ln 10^{-3}}{\\ln r}\\ \\text{samples}.'}
		/>
		<p>
			Sharp peaks and long ringing are two views of the same thing: a pole close to the boundary.
		</p>

		<h3>Minimum phase and all-pass filters</h3>
		<p>
			Reflecting a zero across the boundary — <Tex math={'z_i \\to 1/z_i^*'} /> in the z-plane, <Tex
				math={'z_i \\to -z_i^*'}
			/> in the s-plane — leaves the shape of |H| unchanged (only a constant gain factor changes) but
			changes the phase. Of all filters with the same magnitude, the one with every zero inside the stable
			region has the least phase lag and the shortest delay: it is <strong>minimum phase</strong>,
			and only minimum-phase filters have a stable, causal inverse.
		</p>
		<p>
			Placing a zero exactly at the reflection of each pole gives an <strong>all-pass</strong> filter:
			for every point on the axis the ratio of the zero and pole vector lengths is the same constant,
			so |H| is flat while the phase still turns — the basis of phase equalisers and fractional delays.
		</p>
		<Tex
			display
			math={'H_{ap}(z) = \\frac{z - 1/p^*}{z - p}\\cdot|p| \\qquad\\qquad H_{ap}(s) = \\frac{s + p^*}{s - p}'}
		/>

		<Callout kind="try">
			<ul>
				<li>
					Load <em>Two-pole resonator</em> and drag the radius slider from 0.5 towards 1: the peak narrows,
					the impulse response rings longer, and the bandwidth estimate (1 − r)·fs/π shrinks.
				</li>
				<li>
					Move the probe across the resonance and watch the pole vector shrink — that one short
					vector is the whole peak. Then turn on the heatmap and see the response as a slice through
					the “tent” raised by the pole.
				</li>
				<li>
					Load <em>All-pass pair</em> and drag the zero inside the unit circle to the pole’s angle: the
					magnitude stays the same shape, but the phase and group delay change — that is the minimum-phase
					version.
				</li>
				<li>
					In the s-plane <em>Resonant pair</em>, sweep ζ from 1 down to 0 and on to negative values:
					the step response goes from no overshoot (ζ = 1, critically damped: a double real pole)
					through about 5 % overshoot at ζ ≈ 0.7 to sustained ringing at ζ = 0, then to exponential
					growth as the poles cross the jω axis.
				</li>
				<li>
					Load <em>Moving average</em> and delete one zero: the comb notch disappears and the causal poles
					at the origin rebalance.
				</li>
			</ul>
		</Callout>
	{/snippet}
</ToolLayout>

{#snippet probeOverlay(ctx: PzContext)}
	{#if showProbe}
		{@const P = probePoint}
		{@const left = ctx.X(-ctx.R)}
		{@const top = ctx.Y(ctx.R)}
		{@const w = 2 * ctx.R * ctx.k}
		<defs>
			<clipPath id="pz-probe-clip"><rect x={left} y={top} width={w} height={w} /></clipPath>
		</defs>
		<g clip-path="url(#pz-probe-clip)" pointer-events="none">
			{#if domain === 'z'}
				{#if probe > 0}<path class="slice" d={arcPath(ctx, P)} />{/if}
			{:else}
				<line
					class="slice"
					x1={ctx.X(0)}
					y1={ctx.Y(0)}
					x2={ctx.X(0)}
					y2={ctx.Y(Math.min(P.im, ctx.R * 1.01))}
				/>
			{/if}
			{#each geo.vectors as v, i (i)}
				<line
					class="vec {v.kind}"
					x1={ctx.X(v.root.re)}
					y1={ctx.Y(v.root.im)}
					x2={ctx.X(P.re)}
					y2={ctx.Y(P.im)}
				/>
			{/each}
			<circle class="probe-pt" cx={ctx.X(P.re)} cy={ctx.Y(P.im)} r="5" />
			{#if !probeOutOfView}
				<text
					class="probe-label"
					x={ctx.X(P.re) + (P.re < -0.3 * ctx.R ? -9 : 9)}
					y={ctx.Y(P.im) - 8}
					text-anchor={P.re < -0.3 * ctx.R ? 'end' : 'start'}>{formatSI(probe, 'Hz', 3)}</text
				>
			{/if}
		</g>
	{/if}
{/snippet}

<style>
	.tight {
		margin: 0;
	}
	.sel-title {
		margin: 0;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-weight: 600;
		text-transform: capitalize;
	}
	.sym-wrap {
		display: inline-flex;
	}
	.sym {
		fill: none;
		stroke-width: 2;
		stroke-linecap: round;
	}
	.sym.pole {
		stroke: var(--s2);
	}
	.sym.zero {
		stroke: var(--s1);
	}
	.note-text {
		margin: 0;
		color: var(--warning-ink);
	}
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: flex-end;
		margin-bottom: 0.6rem;
	}
	.spacer {
		flex: 1;
	}
	.pz-layout {
		container-type: inline-size;
	}
	.pz-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 1rem;
	}
	@container (min-width: 720px) {
		.pz-grid {
			grid-template-columns: minmax(0, 1fr) minmax(250px, 310px);
		}
	}
	.pz-area {
		min-width: 0;
	}
	.select-mode :global(svg.adding) {
		cursor: default;
	}
	.heat-legend {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.75rem;
		color: var(--text-2);
		justify-content: center;
		margin-top: 0.2rem;
	}
	.ramp {
		width: 140px;
		height: 8px;
		border-radius: 4px;
		border: 1px solid var(--border);
		background: linear-gradient(
			90deg,
			var(--seq-0),
			var(--seq-1),
			var(--seq-2),
			var(--seq-3),
			var(--seq-4),
			var(--seq-5)
		);
	}
	.geo {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
	}
	.geo h4 {
		margin: 0;
		font-size: 0.9rem;
	}
	.geo-tex {
		overflow-x: auto;
		overflow-y: hidden;
		font-size: 0.9rem;
		padding: 0.1rem 0;
	}
	.geo-tex :global(.tex-display),
	.geo-tex :global(.katex-display) {
		margin: 0;
	}
	.vec-wrap {
		max-height: 230px;
		overflow: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}
	.vec-table {
		font-size: 0.8rem;
	}
	.vec-table th,
	.vec-table td {
		padding: 0.25em 0.5em;
		white-space: nowrap;
	}
	.vec-table th {
		position: sticky;
		top: 0;
	}
	.vec-table svg,
	.root-btn svg {
		vertical-align: -1px;
		margin-right: 0.3rem;
	}
	.note-line {
		margin: 0.6rem 0 0;
	}
	.table-wrap {
		overflow-x: auto;
		/* contain the absolutely positioned visually-hidden labels */
		position: relative;
	}
	table.roots {
		min-width: 560px;
	}
	table.roots td {
		vertical-align: middle;
		padding: 0.3em 0.45em;
	}
	table.roots td :global(.num) {
		min-width: 6.5em;
	}
	tr.selected td {
		background: var(--accent-wash);
	}
	.root-btn {
		border: none;
		background: none;
		padding: 0.2rem 0;
		cursor: pointer;
		white-space: nowrap;
		text-align: left;
		color: var(--text);
	}
	.root-btn:hover {
		text-decoration: underline;
	}
	/* overlay drawn inside the pole–zero plot */
	.slice {
		fill: none;
		stroke: var(--text);
		stroke-opacity: 0.35;
		stroke-width: 4;
		stroke-linecap: round;
	}
	.vec {
		stroke-width: 1.25;
		stroke-opacity: 0.85;
	}
	.vec.zero {
		stroke: var(--s1);
	}
	.vec.pole {
		stroke: var(--s2);
		stroke-dasharray: 5 3;
	}
	.probe-pt {
		fill: var(--text);
		stroke: var(--chart-surface);
		stroke-width: 2;
	}
	.probe-label {
		fill: var(--text);
		font-size: 11px;
		font-weight: 600;
		paint-order: stroke;
		stroke: var(--chart-surface);
		stroke-width: 3px;
	}
</style>
