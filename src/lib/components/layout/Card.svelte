<script lang="ts">
	import type { Snippet } from 'svelte';
	interface Props {
		title?: string;
		subtitle?: string;
		actions?: Snippet;
		children: Snippet;
		padded?: boolean;
		id?: string;
	}
	let { title, subtitle, actions, children, padded = true, id }: Props = $props();
</script>

<section class="card" class:padded {id}>
	{#if title || actions}
		<header>
			<div>
				{#if title}<h3>{title}</h3>{/if}
				{#if subtitle}<p class="sub">{subtitle}</p>{/if}
			</div>
			{#if actions}<div class="actions">{@render actions()}</div>{/if}
		</header>
	{/if}
	{@render children()}
</section>

<style>
	.card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		min-width: 0;
	}
	.padded {
		padding: 0.9rem 1rem;
	}
	header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.6rem;
		margin-bottom: 0.6rem;
		flex-wrap: wrap;
	}
	h3 {
		margin: 0;
		font-size: 0.98rem;
	}
	.sub {
		margin: 0.1rem 0 0;
		font-size: 0.82rem;
		color: var(--muted);
	}
	.actions {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
		align-items: center;
	}
</style>
