<script lang="ts">
	interface Props {
		checked: boolean;
		label: string;
		help?: string;
		disabled?: boolean;
		onchange?: (v: boolean) => void;
	}
	let { checked = $bindable(), label, help, disabled = false, onchange }: Props = $props();
</script>

<label class="toggle" class:disabled>
	<input type="checkbox" bind:checked {disabled} onchange={() => onchange?.(checked)} />
	<span class="track" aria-hidden="true"><span class="thumb"></span></span>
	<span class="text">
		<span>{label}</span>
		{#if help}<span class="help">{help}</span>{/if}
	</span>
</label>

<style>
	.toggle {
		display: flex;
		align-items: flex-start;
		gap: 0.55rem;
		cursor: pointer;
		font-size: 0.88rem;
		color: var(--text);
	}
	input {
		position: absolute;
		opacity: 0;
		width: 1px;
		height: 1px;
	}
	.track {
		flex: none;
		width: 30px;
		height: 18px;
		border-radius: 9px;
		background: var(--surface-3);
		border: 1px solid var(--border-strong);
		position: relative;
		margin-top: 2px;
		transition: background 0.15s;
	}
	.thumb {
		position: absolute;
		top: 1px;
		left: 1px;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--surface);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
		transition: transform 0.15s;
	}
	input:checked + .track {
		background: var(--accent);
		border-color: var(--accent);
	}
	input:checked + .track .thumb {
		transform: translateX(12px);
	}
	input:focus-visible + .track {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
	.text {
		display: flex;
		flex-direction: column;
	}
	.help {
		font-size: 0.76rem;
		color: var(--muted);
	}
	.disabled {
		opacity: 0.55;
		cursor: default;
	}
</style>
