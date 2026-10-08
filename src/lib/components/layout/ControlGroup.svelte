<script lang="ts">
	import type { Snippet } from 'svelte';
	interface Props {
		title?: string;
		children: Snippet;
		columns?: 1 | 2 | 3;
	}
	let { title, children, columns = 1 }: Props = $props();
</script>

<fieldset class="group">
	{#if title}<legend>{title}</legend>{/if}
	<div class="items cols-{columns}">
		{@render children()}
	</div>
</fieldset>

<style>
	.group {
		border: none;
		margin: 0 0 1rem;
		padding: 0;
		min-width: 0;
	}
	legend {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted);
		font-weight: 650;
		margin-bottom: 0.5rem;
		padding: 0;
	}
	.items {
		display: grid;
		gap: 0.7rem;
	}
	.cols-2 {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	.cols-3 {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}
</style>
