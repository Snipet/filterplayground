/** Formatting and parsing of engineering quantities. */

const PREFIXES: [number, string][] = [
	[1e12, 'T'],
	[1e9, 'G'],
	[1e6, 'M'],
	[1e3, 'k'],
	[1, ''],
	[1e-3, 'm'],
	[1e-6, 'µ'],
	[1e-9, 'n'],
	[1e-12, 'p'],
	[1e-15, 'f']
];

/** Format with an SI prefix, e.g. 4700 → "4.7 k", 1.5e-9 → "1.5 n". */
export function formatSI(value: number, unit = '', digits = 3): string {
	if (!Number.isFinite(value))
		return `${value > 0 ? '∞' : value < 0 ? '−∞' : '—'}${unit ? ' ' + unit : ''}`;
	if (value === 0) return `0${unit ? ' ' + unit : ''}`;
	// pick the prefix from the value as it will be shown: 999.84 at 4 digits stays
	// "999.8", while 999.96 rounds to 1000 and moves up to "1 k"
	const abs = Number(Math.abs(value).toPrecision(digits));
	let [scale, prefix] = PREFIXES[PREFIXES.length - 1];
	for (const [s, p] of PREFIXES) {
		if (abs >= s) {
			scale = s;
			prefix = p;
			break;
		}
	}
	const v = value / scale;
	const str = trimNumber(v, digits);
	return `${str}${unit || prefix ? ' ' : ''}${prefix}${unit}`;
}

/** Significant-digit formatting without trailing zeros or exponent for normal ranges. */
export function trimNumber(v: number, digits = 4): string {
	if (!Number.isFinite(v)) return String(v);
	if (v === 0) return '0';
	const abs = Math.abs(v);
	if (abs >= 1e6 || abs < 1e-4)
		return v.toExponential(Math.max(0, digits - 1)).replace(/\.?0+e/, 'e');
	// Number(...) drops trailing zeros and any exponent toPrecision may introduce (1.50e+3 → 1500)
	return String(Number(v.toPrecision(digits)));
}

export const formatHz = (f: number, digits = 4): string => formatSI(f, 'Hz', digits);

/** Frequency formatting for axis ticks: 20, 200, 2k, 20k. */
export function formatFreqTick(f: number): string {
	if (f === 0) return '0';
	const abs = Math.abs(f);
	if (abs >= 1e9) return `${trimNumber(f / 1e9, 3)}G`;
	if (abs >= 1e6) return `${trimNumber(f / 1e6, 3)}M`;
	if (abs >= 1e3) return `${trimNumber(f / 1e3, 3)}k`;
	return trimNumber(f, 3);
}

const PARSE_PREFIX: Record<string, number> = {
	T: 1e12,
	G: 1e9,
	M: 1e6,
	meg: 1e6,
	k: 1e3,
	K: 1e3,
	m: 1e-3,
	u: 1e-6,
	µ: 1e-6,
	μ: 1e-6,
	n: 1e-9,
	p: 1e-12,
	f: 1e-15
};

/**
 * Parse "4.7k", "10n", "2.2 µF", "1e3", "1k5" (= 1.5k), "100 Hz".
 * Pass the field's `unit` so it may be typed after the number even when it starts
 * with a prefix letter ("2 m" metres, "5 ms" in a millisecond field).
 * Returns NaN if it can't be parsed.
 */
export function parseSI(input: string, unit?: string): number {
	if (unit) {
		// The field's own unit may be typed after the number. Strip it first, so "2 m" in a
		// metres field is 2, not 2 milli, while "2 mm" still reads as 0.002.
		const t = input.trim();
		if (t.endsWith(unit)) {
			const rest = t.slice(0, -unit.length);
			const num = rest.trim();
			// "51/s" is 51 per second, not "5" followed by the unit "1/s": a unit that starts
			// with a digit needs a space before it ("5 1/s")
			if (num && !(/^\d/.test(unit) && /\d$/.test(rest))) {
				// centi is not an engineering prefix but is common for lengths ("34.3 cm");
				// shifting the exponent keeps it exact (34.3 / 100 = 0.34299999999999997)
				const cm = num
					.replace(/[\s,]+/g, '')
					.match(/^(-?(?:\d+\.?\d*|\.\d+))(?:[eE]([+-]?\d+))?c$/);
				if (cm) return Number(`${cm[1]}e${Number(cm[2] ?? 0) - 2}`);
				return parseSI(num);
			}
		}
	}
	let s = input.trim().replace(/,/g, '').replace(/\s+/g, '');
	if (!s) return NaN;
	// strip trailing units
	s = s.replace(/(rad\/s|m\/s|dBFS|dBm|dBu|dBV|dB|Hz|hz|Ω|ohms|ohm|oct|°|%|F|H|W|V|A|s)$/u, '');
	// "4k7" style
	const mid = s.match(/^(-?\d+)(meg|[TGMkKmuµμnpf])(\d+)$/u);
	if (mid) return parseFloat(`${mid[1]}.${mid[3]}`) * PARSE_PREFIX[mid[2]];
	const m = s.match(/^(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(meg|[TGMkKmuµμnpf])?$/iu);
	if (!m) return NaN;
	const base = parseFloat(m[1]);
	const pre = m[2] ? (PARSE_PREFIX[m[2]] ?? PARSE_PREFIX[m[2].toLowerCase()] ?? 1) : 1;
	return base * pre;
}

// ---------------------------------------------------------------------------
// E-series preferred values
// ---------------------------------------------------------------------------

export type ESeries = 'E6' | 'E12' | 'E24' | 'E48' | 'E96' | 'exact';

const E6 = [1.0, 1.5, 2.2, 3.3, 4.7, 6.8];
const E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
const E24 = [
	1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6,
	6.2, 6.8, 7.5, 8.2, 9.1
];
const eSeriesN = (n: number) =>
	Array.from({ length: n }, (_, i) => Math.round(Math.pow(10, i / n) * 100) / 100);
const E48 = eSeriesN(48);
const E96 = eSeriesN(96);

export const E_SERIES: Record<Exclude<ESeries, 'exact'>, number[]> = { E6, E12, E24, E48, E96 };

/** Round a positive value to the nearest preferred value of a series (log distance). */
export function toESeries(value: number, series: ESeries): number {
	if (series === 'exact' || !(value > 0) || !Number.isFinite(value)) return value;
	const vals = E_SERIES[series];
	const decade = Math.floor(Math.log10(value));
	let best = value;
	let bestD = Infinity;
	for (let d = decade - 1; d <= decade + 1; d++) {
		for (const v of vals) {
			const cand = v * Math.pow(10, d);
			const dist = Math.abs(Math.log(cand / value));
			if (dist < bestD) {
				bestD = dist;
				best = cand;
			}
		}
	}
	return Number(best.toPrecision(3));
}

export const dbToLinear = (db: number): number => Math.pow(10, db / 20);
export const linearToDb = (v: number): number => 20 * Math.log10(v);
