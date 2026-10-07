<script lang="ts">
	import type { Snippet } from 'svelte';
	import { categoryById, toolBySlug } from '$lib/tools';
	import { toolHref } from '$lib/paths';

	interface Props {
		slug: string;
		/** Left-hand control panel. */
		controls?: Snippet;
		/** Main area (plots, tables). */
		children: Snippet;
		/** Explanatory "how it works" section rendered below. */
		theory?: Snippet;
		/** Slugs of related tools to link at the bottom. */
		related?: string[];
		/** Wider control column (e.g. band editors). */
		wideControls?: boolean;
	}
	let { slug, controls, children, theory, related = [], wideControls = false }: Props = $props();
	const tool = $derived(toolBySlug(slug)!);
	const cat = $derived(categoryById(tool.category));
	const relatedTools = $derived(related.map(toolBySlug).filter((t) => !!t));
</script>

<svelte:head>
	<title>{tool.title} · Filter Playground</title>
	<meta name="description" content={tool.description} />
</svelte:head>

<article class="tool">
	<header class="tool-head">
		<div class="crumb">{cat.title}</div>
		<h1>{tool.title}</h1>
		<p class="lede">{tool.description}</p>
	</header>

	<div class="tool-grid" class:no-controls={!controls} class:wide={wideControls}>
		{#if controls}
			<aside class="controls" aria-label="Controls">
				{@render controls()}
			</aside>
		{/if}
		<div class="main">
			{@render children()}
		</div>
	</div>

	{#if theory}
		<section class="theory prose" aria-label="Theory">
			{@render theory()}
		</section>
	{/if}

	{#if relatedTools.length}
		<nav class="related" aria-label="Related tools">
			<span class="muted small">Related:</span>
			{#each relatedTools as t (t!.slug)}
				<a href={toolHref(t!.slug)}>{t!.title}</a>
			{/each}
		</nav>
	{/if}
</article>

<style>
	.tool {
		max-width: 1500px;
	}
	.tool-head {
		margin-bottom: 1.1rem;
	}
	.crumb {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--muted);
		font-weight: 650;
		margin-bottom: 0.2rem;
	}
	h1 {
		margin-bottom: 0.3rem;
	}
	.lede {
		color: var(--text-2);
		max-width: 80ch;
		margin: 0;
	}
	.tool-grid {
		display: grid;
		grid-template-columns: 300px minmax(0, 1fr);
		gap: 1.1rem;
		align-items: start;
	}
	.tool-grid.wide {
		grid-template-columns: 360px minmax(0, 1fr);
	}
	.tool-grid.no-controls {
		grid-template-columns: minmax(0, 1fr);
	}
	.controls {
		position: sticky;
		top: 64px;
		max-height: calc(100vh - 76px);
		overflow-y: auto;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		padding: 0.9rem 0.9rem 0.3rem;
		scrollbar-width: thin;
	}
	.main {
		display: flex;
		flex-direction: column;
		gap: 1.1rem;
		min-width: 0;
	}
	.theory {
		margin-top: 1.6rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.2rem 1.4rem;
		max-width: none;
	}
	.theory :global(> *) {
		max-width: 80ch;
	}
	.theory :global(.wide) {
		max-width: none;
	}
	.related {
		margin-top: 1.2rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 1rem;
		align-items: baseline;
		font-size: 0.9rem;
	}
	@media (max-width: 1100px) {
		.tool-grid,
		.tool-grid.wide {
			grid-template-columns: minmax(0, 1fr);
		}
		.controls {
			position: static;
			max-height: none;
		}
	}
	@media (max-width: 600px) {
		.theory {
			padding: 1rem;
		}
	}
</style>
