<script lang="ts">
	import type { Snippet } from 'svelte';
	import { toolBySlug } from '$lib/tools';
	import { toolHref } from '$lib/paths';

	interface Props {
		id: string;
		title: string;
		/** Slugs of interactive tools to link from the section header. */
		tools?: string[];
		children: Snippet;
	}
	let { id, title, tools = [], children }: Props = $props();
	const links = $derived(tools.map(toolBySlug).filter((t) => !!t));
</script>

<section class="fsec" {id} aria-labelledby="{id}-h">
	<header>
		<h2 id="{id}-h">{title}</h2>
		<a class="anchor" href="#{id}" aria-label="Link to {title}">#</a>
	</header>
	{#if links.length}
		<p class="tools">
			<span class="muted">Interactive:</span>
			{#each links as t (t!.slug)}<a href={toolHref(t!.slug)}>{t!.title}</a>{/each}
		</p>
	{/if}
	<div class="body">
		{@render children()}
	</div>
</section>

<style>
	.fsec {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		padding: 1.1rem 1.3rem 0.8rem;
		scroll-margin-top: 64px;
		min-width: 0;
	}
	header {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
	}
	h2 {
		margin: 0;
		font-size: 1.3rem;
	}
	.anchor {
		color: var(--muted);
		text-decoration: none;
		font-weight: 600;
	}
	.anchor:hover {
		color: var(--accent-ink);
	}
	.tools {
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem 0.9rem;
		font-size: 0.85rem;
		margin: 0.35rem 0 0.6rem;
	}
	.body {
		min-width: 0;
	}
	.body :global(> p),
	.body :global(> ul),
	.body :global(> ol) {
		max-width: 80ch;
	}
	.body :global(h3) {
		scroll-margin-top: 64px;
		margin-top: 1.3em;
	}
	.body :global(.tw) {
		overflow-x: auto;
		margin: 0.4rem 0 1rem;
	}
	.body :global(.tw table) {
		font-size: 0.9rem;
	}
	.body :global(.tw td),
	.body :global(.tw th) {
		vertical-align: middle;
	}
	.body :global(.tw td.nw),
	.body :global(.tw th.nw) {
		white-space: nowrap;
	}
	.body :global(.cols) {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr));
		gap: 0 1.6rem;
	}
	.body :global(.small-note) {
		font-size: 0.84rem;
		color: var(--muted);
	}
	@media (max-width: 600px) {
		.fsec {
			padding: 0.9rem 0.9rem 0.6rem;
		}
	}
</style>
