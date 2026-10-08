import { describe, expect, it } from 'vitest';
import katex from 'katex';
import { TERMS, letterOf, matchTerm, slugify, termByName } from '../src/lib/features/glossary/terms';
import { TOOLS } from '../src/lib/tools';

describe('glossary data', () => {
	it('has 100+ terms with unique, stable ids', () => {
		expect(TERMS.length).toBeGreaterThanOrEqual(100);
		const ids = TERMS.map((t) => slugify(t.term));
		expect(new Set(ids).size).toBe(ids.length);
		expect(slugify('Parks–McClellan algorithm')).toBe('parks-mcclellan-algorithm');
		expect(slugify('Q factor')).toBe('q-factor');
		expect(slugify('S-plane')).toBe('s-plane');
		expect(slugify('Multiple feedback (MFB) topology')).toBe('multiple-feedback-mfb-topology');
	});

	it('is sorted alphabetically', () => {
		const names = TERMS.map((t) => t.term);
		const sorted = [...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
		expect(names).toEqual(sorted);
		for (const t of TERMS) expect(letterOf(t.term)).toMatch(/^[A-Z]$/);
	});

	it('every "see also" points at an existing term, never at itself', () => {
		for (const t of TERMS) {
			for (const s of t.see ?? []) {
				expect(termByName(s), `${t.term} → ${s}`).toBeDefined();
				expect(s).not.toBe(t.term);
			}
		}
	});

	it('every tool link is a registered page', () => {
		const slugs = new Set(TOOLS.map((t) => t.slug));
		for (const t of TERMS) for (const s of t.tools ?? []) expect(slugs.has(s), `${t.term} → ${s}`).toBe(true);
	});

	it('definitions are 1–3 sentences and formulas parse', () => {
		for (const t of TERMS) {
			expect(t.def.length, t.term).toBeGreaterThan(40);
			const sentences = t.def.split(/(?<=[.!?])\s+(?=[A-Z(])/).length;
			expect(sentences, t.term).toBeLessThanOrEqual(3);
			if (t.tex) expect(() => katex.renderToString(t.tex!, { throwOnError: true, strict: 'ignore' }), t.term).not.toThrow();
		}
	});

	it('covers the core vocabulary', () => {
		const required = [
			'all-pass', 'aliasing', 'amplitude response', 'analog prototype', 'anti-aliasing', 'attenuation', 'band-pass', 'band-stop', 'bandwidth',
			'bessel', 'bilinear', 'biquad', 'bode', 'butterworth', 'cascade', 'causal', 'chebyshev', 'cic', 'coefficient quantization', 'comb',
			'convolution', 'corner frequency', 'cutoff', 'damping ratio', 'decibel', 'decimation', 'dc blocker', 'dft', 'fft', 'difference equation',
			'direct form', 'elliptic', 'enbw', 'equiripple', 'fir', 'fixed point', 'frequency response', 'frequency sampling', 'gibbs', 'group delay',
			'half-band', 'hilbert', 'iir', 'impulse invariance', 'impulse response', 'interpolation', 'kaiser', 'ladder', 'laplace', 'lattice',
			'leakage', 'limit cycle', 'linear phase', 'lti', 'main lobe', 'matched filter', 'matched-z', 'minimum phase', 'moving average',
			'multirate', 'notch', 'nyquist frequency', 'order', 'overshoot', 'parks', 'passband', 'phase delay', 'pole', 'prewarping', 'q factor',
			'quantization', 'raised-cosine', 'resonance', 'ripple', 'roc', 'roll-off', 'sallen', 'mfb', 'savitzky', 'scalloping', 'second-order section',
			'selectivity', 'settling time', 'shelving', 'sidelobe', 'sinc', 's-plane', 'stability', 'state space', 'stopband', 'step response',
			'time constant', 'transfer function', 'transition band', 'transposed', 'unit circle', 'warping', 'window function', 'z-plane',
			'z-transform', 'zero', 'zero-order hold'
		];
		for (const r of required) {
			const hit = TERMS.some((t) => `${t.term} ${(t.aka ?? []).join(' ')}`.toLowerCase().includes(r));
			expect(hit, r).toBe(true);
		}
	});

	it('search matches term, synonyms and definition', () => {
		const find = (q: string) => TERMS.filter((t) => matchTerm(t, q)).map((t) => t.term);
		expect(find('cauer')).toContain('Elliptic filter');
		expect(find('ENBW')).toContain('Equivalent noise bandwidth');
		expect(find('hum')).toContain('Notch filter');
		expect(find('  ')).toHaveLength(TERMS.length);
		expect(find('zzzz')).toHaveLength(0);
	});
});
