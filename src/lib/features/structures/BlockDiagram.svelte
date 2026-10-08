<script lang="ts">
	import type { Diagram } from './diagram';
	import { DELAY_H, DELAY_W, SUM_R } from './diagram';
	import { trimNumber } from '$lib/dsp/units';

	interface Props {
		diagram: Diagram;
		/** Delay contents to print next to each z⁻¹ box (indexed by state number). */
		values?: number[] | null;
		label?: string;
	}
	let { diagram, values = null, label = 'Block diagram' }: Props = $props();

	const uid = `bd-${Math.random().toString(36).slice(2, 9)}`;
	const fmtVal = (v: number) => (Math.abs(v) < 1e-12 ? '0' : trimNumber(v, 4).replace('-', '−'));
	const pts = (p: [number, number][]) =>
		p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
</script>

<div class="bd-wrap">
	<svg
		width={diagram.width}
		height={diagram.height}
		viewBox="0 0 {diagram.width} {diagram.height}"
		role="img"
		aria-label={label}
	>
		<defs>
			<marker
				id="{uid}-arrow"
				viewBox="0 0 10 10"
				refX="9"
				refY="5"
				markerWidth="7"
				markerHeight="7"
				orient="auto-start-reverse"
			>
				<path d="M0,1 L9,5 L0,9 z" class="arrowhead" />
			</marker>
		</defs>
		{#each diagram.els as e, i (i)}
			{#if e.t === 'wire'}
				<polyline
					class="wire"
					points={pts(e.pts)}
					marker-end={e.arrow ? `url(#${uid}-arrow)` : undefined}
				/>
			{/if}
		{/each}
		{#each diagram.els as e, i (i)}
			{#if e.t === 'dot'}
				<circle class="dot" cx={e.x} cy={e.y} r="2.8" />
			{:else if e.t === 'sum'}
				<g class="sum">
					<circle cx={e.x} cy={e.y} r={SUM_R} />
					<path d="M{e.x - 5},{e.y}h10M{e.x},{e.y - 5}v10" />
				</g>
			{:else if e.t === 'delay'}
				{@const v = values?.[e.state]}
				<g class="delay" class:live={values !== null && values !== undefined}>
					<rect
						x={e.x - DELAY_W / 2}
						y={e.y - DELAY_H / 2}
						width={DELAY_W}
						height={DELAY_H}
						rx="3"
					/>
					<text x={e.x} y={e.y + 4} text-anchor="middle"
						>z<tspan dy="-5" font-size="8.5">−1</tspan></text
					>
					{#if v !== undefined}
						{#if e.vertical}
							<text class="val" x={e.x + DELAY_W / 2 + 5} y={e.y + 4} text-anchor="start"
								>{fmtVal(v)}</text
							>
						{:else}
							<text class="val" x={e.x} y={e.y + DELAY_H / 2 + 13} text-anchor="middle"
								>{fmtVal(v)}</text
							>
						{/if}
					{/if}
				</g>
			{:else if e.t === 'gain'}
				<g class="gain">
					<path d="M-8,-9 L-8,9 L10,0 Z" transform="translate({e.x} {e.y}) rotate({e.angle})" />
					<text class="glabel" x={e.lx} y={e.ly} text-anchor={e.anchor}>{e.label}</text>
				</g>
			{:else if e.t === 'text'}
				<text class={e.kind} x={e.x} y={e.y} text-anchor={e.anchor}>{e.text}</text>
			{/if}
		{/each}
	</svg>
</div>

<style>
	.bd-wrap {
		overflow-x: auto;
		max-width: 100%;
		padding-bottom: 4px;
	}
	svg {
		display: block;
		font-family: var(--font-sans);
	}
	.wire {
		fill: none;
		stroke: var(--text-2);
		stroke-width: 1.4;
		stroke-linejoin: round;
	}
	.arrowhead {
		fill: var(--text-2);
	}
	.dot {
		fill: var(--text-2);
	}
	.sum circle {
		fill: var(--surface);
		stroke: var(--text);
		stroke-width: 1.4;
	}
	.sum path {
		stroke: var(--text);
		stroke-width: 1.4;
	}
	.delay rect {
		fill: var(--surface-2);
		stroke: var(--text);
		stroke-width: 1.3;
	}
	.delay.live rect {
		stroke: var(--accent);
		stroke-width: 1.8;
	}
	.delay text {
		font-size: 11.5px;
		fill: var(--text);
	}
	.delay text.val {
		font-family: var(--font-mono);
		font-size: 10.5px;
		fill: var(--accent-ink);
		font-weight: 600;
		paint-order: stroke;
		stroke: var(--surface);
		stroke-width: 3px;
	}
	.gain path {
		fill: var(--surface);
		stroke: var(--text);
		stroke-width: 1.3;
		stroke-linejoin: round;
	}
	.glabel {
		font-family: var(--font-mono);
		font-size: 10.5px;
		fill: var(--text-2);
		paint-order: stroke;
		stroke: var(--surface);
		stroke-width: 3px;
	}
	.signal {
		font-size: 12.5px;
		font-style: italic;
		fill: var(--text);
	}
	.caption {
		font-size: 11px;
		fill: var(--muted);
	}
</style>
