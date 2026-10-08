import { BIQUAD_TYPES, type BiquadType } from '$lib/dsp/biquad';

/** Shareable state of the biquad page. */
export interface BiquadState {
	type: BiquadType;
	fs: number;
	f0: number;
	q: number;
	gainDb: number;
}

export const FS_OPTIONS = [8000, 16000, 22050, 32000, 44100, 48000, 88200, 96000, 192000];
export const F0_MIN = 10;
export const Q_MIN = 0.1;
export const Q_MAX = 50;

/** Highest f₀ offered: just below Nyquist, where ω₀ → π makes the design degenerate. */
export const maxF0 = (fs: number): number => (fs / 2) * 0.98;
export const clampF0 = (f0: number, fs: number): number =>
	Math.min(maxF0(fs), Math.max(F0_MIN, f0));
export const clampQ = (q: number): number => Math.min(Q_MAX, Math.max(Q_MIN, q));

/**
 * Apply a shared-link state onto `cur`, ignoring invalid fields and keeping f₀
 * inside the band of the (possibly restored) sample rate.
 */
export function restoreState(cur: BiquadState, st: Partial<BiquadState> | null): BiquadState {
	const out = { ...cur };
	if (!st) return out;
	if (st.type && BIQUAD_TYPES.some((t) => t.id === st.type)) out.type = st.type;
	if (typeof st.fs === 'number' && FS_OPTIONS.includes(st.fs)) out.fs = st.fs;
	if (typeof st.f0 === 'number' && st.f0 > 0) out.f0 = st.f0;
	out.f0 = clampF0(out.f0, out.fs);
	if (typeof st.q === 'number' && st.q > 0) out.q = st.q;
	if (typeof st.gainDb === 'number' && Number.isFinite(st.gainDb)) out.gainDb = st.gainDb;
	return out;
}
