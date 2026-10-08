/** Schematic layouts for the op-amp stages (rendered by the shared Schematic component). */
import type { PartKind, SchematicItem } from '$lib/features/rlc/schematic/types';
import { opampPins } from '$lib/features/rlc/schematic/types';
import type { StageBand, StageTopology } from './design';

export interface PartLabel {
	name: string;
	value: string;
	/** Open circuit — omitted from the drawing. */
	open?: boolean;
}

export interface StageDrawing {
	items: SchematicItem[];
	width: number;
	height: number;
}

type Lbl = Record<string, PartLabel>;
const kindOf = (role: string): PartKind => role[0] as PartKind;

/**
 * @param labels  designator + value for each local role ("R1", "C2", …)
 * @param vin     input net label, e.g. "v_in" or "v_1"
 * @param vout    output net label
 */
export function stageDrawing(
	topology: StageTopology,
	band: StageBand,
	labels: Lbl,
	vin: string,
	vout: string,
	opamp: string
): StageDrawing {
	switch (topology) {
		case 'rc1':
			return firstOrder(band, labels, vin, vout, opamp);
		case 'sk-unity':
		case 'sk-equal':
			return sallenKey(band, topology === 'sk-equal', labels, vin, vout, opamp);
		default:
			return mfb(topology === 'mfb-bp' ? 'bandpass' : band, labels, vin, vout, opamp);
	}
}

function part(
	role: string,
	labels: Lbl,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	place?: 'split' | 'above' | 'below' | 'right' | 'left'
): SchematicItem {
	return {
		t: 'part',
		kind: kindOf(role),
		x1,
		y1,
		x2,
		y2,
		name: labels[role]?.name ?? role,
		value: labels[role]?.value,
		labels: place
	};
}

function firstOrder(band: StageBand, L: Lbl, vin: string, vout: string, u: string): StageDrawing {
	const y = 100;
	const [ser, sh] = band === 'lowpass' ? ['R1', 'C1'] : ['C1', 'R1'];
	const ox = 230;
	const pins = opampPins(ox, y + 16, false);
	const items: SchematicItem[] = [
		{ t: 'term', x: 20, y, label: vin },
		part(ser, L, 24, y, 124, y),
		{
			t: 'wire',
			pts: [
				[124, y],
				[pins.plus[0], y]
			]
		},
		part(sh, L, 160, y, 160, 180, 'left'),
		{ t: 'gnd', x: 160, y: 180 },
		{ t: 'dot', x: 160, y },
		{ t: 'opamp', x: ox, y: y + 16, minusTop: false, name: u },
		{
			t: 'wire',
			pts: [pins.minus, [ox - 14, pins.minus[1]], [ox - 14, 160], [316, 160], [316, pins.out[1]]]
		},
		{ t: 'wire', pts: [pins.out, [380, pins.out[1]]] },
		{ t: 'dot', x: 316, y: pins.out[1] },
		{ t: 'term', x: 380, y: pins.out[1], label: vout }
	];
	return { items, width: 410, height: 200 };
}

function sallenKey(
	band: StageBand,
	equal: boolean,
	L: Lbl,
	vin: string,
	vout: string,
	u: string
): StageDrawing {
	const y = 140;
	// Z1 input series, Z2 second series, Z3 feedback A→out, Z4 B→ground
	const [z1, z2, z3, z4] = band === 'lowpass' ? ['R1', 'R2', 'C1', 'C2'] : ['C1', 'C2', 'R1', 'R2'];
	const ox = 320;
	const pins = opampPins(ox, y + 16, false);
	const yo = pins.out[1];
	const xo = 440;
	const items: SchematicItem[] = [
		{ t: 'term', x: 20, y, label: vin },
		part(z1, L, 24, y, 124, y),
		{
			t: 'wire',
			pts: [
				[124, y],
				[150, y]
			]
		},
		part(z2, L, 150, y, 250, y),
		{
			t: 'wire',
			pts: [
				[250, y],
				[ox, y]
			]
		},
		part(z4, L, 276, y, 276, 222, 'left'),
		{ t: 'gnd', x: 276, y: 222 },
		{ t: 'dot', x: 150, y },
		{ t: 'dot', x: 276, y },
		// feedback element from node A to the output
		{
			t: 'wire',
			pts: [
				[150, y],
				[150, 60],
				[290, 60]
			]
		},
		part(z3, L, 290, 60, 390, 60),
		{
			t: 'wire',
			pts: [
				[390, 60],
				[xo, 60],
				[xo, yo]
			]
		},
		{ t: 'opamp', x: ox, y: y + 16, minusTop: false, name: u },
		{ t: 'wire', pts: [pins.out, [520, yo]] },
		{ t: 'dot', x: xo, y: yo },
		{ t: 'term', x: 520, y: yo, label: vout }
	];
	if (equal) {
		const yn = 215;
		items.push(
			{ t: 'wire', pts: [pins.minus, [306, pins.minus[1]], [306, yn]] },
			part('R4', L, 306, yn, 412, yn, 'above'),
			{
				t: 'wire',
				pts: [
					[412, yn],
					[412, yo]
				]
			},
			{ t: 'dot', x: 412, y: yo },
			{ t: 'dot', x: 306, y: yn },
			part('R3', L, 306, yn, 306, 272, 'right'),
			{ t: 'gnd', x: 306, y: 272 }
		);
		return { items, width: 545, height: 292 };
	}
	items.push(
		{ t: 'wire', pts: [pins.minus, [306, pins.minus[1]], [306, 205], [412, 205], [412, yo]] },
		{ t: 'dot', x: 412, y: yo }
	);
	return { items, width: 545, height: 248 };
}

function mfb(band: StageBand, L: Lbl, vin: string, vout: string, u: string): StageDrawing {
	const y = 170;
	// Y1 input series, Y2 outer feedback A→out, Y3 A→(−), Y4 A→ground, Y5 (−)→out
	const roles =
		band === 'lowpass'
			? { y1: 'R1', y2: 'R2', y3: 'R3', y4: 'C1', y5: 'C2' }
			: band === 'highpass'
				? { y1: 'C1', y2: 'C2', y3: 'C3', y4: 'R1', y5: 'R2' }
				: { y1: 'R1', y2: 'C2', y3: 'C1', y4: 'R3', y5: 'R2' };
	const ox = 320;
	const pins = opampPins(ox, y + 16, true);
	const yo = pins.out[1];
	const xo = 440;
	const items: SchematicItem[] = [
		{ t: 'term', x: 20, y, label: vin },
		part(roles.y1, L, 24, y, 124, y),
		{
			t: 'wire',
			pts: [
				[124, y],
				[150, y]
			]
		},
		part(roles.y3, L, 150, y, 250, y),
		{
			t: 'wire',
			pts: [
				[250, y],
				[ox, y]
			]
		},
		{ t: 'dot', x: 150, y },
		{ t: 'dot', x: 276, y },
		// inner feedback (−) → out
		{
			t: 'wire',
			pts: [
				[276, y],
				[276, 110],
				[300, 110]
			]
		},
		part(roles.y5, L, 300, 110, 400, 110),
		{
			t: 'wire',
			pts: [
				[400, 110],
				[xo, 110],
				[xo, yo]
			]
		},
		// outer feedback A → out
		{
			t: 'wire',
			pts: [
				[150, y],
				[150, 50],
				[290, 50]
			]
		},
		part(roles.y2, L, 290, 50, 390, 50),
		{
			t: 'wire',
			pts: [
				[390, 50],
				[xo, 50],
				[xo, 110]
			]
		},
		{ t: 'dot', x: xo, y: 110 },
		{ t: 'opamp', x: ox, y: y + 16, minusTop: true, name: u },
		{ t: 'wire', pts: [pins.plus, [306, pins.plus[1]], [306, 226]] },
		{ t: 'gnd', x: 306, y: 226 },
		{ t: 'wire', pts: [pins.out, [520, yo]] },
		{ t: 'dot', x: xo, y: yo },
		{ t: 'term', x: 520, y: yo, label: vout }
	];
	if (!L[roles.y4]?.open) {
		items.push(part(roles.y4, L, 150, y, 150, 250, 'left'), { t: 'gnd', x: 150, y: 250 });
	} else {
		items.push({
			t: 'text',
			x: 150,
			y: y + 30,
			text: `${L[roles.y4]?.name ?? roles.y4} omitted (open)`,
			anchor: 'middle',
			muted: true
		});
	}
	return { items, width: 545, height: 270 };
}
