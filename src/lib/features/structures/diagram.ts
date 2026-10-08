/**
 * Block-diagram layout for filter structures. Produces plain geometry
 * (wires, adders, multipliers, delays, labels) that BlockDiagram.svelte draws.
 */
import { trimNumber } from '$lib/dsp/units';
import type { FirLattice, LatticeLadder, ParallelForm } from './realize';
import { sectionOrder, sub } from './realize';
import type { SOS } from '$lib/dsp/types';

export type Pt = [number, number];

export type El =
	| { t: 'wire'; pts: Pt[]; arrow: boolean }
	| { t: 'sum'; x: number; y: number }
	| { t: 'delay'; x: number; y: number; state: number; vertical: boolean }
	| {
			t: 'gain';
			x: number;
			y: number;
			angle: number;
			label: string;
			lx: number;
			ly: number;
			anchor: 'start' | 'middle' | 'end';
	  }
	| { t: 'dot'; x: number; y: number }
	| {
			t: 'text';
			x: number;
			y: number;
			text: string;
			anchor: 'start' | 'middle' | 'end';
			kind: 'signal' | 'caption';
	  };

export interface Diagram {
	width: number;
	height: number;
	els: El[];
}

export const SUM_R = 9;
export const DELAY_W = 34;
export const DELAY_H = 22;
const RH = 66; // row height
const TOP = 30;

/** Coefficient label: 4 significant digits with a real minus sign. */
export const coef = (v: number) => trimNumber(v, 4).replace('-', '−');

class Builder {
	els: El[] = [];
	maxX = 0;
	maxY = 0;
	private grow(x: number, y: number) {
		this.maxX = Math.max(this.maxX, x);
		this.maxY = Math.max(this.maxY, y);
	}
	/** Polyline; trims the first/last segment by the given pixels. */
	wire(ptsIn: Pt[], opts: { arrow?: boolean; trimStart?: number; trimEnd?: number } = {}) {
		const pts = ptsIn.map((p) => [...p] as Pt);
		const trim = (a: Pt, b: Pt, d: number): Pt => {
			const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
			if (len === 0 || d <= 0) return a;
			return [a[0] + ((b[0] - a[0]) * d) / len, a[1] + ((b[1] - a[1]) * d) / len];
		};
		if (opts.trimStart) pts[0] = trim(pts[0], pts[1], opts.trimStart);
		if (opts.trimEnd) {
			const n = pts.length;
			pts[n - 1] = trim(pts[n - 1], pts[n - 2], opts.trimEnd);
		}
		this.els.push({ t: 'wire', pts, arrow: !!opts.arrow });
		for (const p of pts) this.grow(p[0], p[1]);
	}
	sum(x: number, y: number) {
		this.els.push({ t: 'sum', x, y });
		this.grow(x + SUM_R, y + SUM_R);
	}
	delay(x: number, y: number, state: number, vertical = true) {
		this.els.push({ t: 'delay', x, y, state, vertical });
		this.grow(x + DELAY_W / 2 + 60, y + DELAY_H / 2 + 14);
	}
	dot(x: number, y: number) {
		this.els.push({ t: 'dot', x, y });
	}
	/** Multiplier triangle pointing along `angle` (degrees, 0 = right, 90 = down). */
	gain(
		x: number,
		y: number,
		angle: number,
		value: number,
		labelAt:
			| 'above'
			| 'below'
			| 'right'
			| 'left'
			| { x: number; y: number; anchor?: 'start' | 'end' } = 'above'
	) {
		const label = coef(value);
		let lx = x;
		let ly = y;
		let anchor: 'start' | 'middle' | 'end' = 'middle';
		if (typeof labelAt === 'object') {
			lx = labelAt.x;
			ly = labelAt.y;
			anchor = labelAt.anchor ?? 'start';
		} else if (labelAt === 'above') ly = y - 14;
		else if (labelAt === 'below') ly = y + 22;
		else if (labelAt === 'right') {
			lx = x + 14;
			ly = y + 4;
			anchor = 'start';
		} else {
			lx = x - 14;
			ly = y + 4;
			anchor = 'end';
		}
		this.els.push({ t: 'gain', x, y, angle, label, lx, ly, anchor });
		this.grow(
			Math.max(x + 12, lx + (anchor === 'start' ? label.length * 7 : 0)),
			Math.max(y + 24, ly + 6)
		);
	}
	text(
		x: number,
		y: number,
		text: string,
		anchor: 'start' | 'middle' | 'end' = 'middle',
		kind: 'signal' | 'caption' = 'signal'
	) {
		this.els.push({ t: 'text', x, y, text, anchor, kind });
		this.grow(
			x + (anchor === 'start' ? text.length * 7 : anchor === 'middle' ? text.length * 3.5 : 0),
			y + 6
		);
	}
	done(minW = 0): Diagram {
		return {
			width: Math.ceil(Math.max(minW, this.maxX + 16)),
			height: Math.ceil(this.maxY + 14),
			els: this.els
		};
	}
}

const pad = (v: readonly number[], n: number) => [
	...v,
	...new Array(Math.max(0, n - v.length)).fill(0)
];
const nz = (v: number | undefined) => v !== undefined && v !== 0;

// ---------------------------------------------------------------------------
// Transposed direct form II block (also used by cascade and parallel)
// ---------------------------------------------------------------------------

interface Block {
	inPt: Pt;
	outPt: Pt;
	width: number;
	height: number;
}

const TDF2_W = 300;

function tdf2Block(
	B: Builder,
	ox: number,
	oy: number,
	bIn: readonly number[],
	aIn: readonly number[],
	s0: number
): Block {
	const K = Math.max(bIn.length, aIn.length) - 1;
	const b = pad(bIn, K + 1);
	const a = pad(aIn, K + 1);
	const xBus = ox + 22;
	const xGb = ox + 82;
	const xS = ox + 150;
	const xGa = ox + 218;
	const xY = ox + 278;
	const xOut = ox + TDF2_W;
	const y = (i: number) => oy + i * RH;
	const dc = (i: number) => (y(i) + y(i + 1)) / 2; // delay between rows i and i+1

	const hasB = (i: number) => nz(b[i]);
	const hasA = (i: number) => i >= 1 && nz(a[i]);
	const inputs = (i: number) => (hasB(i) ? 1 : 0) + (hasA(i) ? 1 : 0) + (i < K ? 1 : 0);
	const adder = (i: number) => inputs(i) >= 2;

	// input bus
	const lastB = Math.max(0, ...b.map((v, i) => (nz(v) ? i : 0)));
	B.wire([
		[ox, y(0)],
		[xBus, y(0)]
	]);
	if (lastB > 0) {
		B.wire([
			[xBus, y(0)],
			[xBus, y(lastB)]
		]);
	}
	for (let i = 0; i <= K; i++) {
		if (!hasB(i)) continue;
		if (i < lastB || (i === 0 && lastB > 0)) B.dot(xBus, y(i));
		if (adder(i) || i === 0)
			B.wire(
				[
					[xBus, y(i)],
					[xS, y(i)]
				],
				{ arrow: adder(i), trimEnd: adder(i) ? SUM_R : 0 }
			);
		else
			B.wire(
				[
					[xBus, y(i)],
					[xS, y(i)],
					[xS, dc(i - 1) + DELAY_H / 2]
				],
				{ arrow: true }
			);
		B.gain(xGb, y(i), 0, b[i]);
	}

	// output bus
	const lastA = Math.max(0, ...a.map((v, i) => (i >= 1 && nz(v) ? i : 0)));
	const outStart: Pt = [xS, y(0)];
	B.wire([outStart, [xOut, y(0)]], { trimStart: adder(0) ? SUM_R : 0 });
	if (lastA > 0) {
		B.dot(xY, y(0));
		B.wire([
			[xY, y(0)],
			[xY, y(lastA)]
		]);
	}
	for (let i = 1; i <= K; i++) {
		if (!hasA(i)) continue;
		if (i < lastA) B.dot(xY, y(i));
		if (adder(i))
			B.wire(
				[
					[xY, y(i)],
					[xS, y(i)]
				],
				{ arrow: true, trimEnd: SUM_R }
			);
		else
			B.wire(
				[
					[xY, y(i)],
					[xS, y(i)],
					[xS, dc(i - 1) + DELAY_H / 2]
				],
				{ arrow: true }
			);
		B.gain(xGa, y(i), 180, -a[i]);
	}

	// delays and adders
	for (let i = 0; i < K; i++) {
		B.delay(xS, dc(i), s0 + i);
		// from node i+1 up into the delay
		if (adder(i + 1))
			B.wire(
				[
					[xS, y(i + 1)],
					[xS, dc(i) + DELAY_H / 2]
				],
				{ arrow: true, trimStart: SUM_R }
			);
		// from the delay up into node i
		if (adder(i))
			B.wire(
				[
					[xS, dc(i) - DELAY_H / 2],
					[xS, y(i)]
				],
				{ arrow: true, trimEnd: SUM_R }
			);
		else
			B.wire([
				[xS, dc(i) - DELAY_H / 2],
				[xS, y(i)]
			]);
	}
	for (let i = 0; i <= K; i++) if (adder(i)) B.sum(xS, y(i));
	return { inPt: [ox, y(0)], outPt: [xOut, y(0)], width: TDF2_W, height: K * RH };
}

// ---------------------------------------------------------------------------
// Direct forms
// ---------------------------------------------------------------------------

export function diagramTdf2(b: readonly number[], a: readonly number[]): Diagram {
	const B = new Builder();
	const ox = 44;
	const blk = tdf2Block(B, ox, TOP, b, a, 0);
	B.text(8, TOP + 4, 'x[n]', 'start');
	B.wire([blk.outPt, [blk.outPt[0] + 26, blk.outPt[1]]], { arrow: true });
	B.text(blk.outPt[0] + 30, blk.outPt[1] + 4, 'y[n]', 'start');
	return B.done();
}

export function diagramDf1(b: readonly number[], a: readonly number[]): Diagram {
	const B = new Builder();
	const M = b.length - 1;
	const N = a.length - 1;
	const R = Math.max(M, N);
	const xIn = 44;
	const xTx = 70;
	const xGb = 132;
	const xS = 196;
	const xGa = 262;
	const xTy = 322;
	const xOut = 368;
	const y = (i: number) => TOP + i * RH;
	const mid = (i: number) => (y(i - 1) + y(i)) / 2;

	const hasB = (i: number) => i <= M && nz(b[i]);
	const hasA = (i: number) => i >= 1 && i <= N && nz(a[i]);
	const own = (i: number) => (hasB(i) ? 1 : 0) + (hasA(i) ? 1 : 0);
	const below = (i: number) => {
		for (let j = i + 1; j <= R; j++) if (own(j) > 0) return true;
		return false;
	};
	const adder = (i: number) => own(i) + (below(i) ? 1 : 0) >= 2;

	B.text(8, y(0) + 4, 'x[n]', 'start');
	B.wire([
		[xIn, y(0)],
		[xTx, y(0)]
	]);
	// x delay chain
	for (let i = 1; i <= M; i++) {
		B.wire(
			[
				[xTx, y(i - 1)],
				[xTx, mid(i) - DELAY_H / 2]
			],
			{ arrow: true }
		);
		B.wire([
			[xTx, mid(i) + DELAY_H / 2],
			[xTx, y(i)]
		]);
		B.delay(xTx, mid(i), i - 1);
		if (i < M) B.dot(xTx, y(i));
	}
	if (M >= 1) B.dot(xTx, y(0));
	for (let i = 0; i <= M; i++) {
		if (!hasB(i)) continue;
		B.wire(
			[
				[xTx, y(i)],
				[xS, y(i)]
			],
			{ arrow: adder(i), trimEnd: adder(i) ? SUM_R : 0 }
		);
		B.gain(xGb, y(i), 0, b[i]);
	}
	// output and y delay chain
	B.wire(
		[
			[xS, y(0)],
			[xOut, y(0)]
		],
		{ arrow: true, trimStart: adder(0) ? SUM_R : 0 }
	);
	B.text(xOut + 4, y(0) + 4, 'y[n]', 'start');
	if (N >= 1) B.dot(xTy, y(0));
	for (let i = 1; i <= N; i++) {
		B.wire(
			[
				[xTy, y(i - 1)],
				[xTy, mid(i) - DELAY_H / 2]
			],
			{ arrow: true }
		);
		B.wire([
			[xTy, mid(i) + DELAY_H / 2],
			[xTy, y(i)]
		]);
		B.delay(xTy, mid(i), M + i - 1);
		if (i < N && (hasA(i) || true)) B.dot(xTy, y(i));
	}
	for (let i = 1; i <= N; i++) {
		if (!hasA(i)) continue;
		B.wire(
			[
				[xTy, y(i)],
				[xS, y(i)]
			],
			{ arrow: adder(i), trimEnd: adder(i) ? SUM_R : 0 }
		);
		B.gain(xGa, y(i), 180, -a[i]);
	}
	// adder chain
	for (let i = 1; i <= R; i++) {
		if (own(i) === 0 && !below(i)) continue;
		B.wire(
			[
				[xS, y(i)],
				[xS, y(i - 1)]
			],
			{ arrow: adder(i - 1), trimStart: adder(i) ? SUM_R : 0, trimEnd: adder(i - 1) ? SUM_R : 0 }
		);
	}
	for (let i = 0; i <= R; i++) if (adder(i)) B.sum(xS, y(i));
	return B.done();
}

export function diagramDf2(bIn: readonly number[], aIn: readonly number[]): Diagram {
	const B = new Builder();
	const K = Math.max(bIn.length, aIn.length) - 1;
	const b = pad(bIn, K + 1);
	const a = pad(aIn, K + 1);
	const xIn = 40;
	const xSL = 70;
	const xGa = 138;
	const xD = 206;
	const xGb = 272;
	const xSR = 338;
	const xOut = 386;
	const y = (i: number) => TOP + i * RH;
	const mid = (i: number) => (y(i - 1) + y(i)) / 2;
	const hasA = (i: number) => i >= 1 && nz(a[i]);
	const hasB = (i: number) => nz(b[i]);
	const belowA = (i: number) => a.some((v, j) => j > i && j >= 1 && nz(v));
	const belowB = (i: number) => b.some((v, j) => j > i && nz(v));
	const adderL = (i: number) => (i === 0 ? 1 : hasA(i) ? 1 : 0) + (belowA(i) ? 1 : 0) >= 2;
	const adderR = (i: number) => (hasB(i) ? 1 : 0) + (belowB(i) ? 1 : 0) >= 2;

	B.text(8, y(0) + 4, 'x[n]', 'start');
	B.wire(
		[
			[xIn, y(0)],
			[xSL, y(0)]
		],
		{ arrow: adderL(0), trimEnd: adderL(0) ? SUM_R : 0 }
	);
	// left adder → centre node
	B.wire(
		[
			[xSL, y(0)],
			[xD, y(0)]
		],
		{ trimStart: adderL(0) ? SUM_R : 0 }
	);
	// centre delay chain
	for (let i = 1; i <= K; i++) {
		B.wire(
			[
				[xD, y(i - 1)],
				[xD, mid(i) - DELAY_H / 2]
			],
			{ arrow: true }
		);
		B.wire([
			[xD, mid(i) + DELAY_H / 2],
			[xD, y(i)]
		]);
		B.delay(xD, mid(i), i - 1);
		if (i < K) B.dot(xD, y(i));
	}
	if (K >= 1) B.dot(xD, y(0));
	// feedback
	for (let i = 1; i <= K; i++) {
		if (!hasA(i)) continue;
		B.wire(
			[
				[xD, y(i)],
				[xSL, y(i)]
			],
			{ arrow: adderL(i), trimEnd: adderL(i) ? SUM_R : 0 }
		);
		B.gain(xGa, y(i), 180, -a[i]);
	}
	for (let i = 1; i <= K; i++) {
		if (!hasA(i) && !belowA(i)) continue;
		B.wire(
			[
				[xSL, y(i)],
				[xSL, y(i - 1)]
			],
			{ arrow: adderL(i - 1), trimStart: adderL(i) ? SUM_R : 0, trimEnd: adderL(i - 1) ? SUM_R : 0 }
		);
	}
	// feed-forward
	for (let i = 0; i <= K; i++) {
		if (!hasB(i)) continue;
		B.wire(
			[
				[xD, y(i)],
				[xSR, y(i)]
			],
			{ arrow: adderR(i), trimEnd: adderR(i) ? SUM_R : 0 }
		);
		B.gain(xGb, y(i), 0, b[i]);
	}
	for (let i = 1; i <= K; i++) {
		if (!hasB(i) && !belowB(i)) continue;
		B.wire(
			[
				[xSR, y(i)],
				[xSR, y(i - 1)]
			],
			{ arrow: adderR(i - 1), trimStart: adderR(i) ? SUM_R : 0, trimEnd: adderR(i - 1) ? SUM_R : 0 }
		);
	}
	B.wire(
		[
			[xSR, y(0)],
			[xOut, y(0)]
		],
		{ arrow: true, trimStart: adderR(0) ? SUM_R : 0 }
	);
	B.text(xOut + 4, y(0) + 4, 'y[n]', 'start');
	for (let i = 0; i <= K; i++) {
		if (adderL(i)) B.sum(xSL, y(i));
		if (adderR(i)) B.sum(xSR, y(i));
	}
	return B.done();
}

// ---------------------------------------------------------------------------
// Cascade and parallel
// ---------------------------------------------------------------------------

export function diagramCascade(sos: SOS): Diagram {
	const B = new Builder();
	const gap = 34;
	let ox = 44;
	let s0 = 0;
	const oy = TOP + 18;
	B.text(8, oy + 4, 'x[n]', 'start');
	let prevOut: Pt | null = null;
	sos.forEach((row, i) => {
		const a0 = row[3] || 1;
		const n = row.map((v) => v / a0);
		const K = sectionOrder(n);
		const blk = tdf2Block(B, ox, oy, n.slice(0, K + 1), [1, ...n.slice(4, 4 + K)], s0);
		B.text(ox + TDF2_W / 2, TOP - 6, `Section ${i + 1}`, 'middle', 'caption');
		if (prevOut) B.wire([prevOut, blk.inPt], { arrow: true });
		prevOut = blk.outPt;
		ox += TDF2_W + gap;
		s0 += K;
	});
	if (prevOut) {
		const p = prevOut as Pt;
		B.wire([p, [p[0] + 26, p[1]]], { arrow: true });
		B.text(p[0] + 30, p[1] + 4, 'y[n]', 'start');
	}
	return B.done();
}

export function diagramParallel(form: ParallelForm): Diagram {
	const B = new Builder();
	const xBus = 52;
	const ox = 76;
	const xSum = ox + TDF2_W + 40;
	const blocks: { oy: number; s0: number; kind: 'sec' | 'direct' | 'gain'; idx: number }[] = [];
	let oy = TOP + 18;
	let s0 = 0;
	form.sections.forEach((s, i) => {
		blocks.push({ oy, s0, kind: 'sec', idx: i });
		const K = s.a.length - 1;
		oy += K * RH + 62;
		s0 += Math.max(s.a.length, s.b.length) - 1;
	});
	const hasDirect = form.direct.some((v) => v !== 0);
	if (hasDirect) blocks.push({ oy, s0, kind: form.direct.length > 1 ? 'direct' : 'gain', idx: -1 });

	B.text(8, blocks[0].oy + 4, 'x[n]', 'start');
	B.wire([
		[42, blocks[0].oy],
		[xBus, blocks[0].oy]
	]);
	B.wire([
		[xBus, blocks[0].oy],
		[xBus, blocks[blocks.length - 1].oy]
	]);
	const last = blocks.length - 1;
	blocks.forEach((bk, j) => {
		if (j < last) B.dot(xBus, bk.oy);
		const sumHere = j < last; // has an input from below
		let out: Pt;
		if (bk.kind === 'sec') {
			const s = form.sections[bk.idx];
			B.text(ox + TDF2_W / 2, bk.oy - 22, `Section ${bk.idx + 1}`, 'middle', 'caption');
			const blk = tdf2Block(B, ox, bk.oy, s.b, s.a, bk.s0);
			B.wire([[xBus, bk.oy], blk.inPt]);
			out = blk.outPt;
		} else if (bk.kind === 'direct') {
			B.text(ox + TDF2_W / 2, bk.oy - 22, 'Direct (FIR) part', 'middle', 'caption');
			const blk = tdf2Block(B, ox, bk.oy, form.direct, [1], bk.s0);
			B.wire([[xBus, bk.oy], blk.inPt]);
			out = blk.outPt;
		} else {
			B.text(ox + TDF2_W / 2, bk.oy - 22, 'Direct term', 'middle', 'caption');
			B.wire([
				[xBus, bk.oy],
				[ox + TDF2_W, bk.oy]
			]);
			B.gain(ox + 82, bk.oy, 0, form.direct[0]);
			out = [ox + TDF2_W, bk.oy];
		}
		B.wire([out, [xSum, bk.oy]], { arrow: sumHere || j === 0, trimEnd: sumHere ? SUM_R : 0 });
		if (j > 0) {
			const prevSum = j - 1 < last;
			B.wire(
				[
					[xSum, bk.oy],
					[xSum, blocks[j - 1].oy]
				],
				{ arrow: prevSum, trimStart: sumHere ? SUM_R : 0, trimEnd: prevSum ? SUM_R : 0 }
			);
		}
		if (sumHere) B.sum(xSum, bk.oy);
	});
	const y0 = blocks[0].oy;
	B.wire(
		[
			[xSum, y0],
			[xSum + 40, y0]
		],
		{ arrow: true, trimStart: last > 0 ? SUM_R : 0 }
	);
	B.text(xSum + 44, y0 + 4, 'y[n]', 'start');
	return B.done();
}

// ---------------------------------------------------------------------------
// FIR
// ---------------------------------------------------------------------------

const TAP_W = 100;

export function diagramFir(h: readonly number[]): Diagram {
	const B = new Builder();
	const M = h.length - 1;
	const x = (k: number) => 64 + k * TAP_W;
	const yT = TOP + 8;
	const yG = yT + 64;
	const yB = yT + 128;
	const hasH = (k: number) => nz(h[k]);
	const left = (k: number) => h.slice(0, k).some(nz);
	const adder = (k: number) => (hasH(k) ? 1 : 0) + (left(k) ? 1 : 0) >= 2;

	B.text(8, yT + 4, 'x[n]', 'start');
	B.wire([
		[38, yT],
		[x(0), yT]
	]);
	for (let k = 1; k <= M; k++) {
		const mx = (x(k - 1) + x(k)) / 2;
		B.wire(
			[
				[x(k - 1), yT],
				[mx - DELAY_W / 2, yT]
			],
			{ arrow: true }
		);
		B.wire([
			[mx + DELAY_W / 2, yT],
			[x(k), yT]
		]);
		B.delay(mx, yT, k - 1, false);
	}
	for (let k = 0; k <= M; k++) {
		if (k < M && hasH(k)) B.dot(x(k), yT);
		if (!hasH(k)) continue;
		B.wire(
			[
				[x(k), yT],
				[x(k), yB]
			],
			{ arrow: adder(k), trimEnd: adder(k) ? SUM_R : 0 }
		);
		B.gain(x(k), yG, 90, h[k], 'right');
	}
	for (let k = 1; k <= M; k++) {
		if (!left(k)) continue;
		B.wire(
			[
				[x(k - 1), yB],
				[x(k), yB]
			],
			{ arrow: adder(k), trimStart: adder(k - 1) ? SUM_R : 0, trimEnd: adder(k) ? SUM_R : 0 }
		);
	}
	B.wire(
		[
			[x(M), yB],
			[x(M) + 44, yB]
		],
		{ arrow: true, trimStart: adder(M) ? SUM_R : 0 }
	);
	B.text(x(M) + 48, yB + 4, 'y[n]', 'start');
	for (let k = 0; k <= M; k++) if (adder(k)) B.sum(x(k), yB);
	return B.done();
}

export function diagramFirTransposed(h: readonly number[]): Diagram {
	const B = new Builder();
	const M = h.length - 1;
	const x = (k: number) => 84 + k * TAP_W;
	const yT = TOP + 8;
	const yG = yT + 64;
	const yB = yT + 128;
	const hasH = (k: number) => nz(h[k]);
	const right = (k: number) => h.slice(k + 1).some(nz);
	const adder = (k: number) => (hasH(k) ? 1 : 0) + (right(k) ? 1 : 0) >= 2;
	const lastH = Math.max(0, ...h.map((v, k) => (nz(v) ? k : 0)));

	B.text(8, yT + 4, 'x[n]', 'start');
	B.wire([
		[38, yT],
		[x(lastH), yT]
	]);
	for (let k = 0; k <= M; k++) {
		if (!hasH(k)) continue;
		if (k < lastH) B.dot(x(k), yT);
		B.wire(
			[
				[x(k), yT],
				[x(k), yB]
			],
			{ arrow: adder(k) || k < M, trimEnd: adder(k) ? SUM_R : 0 }
		);
		B.gain(x(k), yG, 90, h[k], 'right');
	}
	for (let k = 0; k < M; k++) {
		const mx = (x(k) + x(k + 1)) / 2;
		B.delay(mx, yB, k, false);
		if (right(k)) {
			B.wire(
				[
					[x(k + 1), yB],
					[mx + DELAY_W / 2, yB]
				],
				{ arrow: true, trimStart: adder(k + 1) ? SUM_R : 0 }
			);
			B.wire(
				[
					[mx - DELAY_W / 2, yB],
					[x(k), yB]
				],
				{ arrow: adder(k), trimEnd: adder(k) ? SUM_R : 0 }
			);
		}
	}
	B.wire(
		[
			[x(0), yB],
			[x(0) - 40, yB]
		],
		{ arrow: true, trimStart: adder(0) ? SUM_R : 0 }
	);
	B.text(x(0) - 44, yB + 4, 'y[n]', 'end');
	for (let k = 0; k <= M; k++) if (adder(k)) B.sum(x(k), yB);
	return B.done();
}

// ---------------------------------------------------------------------------
// Lattices
// ---------------------------------------------------------------------------

const STAGE_W = 190;

/** IIR lattice–ladder (Gray–Markel). Stage N is on the left, stage 1 on the right. */
export function diagramLatticeLadder(ll: LatticeLadder): Diagram {
	const B = new Builder();
	const N = ll.k.length;
	const yF = TOP + 22;
	const yG = yF + 96;
	const yV = yG + 62;
	const yS = yV + 62;
	const x0 = 60;
	const xs = (j: number) => x0 + j * STAGE_W; // left edge of the j-th stage from the left (m = N − j)
	const xEnd = xs(N);
	B.text(8, yF + 4, 'x[n]', 'start');
	B.wire([
		[38, yF],
		[x0, yF]
	]);
	// ladder tap positions: g_m sits at the left edge of stage m (j = N − m); g_0 at the right end
	const tapX = (m: number) => (m === 0 ? xEnd + 20 : xs(N - m) + 18);

	for (let j = 0; j < N; j++) {
		const m = N - j;
		const L = xs(j);
		const T: Pt = [L + 62, yF]; // top adder
		const Db: Pt = [L + 128, yG]; // bottom tap after the delay
		const Dt: Pt = [L + 128, yF]; // top tap after the adder
		const Bt: Pt = [L + 62, yG]; // bottom adder
		const delayX = L + 164;
		B.text(L + 95, TOP - 6, `Stage ${m}`, 'middle', 'caption');
		// top line
		B.wire([[L, yF], T], { arrow: true, trimEnd: SUM_R });
		B.wire([T, [L + STAGE_W, yF]], { trimStart: SUM_R });
		B.dot(Dt[0], Dt[1]);
		// bottom line (flows right → left)
		B.wire(
			[
				[L + STAGE_W, yG],
				[delayX + DELAY_W / 2, yG]
			],
			{ arrow: true }
		);
		B.delay(delayX, yG, m - 1, false);
		B.wire([[delayX - DELAY_W / 2, yG], Bt], { arrow: true, trimEnd: SUM_R });
		B.dot(Db[0], Db[1]);
		B.wire([Bt, [L, yG]], { trimStart: SUM_R });
		// cross connections
		B.wire([Db, T], { arrow: true, trimEnd: SUM_R });
		B.wire([Dt, Bt], { arrow: true, trimEnd: SUM_R });
		const ang1 = (Math.atan2(T[1] - Db[1], T[0] - Db[0]) * 180) / Math.PI;
		const ang2 = (Math.atan2(Bt[1] - Dt[1], Bt[0] - Dt[0]) * 180) / Math.PI;
		const g1: Pt = [Db[0] + 0.27 * (T[0] - Db[0]), Db[1] + 0.27 * (T[1] - Db[1])];
		const g2: Pt = [Dt[0] + 0.27 * (Bt[0] - Dt[0]), Dt[1] + 0.27 * (Bt[1] - Dt[1])];
		B.gain(g1[0], g1[1], ang1, -ll.k[m - 1], { x: Db[0] + 8, y: yG - 22 });
		B.gain(g2[0], g2[1], ang2, ll.k[m - 1], { x: Dt[0] + 8, y: yF + 22 });
		B.sum(T[0], T[1]);
		B.sum(Bt[0], Bt[1]);
	}
	// turnaround f_0 → g_0
	B.wire([
		[xEnd, yF],
		[xEnd + 20, yF],
		[xEnd + 20, yG],
		[xEnd, yG]
	]);
	B.text(xEnd + 26, (yF + yG) / 2 + 4, 'f₀ = g₀', 'start', 'caption');

	// ladder
	const taps = Array.from({ length: N + 1 }, (_, m) => N - m).filter((m) => nz(ll.v[m])); // left → right
	taps.forEach((m, idx) => {
		const tx = tapX(m);
		if (m !== 0) B.dot(tx, yG);
		else B.dot(tx, yG);
		const isSum = idx > 0;
		B.wire(
			[
				[tx, yG],
				[tx, yS]
			],
			{ arrow: isSum, trimEnd: isSum ? SUM_R : 0 }
		);
		B.gain(tx, yV, 90, ll.v[m], 'right');
		if (idx > 0) {
			const px = tapX(taps[idx - 1]);
			B.wire(
				[
					[px, yS],
					[tx, yS]
				],
				{ arrow: true, trimStart: idx - 1 > 0 ? SUM_R : 0, trimEnd: SUM_R }
			);
		}
	});
	B.text(tapX(N) + 8, yG + 16, `g${sub(N)}`, 'start', 'caption');
	if (taps.length) {
		const lx = tapX(taps[taps.length - 1]);
		B.wire(
			[
				[lx, yS],
				[lx + 44, yS]
			],
			{ arrow: true, trimStart: taps.length > 1 ? SUM_R : 0 }
		);
		B.text(lx + 48, yS + 4, 'y[n]', 'start');
		taps.forEach((m, idx) => {
			if (idx > 0) B.sum(tapX(m), yS);
		});
	}
	return B.done();
}

export function diagramFirLattice(fl: FirLattice): Diagram {
	const B = new Builder();
	const M = fl.k.length;
	const yF = TOP + 22;
	const yG = yF + 96;
	const x0 = 70;
	const xs = (j: number) => x0 + j * STAGE_W; // stage m = j + 1
	B.text(8, yF + 4, 'x[n]', 'start');
	B.wire([
		[38, yF],
		[x0, yF]
	]);
	if (M > 0) {
		B.dot(x0 - 14, yF);
		B.wire([
			[x0 - 14, yF],
			[x0 - 14, yG],
			[x0, yG]
		]);
	}
	for (let j = 0; j < M; j++) {
		const m = j + 1;
		const L = xs(j);
		const delayX = L + 30;
		const Db: Pt = [L + 66, yG];
		const Dt: Pt = [L + 66, yF];
		const T: Pt = [L + 140, yF];
		const Bt: Pt = [L + 140, yG];
		B.text(L + 95, TOP - 6, `Stage ${m}`, 'middle', 'caption');
		B.wire([[L, yF], T], { arrow: true, trimEnd: SUM_R });
		B.wire([T, [L + STAGE_W, yF]], { trimStart: SUM_R });
		B.wire(
			[
				[L, yG],
				[delayX - DELAY_W / 2, yG]
			],
			{ arrow: true }
		);
		B.delay(delayX, yG, m - 1, false);
		B.wire([[delayX + DELAY_W / 2, yG], Bt], { arrow: true, trimEnd: SUM_R });
		B.wire([Bt, [L + STAGE_W, yG]], { trimStart: SUM_R });
		B.dot(Db[0], Db[1]);
		B.dot(Dt[0], Dt[1]);
		B.wire([Db, T], { arrow: true, trimEnd: SUM_R });
		B.wire([Dt, Bt], { arrow: true, trimEnd: SUM_R });
		const ang1 = (Math.atan2(T[1] - Db[1], T[0] - Db[0]) * 180) / Math.PI;
		const ang2 = (Math.atan2(Bt[1] - Dt[1], Bt[0] - Dt[0]) * 180) / Math.PI;
		const g1: Pt = [Db[0] + 0.27 * (T[0] - Db[0]), Db[1] + 0.27 * (T[1] - Db[1])];
		const g2: Pt = [Dt[0] + 0.27 * (Bt[0] - Dt[0]), Dt[1] + 0.27 * (Bt[1] - Dt[1])];
		B.gain(g1[0], g1[1], ang1, fl.k[m - 1], { x: Db[0] - 8, y: yG - 20, anchor: 'end' });
		B.gain(g2[0], g2[1], ang2, fl.k[m - 1], { x: Dt[0] - 8, y: yF + 26, anchor: 'end' });
		B.sum(T[0], T[1]);
		B.sum(Bt[0], Bt[1]);
	}
	const xe = xs(M);
	B.wire(
		[
			[xe, yF],
			[xe + 90, yF]
		],
		{ arrow: true }
	);
	if (fl.h0 !== 1) B.gain(xe + 40, yF, 0, fl.h0);
	B.text(xe + 94, yF + 4, 'y[n]', 'start');
	return B.done();
}
