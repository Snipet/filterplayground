<script lang="ts">
	import { formatSI, parseSI, trimNumber } from '$lib/dsp/units';

	interface Props {
		value: number;
		label: string;
		min: number;
		max: number;
		step?: number;
		/** Logarithmic slider travel (min must be > 0). */
		log?: boolean;
		unit?: string;
		si?: boolean;
		digits?: number;
		integer?: boolean;
		disabled?: boolean;
		help?: string;
		/** Allow typed values outside [min, max] (the slider still clamps). */
		allowOutOfRange?: boolean;
		inputMin?: number;
		inputMax?: number;
		onchange?: (v: number) => void;
	}

	let {
		value = $bindable(),
		label,
		min,
		max,
		step,
		log = false,
		unit = '',
		si = false,
		digits = 4,
		integer = false,
		disabled = false,
		help,
		allowOutOfRange = false,
		inputMin,
		inputMax,
		onchange
	}: Props = $props();

	const id = `sl-${Math.random().toString(36).slice(2, 9)}`;
	const RES = 1000;

	const pos = $derived.by(() => {
		if (log) {
			const v = Math.min(max, Math.max(min, value));
			return (Math.log(v / min) / Math.log(max / min)) * RES;
		}
		return value;
	});

	function fromPos(p: number) {
		if (log) {
			let v = min * Math.pow(max / min, p / RES);
			// round to 3 significant digits for tidy values
			v = Number(v.toPrecision(3));
			return integer ? Math.round(v) : v;
		}
		return integer ? Math.round(p) : p;
	}

	function onInput(e: Event) {
		value = fromPos(Number((e.target as HTMLInputElement).value));
		onchange?.(value);
	}

	const fmt = (v: number) => (si ? formatSI(v, unit, digits) : trimNumber(v, digits));
	// announced by assistive tech instead of the range input's raw (log: 0…RES) position
	const valueText = $derived(fmt(value) + (unit && !si ? ` ${unit}` : ''));
	let text = $state('');
	let editing = $state(false);
	$effect(() => {
		if (!editing) text = fmt(value);
	});

	// Removing a focused field (its block switching away) fires blur synchronously, before any
	// teardown: committing then would write the stale text into whatever replaced it. So the
	// blur commit waits a microtask (still ahead of the click that caused the blur) and is
	// dropped once the field is gone.
	let alive = true;
	$effect(() => () => {
		alive = false;
	});
	const commitOnBlur = () =>
		queueMicrotask(() => {
			if (alive) commit();
		});

	function commit() {
		// untouched text is the rounded display: keep the exact value instead of rounding it
		if (text === fmt(value)) {
			editing = false;
			return;
		}
		const v = parseSI(text, unit);
		if (Number.isFinite(v)) {
			const lo = allowOutOfRange ? (inputMin ?? -Infinity) : min;
			const hi = allowOutOfRange ? (inputMax ?? Infinity) : max;
			let nv = Math.min(hi, Math.max(lo, v));
			if (integer) nv = Math.round(nv);
			value = nv;
			onchange?.(value);
		}
		editing = false;
		text = fmt(value);
	}
</script>

<div class="slider" class:disabled>
	<div class="top">
		<label for={id}>{label}</label>
		<span class="valbox">
			<input
				class="val"
				type="text"
				inputmode="decimal"
				aria-label="{label} value"
				bind:value={text}
				{disabled}
				onfocus={(e) => {
					editing = true;
					(e.target as HTMLInputElement).select();
				}}
				onblur={commitOnBlur}
				onkeydown={(e) => {
					if (e.key === 'Enter') commit();
					if (e.key === 'Escape') {
						editing = false;
						text = fmt(value);
					}
				}}
			/>{#if unit && !si}<span class="unit">{unit}</span>{/if}
		</span>
	</div>
	<input
		{id}
		type="range"
		min={log ? 0 : min}
		max={log ? RES : max}
		step={log ? 1 : (step ?? (integer ? 1 : (max - min) / 500))}
		value={pos}
		aria-valuetext={valueText}
		{disabled}
		oninput={onInput}
	/>
	{#if help}<div class="help">{help}</div>{/if}
</div>

<style>
	.slider {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
	}
	.top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}
	label {
		font-size: 0.82rem;
		color: var(--text-2);
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.valbox {
		display: inline-flex;
		align-items: baseline;
		gap: 0.15rem;
	}
	.val {
		width: 6.2em;
		text-align: right;
		border: 1px solid transparent;
		border-radius: 4px;
		background: transparent;
		padding: 0 0.25rem;
		font-size: 0.86rem;
		font-variant-numeric: tabular-nums;
		color: var(--text);
	}
	.val:hover {
		border-color: var(--border);
	}
	.val:focus {
		outline: none;
		border-color: var(--focus);
		background: var(--surface);
	}
	.unit {
		font-size: 0.8rem;
		color: var(--muted);
	}
	input[type='range'] {
		width: 100%;
		accent-color: var(--accent);
		margin: 0.15rem 0 0;
	}
	.help {
		font-size: 0.76rem;
		color: var(--muted);
	}
	.disabled {
		opacity: 0.55;
	}
</style>
