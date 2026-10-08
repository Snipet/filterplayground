import type { Component } from 'svelte';
import DbCard from './cards/DbCard.svelte';
import QCard from './cards/QCard.svelte';
import RcCard from './cards/RcCard.svelte';
import RlCard from './cards/RlCard.svelte';
import LcCard from './cards/LcCard.svelte';
import ReactanceCard from './cards/ReactanceCard.svelte';
import RippleCard from './cards/RippleCard.svelte';
import WavelengthCard from './cards/WavelengthCard.svelte';
import SamplingCard from './cards/SamplingCard.svelte';
import OctaveCard from './cards/OctaveCard.svelte';
import ESeriesCard from './cards/ESeriesCard.svelte';
import TimeConstantCard from './cards/TimeConstantCard.svelte';
import PrewarpCard from './cards/PrewarpCard.svelte';
import PhaseDelayCard from './cards/PhaseDelayCard.svelte';
import PoleCard from './cards/PoleCard.svelte';

export interface CalcEntry {
	/** Stable anchor id — do not rename, people link to these. */
	id: string;
	title: string;
	/** Short label for the index chips. */
	short: string;
	keywords: string;
	component: Component<{ id: string; title: string }>;
}

export const CALCULATORS: CalcEntry[] = [
	{
		id: 'db',
		title: 'Decibels ↔ ratios & levels',
		short: 'dB',
		keywords:
			'decibel db ratio amplitude power gain dbv dbu dbm volts watts rms peak level 50 600 ohm',
		component: DbCard
	},
	{
		id: 'q-bandwidth',
		title: 'Q ↔ bandwidth ↔ damping',
		short: 'Q / bandwidth',
		keywords:
			'q factor quality bandwidth octave damping ratio zeta -3 db edges overshoot resonance peak',
		component: QCard
	},
	{
		id: 'rc',
		title: 'RC filter',
		short: 'RC',
		keywords:
			'rc resistor capacitor cutoff corner time constant tau first order low-pass high-pass e12 e24',
		component: RcCard
	},
	{
		id: 'rl',
		title: 'RL filter',
		short: 'RL',
		keywords: 'rl resistor inductor cutoff corner time constant tau first order',
		component: RlCard
	},
	{
		id: 'lc',
		title: 'LC resonance',
		short: 'LC',
		keywords:
			'lc resonance tank inductor capacitor resonant frequency characteristic impedance z0 reactance',
		component: LcCard
	},
	{
		id: 'reactance',
		title: 'Reactance at a frequency',
		short: 'Reactance',
		keywords: 'reactance impedance capacitor inductor xc xl',
		component: ReactanceCard
	},
	{
		id: 'ripple',
		title: 'Ripple, ε, δ, return loss',
		short: 'Ripple',
		keywords:
			'ripple epsilon passband stopband attenuation delta deviation return loss vswr reflection coefficient chebyshev',
		component: RippleCard
	},
	{
		id: 'wavelength',
		title: 'Frequency ↔ period ↔ wavelength',
		short: 'Wavelength',
		keywords: 'frequency period angular omega wavelength lambda speed of sound light',
		component: WavelengthCard
	},
	{
		id: 'sampling',
		title: 'Sampling & normalised frequency',
		short: 'Sampling',
		keywords:
			'sample rate nyquist normalised normalized frequency cycles per sample rad sample matlab alias samples time',
		component: SamplingCard
	},
	{
		id: 'octaves',
		title: 'Octaves, decades & bands',
		short: 'Octaves',
		keywords:
			'octave decade cents semitone interval third-octave fractional octave band iec 61260 ansi centre frequency',
		component: OctaveCard
	},
	{
		id: 'e-series',
		title: 'E-series lookup',
		short: 'E-series',
		keywords: 'e series e6 e12 e24 e48 e96 preferred values resistor capacitor tolerance nearest',
		component: ESeriesCard
	},
	{
		id: 'time-constant',
		title: 'Time constant & settling',
		short: 'Time constant',
		keywords:
			'time constant tau settling rise time 10 90 first order step response exponential percent',
		component: TimeConstantCard
	},
	{
		id: 'prewarp',
		title: 'Bilinear prewarping',
		short: 'Prewarp',
		keywords: 'bilinear prewarp prewarping warping tustin digital analog frequency',
		component: PrewarpCard
	},
	{
		id: 'phase-delay',
		title: 'Phase ↔ time delay',
		short: 'Phase ↔ delay',
		keywords: 'phase delay time degrees radians lag samples distance',
		component: PhaseDelayCard
	},
	{
		id: 'pole',
		title: 'Pole position ↔ f₀, Q',
		short: 'Poles',
		keywords: 'pole s-plane z-plane natural frequency q damping radius angle decay',
		component: PoleCard
	}
];

/** Every whitespace-separated term must appear in the title or keywords. */
export function matchCalc(c: CalcEntry, query: string): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return true;
	const hay = `${c.title} ${c.short} ${c.keywords}`.toLowerCase();
	return q.split(/\s+/).every((t) => hay.includes(t));
}
