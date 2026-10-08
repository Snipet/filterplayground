/**
 * Minimal A/B player on the Web Audio API: two looping buffers started in
 * sync; switching between them only moves two gains, so the comparison is
 * seamless. The AudioContext is created lazily (browsers only allow audio
 * after a user gesture).
 */
export type Channel = 'A' | 'B';

type Ctor = typeof AudioContext;

export class ABPlayer {
	private ctx: AudioContext | null = null;
	private master: GainNode | null = null;
	private gains: Record<Channel, GainNode | null> = { A: null, B: null };
	private sources: AudioBufferSourceNode[] = [];
	private startedAt = 0;
	private offsetAtStart = 0;
	private duration = 0;
	private volume = 0.5;
	active: Channel | null = null;

	static supported(): boolean {
		return (
			typeof window !== 'undefined' &&
			!!(
				window.AudioContext ??
				(window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext
			)
		);
	}

	private ensure(): AudioContext {
		if (!this.ctx) {
			const C: Ctor =
				window.AudioContext ??
				(window as unknown as { webkitAudioContext: Ctor }).webkitAudioContext;
			this.ctx = new C({ latencyHint: 'interactive' });
			this.master = this.ctx.createGain();
			this.master.gain.value = this.volume;
			this.master.connect(this.ctx.destination);
			for (const ch of ['A', 'B'] as Channel[]) {
				const g = this.ctx.createGain();
				g.gain.value = 0;
				g.connect(this.master);
				this.gains[ch] = g;
			}
		}
		return this.ctx;
	}

	/** Current loop position in seconds (0 when stopped). */
	position(): number {
		if (!this.ctx || !this.active || this.duration <= 0) return 0;
		const t = this.offsetAtStart + (this.ctx.currentTime - this.startedAt);
		return ((t % this.duration) + this.duration) % this.duration;
	}

	/** Start (or restart) both buffers in sync; `which` is audible. */
	play(a: Float32Array, b: Float32Array, fs: number, which: Channel, keepPosition = false): void {
		const ctx = this.ensure();
		void ctx.resume();
		const offset = keepPosition ? this.position() : 0;
		this.stopSources();
		const mk = (data: Float32Array, ch: Channel) => {
			const buf = ctx.createBuffer(1, Math.max(1, data.length), fs);
			buf.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
			const src = ctx.createBufferSource();
			src.buffer = buf;
			src.loop = true;
			src.connect(this.gains[ch]!);
			return src;
		};
		this.duration = a.length / fs;
		const srcA = mk(a, 'A');
		const srcB = mk(b, 'B');
		const t0 = ctx.currentTime + 0.03;
		const off = Math.min(offset, Math.max(0, this.duration - 1e-3));
		srcA.start(t0, off);
		srcB.start(t0, off);
		this.sources = [srcA, srcB];
		this.startedAt = t0;
		this.offsetAtStart = off;
		this.setChannel(which, keepPosition ? 0.008 : 0);
	}

	/** Make the other channel audible with a short cross-fade (no click). */
	setChannel(which: Channel, fade = 0.008): void {
		if (!this.ctx) return;
		const t = this.ctx.currentTime;
		for (const ch of ['A', 'B'] as Channel[]) {
			const g = this.gains[ch]!.gain;
			g.cancelScheduledValues(t);
			const target = ch === which ? 1 : 0;
			if (fade > 0) g.setTargetAtTime(target, t, fade);
			else g.setValueAtTime(target, t);
		}
		this.active = which;
	}

	setVolume(v: number): void {
		this.volume = v;
		if (this.ctx && this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
	}

	private stopSources(): void {
		for (const s of this.sources) {
			try {
				s.stop();
				s.disconnect();
			} catch {
				/* already stopped */
			}
		}
		this.sources = [];
	}

	stop(): void {
		this.stopSources();
		this.active = null;
	}

	dispose(): void {
		this.stop();
		if (this.ctx) {
			void this.ctx.close();
			this.ctx = null;
		}
	}
}

/**
 * Decode an audio file (any format the browser supports), resample it to `fs`,
 * mix it to mono and keep at most `maxSeconds`.
 */
export async function decodeToMono(
	bytes: ArrayBuffer,
	fs: number,
	maxSeconds = 10
): Promise<Float32Array> {
	const off = new OfflineAudioContext(1, 1, fs);
	const buf = await off.decodeAudioData(bytes.slice(0));
	const n = Math.min(buf.length, Math.round(maxSeconds * fs));
	const out = new Float32Array(n);
	for (let ch = 0; ch < buf.numberOfChannels; ch++) {
		const d = buf.getChannelData(ch);
		for (let i = 0; i < n; i++) out[i] += d[i] / buf.numberOfChannels;
	}
	return out;
}
