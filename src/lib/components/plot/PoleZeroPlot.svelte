<script lang="ts" module>
	import type { Snippet } from 'svelte';
	import type { Complex } from '$lib/dsp/complex';

	/** Coordinate helpers passed to the `overlay` snippet. */
	export interface PzContext {
		/** Data → pixel. */
		X: (re: number) => number;
		Y: (im: number) => number;
		/** Pixels per data unit. */
		k: number;
		/** Visible half-width in data units. */
		R: number;
	}

	export interface PzHandle {
		id: string | number;
		kind: 'pole' | 'zero';
		value: Complex;
		/** Constrain dragging to the real axis. */
		realOnly?: boolean;
		selected?: boolean;
	}
</script>

<script lang="ts">
	import { cssColorRgb, theme } from '$lib/theme.svelte';
	import { trimNumber, formatSI, formatFreqTick } from '$lib/dsp/units';

	interface Props {
		zeros?: Complex[];
		poles?: Complex[];
		domain?: 'z' | 's';
		/** Interactive handles (normally one per conjugate pair). */
		handles?: PzHandle[];
		onhandlemove?: (id: string | number, value: Complex) => void;
		onhandleselect?: (id: string | number | null) => void;
		/** Called when a handle drag finishes (pointer released). */
		onhandledragend?: (id: string | number) => void;
		onplotclick?: (value: Complex) => void;
		/** Value (e.g. dB) to colour the plane with; omit for no heatmap. */
		heatmap?: ((s: Complex) => number) | null;
		heatRange?: [number, number];
		/** Half-width of the visible square (data units). Auto when omitted. */
		extent?: number;
		height?: number;
		/** Sampling rate (z-plane) used to label angles as frequencies. */
		fs?: number;
		title?: string;
		/** Snap dragged handles to a grid of this spacing (0 = off). */
		snap?: number;
		/** s-plane coordinates are given in Hz (σ/2π, ω/2π) rather than rad/s. */
		sHz?: boolean;
		/** Extra SVG drawn above the grid and below the poles/zeros. */
		overlay?: Snippet<[PzContext]>;
	}

	let {
		zeros = [],
		poles = [],
		domain = 'z',
		handles = [],
		onhandlemove,
		onhandleselect,
		onhandledragend,
		onplotclick,
		heatmap = null,
		heatRange = [-40, 20],
		extent,
		height = 340,
		fs,
		title,
		snap = 0,
		sHz = false,
		overlay
	}: Props = $props();

	let width = $state(0);
	const pad = 28;

	const R = $derived.by(() => {
		if (extent) return extent;
		const mags = [...zeros, ...poles, ...handles.map((h) => h.value)].map((r) => Math.hypot(r.re, r.im));
		const m = mags.length ? Math.max(...mags.filter(Number.isFinite)) : 0;
		if (domain === 'z') return Math.max(1.3, m * 1.15);
		const nice = niceUp(Math.max(m * 1.25, 1e-9));
		return m > 0 ? nice : 2;
	});

	function niceUp(v: number) {
		const p = Math.pow(10, Math.floor(Math.log10(v)));
		for (const k of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (k * p >= v) return k * p;
		return 10 * p;
	}

	const side = $derived(Math.max(60, Math.min(width - 2 * pad, height - 2 * pad)));
	const cx = $derived(width / 2);
	const cy = $derived(height / 2);
	const k = $derived(side / (2 * R));
	const X = (re: number) => cx + re * k;
	const Y = (im: number) => cy - im * k;
	const invX = (px: number) => (px - cx) / k;
	const invY = (py: number) => (cy - py) / k;

	const ticks = $derived.by(() => {
		const raw = R / (side < 300 ? 1.6 : 2.5);
		const mag = Math.pow(10, Math.floor(Math.log10(raw)));
		const n = raw / mag;
		const step = (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
		const t: number[] = [];
		for (let v = -Math.floor(R / step) * step; v <= R + 1e-12; v += step) if (Math.abs(v) > step * 1e-6) t.push(v);
		return t;
	});

	const tickFmt = (t: number) => (Math.abs(t) >= 1000 ? formatFreqTick(t) : trimNumber(t, 3));

	interface Group {
		v: Complex;
		count: number;
	}
	function group(rs: Complex[]): Group[] {
		const out: Group[] = [];
		for (const r of rs) {
			if (!Number.isFinite(r.re) || !Number.isFinite(r.im)) continue;
			const tol = 1e-6 * Math.max(1, Math.hypot(r.re, r.im));
			const g = out.find((o) => Math.abs(o.v.re - r.re) < tol && Math.abs(o.v.im - r.im) < tol);
			if (g) g.count++;
			else out.push({ v: r, count: 1 });
		}
		return out;
	}
	const zGroups = $derived(group(zeros));
	const pGroups = $derived(group(poles));

	// ---------- heatmap ----------
	let canvas: HTMLCanvasElement | undefined = $state();
	$effect(() => {
		// dependencies
		const fn = heatmap;
		const _t = theme.resolved;
		void _t;
		if (!canvas || !fn || side <= 0) return;
		const res = 150;
		canvas.width = res;
		canvas.height = res;
		const g = canvas.getContext('2d');
		if (!g) return;
		const img = g.createImageData(res, res);
		const stops = [0, 1, 2, 3, 4, 5].map((i) => cssColorRgb(`--seq-${i}`));
		const [lo, hi] = heatRange;
		for (let j = 0; j < res; j++) {
			for (let i = 0; i < res; i++) {
				const re = -R + ((i + 0.5) / res) * 2 * R;
				const im = R - ((j + 0.5) / res) * 2 * R;
				let v = fn({ re, im });
				if (!Number.isFinite(v)) v = v > 0 ? hi : lo;
				const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
				const pos = t * (stops.length - 1);
				const a = Math.floor(Math.min(pos, stops.length - 2));
				const f = pos - a;
				const o = (j * res + i) * 4;
				for (let ch = 0; ch < 3; ch++) img.data[o + ch] = stops[a][ch] + (stops[a + 1][ch] - stops[a][ch]) * f;
				img.data[o + 3] = 255;
			}
		}
		g.putImageData(img, 0, 0);
	});

	// ---------- interaction ----------
	let svgEl: SVGSVGElement | undefined = $state();
	let dragging: PzHandle | null = null;
	/** Suppresses the click event that follows a handle press. */
	let pressedHandle = false;
	let hover = $state<Complex | null>(null);

	function local(ev: PointerEvent | MouseEvent) {
		const rect = svgEl!.getBoundingClientRect();
		return { px: ev.clientX - rect.left, py: ev.clientY - rect.top };
	}

	function snapVal(v: number) {
		return snap > 0 ? Math.round(v / snap) * snap : v;
	}

	function onMove(ev: PointerEvent) {
		if (!svgEl) return;
		const { px, py } = local(ev);
		const v = { re: invX(px), im: invY(py) };
		hover = Math.abs(v.re) <= R && Math.abs(v.im) <= R ? v : null;
		if (dragging) {
			let re = snapVal(Math.max(-R, Math.min(R, v.re)));
			let im = dragging.realOnly ? 0 : snapVal(Math.max(-R, Math.min(R, v.im)));
			// snap onto the real axis / unit circle when close
			if (!dragging.realOnly && Math.abs(im) * k < 5) im = 0;
			if (domain === 'z' && snap === 0) {
				const m = Math.hypot(re, im);
				if (Math.abs(m - 1) * k < 5 && m > 0) {
					re /= m;
					im /= m;
				}
			}
			onhandlemove?.(dragging.id, { re, im });
		}
	}

	function startDrag(ev: PointerEvent, h: PzHandle) {
		ev.stopPropagation();
		ev.preventDefault();
		dragging = h;
		pressedHandle = true;
		onhandleselect?.(h.id);
		svgEl?.setPointerCapture(ev.pointerId);
	}

	function endDrag(ev: PointerEvent) {
		if (dragging) {
			const id = dragging.id;
			dragging = null;
			try {
				svgEl?.releasePointerCapture(ev.pointerId);
			} catch {
				/* noop */
			}
			onhandledragend?.(id);
		}
	}

	function onClick(ev: MouseEvent) {
		if (!svgEl) return;
		if (pressedHandle) {
			pressedHandle = false;
			return;
		}
		const { px, py } = local(ev);
		const v = { re: invX(px), im: invY(py) };
		if (Math.abs(v.re) > R || Math.abs(v.im) > R) return;
		if (onplotclick) onplotclick({ re: snapVal(v.re), im: snapVal(v.im) });
		else onhandleselect?.(null);
	}

	const hoverText = $derived.by(() => {
		if (!hover) return '';
		const h = hover;
		const mag = Math.hypot(h.re, h.im);
		const ang = Math.atan2(h.im, h.re);
		const sgn = h.im < 0 ? '−' : '+';
		const base = `${domain} = ${trimNumber(h.re, 3)} ${sgn} ${trimNumber(Math.abs(h.im), 3)}j`;
		if (domain === 'z') {
			const deg = (ang * 180) / Math.PI;
			const fr = Math.abs(ang) / (2 * Math.PI);
			const fstr = fs ? formatSI(fr * fs, 'Hz', 3) : `${trimNumber(fr, 3)}·fs`;
			return `${base}   |z| = ${trimNumber(mag, 3)}   ∠ ${trimNumber(deg, 3)}° (${fstr})`;
		}
		if (sHz) return `s/2π = ${trimNumber(h.re, 3)} ${sgn} ${trimNumber(Math.abs(h.im), 3)}j Hz`;
		return `${base}   ω → ${formatSI(Math.abs(h.im) / (2 * Math.PI), 'Hz', 3)}`;
	});

	const unitCircleLabels = $derived(
		domain === 'z'
			? [
					{ a: 0, t: fs ? '0' : '0' },
					{ a: Math.PI / 2, t: fs ? formatSI(fs / 4, 'Hz', 3) : 'fs/4' },
					{ a: Math.PI, t: fs ? formatSI(fs / 2, 'Hz', 3) : 'fs/2' }
				]
			: []
	);
</script>

<figure class="pz" aria-label={title ?? `${domain}-plane pole–zero plot`}>
	{#if title}<figcaption class="pz-title">{title}</figcaption>{/if}
	<div class="pz-body" bind:clientWidth={width} style:height="{height}px">
		{#if width > 0}
			{#if heatmap}
				<canvas
					bind:this={canvas}
					class="heat"
					style:left="{cx - side / 2}px"
					style:top="{cy - side / 2}px"
					style:width="{side}px"
					style:height="{side}px"
				></canvas>
			{/if}
			<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
			<svg
				bind:this={svgEl}
				{width}
				{height}
				role="img"
				aria-label="{domain}-plane: {poles.length} poles, {zeros.length} zeros"
				onpointermove={onMove}
				onpointerleave={() => (hover = null)}
				onpointerup={endDrag}
				onpointercancel={endDrag}
				onclick={onClick}
				class:adding={!!onplotclick}
			>
				<rect
					class="frame"
					class:transparent={!!heatmap}
					x={cx - side / 2}
					y={cy - side / 2}
					width={side}
					height={side}
				/>
				{#if domain === 's' && !heatmap}
					<rect class="stable" x={cx - side / 2} y={cy - side / 2} width={side / 2} height={side} />
				{/if}
				{#if domain === 'z' && !heatmap}
					<circle class="stable" cx={X(0)} cy={Y(0)} r={k} />
				{/if}
				<g class="grid">
					{#each ticks as t (t)}
						<line x1={X(t)} x2={X(t)} y1={cy - side / 2} y2={cy + side / 2} />
						<line y1={Y(t)} y2={Y(t)} x1={cx - side / 2} x2={cx + side / 2} />
					{/each}
				</g>
				<g class="axes">
					<line x1={cx - side / 2} x2={cx + side / 2} y1={Y(0)} y2={Y(0)} />
					<line x1={X(0)} x2={X(0)} y1={cy - side / 2} y2={cy + side / 2} class:jw={domain === 's'} />
					{#if domain === 'z'}
						<circle class="unit" cx={X(0)} cy={Y(0)} r={k} />
						{#each unitCircleLabels as l (l.a)}
							<text
								class="uc-label"
								x={X(Math.cos(l.a) * 1.0) + (l.a === 0 ? 6 : l.a === Math.PI ? -6 : 4)}
								y={Y(Math.sin(l.a) * 1.0) + (l.a === Math.PI / 2 ? -6 : 13)}
								text-anchor={l.a === Math.PI ? 'end' : 'start'}>{l.t}</text
							>
						{/each}
					{/if}
					{#each ticks as t (t)}
						<text class="tick" x={X(t)} y={cy + side / 2 + 13} text-anchor="middle">{tickFmt(t)}</text>
						<text class="tick" x={cx - side / 2 - 5} y={Y(t) + 4} text-anchor="end">{tickFmt(t)}</text>
					{/each}
					<text class="axis-name" x={cx + side / 2 - 2} y={Y(0) - 5} text-anchor="end"
						>{domain === 's' ? (sHz ? 'σ/2π' : 'σ') : 'Re'}</text
					>
					<text class="axis-name" x={X(0) - 5} y={cy - side / 2 + 12} text-anchor="end"
						>{domain === 's' ? (sHz ? 'ω/2π (Hz)' : 'jω') : 'Im'}</text
					>
				</g>

				{#if overlay}{@render overlay({ X, Y, k, R })}{/if}

				{#each zGroups as g, i (i)}
					<g class="zero">
						<circle cx={X(g.v.re)} cy={Y(g.v.im)} r="5.5" />
						{#if g.count > 1}<text class="mult" x={X(g.v.re) + 8} y={Y(g.v.im) - 6}>{g.count}</text>{/if}
					</g>
				{/each}
				{#each pGroups as g, i (i)}
					{@const unstable = domain === 'z' ? Math.hypot(g.v.re, g.v.im) >= 1 - 1e-12 : g.v.re >= 0}
					<g class="pole" class:unstable>
						<path
							d="M{X(g.v.re) - 5.5},{Y(g.v.im) - 5.5}l11,11M{X(g.v.re) - 5.5},{Y(g.v.im) + 5.5}l11,-11"
						/>
						{#if g.count > 1}<text class="mult" x={X(g.v.re) + 8} y={Y(g.v.im) - 6}>{g.count}</text>{/if}
					</g>
				{/each}

				{#each handles as h (h.id)}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<g class="handle" class:selected={h.selected} onpointerdown={(e) => startDrag(e, h)}>
						<circle class="hit" cx={X(h.value.re)} cy={Y(h.value.im)} r="14" />
						<circle class="ring {h.kind}" cx={X(h.value.re)} cy={Y(h.value.im)} r="10" />
					</g>
				{/each}
			</svg>

		{/if}
	</div>
	<div class="readout" aria-live="off">{hover ? hoverText : '\u00a0'}</div>
</figure>

<style>
	.pz {
		margin: 0;
		min-width: 0;
	}
	.pz-title {
		font-weight: 600;
		font-size: 0.9rem;
		margin-bottom: 0.25rem;
	}
	.pz-body {
		position: relative;
		width: 100%;
		touch-action: none;
	}
	.heat {
		position: absolute;
		image-rendering: auto;
		border-radius: 2px;
	}
	svg {
		position: relative;
		display: block;
		user-select: none;
		-webkit-user-select: none;
	}
	svg.adding {
		cursor: crosshair;
	}
	.frame {
		fill: var(--chart-surface);
		stroke: var(--axis);
	}
	.frame.transparent {
		fill: transparent;
	}
	.stable {
		fill: var(--good);
		fill-opacity: 0.06;
	}
	.grid line {
		stroke: var(--grid);
		shape-rendering: crispEdges;
	}
	.axes line {
		stroke: var(--axis);
		shape-rendering: crispEdges;
	}
	.axes line.jw {
		stroke: var(--muted);
	}
	.unit {
		fill: none;
		stroke: var(--muted);
		stroke-width: 1.25;
	}
	.tick {
		fill: var(--axis-text);
		font-size: 10.5px;
		font-variant-numeric: tabular-nums;
	}
	.axis-name {
		fill: var(--text-2);
		font-size: 12px;
		font-style: italic;
	}
	.uc-label {
		fill: var(--text-2);
		font-size: 10.5px;
		paint-order: stroke;
		stroke: var(--chart-surface);
		stroke-width: 3px;
	}
	.zero circle {
		fill: var(--chart-surface);
		stroke: var(--s1);
		stroke-width: 2.2;
	}
	.pole path {
		stroke: var(--s2);
		stroke-width: 2.4;
		stroke-linecap: round;
	}
	.pole.unstable path {
		stroke: var(--critical);
	}
	.mult {
		fill: var(--text);
		font-size: 11px;
		font-weight: 650;
		paint-order: stroke;
		stroke: var(--chart-surface);
		stroke-width: 3px;
	}
	.handle {
		cursor: grab;
	}
	.handle .hit {
		fill: transparent;
	}
	.handle .ring {
		fill: none;
		stroke-width: 1.5;
		stroke-opacity: 0;
	}
	.handle:hover .ring,
	.handle.selected .ring {
		stroke-opacity: 1;
	}
	.handle .ring.pole {
		stroke: var(--s2);
	}
	.handle .ring.zero {
		stroke: var(--s1);
	}
	.handle.selected .ring {
		stroke-width: 2.2;
		stroke-dasharray: 3 2;
	}
	.readout {
		font-size: 0.75rem;
		color: var(--text-2);
		min-height: 1.2rem;
		font-variant-numeric: tabular-nums;
		white-space: pre;
		overflow: hidden;
		text-overflow: ellipsis;
		text-align: center;
	}
</style>
