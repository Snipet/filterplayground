<script lang="ts">
	/**
	 * Direct-form I block diagram drawn from feed-forward and feedback taps:
	 * input delay line on the left, a column of adders in the middle, output delay
	 * line on the right. Multi-sample delays are drawn as one z^{−k} block.
	 */
	import type { Diagram, Tap } from './catalog';
	import { trimNumber } from '$lib/dsp/units';

	interface Props {
		diagram: Diagram;
		label?: string;
	}
	let { diagram, label = 'Block diagram' }: Props = $props();

	const H = 62; // row spacing
	const TOP = 30;
	const xL = 72; // input bus
	const xMulL = 140;
	const xA = 212; // adder column
	const xMulR = 292;
	const xR = 352; // output bus
	const rA = 11;

	const ff = $derived([...diagram.ff].sort((a, b) => a.delay - b.delay));
	const fb = $derived([...diagram.fb].sort((a, b) => a.delay - b.delay));
	const hasFb = $derived(fb.length > 0);
	const rows = $derived([...new Set([0, ...ff.map((t) => t.delay), ...fb.map((t) => t.delay)])].sort((a, b) => a - b));
	// vertical position of each row; the gap above the last feed-forward tap grows when it carries a note
	const ys = $derived.by(() => {
		const out: number[] = [];
		const lastFf = ff.length ? ff[ff.length - 1].delay : -1;
		let y = TOP;
		rows.forEach((d, i) => {
			if (i > 0) y += H + (diagram.ffNote && d === lastFf ? 26 : 0);
			out.push(y);
		});
		return out;
	});
	const rowY = (d: number) => ys[rows.indexOf(d)];
	const xOut = $derived(hasFb ? 430 : xA + 100);
	const W = $derived(xOut + 44);
	const height = $derived(ys[ys.length - 1] + 26);

	interface Node {
		d: number;
		y: number;
		ff?: Tap;
		fb?: Tap;
		chain: boolean;
		adder: boolean;
	}
	const nodes = $derived.by((): Node[] =>
		rows.map((d, i) => {
			const f = ff.find((t) => t.delay === d);
			const b = fb.find((t) => t.delay === d);
			const chain = i < rows.length - 1;
			const inputs = (f ? 1 : 0) + (b ? 1 : 0) + (chain ? 1 : 0);
			return { d, y: rowY(d), ff: f, fb: b, chain, adder: inputs >= 2 };
		})
	);

	interface Block {
		y: number;
		k: number;
	}
	function blocks(taps: Tap[]): Block[] {
		const out: Block[] = [];
		let prev = 0;
		for (const t of taps) {
			if (t.delay > prev) out.push({ y: (rowY(prev) + rowY(t.delay)) / 2, k: t.delay - prev });
			prev = t.delay;
		}
		return out;
	}
	const ffBlocks = $derived(blocks(ff));
	const fbBlocks = $derived(blocks(fb));
	const ffLast = $derived(ff.length ? ff[ff.length - 1].delay : 0);
	const fbLast = $derived(fb.length ? fb[fb.length - 1].delay : 0);

	const fmt = (v: number) => trimNumber(v, 4).replace('-', '−');
	const arrowR = (x: number, y: number) => `M${x},${y}l-7,-3.5v7z`;
	const arrowL = (x: number, y: number) => `M${x},${y}l7,-3.5v7z`;
	const arrowU = (x: number, y: number) => `M${x},${y}l-3.5,7h7z`;

	const desc = $derived(
		`Direct-form diagram: feed-forward taps ${ff.map((t) => `${fmt(t.coef)}·x[n−${t.delay}]`).join(', ')}${hasFb ? `; feedback taps ${fb.map((t) => `${fmt(t.coef)}·y[n−${t.delay}]`).join(', ')}` : ''}.`
	);
</script>

<svg class="bd" viewBox="0 0 {W} {height}" style:max-width="{Math.round(W * 1.2)}px" role="img" aria-label="{label}. {desc}">
	<!-- input -->
	<text class="io" x="4" y={rowY(0) + 5}>x[n]</text>
	<line x1="34" y1={rowY(0)} x2={xL} y2={rowY(0)} />
	{#if ffLast > 0}
		<line x1={xL} y1={rowY(0)} x2={xL} y2={rowY(ffLast)} />
	{/if}
	{#each ffBlocks as b, i (i)}
		<rect class="box" x={xL - 20} y={b.y - 12} width="40" height="24" rx="3" />
		<text class="z" x={xL} y={b.y + 5} text-anchor="middle">z<tspan class="exp" dy="-6">−{b.k}</tspan></text>
		{#if diagram.ffNote && i === ffBlocks.length - 1}
			<text class="note" x={xL + 26} y={b.y - 2}>⋮ {diagram.ffNote}</text>
		{/if}
	{/each}

	<!-- output -->
	<line x1={nodes[0].adder ? xA + rA : xA} y1={rowY(0)} x2={xOut} y2={rowY(0)} />
	<path class="head" d={arrowR(xOut, rowY(0))} />
	<text class="io" x={xOut + 5} y={rowY(0) + 5}>y[n]</text>
	{#if hasFb}
		<circle class="dot" cx={xR} cy={rowY(0)} r="3" />
		<line x1={xR} y1={rowY(0)} x2={xR} y2={rowY(fbLast)} />
		{#each fbBlocks as b, i (i)}
			<rect class="box" x={xR - 20} y={b.y - 12} width="40" height="24" rx="3" />
			<text class="z" x={xR} y={b.y + 5} text-anchor="middle">z<tspan class="exp" dy="-6">−{b.k}</tspan></text>
		{/each}
	{/if}

	{#each nodes as n, i (n.d)}
		{#if n.ff}
			{@const end = n.adder ? xA - rA : xA}
			<line x1={xL} y1={n.y} x2={end} y2={n.y} />
			{#if n.d !== ffLast}<circle class="dot" cx={xL} cy={n.y} r="3" />{/if}
			{#if n.adder}<path class="head" d={arrowR(end, n.y)} />{/if}
			{#if n.ff.coef !== 1}
				<path class="mul" d="M{xMulL - 10},{n.y - 10}L{xMulL + 10},{n.y}L{xMulL - 10},{n.y + 10}Z" />
				<text class="coef" x={xMulL} y={n.y - 16} text-anchor="middle">{fmt(n.ff.coef)}</text>
			{/if}
		{/if}
		{#if n.fb}
			{@const end = n.adder ? xA + rA : xA}
			<line x1={xR} y1={n.y} x2={end} y2={n.y} />
			{#if n.d !== fbLast && n.d !== 0}<circle class="dot" cx={xR} cy={n.y} r="3" />{/if}
			{#if n.adder}<path class="head" d={arrowL(end, n.y)} />{/if}
			{#if n.fb.coef !== 1}
				<path class="mul" d="M{xMulR + 10},{n.y - 10}L{xMulR - 10},{n.y}L{xMulR + 10},{n.y + 10}Z" />
				<text class="coef" x={xMulR} y={n.y - 16} text-anchor="middle">{fmt(n.fb.coef)}</text>
			{/if}
		{/if}
		{#if n.chain}
			{@const below = nodes[i + 1]}
			{@const y0 = below.adder ? below.y - rA : below.y}
			{@const y1 = n.adder ? n.y + rA : n.y}
			<line x1={xA} y1={y0} x2={xA} y2={y1} />
			{#if n.adder}<path class="head" d={arrowU(xA, y1)} />{/if}
		{/if}
		{#if n.adder}
			<circle class="adder" cx={xA} cy={n.y} r={rA} />
			<path class="plus" d="M{xA - 5},{n.y}h10M{xA},{n.y - 5}v10" />
		{/if}
	{/each}
</svg>

<style>
	.bd {
		display: block;
		width: 100%;
		height: auto;
		color: var(--text);
		overflow: visible;
	}
	line,
	.plus {
		stroke: currentColor;
		stroke-width: 1.4;
		fill: none;
	}
	.head {
		fill: currentColor;
		stroke: none;
	}
	.dot {
		fill: currentColor;
	}
	.box,
	.adder,
	.mul {
		fill: var(--surface);
		stroke: currentColor;
		stroke-width: 1.4;
	}
	text {
		fill: currentColor;
		font-size: 15px;
	}
	.io {
		font-style: italic;
		font-weight: 600;
	}
	.z {
		font-style: italic;
	}
	.exp {
		font-size: 10.5px;
		font-style: normal;
	}
	.coef {
		font-size: 13.5px;
		fill: var(--text-2);
		font-variant-numeric: tabular-nums;
	}
	.note {
		font-size: 13px;
		fill: var(--muted);
	}
</style>
