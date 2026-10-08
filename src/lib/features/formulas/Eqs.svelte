<script lang="ts">
	import Tex from '$lib/components/content/Tex.svelte';

	/** Several display formulas that sit side by side when there is room and wrap on narrow screens. */
	let { items }: { items: string[] } = $props();
</script>

<div class="eqs">
	{#each items as m, i (i)}
		<div class="eq"><Tex display math={m} /></div>
	{/each}
</div>

<style>
	.eqs {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		align-items: center;
		column-gap: 2.4rem;
		margin: 0.3em 0 0.7em;
	}
	.eq {
		min-width: 0;
		max-width: 100%;
	}
	.eq :global(.tex-display) {
		margin: 0.2em 0;
	}
	/* KaTeX boxes can poke 1–2 px past their measured width; keep that from triggering a scrollbar */
	.eq :global(.katex-display) {
		padding-left: 3px;
		padding-right: 3px;
	}
</style>
