import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Slider from '../src/lib/components/controls/Slider.svelte';
import {
	dbToMag,
	logTicks,
	magToDb,
	markerToMag,
	regionToMag
} from '../src/lib/components/plot/scales';
import { specRegions } from '../src/lib/specmask';

// #120: a sub-decade log axis that contains one power of ten got a single label
describe('logTicks fallback for sub-decade domains', () => {
	it('labels a narrow band around 1 kHz like a linear axis', () => {
		expect(logTicks(900, 1150, 600).labelled).toEqual([900, 950, 1000, 1050, 1100, 1150]);
	});

	it('always gives at least two labels when one power of ten is visible', () => {
		const cases: [number, number][] = [
			[800, 1500],
			[999, 1001],
			[0.9, 1.2],
			[920, 1080],
			[950, 1050],
			[5, 50]
		];
		for (const [a, b] of cases)
			for (const w of [100, 224, 300, 600, 900]) {
				const { labelled } = logTicks(a, b, w);
				expect(labelled.length, `[${a}, ${b}] @ ${w}px`).toBeGreaterThanOrEqual(2);
				for (const v of labelled) {
					expect(v).toBeGreaterThanOrEqual(a * (1 - 1e-9));
					expect(v).toBeLessThanOrEqual(b * (1 + 1e-9));
				}
			}
	});

	it('keeps log-style labels for wide and multi-decade axes', () => {
		expect(logTicks(20, 20000, 600).labelled).toEqual([30, 100, 300, 1000, 3000, 10000]);
		expect(logTicks(10, 100, 300).labelled).toEqual([10, 20, 50, 100]);
		expect(logTicks(200, 800, 600).labelled).toEqual([200, 500]);
		// cramped multi-decade axis: thinned powers of ten, not linear ticks
		expect(logTicks(10, 1e6, 100).labelled).toEqual([10, 1000, 100000]);
	});
});

// #59: dB overlays (spec masks, handles) must be converted for the Linear magnitude view
describe('dB overlays on a linear magnitude axis', () => {
	// Plot clamps region limits to the y-domain the same way
	const clampRegion = (r: { y0: number; y1: number }, yd: [number, number]) => {
		const y0 = Math.min(Math.max(r.y0, yd[0]), yd[1]);
		const y1 = Math.max(Math.min(r.y1, yd[1]), yd[0]);
		return [Math.min(y0, y1), Math.max(y0, y1)];
	};

	it('maps an Rp = 1 dB / Rs = 40 dB mask to |H| limits 0.891 and 0.01', () => {
		const regions = specRegions('lowpass', 1000, 2000, 1, 40).map(regionToMag);
		const yd: [number, number] = [0, 1.2];
		const [pass, stop] = regions.map((r) => clampRegion(r, yd));
		// forbidden below 10^(−1/20) in the passband
		expect(pass[0]).toBe(0);
		expect(pass[1]).toBeCloseTo(0.891251, 6);
		// forbidden above 10^(−40/20) in the stopband
		expect(stop[0]).toBeCloseTo(0.01, 12);
		expect(stop[1]).toBe(1.2);
		// labels and x-extent are kept
		expect(regions[0].label).toContain('−1 dB');
		expect(regions[1].x0).toBe(2000);
	});

	it('places a dB handle on the curve and returns drags in dB', () => {
		const m = markerToMag({ id: 'f0', x: 1000, y: 6, draggable: true });
		expect(m.y).toBeCloseTo(1.995262, 6);
		expect(m).toMatchObject({ id: 'f0', x: 1000, draggable: true });
		expect(magToDb(m.y)).toBeCloseTo(6, 12);
		expect(magToDb(dbToMag(-60))).toBeCloseTo(-60, 9);
		// a drag to (or below) zero stays finite
		expect(magToDb(0)).toBe(-240);
		expect(magToDb(-0.05)).toBe(-240);
	});
});

// #121: log sliders exposed the raw 0…1000 travel position to assistive technology
describe('Slider aria-valuetext', () => {
	const rangeValueText = (props: Record<string, unknown>) => {
		const { body } = render(Slider, { props: props as never });
		const input = body.match(/<input[^>]*type="range"[^>]*>/)?.[0] ?? '';
		return input.match(/aria-valuetext="([^"]*)"/)?.[1];
	};

	it('announces the value and unit of a log slider, not its position', () => {
		expect(
			rangeValueText({
				value: 1000,
				label: 'Frequency f₀',
				min: 10,
				max: 23520,
				log: true,
				unit: 'Hz'
			})
		).toBe('1000 Hz');
		expect(rangeValueText({ value: 1, label: 'Q', min: 0.1, max: 50, log: true })).toBe('1');
	});

	it('adds the unit for linear sliders and keeps SI prefixes', () => {
		expect(rangeValueText({ value: 6, label: 'Gain', min: -30, max: 30, unit: 'dB' })).toBe('6 dB');
		expect(
			rangeValueText({ value: 0.1, label: 'L', min: 1e-6, max: 10, log: true, unit: 'H', si: true })
		).toBe('100 mH');
	});
});
