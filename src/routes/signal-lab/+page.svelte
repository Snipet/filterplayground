<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import ToolLayout from '$lib/components/layout/ToolLayout.svelte';
	import ControlGroup from '$lib/components/layout/ControlGroup.svelte';
	import Card from '$lib/components/layout/Card.svelte';
	import Select from '$lib/components/controls/Select.svelte';
	import Segmented from '$lib/components/controls/Segmented.svelte';
	import Slider from '$lib/components/controls/Slider.svelte';
	import Toggle from '$lib/components/controls/Toggle.svelte';
	import Plot, { type Series } from '$lib/components/plot/Plot.svelte';
	import StatGrid, { type Stat } from '$lib/components/content/StatGrid.svelte';
	import Callout from '$lib/components/content/Callout.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import { designDigital } from '$lib/dsp/design';
	import { BIQUAD_TYPES, biquad, type BiquadType } from '$lib/dsp/biquad';
	import { firwin } from '$lib/dsp/fir';
	import { applyDigital } from '$lib/dsp/time';
	import { evaluate } from '$lib/dsp/response';
	import { welchPsd } from '$lib/dsp/fft';
	import { isStable, digitalZpk } from '$lib/dsp/convert';
	import { formatSI, trimNumber } from '$lib/dsp/units';
	import { freqFormat } from '$lib/components/plot/scales';
	import type { BandType, DigitalFilter } from '$lib/dsp/types';
	import { parseNumbers, parseSos, formatError } from '$lib/features/tf-analyzer/parse';
	import {
		SIGNALS,
		dbfs,
		drums,
		fadeEdges,
		impulseTrain,
		logChirp,
		normalizePeak,
		oddTaps,
		peakOf,
		playbackGain,
		pinkNoise,
		rmsOf,
		sawtooth,
		sine,
		square,
		transientIndex,
		twoTone,
		whiteNoise,
		windowed,
		type SignalType
	} from '$lib/features/signal-lab/signals';
	import { ABPlayer, decodeToMono } from '$lib/features/signal-lab/player';

	const DURATION = 3;
	const INPUT_PEAK = 0.5; // −6 dBFS
	const SAFE_PEAK = 0.5;

	// ---------------- state ----------------
	let fs = $state(48000);
	let sigType = $state<SignalType>('pink');
	let toneF = $state(220);
	let toneF2 = $state(5000);
	let rate = $state(4);

	type Source = 'design' | 'biquad' | 'fir' | 'paste';
	let source = $state<Source>('design');
	let family = $state<'butter' | 'cheby1' | 'cheby2' | 'ellip' | 'bessel'>('butter');
	let band = $state<BandType>('lowpass');
	let order = $state(4);
	let f1 = $state(1000);
	let f2 = $state(4000);
	let rp = $state(1);
	let rs = $state(60);
	let bqType = $state<BiquadType>('peaking');
	let bqF0 = $state(1000);
	let bqQ = $state(4);
	let bqGain = $state(12);
	let firTaps = $state(101);
	let firFc = $state(2000);
	let firWin = $state<'hann' | 'hamming' | 'blackman' | 'kaiser'>('hamming');
	let pasteKind = $state<'sos' | 'fir'>('sos');
	let pasteText = $state(
		'# 2nd-order Butterworth high-pass at 300 Hz (fs = 48 kHz)\n0.9726136, -1.9452273, 0.9726136, 1, -1.9444777, 0.9459768'
	);

	let winLen = $state<number>(20);
	let winStart = $state(0);
	let matchLoudness = $state(false);
	let volume = $state(0.5);
	let playing = $state<'none' | 'input' | 'output'>('none');

	// user audio
	let fileName = $state<string | null>(null);
	let fileBytes: ArrayBuffer | null = null;
	let fileAudio = $state.raw<{ data: Float32Array; fs: number; id: number } | null>(null);
	let fileError = $state<string | null>(null);
	let fileBusy = $state(false);
	let fileSeq = 0;

	const sigInfo = $derived(SIGNALS.find((s) => s.id === sigType)!);
	const nyq = $derived(fs / 2);
	const isBand = $derived(band === 'bandpass' || band === 'bandstop');
	const bqInfo = $derived(BIQUAD_TYPES.find((t) => t.id === bqType)!);
	// an even tap count is rounded up to the next odd one (type I linear phase)
	const firN = $derived(oddTaps(firTaps));

	// ---------------- filter ----------------
	let lastPasted: DigitalFilter | null = null;
	const filterResult = $derived.by(
		(): { filter: DigitalFilter | null; error: string | null; label: string } => {
			try {
				switch (source) {
					case 'design': {
						const lo = Math.min(f1, nyq * 0.95);
						const hi = Math.min(Math.max(f2, lo * 1.05), nyq * 0.98);
						const d = designDigital({ family, band, order, f1: lo, f2: hi, rp, rs, fs });
						const name = {
							butter: 'Butterworth',
							cheby1: 'Chebyshev I',
							cheby2: 'Chebyshev II',
							ellip: 'Elliptic',
							bessel: 'Bessel'
						}[family];
						const bname = {
							lowpass: 'low-pass',
							highpass: 'high-pass',
							bandpass: 'band-pass',
							bandstop: 'band-stop'
						}[band];
						return {
							filter: { kind: 'digital', fs, sos: d.sos },
							error: null,
							label: `${name} ${bname}, order ${isBand ? 2 * order : order}`
						};
					}
					case 'biquad':
						return {
							filter: {
								kind: 'digital',
								fs,
								sos: [
									biquad({
										type: bqType,
										f0: Math.min(bqF0, nyq * 0.98),
										fs,
										q: bqQ,
										gainDb: bqGain
									})
								]
							},
							error: null,
							label: `RBJ ${bqInfo.name}`
						};
					case 'fir': {
						const h = firwin(
							firN,
							[Math.min(firFc, nyq * 0.98)],
							{ type: firWin, param: firWin === 'kaiser' ? 8 : undefined },
							true,
							fs
						);
						return {
							filter: { kind: 'digital', fs, fir: h },
							error: null,
							label: `${firN}-tap FIR low-pass`
						};
					}
					case 'paste': {
						if (pasteKind === 'sos') {
							const r = parseSos(pasteText);
							if (!r.ok) throw new Error(formatError(r.error));
							r.value.forEach((row, i) => {
								if (row[3] === 0) throw new Error(`Section ${i + 1}: a₀ must be non-zero.`);
							});
							lastPasted = { kind: 'digital', fs, sos: r.value };
						} else {
							const r = parseNumbers(pasteText, 'FIR taps');
							if (!r.ok) throw new Error(formatError(r.error));
							if (r.value.length > 4096) throw new Error('At most 4096 taps, please.');
							lastPasted = { kind: 'digital', fs, fir: r.value };
						}
						return {
							filter: lastPasted,
							error: null,
							label: pasteKind === 'sos' ? 'Pasted SOS' : 'Pasted FIR'
						};
					}
				}
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				return {
					filter: source === 'paste' && lastPasted ? { ...lastPasted, fs } : null,
					error: msg,
					label: 'Last valid filter'
				};
			}
		}
	);
	const filter = $derived(filterResult.filter);
	const unstable = $derived(
		filter && !filter.fir ? !isStable(digitalZpk(filter), 'digital') : false
	);

	// ---------------- signal generation + processing (debounced) ----------------
	interface Processed {
		x: Float64Array;
		y: Float64Array;
		fs: number;
		blewUp: boolean;
	}
	let processed = $state.raw<Processed | null>(null);
	let busy = $state(false);
	let inputCache: { key: string; x: Float64Array } | null = null;

	const sigSpec = $derived({
		type: sigType,
		toneF,
		toneF2,
		rate,
		fs,
		file: sigType === 'file' ? fileAudio : null
	});

	function generate(spec: typeof sigSpec): Float64Array {
		const n = Math.round(DURATION * spec.fs);
		let x: Float64Array;
		switch (spec.type) {
			case 'white':
				x = whiteNoise(n);
				break;
			case 'pink':
				x = pinkNoise(n);
				break;
			case 'sine':
				x = sine(n, spec.fs, spec.toneF);
				break;
			case 'square':
				x = square(n, spec.fs, spec.toneF);
				break;
			case 'saw':
				x = sawtooth(n, spec.fs, spec.toneF);
				break;
			case 'chirp':
				x = logChirp(n, spec.fs, 20, Math.min(20000, spec.fs * 0.45));
				break;
			case 'impulses':
				return normalizePeak(impulseTrain(n, spec.fs, spec.rate), INPUT_PEAK);
			case 'twotone':
				x = twoTone(n, spec.fs, spec.toneF, spec.toneF2);
				break;
			case 'drums':
				return normalizePeak(drums(n, spec.fs), INPUT_PEAK);
			case 'file':
				if (!spec.file) return new Float64Array(n);
				return normalizePeak(Float64Array.from(spec.file.data), INPUT_PEAK);
		}
		return normalizePeak(fadeEdges(x, Math.round(0.005 * spec.fs)), INPUT_PEAK);
	}

	$effect(() => {
		const spec = sigSpec;
		const f = filter;
		busy = true;
		const delay = untrack(() => processed) ? 150 : 0;
		const timer = setTimeout(() => {
			const key = JSON.stringify({ ...spec, file: spec.file?.id ?? null });
			if (!inputCache || inputCache.key !== key) inputCache = { key, x: generate(spec) };
			const x = inputCache.x;
			let y: Float64Array = f ? applyDigital(f, x) : Float64Array.from(x);
			const p = peakOf(y);
			const blewUp = !Number.isFinite(p) || p > 1e4;
			if (blewUp) y = y.map((v) => (Number.isFinite(v) ? Math.max(-1e4, Math.min(1e4, v)) : 0));
			processed = { x, y, fs: spec.fs, blewUp };
			busy = false;
		}, delay);
		return () => clearTimeout(timer);
	});

	// ---------------- levels ----------------
	// An unstable filter is never auditioned, even while its output is still small within
	// the loop; an output that did blow up (or overflow) cannot be played either.
	const muted = $derived(unstable || !!processed?.blewUp);

	const levels = $derived.by(() => {
		if (!processed) return null;
		const pin = peakOf(processed.x);
		const pout = peakOf(processed.y);
		const rin = rmsOf(processed.x);
		const rout = rmsOf(processed.y);
		const match = matchLoudness && rout > 1e-9 && !muted ? rin / rout : 1;
		// a muted output is not played, so it must not turn the input down
		const g = playbackGain(pin, pout, match, muted, SAFE_PEAK);
		return { pin, pout, rin, rout, match, g };
	});

	const stats = $derived.by((): Stat[] => {
		if (!levels || !processed) return [];
		const { pin, pout, rin, rout, g, match } = levels;
		const out: Stat[] = [
			{ label: 'Input RMS', value: `${trimNumber(dbfs(rin), 3)} dBFS` },
			{
				label: 'Input peak',
				value: `${trimNumber(dbfs(pin), 3)} dBFS`,
				hint: `Crest factor ${trimNumber(dbfs(pin) - dbfs(rin), 3)} dB`
			},
			{ label: 'Output RMS', value: processed.blewUp ? '∞' : `${trimNumber(dbfs(rout), 3)} dBFS` },
			{
				label: 'Output peak',
				value: processed.blewUp ? '∞' : `${trimNumber(dbfs(pout), 3)} dBFS`,
				status: processed.blewUp || pout > 1 ? 'critical' : undefined,
				hint:
					pout > 1
						? 'Above 0 dBFS: this would clip in a real fixed-point system'
						: `Crest factor ${trimNumber(dbfs(pout) - dbfs(rout), 3)} dB`
			},
			{
				label: 'Level change (RMS)',
				value: processed.blewUp
					? '—'
					: `${dbfs(rout) - dbfs(rin) >= 0 ? '+' : ''}${trimNumber(dbfs(rout) - dbfs(rin), 3)} dB`
			},
			{
				label: 'Playback gain',
				value: g < 1 ? `${trimNumber(dbfs(g), 3)} dB` : '0 dB',
				status: g < 1 ? 'warning' : 'good',
				hint: muted
					? 'Output muted: only the input is played, and it needs no limiting'
					: g < 1
						? 'Both signals are turned down by the same amount so that no peak exceeds −6 dBFS'
						: 'No limiting needed: every peak is at or below −6 dBFS'
			}
		];
		if (matchLoudness)
			out.push({
				label: 'Loudness match',
				value: `${match >= 1 ? '+' : ''}${trimNumber(dbfs(match), 3)} dB on output`
			});
		return out;
	});

	// ---------------- audio ----------------
	const player = new ABPlayer();
	const audioOk = typeof window === 'undefined' ? true : ABPlayer.supported();

	function buffers(): { a: Float32Array; b: Float32Array } | null {
		if (!processed || !levels) return null;
		const gA = levels.g;
		const gB = levels.g * levels.match;
		const a = new Float32Array(processed.x.length);
		const b = new Float32Array(processed.y.length);
		for (let i = 0; i < a.length; i++) a[i] = processed.x[i] * gA;
		for (let i = 0; i < b.length; i++)
			b[i] = muted ? 0 : Math.max(-1, Math.min(1, processed.y[i] * gB));
		return { a, b };
	}

	function start(which: 'input' | 'output', keepPosition = false) {
		const buf = buffers();
		if (!buf || !processed) return;
		player.setVolume(volume);
		player.play(buf.a, buf.b, processed.fs, which === 'input' ? 'A' : 'B', keepPosition);
		playing = which;
	}

	function abToggle() {
		if (playing === 'none' || muted) return;
		const next = playing === 'input' ? 'output' : 'input';
		player.setChannel(next === 'input' ? 'A' : 'B');
		playing = next;
	}

	function stop() {
		player.stop();
		playing = 'none';
	}

	// rebuild the buffers when the processed audio changes while playing
	$effect(() => {
		void processed;
		void levels;
		untrack(() => {
			if (playing !== 'none') start(playing, true);
		});
	});

	$effect(() => {
		player.setVolume(volume);
	});

	onDestroy(() => player.dispose());

	function onKey(e: KeyboardEvent) {
		const tgt = e.target as HTMLElement;
		if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT'))
			return;
		if (e.key === 'b' || e.key === 'B') abToggle();
	}

	// ---------------- file ----------------
	async function decodeFile(bytes: ArrayBuffer, rate: number) {
		const seq = ++fileSeq;
		fileBusy = true;
		fileError = null;
		try {
			const data = await decodeToMono(bytes, rate, 10);
			if (seq !== fileSeq) return;
			fileAudio = { data, fs: rate, id: seq };
		} catch (e) {
			if (seq !== fileSeq) return;
			fileError = `Could not decode this file (${e instanceof Error ? e.message : String(e)}). Try WAV, MP3, OGG or M4A.`;
			fileAudio = null;
		} finally {
			if (seq === fileSeq) fileBusy = false;
		}
	}

	async function onFile(e: Event) {
		const input = e.target as HTMLInputElement;
		const f = input.files?.[0];
		if (!f) return;
		fileName = f.name;
		fileBytes = await f.arrayBuffer();
		sigType = 'file';
		await decodeFile(fileBytes, fs);
	}

	// re-decode at a new sample rate
	$effect(() => {
		const rate = fs;
		const fa = untrack(() => fileAudio);
		if (fileBytes && fa && fa.fs !== rate) void decodeFile(fileBytes, rate);
	});

	// ---------------- displays ----------------
	const nSamples = $derived(processed ? processed.x.length : Math.round(DURATION * fs));
	const totalMs = $derived((nSamples / fs) * 1000);
	const lenMs = $derived(winLen <= 0 ? totalMs : Math.min(winLen, totalMs));
	const startMs = $derived(Math.max(0, Math.min(winStart, totalMs - lenMs)));

	function jumpToTransient() {
		if (!processed) return;
		const i = transientIndex(processed.x, processed.fs);
		winStart = Math.max(0, (i / processed.fs) * 1000 - lenMs * 0.2);
	}

	const waveSeries = $derived.by((): Series[] => {
		if (!processed) return [];
		const s0 = (startMs / 1000) * processed.fs;
		const len = (lenMs / 1000) * processed.fs;
		const a = windowed(processed.x, s0, len, processed.fs);
		const b = windowed(processed.y, s0, len, processed.fs);
		const fmt = (v: number) => trimNumber(v, 4);
		return [
			{ x: a.t, y: a.y, label: 'Input', color: 'var(--s1)', format: fmt },
			{ x: b.t, y: b.y, label: 'Output', color: 'var(--s2)', format: fmt }
		];
	});

	const spectra = $derived.by(() => {
		const pr = processed;
		if (!pr) return null;
		const seg = 4096;
		const pi = welchPsd(pr.x, seg);
		const po = welchPsd(pr.y, seg);
		const f = pi.f.map((v) => v * pr.fs);
		return { f: f.slice(1), pin: pi.psdDb.slice(1), pout: po.psdDb.slice(1) };
	});
	const hOverlay = $derived.by(() => {
		if (!spectra || !filter) return null;
		const r = evaluate(filter, spectra.f);
		const top = Math.max(...spectra.pin.filter((v, i) => Number.isFinite(v) && spectra.f[i] >= 20));
		return { y: r.magDb.map((v) => v + top), offset: top };
	});
	const specSeries = $derived.by((): Series[] => {
		if (!spectra) return [];
		const fmt = (v: number) => `${trimNumber(v, 4)} dB`;
		const s: Series[] = [
			{ x: spectra.f, y: spectra.pin, label: 'Input', color: 'var(--s1)', format: fmt },
			{ x: spectra.f, y: spectra.pout, label: 'Output', color: 'var(--s2)', format: fmt }
		];
		if (hOverlay)
			s.push({
				x: spectra.f,
				y: hOverlay.y,
				label: '|H(f)|, shifted',
				color: 'var(--s3)',
				dash: '6 4',
				format: (v) => `${trimNumber(v - hOverlay!.offset, 4)} dB (|H|)`
			});
		return s;
	});
	const specDomain = $derived.by((): [number, number] => {
		if (!spectra) return [-100, 0];
		const top = Math.max(
			...spectra.pin.filter(Number.isFinite),
			...spectra.pout.filter(Number.isFinite)
		);
		const t = Math.ceil((top + 6) / 10) * 10;
		return [t - 110, t];
	});

	const signalOptions = SIGNALS.map((s) => ({ value: s.id, label: s.name }));
	const familyOptions = [
		{ value: 'butter' as const, label: 'Butterworth' },
		{ value: 'cheby1' as const, label: 'Chebyshev I' },
		{ value: 'cheby2' as const, label: 'Chebyshev II' },
		{ value: 'ellip' as const, label: 'Elliptic' },
		{ value: 'bessel' as const, label: 'Bessel' }
	];
	const typeOptions = BIQUAD_TYPES.map((t) => ({
		value: t.id,
		label: t.name,
		group: t.firstOrder ? 'First order' : 'Second order'
	}));
	const hzTip = (v: number) => formatSI(v, 'Hz', 4);
	const msFmt = (v: number) => `${trimNumber(v, 4)} ms`;
</script>

<svelte:window onkeydown={onKey} />

<ToolLayout
	slug="signal-lab"
	related={['biquad', 'iir-designer', 'fir-designer', 'parametric-eq', 'windows']}
>
	{#snippet controls()}
		<ControlGroup title="Test signal">
			<Select label="Signal" bind:value={sigType} options={signalOptions} />
			<p class="small muted desc">{sigInfo.description}</p>
			{#if sigInfo.freq === 'tone'}
				<Slider
					label={sigType === 'twotone' ? 'Low tone' : 'Frequency'}
					bind:value={toneF}
					min={sigType === 'saw' || sigType === 'square' ? 55 : 20}
					max={sigType === 'twotone' ? 2000 : 5000}
					log
					unit="Hz"
				/>
				{#if sigType === 'twotone'}
					<Slider
						label="High tone"
						bind:value={toneF2}
						min={1000}
						max={Math.min(20000, nyq * 0.95)}
						log
						unit="Hz"
					/>
				{/if}
			{:else if sigInfo.freq === 'rate'}
				<Slider label="Clicks per second" bind:value={rate} min={1} max={100} log unit="Hz" />
			{/if}
			{#if sigType === 'file'}
				<label class="file">
					<span>Audio file</span>
					<input type="file" accept="audio/*" onchange={onFile} />
				</label>
				{#if fileBusy}<p class="small muted">Decoding…</p>{/if}
				{#if fileName && fileAudio}<p class="small muted">
						{fileName}: {trimNumber(fileAudio.data.length / fileAudio.fs, 3)} s (first 10 s at most),
						mono.
					</p>{/if}
				{#if fileError}<p class="small err" role="alert">✕ {fileError}</p>{/if}
			{/if}
			<Segmented
				label="Sample rate"
				bind:value={fs}
				options={[
					{ value: 44100, label: '44.1 kHz' },
					{ value: 48000, label: '48 kHz' }
				]}
			/>
		</ControlGroup>

		<ControlGroup title="Filter">
			<Segmented
				size="small"
				bind:value={source}
				options={[
					{ value: 'design', label: 'IIR design' },
					{ value: 'biquad', label: 'Biquad' },
					{ value: 'fir', label: 'FIR' },
					{ value: 'paste', label: 'Paste' }
				]}
			/>
			{#if source === 'design'}
				<Select label="Family" bind:value={family} options={familyOptions} />
				<Segmented
					label="Response type"
					bind:value={band}
					options={[
						{ value: 'lowpass', label: 'LP' },
						{ value: 'highpass', label: 'HP' },
						{ value: 'bandpass', label: 'BP' },
						{ value: 'bandstop', label: 'BS' }
					]}
				/>
				<Slider label="Order" bind:value={order} min={1} max={isBand ? 6 : 12} integer />
				<Slider
					label={isBand ? 'Lower edge f₁' : 'Cutoff fc'}
					bind:value={f1}
					min={20}
					max={nyq * 0.95}
					log
					unit="Hz"
				/>
				{#if isBand}<Slider
						label="Upper edge f₂"
						bind:value={f2}
						min={20}
						max={nyq * 0.98}
						log
						unit="Hz"
					/>{/if}
				{#if family === 'cheby1' || family === 'ellip'}<Slider
						label="Passband ripple"
						bind:value={rp}
						min={0.1}
						max={6}
						log
						unit="dB"
					/>{/if}
				{#if family === 'cheby2' || family === 'ellip'}<Slider
						label="Stopband attenuation"
						bind:value={rs}
						min={20}
						max={100}
						step={1}
						unit="dB"
					/>{/if}
			{:else if source === 'biquad'}
				<Select label="Type" bind:value={bqType} options={typeOptions} />
				<Slider label="Frequency f₀" bind:value={bqF0} min={20} max={nyq * 0.95} log unit="Hz" />
				{#if bqInfo.usesQ}<Slider label="Q" bind:value={bqQ} min={0.1} max={50} log />{/if}
				{#if bqInfo.usesGain}<Slider
						label="Gain"
						bind:value={bqGain}
						min={-24}
						max={24}
						step={0.5}
						unit="dB"
					/>{/if}
			{:else if source === 'fir'}
				<Slider label="Taps" bind:value={firTaps} min={11} max={501} integer />
				<Slider label="Cutoff" bind:value={firFc} min={20} max={nyq * 0.95} log unit="Hz" />
				<Select
					label="Window"
					bind:value={firWin}
					options={[
						{ value: 'hann', label: 'Hann' },
						{ value: 'hamming', label: 'Hamming' },
						{ value: 'blackman', label: 'Blackman' },
						{ value: 'kaiser', label: 'Kaiser (β = 8)' }
					]}
				/>
				<p class="small muted desc">
					{#if firN !== firTaps}Using {firN} taps (rounded up to odd, type I).{' '}{/if}Linear
					phase: a delay of {trimNumber((firN - 1) / 2, 4)} samples = {formatSI(
						(firN - 1) / 2 / fs,
						's',
						3
					)}.
				</p>
			{:else}
				<Segmented
					size="small"
					bind:value={pasteKind}
					options={[
						{ value: 'sos', label: 'SOS rows' },
						{ value: 'fir', label: 'FIR taps' }
					]}
				/>
				<label class="paste">
					<span
						>{pasteKind === 'sos'
							? 'Sections: b0 b1 b2 a0 a1 a2 per row'
							: 'Taps h[0], h[1], …'}</span
					>
					<textarea rows="6" spellcheck="false" bind:value={pasteText}></textarea>
				</label>
				<p class="small muted desc">
					Coefficients are used at the sample rate above. Brackets, commas, <span class="mono"
						>np.array</span
					> and comments are fine.
				</p>
			{/if}
		</ControlGroup>
	{/snippet}

	{#if filterResult.error}
		<Callout kind="danger" title="Filter problem">
			{filterResult.error}
			{#if filter}<br />Using the last valid filter.{/if}
		</Callout>
	{/if}
	{#if unstable}
		<Callout kind="danger" title="Unstable filter"
			>This filter has poles on or outside the unit circle; its output can grow without bound.
			Output playback is muted.</Callout
		>
	{/if}

	<Card
		title="Listen"
		subtitle={filter
			? `${filterResult.label} · ${sigInfo.name} · ${trimNumber(nSamples / fs, 3)} s loop`
			: 'No filter'}
	>
		{#if !audioOk}
			<Callout kind="warning"
				>This browser does not support the Web Audio API, so playback is unavailable. The plots
				still work.</Callout
			>
		{/if}
		<div class="transport">
			<button
				class="btn"
				class:primary={playing === 'input'}
				type="button"
				onclick={() => start('input')}
				disabled={!processed || !audioOk}
				aria-pressed={playing === 'input'}>▶ Input</button
			>
			<button
				class="btn"
				class:primary={playing === 'output'}
				type="button"
				onclick={() => start('output')}
				disabled={!processed || !audioOk || muted}
				aria-pressed={playing === 'output'}>▶ Output</button
			>
			<button
				class="btn"
				type="button"
				onclick={abToggle}
				disabled={playing === 'none' || muted}
				title="Switch between input and output without stopping (key B)">⇄ A / B</button
			>
			<button class="btn" type="button" onclick={stop} disabled={playing === 'none'}>■ Stop</button>
			<span class="now-playing" aria-live="polite">
				{#if busy}Processing…{:else if playing === 'none'}Stopped{:else}Playing: <strong
						>{playing === 'input' ? 'A — input' : 'B — output'}</strong
					>{/if}
			</span>
		</div>
		<div class="audio-opts">
			<div class="vol">
				<Slider label="Volume" bind:value={volume} min={0} max={1} step={0.01} />
			</div>
			<Toggle
				label="Match loudness (RMS) of output to input"
				bind:checked={matchLoudness}
				help="Removes the ‘louder sounds better’ bias when comparing"
			/>
		</div>
		<p class="small muted">
			Start quietly — headphones recommended. Both signals are limited to −6 dBFS peak by one common
			gain, so the A/B level difference is real (unless loudness matching is on). Press <kbd>B</kbd> to
			switch while playing.
		</p>
	</Card>

	{#if stats.length}<StatGrid {stats} />{/if}

	<Card
		title="Waveforms"
		subtitle="Input and output on the same scale. Long windows are drawn as a min/max envelope."
	>
		{#snippet actions()}
			<Segmented
				size="small"
				bind:value={winLen}
				options={[
					{ value: 5, label: '5 ms' },
					{ value: 20, label: '20 ms' },
					{ value: 100, label: '100 ms' },
					{ value: 1000, label: '1 s' },
					{ value: 0, label: 'All' }
				]}
			/>
		{/snippet}
		<div class="win-ctl">
			<div class="start">
				<Slider
					label="Window start"
					bind:value={winStart}
					min={0}
					max={Math.max(1, totalMs - lenMs)}
					step={0.1}
					unit="ms"
				/>
			</div>
			<button class="btn small" type="button" onclick={jumpToTransient} disabled={!processed}
				>Jump to transient</button
			>
		</div>
		<Plot
			series={waveSeries}
			xLabel="Time (ms)"
			yLabel="Amplitude (full scale = 1)"
			xTooltipFormat={msFmt}
			height={280}
			exportName="waveforms"
		/>
	</Card>

	<Card
		title="Spectra"
		subtitle="Welch power spectral density (Hann, 4096-point segments, 50 % overlap). In dB, filtering is a subtraction: output = input + 20·log₁₀|H|."
	>
		<Plot
			series={specSeries}
			xScale="log"
			xDomain={[20, nyq]}
			yDomain={specDomain}
			xLabel="Frequency (Hz)"
			yLabel="Power (dB, relative)"
			xFormat={freqFormat}
			xTooltipFormat={hzTip}
			height={320}
			exportName="spectra"
		/>
		{#if hOverlay}<p class="small muted">
				The dashed curve is the filter’s |H(f)| shifted up by {trimNumber(hOverlay.offset, 3)} dB so that
				0 dB sits at the top of the input spectrum.
			</p>{/if}
	</Card>

	{#snippet theory()}
		<h2>What a filter does to a signal</h2>
		<p>
			A linear filter multiplies every frequency component of its input by <Tex
				math={'H(e^{j\\omega})'}
			/>: the magnitude scales it, the phase delays it. In power terms <Tex
				math={'S_y(f)=|H(f)|^2\\,S_x(f)'}
			/>, which in decibels is a simple sum: the gap between the input and output spectra above
			traces the dashed |H| curve. The audible result depends on what the signal is made of.
		</p>
		<h3>Periodic waveforms and their harmonics</h3>
		<p>
			A square and a sawtooth wave of fundamental <Tex math="f_0" /> are sums of harmonics with amplitudes
			falling as 1/k:
		</p>
		<Tex
			display
			math={'x_{\\text{sq}}(t)=\\frac{4}{\\pi}\\sum_{k\\ \\text{odd}}\\frac{\\sin(2\\pi k f_0 t)}{k},\\qquad x_{\\text{saw}}(t)=\\frac{2}{\\pi}\\sum_{k\\ge1}\\frac{(-1)^{k+1}\\sin(2\\pi k f_0 t)}{k}'}
		/>
		<p>
			A low-pass removes the upper harmonics: the edges round off and, once only the fundamental
			remains, the wave becomes a sine. A steep low-pass also leaves ringing at the edges (the Gibbs
			phenomenon). A high-pass removes the fundamental and the flat tops of the square wave sag. The
			test waves here are <em>band-limited</em> (only harmonics below fs/2 are generated); a naive square
			wave would alias.
		</p>
		<h3>White and pink noise</h3>
		<p>
			White noise has a flat power spectral density, <Tex math={'S(f)=N_0'} />: every hertz carries
			the same power, so each octave carries twice the power of the one below and the noise sounds
			bright. Pink noise has <Tex math={'S(f)\\propto 1/f'} />, a tilt of −3 dB per octave, so every
			octave carries the same power:
		</p>
		<Tex display math={'P_{[f,2f]}=\\int_f^{2f}\\frac{c}{\\nu}\\,d\\nu=c\\ln 2'} />
		<p>
			Because hearing analyses sound in roughly constant-percentage bands, pink noise sounds evenly
			balanced, which makes it the standard test signal for loudspeakers and equalisers.
		</p>
		<h3>Transients and smearing</h3>
		<p>
			A short event has a broad spectrum; removing part of that spectrum spreads the event out in
			time. A narrow band-pass or a high-Q resonance rings for roughly <Tex math={'Q/(\\pi f_0)'} /> seconds
			(the time constant of its poles), and a steep IIR low-pass rings after every transient. A linear-phase
			FIR rings symmetrically — <em>before</em> the transient as well as after (pre-ringing) — and delays
			everything by half its length. Use the drum pattern and “Jump to transient” to compare.
		</p>
		<h3>Decibels and loudness</h3>
		<p>
			Levels here are in dBFS: <Tex math={'20\\log_{10}(\\text{amplitude})'} /> relative to full scale
			(1.0). The <strong>peak</strong> level decides whether a signal clips; the
			<strong>RMS</strong>
			level tracks its power and correlates better with loudness. Their difference is the crest factor:
			3 dB for a sine, about 12–14 dB for Gaussian noise, and much more for clicks. Perceived loudness
			is not simply RMS: hearing is much less sensitive at low and very high frequencies (equal-loudness
			contours), and roughly +10 dB is perceived as twice as loud. Because a louder version of a sound
			almost always seems “better”, compare filters with
			<em>Match loudness</em> switched on.
		</p>
		<Callout kind="try">
			<ul>
				<li>
					Pink noise through a 4th-order Butterworth low-pass at 1 kHz, then switch the response
					type to high-pass. Press <kbd>B</kbd> repeatedly while playing.
				</li>
				<li>
					A 220 Hz square wave through a low-pass at 500 Hz: only the fundamental survives and it
					sounds like a sine. Look at the 20 ms waveform.
				</li>
				<li>
					The impulse train through a peaking biquad with Q = 30 and +20 dB: every click rings at
					f₀. Halve the Q and the ringing halves.
				</li>
				<li>
					Drums through a 501-tap FIR low-pass at 300 Hz versus an 8th-order elliptic low-pass at
					300 Hz: jump to the transient and compare pre-ringing (FIR) with post-ringing (IIR).
				</li>
				<li>
					Raise a peaking EQ to +12 dB and turn <em>Match loudness</em> on and off: how much of the “improvement”
					was just level?
				</li>
			</ul>
		</Callout>
	{/snippet}
</ToolLayout>

<style>
	.desc {
		margin: -0.1rem 0 0;
	}
	.err {
		color: var(--critical-ink);
		margin: 0;
	}
	.file,
	.paste {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.82rem;
		color: var(--text-2);
		font-weight: 550;
	}
	.file input {
		font-size: 0.82rem;
		font-weight: 400;
		max-width: 100%;
	}
	textarea {
		width: 100%;
		font-family: var(--font-mono);
		font-size: 0.8rem;
		font-weight: 400;
		padding: 0.35rem 0.5rem;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		resize: vertical;
	}
	.transport {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}
	.now-playing {
		font-size: 0.88rem;
		color: var(--text-2);
		margin-left: 0.3rem;
	}
	.audio-opts {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
		gap: 0.6rem 1.2rem;
		align-items: center;
		margin: 0.8rem 0 0.4rem;
	}
	.win-ctl {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 0.6rem 1rem;
		margin-bottom: 0.4rem;
	}
	.start {
		flex: 1 1 220px;
		max-width: 420px;
	}
</style>
