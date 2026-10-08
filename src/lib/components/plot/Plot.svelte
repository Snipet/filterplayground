<script lang="ts" module>
	import type { Snippet } from 'svelte';
	import type { Scale, ScaleType } from './scales';

	export interface Series {
		x: ArrayLike<number>;
		y: ArrayLike<number>;
		label?: string;
		color?: string;
		width?: number;
		/** SVG dash array, e.g. "6 4". */
		dash?: string;
		kind?: 'line' | 'stem' | 'step' | 'points' | 'area';
		opacity?: number;
		/** Exclude from tooltip / legend. */
		hidden?: boolean;
		/** Keep in the legend but leave out of the tooltip (e.g. Monte-Carlo traces). */
		noTooltip?: boolean;
		/** Custom value formatter for the tooltip. */
		format?: (v: number) => string;
	}

	export interface Region {
		x0: number;
		x1: number;
		y0: number;
		y1: number;
		/** Fill colour; defaults to a translucent critical/good wash by `kind`. */
		kind?: 'forbidden' | 'allowed' | 'neutral';
		label?: string;
	}

	export interface RefLine {
		value: number;
		label?: string;
		color?: string;
		dash?: string;
	}

	export interface Marker {
		id: string | number;
		x: number;
		y: number;
		label?: string;
		color?: string;
		draggable?: boolean;
		selected?: boolean;
		/** Constrain dragging to one axis. */
		axis?: 'x' | 'y' | 'xy';
	}

	export interface PlotContext {
		x: Scale;
		y: Scale;
		width: number;
		height: number;
		left: number;
		top: number;
		innerWidth: number;
		innerHeight: number;
	}
	export type { ScaleType };
</script>

<script lang="ts">
	import {
		defaultFormat,
		linearTicks,
		logTicks,
		makeScale,
		nearestIndex,
		seriesColor
	} from './scales';

	interface Props {
		series?: Series[];
		xScale?: ScaleType;
		yScale?: ScaleType;
		xDomain?: [number, number];
		yDomain?: [number, number];
		/** Minimum span of an auto y-domain (prevents zooming into numerical noise). */
		minYSpan?: number;
		/** Clamp an auto y-domain to these limits. */
		yLimits?: [number, number];
		xLabel?: string;
		yLabel?: string;
		xFormat?: (v: number) => string;
		yFormat?: (v: number) => string;
		/** Formatter for the x value shown in the tooltip header. */
		xTooltipFormat?: (v: number) => string;
		title?: string;
		height?: number;
		regions?: Region[];
		vlines?: RefLine[];
		hlines?: RefLine[];
		markers?: Marker[];
		crosshair?: boolean;
		legend?: boolean;
		/** Name used for the CSV download; omit to hide the button. */
		exportName?: string;
		/** Keep a square data aspect ratio (pole–zero style). */
		equalAspect?: boolean;
		onmarkerdrag?: (id: string | number, x: number, y: number) => void;
		onmarkerdragend?: (id: string | number) => void;
		onmarkerwheel?: (id: string | number, deltaY: number) => void;
		onmarkerselect?: (id: string | number) => void;
		onplotclick?: (x: number, y: number, ev: MouseEvent) => void;
		overlay?: Snippet<[PlotContext]>;
		toolbar?: Snippet;
	}

	let {
		series = [],
		xScale = 'linear',
		yScale = 'linear',
		xDomain,
		yDomain,
		minYSpan = 0,
		yLimits,
		xLabel,
		yLabel,
		xFormat = defaultFormat,
		yFormat = defaultFormat,
		xTooltipFormat,
		title,
		height = 280,
		regions = [],
		vlines = [],
		hlines = [],
		markers = [],
		crosshair = true,
		legend,
		exportName,
		equalAspect = false,
		onmarkerdrag,
		onmarkerdragend,
		onmarkerwheel,
		onmarkerselect,
		onplotclick,
		overlay,
		toolbar
	}: Props = $props();

	let width = $state(0);
	const uid = `plot-${Math.random().toString(36).slice(2, 9)}`;

	const margin = $derived({ top: 10, right: 14, bottom: xLabel ? 40 : 26, left: yLabel ? 62 : 50 });
	const innerW = $derived(Math.max(10, width - margin.left - margin.right));
	const innerH = $derived(Math.max(10, height - margin.top - margin.bottom));

	function finiteExtent(arrays: ArrayLike<number>[], positiveOnly: boolean): [number, number] | null {
		let lo = Infinity;
		let hi = -Infinity;
		for (const a of arrays) {
			for (let i = 0; i < a.length; i++) {
				const v = a[i];
				if (!Number.isFinite(v) || (positiveOnly && v <= 0)) continue;
				if (v < lo) lo = v;
				if (v > hi) hi = v;
			}
		}
		return lo <= hi ? [lo, hi] : null;
	}

	const xDom = $derived.by((): [number, number] => {
		if (xDomain) return xDomain;
		const e = finiteExtent(
			series.map((s) => s.x),
			xScale === 'log'
		);
		if (!e) return xScale === 'log' ? [1, 10] : [0, 1];
		if (e[0] === e[1]) return xScale === 'log' ? [e[0] / 2, e[0] * 2] : [e[0] - 1, e[1] + 1];
		return e;
	});

	const yDom = $derived.by((): [number, number] => {
		if (yDomain) return yDomain;
		// only consider points inside the x-domain
		let lo = Infinity;
		let hi = -Infinity;
		for (const s of series) {
			for (let i = 0; i < s.y.length; i++) {
				const xv = s.x[i];
				const v = s.y[i];
				if (!Number.isFinite(v) || xv < xDom[0] || xv > xDom[1]) continue;
				if (yScale === 'log' && v <= 0) continue;
				if (v < lo) lo = v;
				if (v > hi) hi = v;
			}
			if (s.kind === 'stem' || s.kind === 'area') {
				lo = Math.min(lo, 0);
				hi = Math.max(hi, 0);
			}
		}
		for (const h of hlines) {
			lo = Math.min(lo, h.value);
			hi = Math.max(hi, h.value);
		}
		if (!(lo <= hi)) return yScale === 'log' ? [1, 10] : [-1, 1];
		if (yLimits) {
			lo = Math.max(lo, yLimits[0]);
			hi = Math.min(hi, yLimits[1]);
		}
		if (yScale === 'log') return [lo / 1.2, hi * 1.2];
		let span = hi - lo;
		if (span < minYSpan) {
			const mid = (hi + lo) / 2;
			lo = mid - minYSpan / 2;
			hi = mid + minYSpan / 2;
			span = minYSpan;
		}
		if (span === 0) {
			const pad = Math.abs(lo) > 0 ? Math.abs(lo) * 0.1 : 1;
			return [lo - pad, hi + pad];
		}
		const pad = span * 0.06;
		return [lo - pad, hi + pad];
	});

	// equal aspect: expand the smaller data span to match the pixel aspect
	const domains = $derived.by(() => {
		let xd = xDom;
		let yd = yDom;
		if (equalAspect && innerW > 0 && innerH > 0) {
			const xs = xd[1] - xd[0];
			const ys = yd[1] - yd[0];
			const ppx = innerW / xs;
			const ppy = innerH / ys;
			if (ppx > ppy) {
				const nx = innerW / ppy;
				const mid = (xd[0] + xd[1]) / 2;
				xd = [mid - nx / 2, mid + nx / 2];
			} else {
				const ny = innerH / ppx;
				const mid = (yd[0] + yd[1]) / 2;
				yd = [mid - ny / 2, mid + ny / 2];
			}
		}
		return { xd, yd };
	});

	const xs = $derived(makeScale(xScale, domains.xd, [margin.left, margin.left + innerW]));
	const ys = $derived(makeScale(yScale, domains.yd, [margin.top + innerH, margin.top]));

	const xTicks = $derived.by(() => {
		if (xScale === 'log') return logTicks(domains.xd[0], domains.xd[1], innerW);
		const t = linearTicks(domains.xd[0], domains.xd[1], Math.max(2, Math.floor(innerW / 80)));
		return { major: t, minor: [] as number[], labelled: t };
	});
	const yTicks = $derived.by(() => {
		if (yScale === 'log') return logTicks(domains.yd[0], domains.yd[1], innerH);
		const t = linearTicks(domains.yd[0], domains.yd[1], Math.max(2, Math.floor(innerH / 46)));
		return { major: t, minor: [] as number[], labelled: t };
	});

	const clampPx = (v: number) => Math.max(-1e4, Math.min(1e4, v));

	function linePath(s: Series): string {
		let d = '';
		let pen = false;
		const n = Math.min(s.x.length, s.y.length);
		for (let i = 0; i < n; i++) {
			const xv = s.x[i];
			const yv = s.y[i];
			if (!Number.isFinite(xv) || !Number.isFinite(yv) || (xScale === 'log' && xv <= 0) || (yScale === 'log' && yv <= 0)) {
				pen = false;
				continue;
			}
			const px = clampPx(xs(xv));
			const py = clampPx(ys(yv));
			if (s.kind === 'step' && pen) {
				d += `H${px.toFixed(2)}`;
			}
			d += `${pen ? 'L' : 'M'}${px.toFixed(2)},${py.toFixed(2)}`;
			pen = true;
		}
		return d;
	}

	function areaPath(s: Series): string {
		const base = ys(Math.max(domains.yd[0], Math.min(domains.yd[1], 0)));
		const n = Math.min(s.x.length, s.y.length);
		let d = '';
		let first = -1;
		let last = -1;
		for (let i = 0; i < n; i++) {
			if (!Number.isFinite(s.y[i])) continue;
			const px = clampPx(xs(s.x[i]));
			const py = clampPx(ys(s.y[i]));
			if (first < 0) {
				d += `M${px},${base}L${px},${py}`;
				first = i;
			} else d += `L${px},${py}`;
			last = i;
		}
		if (last >= 0) d += `L${xs(s.x[last])},${base}Z`;
		return d;
	}

	function stemPath(s: Series): string {
		const base = ys(Math.max(domains.yd[0], Math.min(domains.yd[1], 0)));
		let d = '';
		const n = Math.min(s.x.length, s.y.length);
		for (let i = 0; i < n; i++) {
			if (!Number.isFinite(s.y[i])) continue;
			const px = xs(s.x[i]).toFixed(2);
			d += `M${px},${base.toFixed(2)}V${clampPx(ys(s.y[i])).toFixed(2)}`;
		}
		return d;
	}

	const showLegend = $derived(legend ?? series.filter((s) => s.label && !s.hidden).length >= 2);

	// ---------------- hover ----------------
	let hoverPx = $state<number | null>(null);
	let hoverPy = $state<number | null>(null);
	const hoverX = $derived(hoverPx === null ? null : xs.invert(hoverPx));

	const hoverRows = $derived.by(() => {
		if (hoverX === null) return [];
		return series
			.map((s, i) => ({ s, i }))
			.filter(({ s }) => !s.hidden && !s.noTooltip && s.x.length > 0)
			.map(({ s, i }) => {
				// scatter data need not be sorted by x: search linearly
				const idx = s.kind === 'points' ? nearestLinear(s.x, hoverX) : nearestIndex(s.x, hoverX);
				return {
					label: s.label ?? `Series ${i + 1}`,
					color: s.color ?? seriesColor(i),
					dash: s.dash,
					x: s.x[idx],
					y: s.y[idx],
					fmt: s.format ?? yFormat
				};
			});
	});

	function nearestLinear(xsArr: ArrayLike<number>, v: number): number {
		let best = 0;
		for (let i = 1; i < xsArr.length; i++) if (Math.abs(xsArr[i] - v) < Math.abs(xsArr[best] - v)) best = i;
		return best;
	}

	const snapX = $derived(hoverRows.length ? hoverRows[0].x : hoverX);

	let svgEl: SVGSVGElement | undefined = $state();
	let dragging: string | number | null = null;
	let dragMarker: Marker | null = null;

	function localPoint(ev: PointerEvent | MouseEvent | WheelEvent) {
		const rect = svgEl!.getBoundingClientRect();
		return { px: ev.clientX - rect.left, py: ev.clientY - rect.top };
	}

	function onPointerMove(ev: PointerEvent) {
		if (!svgEl) return;
		const { px, py } = localPoint(ev);
		if (dragging !== null && dragMarker) {
			const cx = Math.max(margin.left, Math.min(margin.left + innerW, px));
			const cy = Math.max(margin.top, Math.min(margin.top + innerH, py));
			const axis = dragMarker.axis ?? 'xy';
			const nx = axis === 'y' ? dragMarker.x : xs.invert(cx);
			const ny = axis === 'x' ? dragMarker.y : ys.invert(cy);
			onmarkerdrag?.(dragging, nx, ny);
			return;
		}
		if (px >= margin.left && px <= margin.left + innerW && py >= margin.top && py <= margin.top + innerH) {
			hoverPx = px;
			hoverPy = py;
		} else {
			hoverPx = null;
		}
	}

	function onPointerLeave() {
		if (dragging === null) hoverPx = null;
	}

	/** Set when a marker is pressed, so the click that follows isn't treated as a plot click. */
	let pressedMarker = false;

	function startDrag(ev: PointerEvent, m: Marker) {
		pressedMarker = true;
		onmarkerselect?.(m.id);
		if (!m.draggable) return;
		ev.preventDefault();
		ev.stopPropagation();
		dragging = m.id;
		dragMarker = m;
		svgEl?.setPointerCapture(ev.pointerId);
	}

	function endDrag(ev: PointerEvent) {
		if (dragging !== null) {
			const id = dragging;
			dragging = null;
			dragMarker = null;
			try {
				svgEl?.releasePointerCapture(ev.pointerId);
			} catch {
				/* already released */
			}
			onmarkerdragend?.(id);
		}
	}

	function onClick(ev: MouseEvent) {
		if (pressedMarker) {
			pressedMarker = false;
			return;
		}
		if (!onplotclick || !svgEl) return;
		const { px, py } = localPoint(ev);
		if (px < margin.left || px > margin.left + innerW || py < margin.top || py > margin.top + innerH) return;
		onplotclick(xs.invert(px), ys.invert(py), ev);
	}

	function onMarkerWheel(ev: WheelEvent, m: Marker) {
		if (!onmarkerwheel) return;
		ev.preventDefault();
		onmarkerwheel(m.id, ev.deltaY);
	}

	function onKey(ev: KeyboardEvent) {
		if (!crosshair) return;
		if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
		ev.preventDefault();
		const step = innerW / 100;
		const cur = hoverPx ?? margin.left + innerW / 2;
		hoverPx = Math.max(margin.left, Math.min(margin.left + innerW, cur + (ev.key === 'ArrowLeft' ? -step : step)));
	}

	function downloadCsv() {
		const lines = ['series,x,y'];
		series.forEach((s, i) => {
			const name = (s.label ?? `series${i + 1}`).replace(/[",\n]/g, ' ');
			for (let k = 0; k < Math.min(s.x.length, s.y.length); k++) lines.push(`${name},${s.x[k]},${s.y[k]}`);
		});
		const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = `${exportName ?? 'plot'}.csv`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 1000);
	}

	const ctx = $derived<PlotContext>({
		x: xs,
		y: ys,
		width,
		height,
		left: margin.left,
		top: margin.top,
		innerWidth: innerW,
		innerHeight: innerH
	});

	const tooltipLeft = $derived(hoverPx !== null && hoverPx > margin.left + innerW * 0.6);
</script>

<figure class="plot" aria-label={title}>
	{#if title || showLegend || exportName || toolbar}
		<figcaption class="plot-head">
			{#if title}<span class="plot-title">{title}</span>{/if}
			{#if showLegend}
				<ul class="legend">
					{#each series as s, i (i)}
						{#if s.label && !s.hidden}
							<li>
								<svg width="18" height="8" aria-hidden="true">
									{#if s.kind === 'points'}
										<circle cx="9" cy="4" r="3.5" fill={s.color ?? seriesColor(i)} />
									{:else}
										<line
											x1="1"
											y1="4"
											x2="17"
											y2="4"
											stroke={s.color ?? seriesColor(i)}
											stroke-width="2.5"
											stroke-dasharray={s.dash}
											stroke-linecap="round"
										/>
									{/if}
								</svg>
								{s.label}
							</li>
						{/if}
					{/each}
				</ul>
			{/if}
			<span class="spacer"></span>
			{#if toolbar}{@render toolbar()}{/if}
			{#if exportName}
				<button class="btn ghost small" type="button" onclick={downloadCsv} title="Download plotted data as CSV">CSV</button>
			{/if}
		</figcaption>
	{/if}
	<div class="plot-body" bind:clientWidth={width} style:height="{height}px">
		{#if width > 0}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
			<svg
				bind:this={svgEl}
				{width}
				{height}
				role="img"
				aria-label={title ?? 'chart'}
				tabindex="0"
				onpointermove={onPointerMove}
				onpointerleave={onPointerLeave}
				onpointerup={endDrag}
				onpointercancel={endDrag}
				onclick={onClick}
				onkeydown={onKey}
				class:clickable={!!onplotclick}
			>
				<defs>
					<clipPath id="{uid}-clip">
						<rect x={margin.left} y={margin.top} width={innerW} height={innerH} />
					</clipPath>
				</defs>
				<rect class="bg" x={margin.left} y={margin.top} width={innerW} height={innerH} />

				<!-- grid -->
				<g class="grid">
					{#each xTicks.minor as t (t)}
						<line class="minor" x1={xs(t)} x2={xs(t)} y1={margin.top} y2={margin.top + innerH} />
					{/each}
					{#each xTicks.major as t (t)}
						<line x1={xs(t)} x2={xs(t)} y1={margin.top} y2={margin.top + innerH} />
					{/each}
					{#each yTicks.minor as t (t)}
						<line class="minor" x1={margin.left} x2={margin.left + innerW} y1={ys(t)} y2={ys(t)} />
					{/each}
					{#each yTicks.major as t (t)}
						<line x1={margin.left} x2={margin.left + innerW} y1={ys(t)} y2={ys(t)} />
					{/each}
				</g>

				<g clip-path="url(#{uid}-clip)">
					{#each regions as r, i (i)}
						{@const x0 = xs(Math.max(r.x0, domains.xd[0]))}
						{@const x1 = xs(Math.min(r.x1, domains.xd[1]))}
						{@const y0 = ys(Math.min(Math.max(r.y0, domains.yd[0]), domains.yd[1]))}
						{@const y1 = ys(Math.max(Math.min(r.y1, domains.yd[1]), domains.yd[0]))}
						<rect
							class="region {r.kind ?? 'forbidden'}"
							x={Math.min(x0, x1)}
							y={Math.min(y0, y1)}
							width={Math.abs(x1 - x0)}
							height={Math.abs(y1 - y0)}
						>
							{#if r.label}<title>{r.label}</title>{/if}
						</rect>
					{/each}

					{#each hlines as h, i (i)}
						<line
							class="refline"
							x1={margin.left}
							x2={margin.left + innerW}
							y1={ys(h.value)}
							y2={ys(h.value)}
							stroke={h.color ?? 'var(--muted)'}
							stroke-dasharray={h.dash ?? '4 4'}
						/>
						{#if h.label}
							<text class="reflabel" x={margin.left + innerW - 4} y={ys(h.value) - 4} text-anchor="end">{h.label}</text>
						{/if}
					{/each}
					{#each vlines as v, i (i)}
						{#if v.value >= domains.xd[0] && v.value <= domains.xd[1]}
							<line
								class="refline"
								x1={xs(v.value)}
								x2={xs(v.value)}
								y1={margin.top}
								y2={margin.top + innerH}
								stroke={v.color ?? 'var(--muted)'}
								stroke-dasharray={v.dash ?? '4 4'}
							/>
							{#if v.label}
								<text class="reflabel" x={xs(v.value) + 4} y={margin.top + 12}>{v.label}</text>
							{/if}
						{/if}
					{/each}

					{#each series as s, i (i)}
						{@const color = s.color ?? seriesColor(i)}
						{#if s.kind === 'area'}
							<path d={areaPath(s)} fill={color} fill-opacity="0.1" stroke="none" />
							<path d={linePath(s)} fill="none" stroke={color} stroke-width={s.width ?? 2} stroke-linejoin="round" stroke-linecap="round" opacity={s.opacity ?? 1} />
						{:else if s.kind === 'stem'}
							<path d={stemPath(s)} stroke={color} stroke-width={s.width ?? 1.5} opacity={s.opacity ?? 1} />
							{#if s.x.length <= 160}
								{#each Array.from(s.y) as yv, k (k)}
									{#if Number.isFinite(yv)}
										<circle cx={xs(s.x[k])} cy={clampPx(ys(yv))} r="3" fill={color} stroke="var(--chart-surface)" stroke-width="1.5" opacity={s.opacity ?? 1} />
									{/if}
								{/each}
							{/if}
						{:else if s.kind === 'points'}
							{#each Array.from(s.y) as yv, k (k)}
								{#if Number.isFinite(yv)}
									<circle cx={xs(s.x[k])} cy={ys(yv)} r="4" fill={color} stroke="var(--chart-surface)" stroke-width="2" opacity={s.opacity ?? 1} />
								{/if}
							{/each}
						{:else}
							<path
								d={linePath(s)}
								fill="none"
								stroke={color}
								stroke-width={s.width ?? 2}
								stroke-dasharray={s.dash}
								stroke-linejoin="round"
								stroke-linecap="round"
								opacity={s.opacity ?? 1}
							/>
						{/if}
					{/each}

					{#if overlay}{@render overlay(ctx)}{/if}
				</g>

				<!-- axes -->
				<g class="axis">
					<line x1={margin.left} x2={margin.left + innerW} y1={margin.top + innerH} y2={margin.top + innerH} />
					<line x1={margin.left} x2={margin.left} y1={margin.top} y2={margin.top + innerH} />
					{#each xTicks.labelled as t (t)}
						<text x={xs(t)} y={margin.top + innerH + 16} text-anchor="middle">{xFormat(t)}</text>
					{/each}
					{#each yTicks.labelled as t (t)}
						<text x={margin.left - 6} y={ys(t) + 4} text-anchor="end">{yFormat(t)}</text>
					{/each}
					{#if xLabel}
						<text class="label" x={margin.left + innerW / 2} y={height - 6} text-anchor="middle">{xLabel}</text>
					{/if}
					{#if yLabel}
						<text
							class="label"
							transform="translate(14 {margin.top + innerH / 2}) rotate(-90)"
							text-anchor="middle">{yLabel}</text
						>
					{/if}
				</g>

				{#if crosshair && hoverPx !== null && snapX !== null && Number.isFinite(snapX)}
					<g class="crosshair" pointer-events="none">
						<line x1={xs(snapX)} x2={xs(snapX)} y1={margin.top} y2={margin.top + innerH} />
						{#each hoverRows as r, i (i)}
							{#if Number.isFinite(r.y) && r.y >= domains.yd[0] && r.y <= domains.yd[1]}
								<circle cx={xs(r.x)} cy={ys(r.y)} r="4" fill={r.color} stroke="var(--chart-surface)" stroke-width="2" />
							{/if}
						{/each}
					</g>
				{/if}

				<!-- markers (draggable handles) -->
				{#each markers as m (m.id)}
					{#if Number.isFinite(m.x) && Number.isFinite(m.y)}
						{@const mx = xs(m.x)}
						{@const my = clampPx(ys(m.y))}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<g
							class="marker"
							class:draggable={m.draggable}
							class:selected={m.selected}
							onpointerdown={(e) => startDrag(e, m)}
							onwheel={(e) => onMarkerWheel(e, m)}
						>
							<circle class="hit" cx={mx} cy={my} r="14" />
							<circle cx={mx} cy={my} r={m.selected ? 8 : 6.5} fill={m.color ?? 'var(--s1)'} stroke="var(--chart-surface)" stroke-width="2" />
							{#if m.label}
								<text x={mx} y={my + 3.5} text-anchor="middle" class="marker-label">{m.label}</text>
							{/if}
						</g>
					{/if}
				{/each}
			</svg>
			{#if crosshair && hoverPx !== null && hoverRows.length > 0 && snapX !== null}
				<div
					class="tooltip"
					style:left={tooltipLeft ? 'auto' : `${hoverPx + 14}px`}
					style:right={tooltipLeft ? `${width - hoverPx + 14}px` : 'auto'}
					style:top="{Math.max(4, Math.min((hoverPy ?? 0) - 20, height - 30 - hoverRows.length * 22))}px"
				>
					<div class="tt-x">{(xTooltipFormat ?? xFormat)(snapX)}{xLabel ? '' : ''}</div>
					{#each hoverRows as r, i (i)}
						<div class="tt-row">
							<svg width="14" height="6" aria-hidden="true"
								><line x1="1" y1="3" x2="13" y2="3" stroke={r.color} stroke-width="2.5" stroke-dasharray={r.dash} stroke-linecap="round" /></svg
							>
							<strong>{Number.isFinite(r.y) ? r.fmt(r.y) : '—'}</strong>
							{#if hoverRows.length > 1}<span class="tt-label">{r.label}</span>{/if}
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	</div>
</figure>

<style>
	.plot {
		margin: 0;
		min-width: 0;
	}
	.plot-head {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.3rem 0.9rem;
		margin-bottom: 0.25rem;
		min-height: 1.6rem;
	}
	.plot-title {
		font-weight: 600;
		font-size: 0.9rem;
		color: var(--text);
	}
	.spacer {
		flex: 1;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem 0.9rem;
		list-style: none;
		margin: 0;
		padding: 0;
		font-size: 0.8rem;
		color: var(--text-2);
	}
	.legend li {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		margin: 0;
	}
	.plot-body {
		position: relative;
		width: 100%;
		touch-action: pan-y;
	}
	svg {
		display: block;
		overflow: visible;
		user-select: none;
		-webkit-user-select: none;
	}
	svg:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
		border-radius: 4px;
	}
	svg.clickable {
		cursor: crosshair;
	}
	.bg {
		fill: var(--chart-surface);
	}
	.grid line {
		stroke: var(--grid);
		stroke-width: 1;
		shape-rendering: crispEdges;
	}
	.grid line.minor {
		opacity: 0.55;
	}
	.axis line {
		stroke: var(--axis);
		stroke-width: 1;
		shape-rendering: crispEdges;
	}
	.axis text {
		fill: var(--axis-text);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}
	.axis text.label {
		fill: var(--text-2);
		font-size: 12px;
	}
	.region.forbidden {
		fill: var(--critical);
		fill-opacity: 0.09;
	}
	.region.allowed {
		fill: var(--good);
		fill-opacity: 0.08;
	}
	.region.neutral {
		fill: var(--muted);
		fill-opacity: 0.1;
	}
	.refline {
		stroke-width: 1;
	}
	.reflabel {
		fill: var(--text-2);
		font-size: 11px;
		paint-order: stroke;
		stroke: var(--chart-surface);
		stroke-width: 3px;
	}
	.crosshair line {
		stroke: var(--crosshair);
		stroke-width: 1;
	}
	.marker .hit {
		fill: transparent;
	}
	.marker.draggable {
		cursor: grab;
	}
	.marker.draggable:active {
		cursor: grabbing;
	}
	.marker.selected circle:not(.hit) {
		stroke: var(--text);
	}
	.marker-label {
		fill: #fff;
		font-size: 9px;
		font-weight: 700;
		pointer-events: none;
	}
	.tooltip {
		position: absolute;
		pointer-events: none;
		background: var(--surface);
		border: 1px solid var(--border-strong);
		box-shadow: var(--shadow);
		border-radius: 8px;
		padding: 0.35rem 0.55rem;
		font-size: 0.78rem;
		line-height: 1.35;
		z-index: 5;
		white-space: nowrap;
	}
	.tt-x {
		color: var(--muted);
		margin-bottom: 0.15rem;
		font-variant-numeric: tabular-nums;
	}
	.tt-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-variant-numeric: tabular-nums;
	}
	.tt-row strong {
		color: var(--text);
		font-weight: 600;
	}
	.tt-label {
		color: var(--text-2);
	}
</style>
