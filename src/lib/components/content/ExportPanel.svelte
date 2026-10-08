<script lang="ts">
	import CodeBlock from './CodeBlock.svelte';
	import Callout from './Callout.svelte';
	import * as ex from '$lib/export';
	import type { SOS, TF, ZPK } from '$lib/dsp/types';
	import { zpk2sosAnalog } from '$lib/dsp/convert';

	export interface Recipe {
		label: string;
		code: string;
		language?: string;
	}

	interface Props {
		kind: 'analog' | 'digital';
		sos?: SOS;
		tf?: TF;
		zpk?: ZPK;
		fir?: number[];
		fs?: number;
		/** Extra tabs shown first (e.g. the SciPy call that designs this filter). */
		recipes?: Recipe[];
		name?: string;
	}

	let { kind, sos, tf, zpk, fir, fs = 48000, recipes = [], name = 'filter' }: Props = $props();
	let ctype = $state<ex.CType>('float');
	let fixedBits = $state(16);
	// The number field binds null while empty and accepts out-of-range typing: use a clamped copy.
	const qBits = $derived(ex.clampFixedBits(fixedBits));

	const tabs = $derived.by(() => {
		const t: { id: string; label: string; code: string; language: string; filename?: string }[] =
			[];
		for (const r of recipes)
			t.push({
				id: `r-${r.label}`,
				label: r.label,
				code: r.code,
				language: r.language ?? 'python'
			});
		if (kind === 'digital' && fir) {
			t.push({
				id: 'fir-py',
				label: 'Python',
				code:
					ex.arrayToPython('h', fir) +
					`\n\n# from scipy import signal\n# y = signal.lfilter(h, 1.0, x)`,
				language: 'python'
			});
			t.push({
				id: 'fir-c',
				label: 'C array',
				code: ex.arrayToC('h', fir, ctype),
				language: 'c',
				filename: `${name}.h`
			});
			t.push({
				id: 'fir-impl',
				label: 'C implementation',
				code: ex.firImplementationC(fir, ctype, name),
				language: 'c',
				filename: `${name}.c`
			});
			t.push({
				id: 'fir-q',
				label: 'Fixed point',
				code: ex.firToFixedC(fir, qBits, 'h'),
				language: 'c'
			});
			t.push({
				id: 'fir-m',
				label: 'MATLAB',
				code: ex.arrayToMatlab('h', fir),
				language: 'matlab'
			});
			t.push({
				id: 'fir-csv',
				label: 'CSV',
				code: fir.map((v) => ex.num(v)).join('\n'),
				language: 'csv',
				filename: `${name}.csv`
			});
			t.push({ id: 'fir-json', label: 'JSON', code: JSON.stringify(fir), language: 'json' });
		}
		if (kind === 'digital' && sos) {
			t.push({
				id: 'sos-py',
				label: 'SOS (Python)',
				code: ex.sosScipyUsage(sos, fs),
				language: 'python'
			});
			t.push({
				id: 'sos-c',
				label: 'SOS (C array)',
				code: ex.sosToC(sos, 'sos', ctype),
				language: 'c',
				filename: `${name}_sos.h`
			});
			t.push({
				id: 'sos-impl',
				label: 'C implementation',
				code: ex.sosImplementationC(sos, ctype, name),
				language: 'c',
				filename: `${name}.c`
			});
			t.push({
				id: 'sos-js',
				label: 'JavaScript',
				code: ex.sosImplementationJs(sos),
				language: 'javascript'
			});
			t.push({ id: 'sos-m', label: 'SOS (MATLAB)', code: ex.sosToMatlab(sos), language: 'matlab' });
			t.push({ id: 'sos-json', label: 'JSON', code: ex.sosToJson(sos), language: 'json' });
		}
		if (kind === 'analog' && zpk && zpk.z.length <= zpk.p.length) {
			const asos = zpk2sosAnalog(zpk);
			const rows = asos.map((r) => `    [${r.map((v) => ex.num(v)).join(', ')}],`).join('\n');
			t.push({
				id: 'asos',
				label: 'Analog sections',
				code: `# Analog second-order sections, one row per stage: [b0, b1, b2, a0, a1, a2]\n# H_i(s) = (b0 s^2 + b1 s + b2) / (a0 s^2 + a1 s + a2), s in rad/s; first-order rows have a0 = 0\nsections = [\n${rows}\n]`,
				language: 'python'
			});
		}
		if (tf && !fir) {
			t.push({ id: 'tf-py', label: 'b / a (Python)', code: ex.tfToPython(tf), language: 'python' });
			t.push({ id: 'tf-m', label: 'b / a (MATLAB)', code: ex.tfToMatlab(tf), language: 'matlab' });
			if (kind === 'digital')
				t.push({ id: 'tf-c', label: 'b / a (C)', code: ex.tfToC(tf, ctype), language: 'c' });
		}
		if (zpk) {
			t.push({
				id: 'zpk-py',
				label: 'Poles / zeros (Python)',
				code: ex.zpkToPython(zpk) + (kind === 'analog' ? '\n# analog: units are rad/s' : ''),
				language: 'python'
			});
			t.push({
				id: 'zpk-m',
				label: 'Poles / zeros (MATLAB)',
				code: ex.zpkToMatlab(zpk),
				language: 'matlab'
			});
		}
		return t;
	});

	let active = $state<string | null>(null);
	const current = $derived(tabs.find((t) => t.id === active) ?? tabs[0]);
	const showCType = $derived(current?.language === 'c');
	const qFormat = $derived(current?.id === 'fir-q' && fir ? ex.fixedFormat(fir, qBits) : null);
</script>

<div class="export">
	<div class="tabs" role="tablist" aria-label="Export format">
		{#each tabs as t (t.id)}
			<button
				type="button"
				role="tab"
				aria-selected={current?.id === t.id}
				class:active={current?.id === t.id}
				onclick={() => (active = t.id)}>{t.label}</button
			>
		{/each}
	</div>
	{#if current}
		{#if showCType}
			<div class="opts">
				<label><input type="radio" bind:group={ctype} value="float" /> float</label>
				<label><input type="radio" bind:group={ctype} value="double" /> double</label>
				{#if current.id === 'fir-q'}
					<label class="bits"
						>bits <input
							type="number"
							min={ex.FIXED_BITS_MIN}
							max={ex.FIXED_BITS_MAX}
							step="1"
							bind:value={fixedBits}
							onchange={() => (fixedBits = qBits)}
						/></label
					>
				{/if}
			</div>
		{/if}
		{#if qFormat && (qFormat.intBits > 0 || qFormat.clipped > 0)}
			<Callout kind={qFormat.clipped > 0 ? 'warning' : 'note'} title="Q format">
				{#if qFormat.clipped > 0}
					{qFormat.clipped} tap{qFormat.clipped > 1 ? 's do' : ' does'} not fit a {qFormat.bits}-bit
					integer even with no fractional bits and {qFormat.clipped > 1 ? 'are' : 'is'} clipped, so the
					exported filter is wrong. Scale the taps down before quantising.
				{:else}
					The largest tap, |h| = {ex.num(qFormat.maxAbs, 4)}, does not fit Q0.{qFormat.bits - 1},
					which covers [−1, 1). The export therefore uses Q{qFormat.intBits}.{qFormat.frac}: {qFormat.intBits}
					integer bit{qFormat.intBits > 1 ? 's' : ''} and {qFormat.frac} fractional bits, value = integer
					/ 2<sup>{qFormat.frac}</sup>.
				{/if}
			</Callout>
		{/if}
		<CodeBlock code={current.code} language={current.language} filename={current.filename} />
	{/if}
</div>

<style>
	.export {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
	}
	.tabs {
		display: flex;
		gap: 0.25rem;
		overflow-x: auto;
		padding-bottom: 2px;
		scrollbar-width: thin;
	}
	.tabs button {
		border: 1px solid var(--border);
		background: var(--surface-2);
		border-radius: 999px;
		padding: 0.18rem 0.65rem;
		font-size: 0.8rem;
		cursor: pointer;
		white-space: nowrap;
		color: var(--text-2);
	}
	.tabs button.active {
		background: var(--accent-wash);
		border-color: var(--accent);
		color: var(--accent-ink);
		font-weight: 600;
	}
	.opts {
		display: flex;
		gap: 1rem;
		font-size: 0.82rem;
		color: var(--text-2);
		align-items: center;
	}
	.opts label {
		display: inline-flex;
		gap: 0.3rem;
		align-items: center;
	}
	.bits input {
		width: 4em;
		border: 1px solid var(--border-strong);
		border-radius: 4px;
		background: var(--surface);
		padding: 0.05rem 0.3rem;
	}
</style>
