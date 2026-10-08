/** Registry of every page in the site: drives the sidebar, home page and search. */

export type CategoryId = 'playgrounds' | 'analog' | 'iir' | 'fir' | 'analysis' | 'reference';

export interface Category {
	id: CategoryId;
	title: string;
	blurb: string;
}

export interface Tool {
	slug: string;
	title: string;
	/** Short label for the sidebar. */
	nav: string;
	category: CategoryId;
	description: string;
	tags: string[];
}

export const CATEGORIES: Category[] = [
	{
		id: 'playgrounds',
		title: 'Playgrounds',
		blurb: 'Build intuition by grabbing poles, zeros and components and watching what happens.'
	},
	{
		id: 'analog',
		title: 'Analog design',
		blurb: 'Classic continuous-time filters: prototypes, active circuits and passive ladders.'
	},
	{
		id: 'iir',
		title: 'Digital IIR',
		blurb: 'Recursive filters: biquads, EQs and discretised analog prototypes.'
	},
	{
		id: 'fir',
		title: 'Digital FIR',
		blurb: 'Finite impulse response filters: windows, equiripple and special-purpose designs.'
	},
	{
		id: 'analysis',
		title: 'Analysis & implementation',
		blurb: 'Analyse arbitrary filters, hear them, quantise them and see how they are built.'
	},
	{
		id: 'reference',
		title: 'Reference',
		blurb: 'Calculators, formulas and definitions to keep at hand.'
	}
];

export const TOOLS: Tool[] = [
	// ---------------- Playgrounds ----------------
	{
		slug: 'pole-zero',
		title: 'Pole–Zero Playground',
		nav: 'Pole–zero playground',
		category: 'playgrounds',
		description:
			'Drag poles and zeros around the s-plane or z-plane and watch the magnitude, phase and impulse response react in real time.',
		tags: ['poles', 'zeros', 'z-plane', 's-plane', 'stability', 'interactive', 'heatmap']
	},
	{
		slug: 'bode',
		title: 'Bode Plot Builder',
		nav: 'Bode plot builder',
		category: 'playgrounds',
		description:
			'Assemble a transfer function from gains, integrators, real and complex poles/zeros and compare straight-line asymptotes with the exact response.',
		tags: ['bode', 'asymptote', 'decade', 'damping', 'transfer function']
	},
	{
		slug: 'rlc',
		title: 'RC / RL / RLC Circuit Explorer',
		nav: 'RC / RLC circuits',
		category: 'playgrounds',
		description:
			'Tweak resistors, capacitors and inductors in first- and second-order passive circuits and see cutoff, Q, damping and step response.',
		tags: ['rc', 'rl', 'rlc', 'passive', 'resonance', 'damping', 'q factor', 'time constant']
	},
	{
		slug: 'convolution',
		title: 'Convolution Visualizer',
		nav: 'Convolution visualizer',
		category: 'playgrounds',
		description:
			'Step through discrete convolution sample by sample: flip, shift, multiply and sum — the mechanics of every FIR filter.',
		tags: ['convolution', 'fir', 'impulse response', 'step by step']
	},
	{
		slug: 'aliasing',
		title: 'Sampling & Aliasing',
		nav: 'Sampling & aliasing',
		category: 'playgrounds',
		description:
			'See spectral images fold around fs/2 and size the anti-aliasing filter a converter really needs.',
		tags: ['sampling', 'aliasing', 'nyquist', 'anti-aliasing', 'adc', 'images']
	},

	// ---------------- Analog ----------------
	{
		slug: 'analog-designer',
		title: 'Analog Filter Designer',
		nav: 'Analog filter designer',
		category: 'analog',
		description:
			'Butterworth, Chebyshev I/II, elliptic, Bessel, Legendre and more — low-pass, high-pass, band-pass or band-stop, from an order or from specifications.',
		tags: [
			'butterworth',
			'chebyshev',
			'elliptic',
			'cauer',
			'bessel',
			'legendre',
			'prototype',
			'order',
			'analog'
		]
	},
	{
		slug: 'family-compare',
		title: 'Filter Family Comparison',
		nav: 'Family comparison',
		category: 'analog',
		description:
			'Overlay filter families at the same order and cutoff to see the trade-off between sharpness, ripple, phase linearity and overshoot.',
		tags: ['compare', 'butterworth', 'chebyshev', 'elliptic', 'bessel', 'overshoot', 'group delay']
	},
	{
		slug: 'active-filters',
		title: 'Active Filter Designer',
		nav: 'Active filters (op-amp)',
		category: 'analog',
		description:
			'Turn a filter into cascaded Sallen–Key or multiple-feedback op-amp stages with real E-series component values and see the error they introduce.',
		tags: [
			'sallen-key',
			'mfb',
			'multiple feedback',
			'op-amp',
			'active',
			'component values',
			'e-series',
			'cascade'
		]
	},
	{
		slug: 'lc-ladder',
		title: 'Passive LC Ladder Designer',
		nav: 'Passive LC ladder',
		category: 'analog',
		description:
			'Doubly-terminated LC ladder networks from normalised g-values, scaled to your impedance and frequency, verified by circuit simulation.',
		tags: [
			'lc',
			'ladder',
			'passive',
			'g-values',
			'cauer',
			'inductor',
			'capacitor',
			'impedance',
			'rf'
		]
	},
	{
		slug: 'crossover',
		title: 'Crossover Designer',
		nav: 'Audio crossover',
		category: 'analog',
		description:
			'Two- and three-way loudspeaker crossovers (Butterworth, Linkwitz–Riley, Bessel) with summed magnitude, phase and polarity.',
		tags: ['crossover', 'linkwitz-riley', 'loudspeaker', 'audio', 'summing', 'all-pass']
	},

	// ---------------- Digital IIR ----------------
	{
		slug: 'iir-designer',
		title: 'Digital IIR Designer',
		nav: 'IIR designer',
		category: 'iir',
		description:
			'Design digital IIR filters from analog prototypes via the bilinear transform, check them against a spec mask and export second-order sections.',
		tags: ['iir', 'bilinear', 'sos', 'biquad cascade', 'digital', 'coefficients', 'export']
	},
	{
		slug: 'biquad',
		title: 'Biquad Cookbook',
		nav: 'Biquad cookbook',
		category: 'iir',
		description:
			"All of RBJ's Audio-EQ-Cookbook biquads with a draggable handle, live coefficients, pole–zero plot and code.",
		tags: ['biquad', 'rbj', 'cookbook', 'peaking', 'shelf', 'notch', 'allpass', 'audio']
	},
	{
		slug: 'parametric-eq',
		title: 'Parametric EQ',
		nav: 'Parametric EQ',
		category: 'iir',
		description:
			'A multi-band equaliser: click to add bands, drag them around, scroll to change Q — then export the whole cascade.',
		tags: ['eq', 'equalizer', 'parametric', 'audio', 'bands', 'shelf', 'peaking']
	},
	{
		slug: 'simple-filters',
		title: 'Simple Digital Filters',
		nav: 'Simple filters',
		category: 'iir',
		description:
			'The small filters that do most of the work: one-pole smoothers, DC blockers, moving averages, comb filters, resonators and all-passes.',
		tags: [
			'one-pole',
			'ema',
			'exponential moving average',
			'dc blocker',
			'comb',
			'resonator',
			'leaky integrator',
			'moving average'
		]
	},
	{
		slug: 'discretization',
		title: 'Analog → Digital Mapping',
		nav: 'Analog → digital',
		category: 'iir',
		description:
			'Compare bilinear, matched-Z, impulse invariance and Euler discretisation: how each maps the s-plane and what it does to the response.',
		tags: [
			'bilinear',
			'prewarp',
			'impulse invariance',
			'matched z',
			'euler',
			'warping',
			'aliasing',
			's-plane',
			'z-plane'
		]
	},

	// ---------------- Digital FIR ----------------
	{
		slug: 'fir-designer',
		title: 'FIR Filter Designer',
		nav: 'FIR designer',
		category: 'fir',
		description:
			'Window method, least squares, frequency sampling and Parks–McClellan (Remez) equiripple design with order estimation and tap export.',
		tags: [
			'fir',
			'window method',
			'kaiser',
			'remez',
			'parks-mcclellan',
			'equiripple',
			'least squares',
			'taps'
		]
	},
	{
		slug: 'windows',
		title: 'Window Function Explorer',
		nav: 'Window functions',
		category: 'fir',
		description:
			'Compare 20 window functions in time and frequency, with main-lobe width, sidelobe level, ENBW and scalloping loss.',
		tags: [
			'window',
			'hann',
			'hamming',
			'blackman',
			'kaiser',
			'dpss',
			'chebyshev',
			'sidelobe',
			'leakage',
			'enbw'
		]
	},
	{
		slug: 'special-fir',
		title: 'Special-Purpose FIR Filters',
		nav: 'Special FIRs',
		category: 'fir',
		description:
			'Hilbert transformers, differentiators, raised-cosine and Gaussian pulse shapers, Savitzky–Golay smoothers, half-band and CIC filters.',
		tags: [
			'hilbert',
			'differentiator',
			'raised cosine',
			'rrc',
			'gaussian',
			'savitzky-golay',
			'cic',
			'half-band',
			'pulse shaping'
		]
	},
	{
		slug: 'linear-phase',
		title: 'Linear vs Minimum Phase',
		nav: 'Linear vs minimum phase',
		category: 'fir',
		description:
			'The four linear-phase FIR types, their zero symmetries and constraints — and what converting to minimum phase does to delay and ringing.',
		tags: [
			'linear phase',
			'minimum phase',
			'type i',
			'type ii',
			'type iii',
			'type iv',
			'pre-ringing',
			'group delay'
		]
	},

	// ---------------- Analysis ----------------
	{
		slug: 'tf-analyzer',
		title: 'Transfer Function Analyzer',
		nav: 'Transfer function analyzer',
		category: 'analysis',
		description:
			'Paste coefficients (b/a, SOS or poles/zeros, analog or digital) and get the full analysis plus conversions between forms.',
		tags: [
			'transfer function',
			'coefficients',
			'analyze',
			'convert',
			'sos',
			'zpk',
			'tf',
			'stability'
		]
	},
	{
		slug: 'signal-lab',
		title: 'Signal Lab',
		nav: 'Signal lab (listen)',
		category: 'analysis',
		description:
			'Run test signals and noise through a filter, compare input and output in time and frequency — and listen to the difference.',
		tags: [
			'audio',
			'listen',
			'noise',
			'chirp',
			'square wave',
			'spectrum',
			'time domain',
			'web audio'
		]
	},
	{
		slug: 'quantization',
		title: 'Coefficient Quantization',
		nav: 'Quantization effects',
		category: 'analysis',
		description:
			'Round coefficients to N-bit fixed point and watch poles drift and responses break — and why second-order sections survive.',
		tags: ['fixed point', 'quantization', 'q15', 'wordlength', 'sos', 'direct form', 'sensitivity']
	},
	{
		slug: 'structures',
		title: 'Filter Structures',
		nav: 'Filter structures',
		category: 'analysis',
		description:
			'Direct form I and II, transposed, cascade, parallel and lattice block diagrams with your coefficients, plus ready-to-use code.',
		tags: [
			'direct form',
			'transposed',
			'cascade',
			'parallel',
			'lattice',
			'block diagram',
			'implementation',
			'code'
		]
	},

	// ---------------- Reference ----------------
	{
		slug: 'order-calculator',
		title: 'Filter Order Calculator',
		nav: 'Order calculator',
		category: 'reference',
		description:
			'Enter passband and stopband specs once and see the minimum order every IIR family and FIR method needs to meet them.',
		tags: ['order', 'specification', 'estimate', 'kaiser', 'compare', 'requirements']
	},
	{
		slug: 'calculators',
		title: 'Engineering Calculators',
		nav: 'Calculators',
		category: 'reference',
		description:
			'dB conversions, Q ↔ bandwidth ↔ damping, RC/RL/LC corner frequencies, ripple ↔ ε, E-series rounding and more.',
		tags: [
			'db',
			'decibel',
			'q',
			'bandwidth',
			'octave',
			'damping',
			'rc',
			'lc',
			'resonance',
			'e-series',
			'convert'
		]
	},
	{
		slug: 'formulas',
		title: 'Formula Reference',
		nav: 'Formula sheet',
		category: 'reference',
		description:
			'The equations you keep looking up: transforms, prototypes, frequency transformations, bilinear mapping, cookbook biquads and windows.',
		tags: ['formula', 'cheat sheet', 'laplace', 'z-transform', 'bilinear', 'equations']
	},
	{
		slug: 'glossary',
		title: 'Glossary',
		nav: 'Glossary',
		category: 'reference',
		description:
			'Plain-language definitions of filter terminology, from all-pass to zero-order hold.',
		tags: ['glossary', 'definitions', 'terms', 'vocabulary']
	}
];

export const toolBySlug = (slug: string): Tool | undefined => TOOLS.find((t) => t.slug === slug);
export const toolsIn = (cat: CategoryId): Tool[] => TOOLS.filter((t) => t.category === cat);
export const categoryById = (id: CategoryId): Category => CATEGORIES.find((c) => c.id === id)!;

/** Simple ranked search over titles, descriptions and tags. */
export function searchTools(query: string): Tool[] {
	const q = query.trim().toLowerCase();
	if (!q) return TOOLS;
	const terms = q.split(/\s+/);
	return TOOLS.map((t) => {
		const hay = `${t.title} ${t.description} ${t.tags.join(' ')}`.toLowerCase();
		let score = 0;
		for (const term of terms) {
			if (!hay.includes(term)) return { t, score: -1 };
			if (t.title.toLowerCase().includes(term)) score += 3;
			if (t.tags.some((g) => g.includes(term))) score += 2;
			score += 1;
		}
		return { t, score };
	})
		.filter((r) => r.score > 0)
		.sort((a, b) => b.score - a.score)
		.map((r) => r.t);
}
