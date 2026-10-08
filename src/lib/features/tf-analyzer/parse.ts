/**
 * Forgiving parsers for coefficient lists, SOS matrices and complex roots as
 * people paste them from Python, MATLAB, JSON, C or papers.
 *
 * Accepted everywhere: commas, whitespace, newlines and `;` as separators,
 * brackets of any kind, `np.array(...)` wrappers, `name =` assignments,
 * comments (`#`, `%`, `//`), MATLAB `...` continuations, the Unicode minus sign,
 * scientific notation and simple fractions such as `1/3`.
 */
import type { Complex } from '$lib/dsp/complex';

export interface ParseError {
	message: string;
	/** The offending text, if a single token is to blame. */
	token?: string;
	/** 1-based line and column of the token. */
	line?: number;
	col?: number;
}

export type ParseResult<T> = { ok: true; value: T; notes: string[] } | { ok: false; error: ParseError };

/** Format an error for display: "Line 2, col 5: …". */
export function formatError(e: ParseError): string {
	const where = e.line !== undefined ? `Line ${e.line}, col ${e.col}: ` : '';
	return where + e.message;
}

class ParseFailure extends Error {
	constructor(public info: ParseError) {
		super(info.message);
	}
}

const NUM = String.raw`(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?`;
const REAL_RE = new RegExp(`^[+-]?${NUM}$`);
const FRACTION_RE = new RegExp(`^([+-]?${NUM})/(${NUM})$`);

/** Replace everything that is not data by spaces (keeping positions intact). */
function clean(text: string): string {
	const blank = (m: string) => m.replace(/[^\n]/g, ' ');
	return (
		text
			.replace(/[−‒–﹣－]/g, '-') // unicode minus / dashes
			.replace(/(#|%|\/\/)[^\n]*/g, blank) // comments
			.replace(/\.\.\./g, '   ') // MATLAB continuation
			// np.array(, numpy.asarray(, array(, dtype=float …
			.replace(/\b(?:np|numpy)\s*\.\s*(?:as)?array\b/gi, blank)
			.replace(/\b(?:as)?array\b/gi, blank)
			.replace(/\bdtype\s*=\s*[\w.]+/gi, blank)
			// `name =` assignments (not ==); also C declarations like `double b[3] =`
			.replace(/(?:\b(?:static|const|float|double|int|let|var)\s+)*[A-Za-z_][\w.]*\s*(?:\[[^\]\n]*\]\s*)*=(?!=)/g, blank)
	);
}

interface Word {
	text: string;
	index: number;
}

interface Scan {
	/** Rows of words; rows are split by `;`, newlines and closing inner brackets. */
	rows: Word[][][];
}

/**
 * Split cleaned text into rows → items → words. Items are separated by commas
 * and row separators; words inside an item are separated by whitespace.
 */
function scan(text: string): Scan {
	const rows: Word[][][] = [];
	let row: Word[][] = [];
	let item: Word[] = [];
	let depth = 0;
	let i = 0;
	const endItem = () => {
		if (item.length) row.push(item);
		item = [];
	};
	const endRow = () => {
		endItem();
		if (row.length) rows.push(row);
		row = [];
	};
	while (i < text.length) {
		const ch = text[i];
		if (ch === '\n') {
			endRow();
			i++;
		} else if (ch === ';') {
			endRow();
			i++;
		} else if (ch === ',') {
			endItem();
			i++;
		} else if (ch === ' ' || ch === '\t' || ch === '\r') {
			i++;
		} else if ('[({'.includes(ch)) {
			depth++;
			endItem();
			i++;
		} else if ('])}'.includes(ch)) {
			if (depth >= 2) endRow();
			else endItem();
			depth = Math.max(0, depth - 1);
			i++;
		} else {
			let j = i;
			while (j < text.length && !' \t\r\n,;[](){}'.includes(text[j])) j++;
			item.push({ text: text.slice(i, j), index: i });
			i = j;
		}
	}
	endRow();
	return { rows };
}

function position(text: string, index: number): { line: number; col: number } {
	let line = 1;
	let last = -1;
	for (let k = 0; k < index && k < text.length; k++) {
		if (text[k] === '\n') {
			line++;
			last = k;
		}
	}
	return { line, col: index - last };
}

function fail(text: string, w: Word, message: string): never {
	const { line, col } = position(text, w.index);
	throw new ParseFailure({ message, token: w.text, line, col });
}

function parseRealWord(text: string, w: Word): number {
	const s = w.text;
	if (REAL_RE.test(s)) return Number(s);
	const fr = s.match(FRACTION_RE);
	if (fr) {
		const den = Number(fr[2]);
		if (den === 0) fail(text, w, `Division by zero in “${s}”.`);
		return Number(fr[1]) / den;
	}
	if (/^[+-]?(inf|infinity|nan)$/i.test(s)) fail(text, w, `“${s}” is not a finite number.`);
	if (/[ij]$/.test(s) && /\d/.test(s)) fail(text, w, `“${s}” looks complex — coefficients must be real.`);
	fail(text, w, `“${s}” is not a number.`);
}

/** Join a lone sign with the number that follows it ("- 2" → "-2"). */
function joinSigns(words: Word[]): Word[] {
	const out: Word[] = [];
	for (let k = 0; k < words.length; k++) {
		const w = words[k];
		if ((w.text === '-' || w.text === '+') && k + 1 < words.length) {
			out.push({ text: w.text + words[k + 1].text, index: w.index });
			k++;
		} else out.push(w);
	}
	return out;
}

function run<T>(fn: () => { value: T; notes?: string[] }): ParseResult<T> {
	try {
		const r = fn();
		return { ok: true, value: r.value, notes: r.notes ?? [] };
	} catch (e) {
		if (e instanceof ParseFailure) return { ok: false, error: e.info };
		return { ok: false, error: { message: e instanceof Error ? e.message : String(e) } };
	}
}

// ---------------------------------------------------------------------------
// Real numbers
// ---------------------------------------------------------------------------

/** Parse a flat list of real numbers. */
export function parseNumbers(input: string, what = 'coefficients'): ParseResult<number[]> {
	return run(() => {
		const text = clean(input);
		const { rows } = scan(text);
		const values: number[] = [];
		for (const row of rows) for (const item of row) for (const w of joinSigns(item)) values.push(parseRealWord(text, w));
		if (values.length === 0) throw new ParseFailure({ message: `Enter at least one number for the ${what}.` });
		return { value: values };
	});
}

/** Parse a single real number (e.g. a gain). */
export function parseScalar(input: string, what = 'value'): ParseResult<number> {
	const r = parseNumbers(input, what);
	if (!r.ok) return r;
	if (r.value.length !== 1) return { ok: false, error: { message: `Expected a single number for the ${what}, found ${r.value.length}.` } };
	return { ok: true, value: r.value[0], notes: r.notes };
}

/** Parse rows of real numbers (rows split by newlines, `;` or inner brackets). */
export function parseRows(input: string): ParseResult<number[][]> {
	return run(() => {
		const text = clean(input);
		const { rows } = scan(text);
		const out: number[][] = [];
		for (const row of rows) {
			const vals: number[] = [];
			for (const item of row) for (const w of joinSigns(item)) vals.push(parseRealWord(text, w));
			if (vals.length) out.push(vals);
		}
		return { value: out };
	});
}

/**
 * Parse a second-order-section matrix: rows of six numbers
 * [b0 b1 b2 a0 a1 a2]. A single long row whose length is a multiple of 6 is
 * split automatically (e.g. a flattened array).
 */
export function parseSos(input: string): ParseResult<number[][]> {
	const r = parseRows(input);
	if (!r.ok) return r;
	const rows = r.value;
	if (rows.length === 0) return { ok: false, error: { message: 'Enter at least one section: six numbers b0 b1 b2 a0 a1 a2.' } };
	const notes: string[] = [];
	let out = rows;
	if (rows.length === 1 && rows[0].length > 6 && rows[0].length % 6 === 0) {
		const flat = rows[0];
		out = [];
		for (let i = 0; i < flat.length; i += 6) out.push(flat.slice(i, i + 6));
		notes.push(`Split ${flat.length} numbers into ${out.length} rows of 6.`);
	}
	for (let i = 0; i < out.length; i++) {
		if (out[i].length !== 6) {
			return {
				ok: false,
				error: {
					message: `Section ${i + 1} has ${out[i].length} number${out[i].length === 1 ? '' : 's'}; each SOS row needs exactly 6: b0 b1 b2 a0 a1 a2.`
				}
			};
		}
		if (out[i][3] === 0 && out[i][4] === 0 && out[i][5] === 0) {
			return { ok: false, error: { message: `Section ${i + 1} has an all-zero denominator.` } };
		}
	}
	return { ok: true, value: out, notes: [...r.notes, ...notes] };
}

// ---------------------------------------------------------------------------
// Complex numbers
// ---------------------------------------------------------------------------

const IMAG_RE = new RegExp(`^([+-]?)(${NUM})?\\*?[ij]$`);
const RECT_RE = new RegExp(`^([+-]?${NUM})([+\\-±])(${NUM})?\\*?[ij]$`);
const PM_IMAG_RE = new RegExp(`^±(${NUM})?\\*?[ij]$`);
const POLAR_RE = new RegExp(`^([+]?${NUM})∠([+\\-±]?)(${NUM})(°|deg|rad)?$`);

const UNSIGNED_IMAG_RE = new RegExp(`^(${NUM})?\\*?[ij]$`);
const isImagWord = (s: string) => UNSIGNED_IMAG_RE.test(s);
const isOperator = (s: string) => s === '+' || s === '-' || s === '±' || s === '∠';

/**
 * Re-join words of an item that belong to one complex number:
 * "0.5 + 0.3j" → "0.5+0.3j", "1 -2j" → "1-2j", "0.9 ∠ 30°" → "0.9∠30°".
 * Two real numbers separated by a space stay separate.
 */
function joinComplexWords(words: Word[]): Word[] {
	const out: Word[] = [];
	for (const w of words) {
		const prev = out[out.length - 1];
		if (prev) {
			const prevEndsOp = /[+\-±∠]$/.test(prev.text);
			const curIsOp = isOperator(w.text);
			const curStartsOp = /^[+\-±]/.test(w.text) && w.text.length > 1;
			const prevIsReal = !/[ij∠]/.test(prev.text);
			const joinImag = curStartsOp && isImagWord(w.text.slice(1)) && prevIsReal;
			const joinPolar = w.text.startsWith('∠') && prevIsReal;
			if (prevEndsOp || curIsOp || joinImag || joinPolar) {
				prev.text += w.text;
				continue;
			}
		}
		out.push({ ...w });
	}
	return out;
}

function parseComplexWord(text: string, w: Word): Complex[] {
	const s = w.text.replace(/\s+/g, '');
	if (REAL_RE.test(s)) return [{ re: Number(s), im: 0 }];
	const fr = s.match(FRACTION_RE);
	if (fr) return [{ re: Number(fr[1]) / Number(fr[2]), im: 0 }];
	let m = s.match(IMAG_RE);
	if (m) {
		const v = (m[1] === '-' ? -1 : 1) * (m[2] === undefined ? 1 : Number(m[2]));
		return [{ re: 0, im: v }];
	}
	m = s.match(PM_IMAG_RE);
	if (m) {
		const v = m[1] === undefined ? 1 : Number(m[1]);
		return [
			{ re: 0, im: v },
			{ re: 0, im: -v }
		];
	}
	m = s.match(RECT_RE);
	if (m) {
		const re = Number(m[1]);
		const im = m[3] === undefined ? 1 : Number(m[3]);
		if (m[2] === '±')
			return [
				{ re, im },
				{ re, im: -im }
			];
		return [{ re, im: m[2] === '-' ? -im : im }];
	}
	m = s.match(POLAR_RE);
	if (m) {
		const r = Number(m[1]);
		const a = Number(m[3]) * (m[4] === 'rad' ? 1 : Math.PI / 180);
		const mk = (sign: number) => ({ re: r * Math.cos(sign * a), im: r * Math.sin(sign * a) });
		if (m[2] === '±') return [mk(1), mk(-1)];
		return [mk(m[2] === '-' ? -1 : 1)];
	}
	if (/^[+-]?(inf|infinity|nan)$/i.test(s)) fail(text, w, `“${s}” is not a finite number.`);
	fail(text, w, `“${s}” is not a number. Write complex values like 0.5+0.3j, 1-2i, 2j, 0.5±0.3j or 0.9∠30°.`);
}

/** Parse a list of complex numbers (one per line or comma-separated). An empty input is an empty list. */
export function parseComplexList(input: string): ParseResult<Complex[]> {
	return run(() => {
		const text = clean(input);
		const { rows } = scan(text);
		const out: Complex[] = [];
		for (const row of rows) for (const item of row) for (const w of joinComplexWords(item)) out.push(...parseComplexWord(text, w));
		return { value: out };
	});
}

/**
 * Make a root list closed under conjugation (so that the polynomial has real
 * coefficients). Returns the completed list and the roots that were added.
 */
export function completeConjugates(rs: readonly Complex[], tol = 1e-9): { roots: Complex[]; added: Complex[] } {
	const out = rs.map((r) => ({ ...r }));
	const used = new Array(out.length).fill(false);
	const added: Complex[] = [];
	for (let i = 0; i < out.length; i++) {
		const r = out[i];
		if (used[i]) continue;
		used[i] = true;
		const scale = Math.max(1, Math.hypot(r.re, r.im));
		if (Math.abs(r.im) <= tol * scale) {
			r.im = 0;
			continue;
		}
		let partner = -1;
		for (let j = 0; j < out.length; j++) {
			if (used[j]) continue;
			if (Math.abs(out[j].re - r.re) <= tol * scale * 1e3 && Math.abs(out[j].im + r.im) <= tol * scale * 1e3) {
				partner = j;
				break;
			}
		}
		if (partner >= 0) {
			used[partner] = true;
			out[partner] = { re: r.re, im: -r.im };
		} else added.push({ re: r.re, im: -r.im });
	}
	return { roots: [...out, ...added], added };
}

// ---------------------------------------------------------------------------
// Formatting back to text (for "use as input")
// ---------------------------------------------------------------------------

export function formatReal(v: number, digits = 12): string {
	if (!Number.isFinite(v)) return String(v);
	if (v === 0) return '0';
	return String(Number(v.toPrecision(digits)));
}

export function formatComplex(z: Complex, digits = 12): string {
	const re = formatReal(z.re, digits);
	if (Math.abs(z.im) <= 1e-14 * Math.max(1, Math.abs(z.re))) return re;
	const im = formatReal(Math.abs(z.im), digits);
	if (Math.abs(z.re) <= 1e-14 * Math.abs(z.im)) return `${z.im < 0 ? '-' : ''}${im}j`;
	return `${re}${z.im < 0 ? '-' : '+'}${im}j`;
}
