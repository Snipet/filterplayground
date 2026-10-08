<script lang="ts" module>
	export interface ResultRow {
		label: string;
		value: string;
		/** Highlight the quantity that was solved for. */
		primary?: boolean;
		hint?: string;
	}
</script>

<script lang="ts">
	interface Props {
		rows: ResultRow[];
	}
	let { rows }: Props = $props();
</script>

<dl class="results">
	{#each rows as r (r.label)}
		<div class="row" class:primary={r.primary} title={r.hint}>
			<dt>{r.label}</dt>
			<dd>{r.value}</dd>
		</div>
	{/each}
</dl>

<style>
	.results {
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 0.35rem;
	}
	.row {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 0.25rem 0.5rem;
		min-width: 0;
	}
	.row.primary {
		border-color: var(--accent);
		background: var(--accent-wash);
	}
	dt {
		font-size: 0.74rem;
		color: var(--muted);
	}
	dd {
		margin: 0;
		font-weight: 600;
		font-size: 0.93rem;
		font-variant-numeric: tabular-nums;
		overflow-wrap: anywhere;
	}
</style>
