<script lang="ts">
	import katex from 'katex';

	interface Props {
		/** TeX source. */
		math: string;
		display?: boolean;
	}
	let { math, display = false }: Props = $props();
	const html = $derived(
		katex.renderToString(math, {
			displayMode: display,
			throwOnError: false,
			strict: 'ignore',
			output: 'html'
		})
	);
</script>

{#if display}
	<div class="tex-display">{@html html}</div>
{:else}
	<span class="tex">{@html html}</span>
{/if}

<style>
	.tex-display {
		overflow-x: auto;
		overflow-y: hidden;
		margin: 0.5em 0 0.9em;
	}
</style>
