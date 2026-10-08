<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		id: string;
		title: string;
		blurb?: string;
		/** Optional control row under the title (e.g. "solve for"). */
		head?: Snippet;
		children: Snippet;
		/** The governing formula(s), rendered at the bottom. */
		formula?: Snippet;
	}
	let { id, title, blurb, head, children, formula }: Props = $props();
</script>

<section class="calc" {id} aria-labelledby="{id}-title">
	<header>
		<h2 id="{id}-title">{title}</h2>
		<a class="anchor" href="#{id}" title="Link to this calculator" aria-label="Link to {title}">#</a
		>
	</header>
	{#if blurb}<p class="blurb">{blurb}</p>{/if}
	{#if head}<div class="head">{@render head()}</div>{/if}
	<div class="body">{@render children()}</div>
	{#if formula}
		<div class="formula">{@render formula()}</div>
	{/if}
</section>

<style>
	.calc {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		padding: 0.9rem 1rem 0.7rem;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
		scroll-margin-top: 68px;
	}
	.calc:target {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-wash);
	}
	header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}
	h2 {
		font-size: 1rem;
		margin: 0;
	}
	.anchor {
		color: var(--muted);
		text-decoration: none;
		font-weight: 600;
		padding: 0 0.25rem;
		border-radius: 4px;
	}
	.anchor:hover {
		color: var(--accent-ink);
		background: var(--accent-wash);
	}
	.blurb {
		margin: -0.35rem 0 0;
		font-size: 0.84rem;
		color: var(--muted);
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 0.8rem;
		align-items: flex-end;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		min-width: 0;
	}
	.formula {
		margin-top: auto;
		border-top: 1px solid var(--border);
		padding-top: 0.35rem;
		font-size: 0.92rem;
		min-width: 0;
	}
	.formula :global(.tex-display) {
		margin: 0.25em 0;
	}
	.body :global(.fields) {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.6rem 0.7rem;
	}
	.body :global(.fields.three) {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}
	.body :global(.sub) {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted);
		font-weight: 650;
		margin: 0.2rem 0 -0.3rem;
	}
	.body :global(.note) {
		font-size: 0.8rem;
		color: var(--muted);
		margin: 0;
	}
	@media (max-width: 420px) {
		.body :global(.fields.three) {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
