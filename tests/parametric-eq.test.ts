import { describe, expect, it } from 'vitest';
import {
	analogBandDb,
	bandSection,
	bandsFromPreset,
	cascade,
	EQ_TYPES,
	freeSlot,
	gainFromLevel,
	markerLevel,
	PRESETS,
	sanitizeBand,
	type EqBand
} from '../src/lib/features/parametric-eq/eq';
import { evaluate } from '../src/lib/dsp/response';

const band = (over: Partial<EqBand>): EqBand => ({
	id: 1,
	slot: 0,
	type: 'peaking',
	f: 1000,
	q: 1,
	gain: 6,
	enabled: true,
	...over
});
const digitalDb = (b: EqBand, fs: number, f: number) =>
	evaluate({ kind: 'digital', fs, sos: [bandSection(b, fs)] }, [f]).magDb[0];

describe('analog prototypes match the RBJ biquads far below Nyquist', () => {
	const fs = 192000;
	for (const t of EQ_TYPES) {
		it(t.id, () => {
			const b = band({ type: t.id, f: 200, q: 1.3, gain: t.usesGain ? 7.5 : 0 });
			for (const f of [30, 100, 200, 400, 1000]) {
				const a = analogBandDb(b, f);
				const d = digitalDb(b, fs, f);
				if (t.id === 'notch' && f === 200) {
					expect(d).toBeLessThan(-100);
					expect(a).toBeLessThan(-100);
					continue;
				}
				expect(Math.abs(a - d)).toBeLessThan(0.02);
			}
		});
	}
});

describe('RBJ landmarks', () => {
	it('a peaking band has exactly its gain at f0, even near Nyquist (prewarped)', () => {
		const b = band({ f: 15000, gain: 9, q: 0.7 });
		expect(digitalDb(b, 48000, 15000)).toBeCloseTo(9, 9);
		expect(analogBandDb(b, 15000)).toBeCloseTo(9, 9);
	});
	it('shelves pass through half their gain at f0', () => {
		for (const type of ['lowshelf', 'highshelf'] as const) {
			const b = band({ type, gain: 10, q: 0.707 });
			expect(digitalDb(b, 48000, 1000)).toBeCloseTo(5, 6);
			expect(analogBandDb(b, 1000)).toBeCloseTo(5, 9);
			expect(markerLevel(b, NaN)).toBe(5);
			expect(gainFromLevel(b, 5)).toBe(10);
		}
	});
	it('cramping: a wide bell near Nyquist is narrower than its analog prototype', () => {
		const b = band({ f: 16000, gain: 9, q: 0.7 });
		// above f0 the digital response is forced back to its Nyquist value
		expect(digitalDb(b, 48000, 23000)).toBeLessThan(analogBandDb(b, 23000) - 1);
	});
});

describe('bands and slots', () => {
	it('reuses the lowest free colour slot', () => {
		const bands = [band({ slot: 0 }), band({ id: 2, slot: 2 })];
		expect(freeSlot(bands)).toBe(1);
		expect(freeSlot(Array.from({ length: 8 }, (_, i) => band({ id: i, slot: i })))).toBe(-1);
	});
	it('cascades only enabled bands and adds dB', () => {
		const a = band({ f: 100, gain: 3 });
		const b = band({ id: 2, slot: 1, f: 5000, gain: -4, q: 2 });
		const off = band({ id: 3, slot: 2, f: 1000, gain: 12, enabled: false });
		const fs = 48000;
		const sos = cascade([a, b, off], fs);
		expect(sos).toHaveLength(2);
		const total = evaluate({ kind: 'digital', fs, sos }, [700]).magDb[0];
		expect(total).toBeCloseTo(digitalDb(a, fs, 700) + digitalDb(b, fs, 700), 9);
		expect(cascade([], fs)).toEqual([[1, 0, 0, 1, 0, 0]]);
	});
	it('presets are valid and fit the band limit', () => {
		for (const p of PRESETS) {
			const bands = bandsFromPreset(p, 10);
			expect(bands.length).toBeLessThanOrEqual(8);
			for (const b of bands) expect(sanitizeBand(b, b.id)).toEqual(b);
		}
	});
	it('rejects malformed shared bands', () => {
		expect(sanitizeBand({ type: 'bogus', f: 100, q: 1, gain: 0, slot: 0 }, 1)).toBeNull();
		expect(sanitizeBand({ type: 'peaking', f: -1, q: 1, gain: 0, slot: 0 }, 1)).toBeNull();
		expect(sanitizeBand({ type: 'peaking', f: 100, q: 1, gain: 0, slot: 9 }, 1)).toBeNull();
		expect(sanitizeBand({ type: 'peaking', f: 100, q: 100, gain: 99, slot: 3 }, 1)).toMatchObject({
			q: 30,
			gain: 24
		});
	});
});
