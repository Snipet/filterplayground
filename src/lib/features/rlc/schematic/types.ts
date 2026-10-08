/**
 * A tiny declarative schematic description, rendered by Schematic.svelte.
 * Coordinates are SVG user units in the schematic's viewBox; parts must be
 * axis-aligned (horizontal or vertical).
 */

export type PartKind = 'R' | 'C' | 'L';

/** Where the designator/value labels go relative to a part. */
export type LabelPlacement = 'split' | 'above' | 'below' | 'right' | 'left';

export interface PartItem {
	t: 'part';
	kind: PartKind;
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	/** Designator, e.g. "R1". */
	name?: string;
	/** Value text, e.g. "4.7 kΩ". */
	value?: string;
	labels?: LabelPlacement;
	accent?: boolean;
}

export interface WireItem {
	t: 'wire';
	pts: [number, number][];
	accent?: boolean;
	dashed?: boolean;
}

export interface GroundItem {
	t: 'gnd';
	x: number;
	y: number;
}

export interface DotItem {
	t: 'dot';
	x: number;
	y: number;
	accent?: boolean;
}

export interface TerminalItem {
	t: 'term';
	x: number;
	y: number;
	label?: string;
	/** Label offset from the terminal and anchor. */
	dx?: number;
	dy?: number;
	anchor?: 'start' | 'middle' | 'end';
	accent?: boolean;
}

export interface SourceItem {
	t: 'src';
	/** Centre of the (vertical) AC source. */
	x: number;
	y: number;
	label?: string;
}

export interface OpAmpItem {
	t: 'opamp';
	/** Left edge (inputs) x and centre y; the output is at (x + w, y). */
	x: number;
	y: number;
	w?: number;
	h?: number;
	/** Inverting input on top (default true). */
	minusTop?: boolean;
	name?: string;
}

export interface TextItem {
	t: 'text';
	x: number;
	y: number;
	text: string;
	anchor?: 'start' | 'middle' | 'end';
	accent?: boolean;
	muted?: boolean;
	size?: number;
}

/** Output-voltage marker: "+" at y1, "−" at y2 and a label in between. */
export interface VoltageItem {
	t: 'volt';
	x: number;
	y1: number;
	y2: number;
	label: string;
	accent?: boolean;
}

export type SchematicItem =
	| PartItem
	| WireItem
	| GroundItem
	| DotItem
	| TerminalItem
	| SourceItem
	| OpAmpItem
	| TextItem
	| VoltageItem;

export const OPAMP_W = 64;
export const OPAMP_H = 64;
/** Vertical offset of each input from the op-amp centre line. */
export const OPAMP_IN = 16;

/** Pin coordinates of an op-amp item. */
export function opampPins(x: number, y: number, minusTop = true, w = OPAMP_W) {
	const top: [number, number] = [x, y - OPAMP_IN];
	const bottom: [number, number] = [x, y + OPAMP_IN];
	return {
		minus: minusTop ? top : bottom,
		plus: minusTop ? bottom : top,
		out: [x + w, y] as [number, number]
	};
}
