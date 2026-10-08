<script lang="ts">
	import type { PartItem, SchematicItem } from './types';
	import { OPAMP_H, OPAMP_IN, OPAMP_W } from './types';

	interface Props {
		items: SchematicItem[];
		/** viewBox width and height (the drawing scales to the container). */
		width: number;
		height: number;
		/** Accessible description of the circuit. */
		title: string;
		/** Largest rendered width in px (defaults to the viewBox width). */
		maxWidth?: number;
	}
	let { items, width, height, title, maxWidth }: Props = $props();

	function partGeom(p: PartItem) {
		const dx = p.x2 - p.x1;
		const dy = p.y2 - p.y1;
		const len = Math.hypot(dx, dy);
		const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
		const m = len / 2;
		let lead = '';
		let body = '';
		let plates = '';
		if (p.kind === 'R') {
			const h = 18;
			let d = `M${m - h},0`;
			for (let i = 0; i < 6; i++) d += ` L${m - h + (i + 0.5) * 6},${i % 2 === 0 ? -6 : 6}`;
			d += ` L${m + h},0`;
			body = d;
			lead = `M0,0 H${m - h} M${m + h},0 H${len}`;
		} else if (p.kind === 'C') {
			lead = `M0,0 H${m - 4} M${m + 4},0 H${len}`;
			plates = `M${m - 4},-11 V11 M${m + 4},-11 V11`;
		} else {
			const h = 20;
			let d = `M${m - h},0`;
			for (let i = 0; i < 4; i++) d += ` a5,5 0 0 1 10,0`;
			body = d;
			lead = `M0,0 H${m - h} M${m + h},0 H${len}`;
		}
		const horizontal = Math.abs(dx) >= Math.abs(dy);
		const cx = (p.x1 + p.x2) / 2;
		const cy = (p.y1 + p.y2) / 2;
		const place = p.labels ?? (horizontal ? 'split' : 'right');
		let nameAt: [number, number, 'start' | 'middle' | 'end'];
		let valueAt: [number, number, 'start' | 'middle' | 'end'];
		switch (place) {
			case 'above':
				nameAt = [cx, cy - 29, 'middle'];
				valueAt = [cx, cy - 16, 'middle'];
				break;
			case 'below':
				nameAt = [cx, cy + 25, 'middle'];
				valueAt = [cx, cy + 38, 'middle'];
				break;
			case 'left':
				nameAt = [cx - 15, cy - 3, 'end'];
				valueAt = [cx - 15, cy + 11, 'end'];
				break;
			case 'right':
				nameAt = [cx + 15, cy - 3, 'start'];
				valueAt = [cx + 15, cy + 11, 'start'];
				break;
			default:
				nameAt = [cx, cy - 16, 'middle'];
				valueAt = [cx, cy + 25, 'middle'];
		}
		return {
			transform: `translate(${p.x1} ${p.y1}) rotate(${angle})`,
			lead,
			body,
			plates,
			nameAt,
			valueAt
		};
	}

	/** Split "v_out" into main text and a subscript. */
	function sub(s: string): [string, string] {
		const i = s.indexOf('_');
		return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)];
	}
</script>

<svg
	class="schem"
	viewBox="0 0 {width} {height}"
	role="img"
	aria-label={title}
	style:max-width="{maxWidth ?? width}px"
>
	{#snippet label(
		text: string,
		x: number,
		y: number,
		anchor: 'start' | 'middle' | 'end',
		cls: string
	)}
		{@const [main, subscript] = sub(text)}
		<text {x} {y} text-anchor={anchor} class={cls}
			>{main}{#if subscript}<tspan class="subs" dy="3">{subscript}</tspan>{/if}</text
		>
	{/snippet}

	{#each items as it, i (i)}
		{#if it.t === 'wire'}
			<polyline
				points={it.pts.map((p) => p.join(',')).join(' ')}
				class="ln"
				class:acc={it.accent}
				stroke-dasharray={it.dashed ? '4 3' : undefined}
			/>
		{:else if it.t === 'part'}
			{@const g = partGeom(it)}
			<g class="part" class:acc={it.accent}>
				<g transform={g.transform}>
					<path d={g.lead} class="ln" />
					{#if g.body}<path d={g.body} class="ln body" />{/if}
					{#if g.plates}<path d={g.plates} class="ln plate" />{/if}
				</g>
				{#if it.name}{@render label(it.name, g.nameAt[0], g.nameAt[1], g.nameAt[2], 'name')}{/if}
				{#if it.value}<text
						x={g.valueAt[0]}
						y={g.valueAt[1]}
						text-anchor={g.valueAt[2]}
						class="value">{it.value}</text
					>{/if}
			</g>
		{:else if it.t === 'gnd'}
			<path
				d="M{it.x - 11},{it.y} H{it.x + 11} M{it.x - 7},{it.y + 4.5} H{it.x + 7} M{it.x - 3},{it.y +
					9} H{it.x + 3}"
				class="ln"
			/>
		{:else if it.t === 'dot'}
			<circle cx={it.x} cy={it.y} r="3.2" class="dot" class:acc={it.accent} />
		{:else if it.t === 'term'}
			<circle cx={it.x} cy={it.y} r="3.6" class="term" class:acc={it.accent} />
			{#if it.label}
				{@render label(
					it.label,
					it.x + (it.dx ?? 0),
					it.y + (it.dy ?? -9),
					it.anchor ?? 'middle',
					it.accent ? 'name accent' : 'name'
				)}
			{/if}
		{:else if it.t === 'src'}
			<circle cx={it.x} cy={it.y} r="13" class="ln src" />
			<path d="M{it.x - 7},{it.y} c2.4,-8 4.6,-8 7,0 s4.6,8 7,0" class="ln" />
			<text x={it.x - 4} y={it.y - 16} text-anchor="middle" class="sign">+</text>
			{#if it.label}{@render label(it.label, it.x - 19, it.y + 4, 'end', 'name')}{/if}
		{:else if it.t === 'opamp'}
			{@const w = it.w ?? OPAMP_W}
			{@const h = it.h ?? OPAMP_H}
			{@const top = it.minusTop ?? true}
			<path d="M{it.x},{it.y - h / 2} L{it.x + w},{it.y} L{it.x},{it.y + h / 2} Z" class="ln amp" />
			<text x={it.x + 9} y={it.y - OPAMP_IN + 4.5} text-anchor="middle" class="sign"
				>{top ? '−' : '+'}</text
			>
			<text x={it.x + 9} y={it.y + OPAMP_IN + 4.5} text-anchor="middle" class="sign"
				>{top ? '+' : '−'}</text
			>
			{#if it.name}<text x={it.x + w * 0.4} y={it.y + 4} text-anchor="middle" class="name small"
					>{it.name}</text
				>{/if}
		{:else if it.t === 'text'}
			<text
				x={it.x}
				y={it.y}
				text-anchor={it.anchor ?? 'start'}
				class="free"
				class:accent={it.accent}
				class:muted={it.muted}
				style:font-size={it.size ? `${it.size}px` : undefined}>{it.text}</text
			>
		{:else if it.t === 'volt'}
			<text x={it.x} y={it.y1 + 15} text-anchor="middle" class="sign" class:accent={it.accent}
				>+</text
			>
			<text x={it.x} y={it.y2 - 6} text-anchor="middle" class="sign" class:accent={it.accent}
				>−</text
			>
			{@render label(
				it.label,
				it.x,
				(it.y1 + it.y2) / 2 + 4,
				'middle',
				it.accent ? 'name accent' : 'name'
			)}
		{/if}
	{/each}
</svg>

<style>
	.schem {
		display: block;
		width: 100%;
		height: auto;
		color: var(--text);
		overflow: visible;
	}
	.ln {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
		stroke-linejoin: round;
		stroke-linecap: round;
	}
	.plate {
		stroke-width: 2.6;
		stroke-linecap: butt;
	}
	.amp {
		fill: var(--surface);
	}
	.src {
		fill: var(--surface);
	}
	.acc,
	.acc .ln {
		stroke: var(--accent);
	}
	.dot {
		fill: currentColor;
	}
	.dot.acc {
		fill: var(--accent);
		stroke: none;
	}
	.term {
		fill: var(--surface);
		stroke: currentColor;
		stroke-width: 1.5;
	}
	.term.acc {
		stroke: var(--accent);
	}
	text {
		font-family: var(--font-sans);
		fill: var(--text);
	}
	.name {
		font-size: 12.5px;
		font-weight: 600;
	}
	.name.small {
		font-size: 10.5px;
		font-weight: 600;
		fill: var(--text-2);
	}
	.value {
		font-size: 11.5px;
		fill: var(--text-2);
		font-variant-numeric: tabular-nums;
	}
	.subs {
		font-size: 9.5px;
	}
	.sign {
		font-size: 14px;
		font-weight: 600;
		fill: var(--text-2);
	}
	.free {
		font-size: 11.5px;
		fill: var(--text-2);
	}
	.free.muted {
		fill: var(--muted);
	}
	.accent,
	.part.acc .name,
	.part.acc .value {
		fill: var(--accent-ink);
	}
</style>
