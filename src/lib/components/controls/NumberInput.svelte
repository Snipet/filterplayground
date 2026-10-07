<script lang="ts">
	import { formatSI, parseSI, trimNumber } from '$lib/dsp/units';

	interface Props {
		value: number;
		label?: string;
		unit?: string;
		min?: number;
		max?: number;
		/** Increment for arrow keys; with `logStep` the value is multiplied instead. */
		step?: number;
		logStep?: number;
		digits?: number;
		/** Display with SI prefixes (k, M, µ…). */
		si?: boolean;
		integer?: boolean;
		disabled?: boolean;
		id?: string;
		help?: string;
		onchange?: (v: number) => void;
	}

	let {
		value = $bindable(),
		label,
		unit = '',
		min = -Infinity,
		max = Infinity,
		step = 1,
		logStep,
		digits = 5,
		si = false,
		integer = false,
		disabled = false,
		id,
		help,
		onchange
	}: Props = $props();

	const fallbackId = `num-${Math.random().toString(36).slice(2, 9)}`;
	const inputId = $derived(id ?? fallbackId);
	const fmt = (v: number) => (si ? formatSI(v, unit, digits) : trimNumber(v, digits));
	let text = $state('');
	let editing = $state(false);
	let invalid = $state(false);

	$effect(() => {
		if (!editing) text = fmt(value);
	});

	function clamp(v: number) {
		let out = Math.min(max, Math.max(min, v));
		if (integer) out = Math.round(out);
		return out;
	}

	function commit() {
		const v = parseSI(text);
		if (Number.isFinite(v)) {
			invalid = false;
			value = clamp(v);
			onchange?.(value);
		} else {
			invalid = true;
		}
		editing = false;
		text = fmt(value);
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			commit();
			(e.target as HTMLInputElement).select();
		} else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
			e.preventDefault();
			const dir = e.key === 'ArrowUp' ? 1 : -1;
			const mult = e.shiftKey ? 10 : 1;
			let v = Number.isFinite(parseSI(text)) ? parseSI(text) : value;
			if (logStep) v = v * Math.pow(logStep, dir * mult);
			else v = v + dir * step * mult;
			value = clamp(Number(v.toPrecision(12)));
			onchange?.(value);
			editing = false;
			text = fmt(value);
		} else if (e.key === 'Escape') {
			editing = false;
			text = fmt(value);
		}
	}
</script>

<div class="num" class:disabled>
	{#if label}<label for={inputId}>{label}</label>{/if}
	<div class="box" class:invalid>
		<input
			id={inputId}
			type="text"
			inputmode="decimal"
			autocomplete="off"
			spellcheck="false"
			bind:value={text}
			{disabled}
			onfocus={(e) => {
				editing = true;
				(e.target as HTMLInputElement).select();
			}}
			onblur={commit}
			onkeydown={onKey}
			aria-describedby={help ? `${inputId}-help` : undefined}
		/>
		{#if unit && !si}<span class="unit">{unit}</span>{/if}
	</div>
	{#if help}<div class="help" id="{inputId}-help">{help}</div>{/if}
</div>

<style>
	.num {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		min-width: 0;
	}
	label {
		font-size: 0.82rem;
		color: var(--text-2);
		font-weight: 500;
	}
	.box {
		display: flex;
		align-items: center;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		padding: 0 0.5rem;
		min-width: 0;
	}
	.box:focus-within {
		border-color: var(--focus);
		box-shadow: 0 0 0 3px var(--accent-wash);
	}
	.box.invalid {
		border-color: var(--critical);
	}
	input {
		border: none;
		background: transparent;
		outline: none;
		padding: 0.32rem 0;
		width: 100%;
		min-width: 0;
		font-variant-numeric: tabular-nums;
	}
	.unit {
		color: var(--muted);
		font-size: 0.85rem;
		padding-left: 0.3rem;
		white-space: nowrap;
	}
	.help {
		font-size: 0.76rem;
		color: var(--muted);
	}
	.disabled {
		opacity: 0.55;
	}
</style>
