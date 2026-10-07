<script lang="ts" generics="T extends string | number">
	interface Option {
		value: T;
		label: string;
		title?: string;
		disabled?: boolean;
	}
	interface Props {
		value: T;
		options: Option[];
		label?: string;
		size?: 'normal' | 'small';
		onchange?: (v: T) => void;
	}
	let { value = $bindable(), options, label, size = 'normal', onchange }: Props = $props();
	const name = `seg-${Math.random().toString(36).slice(2, 9)}`;
</script>

<div class="seg-wrap">
	{#if label}<span class="lbl" id="{name}-lbl">{label}</span>{/if}
	<div class="seg {size}" role="radiogroup" aria-labelledby={label ? `${name}-lbl` : undefined}>
		{#each options as o (o.value)}
			<button
				type="button"
				role="radio"
				aria-checked={value === o.value}
				class:active={value === o.value}
				disabled={o.disabled}
				title={o.title}
				onclick={() => {
					value = o.value;
					onchange?.(o.value);
				}}>{o.label}</button
			>
		{/each}
	</div>
</div>

<style>
	.seg-wrap {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		min-width: 0;
	}
	.lbl {
		font-size: 0.82rem;
		color: var(--text-2);
		font-weight: 500;
	}
	.seg {
		display: inline-flex;
		flex-wrap: wrap;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 2px;
		gap: 2px;
	}
	button {
		flex: 1 1 auto;
		border: none;
		background: transparent;
		padding: 0.28rem 0.6rem;
		border-radius: 6px;
		cursor: pointer;
		font-size: 0.86rem;
		color: var(--text-2);
		white-space: nowrap;
	}
	.small button {
		padding: 0.16rem 0.5rem;
		font-size: 0.8rem;
	}
	button:hover:not(.active) {
		color: var(--text);
		background: var(--surface-3);
	}
	button.active {
		background: var(--surface);
		color: var(--text);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
		font-weight: 550;
	}
	button:disabled {
		opacity: 0.45;
		cursor: default;
	}
</style>
