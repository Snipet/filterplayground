<script lang="ts">
	import { formatSI } from '$lib/dsp/units';
	import type { Branch } from '$lib/features/lc-ladder/ladder';

	interface Props {
		branches: Branch[];
		rs: number;
		rl: number;
		title?: string;
	}
	let { branches, rs, rl, title = 'Ladder schematic' }: Props = $props();

	const RAIL = 56;
	const GND = 176;
	const MID = (RAIL + GND) / 2;
	const EL = 56; // element body length (shunt branches)
	const TOP = RAIL + (GND - RAIL - EL) / 2;
	const DES_Y = RAIL - 30;
	const VAL_Y = RAIL - 16;
	const XS = 44; // source x

	type Item =
		| { kind: 'series'; x: number; w: number; br: Branch }
		| { kind: 'shunt'; x: number; w: number; node: number; br: Branch };

	const layout = $derived.by(() => {
		let x = XS + 76; // after Rs (from XS+16 to XS+76)
		const items: Item[] = [];
		for (const br of branches) {
			const both = br.L !== undefined && br.C !== undefined;
			if (br.pos === 'series') {
				const w = both ? 150 : 84;
				items.push({ kind: 'series', x, w, br });
				x += w;
			} else {
				const w = both ? 124 : 96;
				items.push({ kind: 'shunt', x, w, node: x + 22, br });
				x += w;
			}
		}
		const loadX = x + 22;
		return { items, loadX, width: loadX + 70 };
	});

	const fmtL = (v: number) => formatSI(v, 'H', 3);
	const fmtC = (v: number) => formatSI(v, 'F', 3);
	const fmtR = (v: number) => formatSI(v, 'Ω', 4);

	// ---- element paths (start point, direction) ----
	function resH(x: number, y: number, len: number) {
		const lead = (len - 36) / 2;
		let d = `M${x} ${y}h${lead}l3 -6`;
		for (let i = 0; i < 5; i++) d += `l6 ${i % 2 === 0 ? 12 : -12}`;
		return d + `l3 -6h${lead}`;
	}
	function resV(x: number, y: number, len: number) {
		const lead = (len - 36) / 2;
		let d = `M${x} ${y}v${lead}l6 3`;
		for (let i = 0; i < 5; i++) d += `l${i % 2 === 0 ? -12 : 12} 6`;
		return d + `l6 3v${lead}`;
	}
	function indH(x: number, y: number, len: number) {
		const lead = (len - 40) / 2;
		return `M${x} ${y}h${lead}` + 'a5 5 0 0 1 10 0'.repeat(4) + `h${lead}`;
	}
	function indV(x: number, y: number, len: number) {
		const lead = (len - 40) / 2;
		return `M${x} ${y}v${lead}` + 'a5 5 0 0 1 0 10'.repeat(4) + `v${lead}`;
	}
	function capH(x: number, y: number, len: number) {
		const a = len / 2 - 3;
		return `M${x} ${y}h${a}M${x + a} ${y - 11}v22M${x + a + 6} ${y - 11}v22M${x + a + 6} ${y}h${a}`;
	}
	function capV(x: number, y: number, len: number) {
		const a = len / 2 - 3;
		return `M${x} ${y}v${a}M${x - 11} ${y + a}h22M${x - 11} ${y + a + 6}h22M${x} ${y + a + 6}v${a}`;
	}
</script>

<svg
	class="schem"
	viewBox="0 0 {layout.width} {GND + 34}"
	style:min-width="{Math.min(layout.width, 1400) * 0.62}px"
	role="img"
	aria-label={title}
>
	<!-- source -->
	<path class="wire" d="M{XS} {MID - 15}V{RAIL}H{XS + 16}M{XS} {MID + 15}V{GND}" />
	<circle class="wire" cx={XS} cy={MID} r="15" fill="none" />
	<path class="wire" d="M{XS - 8} {MID}q4 -9 8 0t8 0" />
	<text class="des" x={XS - 20} y={MID + 4} text-anchor="end"
		>V<tspan class="sub" dy="3">S</tspan></text
	>
	<!-- source resistor -->
	<path class="wire" d={resH(XS + 16, RAIL, 60)} />
	<text class="des" x={XS + 46} y={DES_Y} text-anchor="middle"
		>R<tspan class="sub" dy="3">S</tspan></text
	>
	<text class="val" x={XS + 46} y={VAL_Y} text-anchor="middle">{fmtR(rs)}</text>

	{#each layout.items as it, i (i)}
		{#if it.kind === 'series'}
			{@const cx = it.x + it.w / 2}
			{#if it.br.L !== undefined && it.br.C !== undefined}
				<path class="wire" d="{indH(it.x, RAIL, 72)}{capH(it.x + 72, RAIL, it.w - 72)}" />
				<text class="des" x={it.x + 36} y={DES_Y} text-anchor="middle">L{it.br.index}</text>
				<text class="val" x={it.x + 36} y={VAL_Y} text-anchor="middle">{fmtL(it.br.L)}</text>
				<text class="des" x={it.x + 72 + (it.w - 72) / 2} y={DES_Y} text-anchor="middle"
					>C{it.br.index}</text
				>
				<text class="val" x={it.x + 72 + (it.w - 72) / 2} y={VAL_Y} text-anchor="middle"
					>{fmtC(it.br.C)}</text
				>
			{:else if it.br.L !== undefined}
				<path class="wire" d={indH(it.x, RAIL, it.w)} />
				<text class="des" x={cx} y={DES_Y} text-anchor="middle">L{it.br.index}</text>
				<text class="val" x={cx} y={VAL_Y} text-anchor="middle">{fmtL(it.br.L)}</text>
			{:else if it.br.C !== undefined}
				<path class="wire" d={capH(it.x, RAIL, it.w)} />
				<text class="des" x={cx} y={DES_Y} text-anchor="middle">C{it.br.index}</text>
				<text class="val" x={cx} y={VAL_Y} text-anchor="middle">{fmtC(it.br.C)}</text>
			{/if}
		{:else}
			{@const top = TOP}
			<path class="wire" d="M{it.x} {RAIL}H{it.x + it.w}" />
			<circle class="dot" cx={it.node} cy={RAIL} r="3" />
			<circle class="dot" cx={it.node} cy={GND} r="3" />
			{#if it.br.L !== undefined && it.br.C !== undefined}
				{@const xl = it.node - 12}
				{@const xc = it.node + 14}
				<path
					class="wire"
					d="M{it.node} {RAIL}V{top - 8}M{xl} {top - 8}H{xc}M{xl} {top +
						EL +
						8}H{xc}M{it.node} {top + EL + 8}V{GND}"
				/>
				<path
					class="wire"
					d="M{xl} {top - 8}V{top}{indV(xl, top, EL).slice(`M${xl} ${top}`.length)}V{top + EL + 8}"
				/>
				<path
					class="wire"
					d="M{xc} {top - 8}V{top}{capV(xc, top, EL).slice(`M${xc} ${top}`.length)}V{top + EL + 8}"
				/>
				<text class="des" x={xc + 16} y={MID - 8}>L{it.br.index} ∥ C{it.br.index}</text>
				<text class="val" x={xc + 16} y={MID + 6}>{fmtL(it.br.L)}</text>
				<text class="val" x={xc + 16} y={MID + 20}>{fmtC(it.br.C)}</text>
			{:else if it.br.C !== undefined}
				<path
					class="wire"
					d="M{it.node} {RAIL}V{top}{capV(it.node, top, EL).slice(
						`M${it.node} ${top}`.length
					)}V{GND}"
				/>
				<text class="des" x={it.node + 16} y={MID - 3}>C{it.br.index}</text>
				<text class="val" x={it.node + 16} y={MID + 12}>{fmtC(it.br.C)}</text>
			{:else if it.br.L !== undefined}
				<path
					class="wire"
					d="M{it.node} {RAIL}V{top}{indV(it.node, top, EL).slice(
						`M${it.node} ${top}`.length
					)}V{GND}"
				/>
				<text class="des" x={it.node + 18} y={MID - 3}>L{it.br.index}</text>
				<text class="val" x={it.node + 18} y={MID + 12}>{fmtL(it.br.L)}</text>
			{/if}
		{/if}
	{/each}

	<!-- load -->
	<path
		class="wire"
		d="M{layout.loadX - 22} {RAIL}H{layout.loadX}V{TOP}{resV(layout.loadX, TOP, EL).slice(
			`M${layout.loadX} ${TOP}`.length
		)}V{GND}"
	/>
	<circle class="dot" cx={layout.loadX} cy={RAIL} r="3" />
	<text class="des" x={layout.loadX + 16} y={MID - 3}>R<tspan class="sub" dy="3">L</tspan></text>
	<text class="val" x={layout.loadX + 16} y={MID + 14}>{fmtR(rl)}</text>
	<text class="port" x={layout.loadX + 10} y={RAIL - 10}>V<tspan class="sub" dy="3">L</tspan></text>

	<!-- ground rail + symbol -->
	<path class="wire" d="M{XS} {GND}H{layout.loadX}" />
	<path
		class="wire"
		d="M{XS} {GND}v10M{XS - 10} {GND + 10}h20M{XS - 6} {GND + 14}h12M{XS - 2} {GND + 18}h4"
	/>
</svg>

<style>
	.schem {
		display: block;
		width: 100%;
		height: auto;
		color: var(--text);
	}
	.wire {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
		stroke-linejoin: round;
		stroke-linecap: round;
	}
	.dot {
		fill: currentColor;
	}
	text {
		font-size: 12px;
		font-family: var(--font-sans);
	}
	.des {
		fill: var(--text);
		font-weight: 600;
	}
	.val {
		fill: var(--text-2);
		font-variant-numeric: tabular-nums;
	}
	.port {
		fill: var(--muted);
		font-weight: 600;
	}
	.sub {
		font-size: 9px;
	}
</style>
