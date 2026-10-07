<script lang="ts">
	export interface Stat {
		label: string;
		value: string;
		hint?: string;
		status?: 'good' | 'warning' | 'critical';
	}
	interface Props {
		stats: Stat[];
		columns?: number;
	}
	let { stats, columns }: Props = $props();
	const icon = { good: '✓', warning: '!', critical: '✕' };
</script>

<dl class="stats" style:grid-template-columns={columns ? `repeat(${columns}, minmax(0, 1fr))` : undefined}>
	{#each stats as s (s.label)}
		<div class="stat" title={s.hint}>
			<dt>{s.label}</dt>
			<dd class={s.status}>
				{#if s.status}<span class="st" aria-hidden="true">{icon[s.status]}</span>{/if}{s.value}
			</dd>
		</div>
	{/each}
</dl>

<style>
	.stats {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 0.5rem;
		margin: 0;
	}
	.stat {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 0.4rem 0.6rem;
		min-width: 0;
	}
	dt {
		font-size: 0.75rem;
		color: var(--muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	dd {
		margin: 0;
		font-weight: 600;
		font-size: 0.95rem;
		overflow-wrap: anywhere;
	}
	.st {
		display: inline-block;
		margin-right: 0.3rem;
	}
	dd.good {
		color: var(--good-ink);
	}
	dd.warning {
		color: var(--warning-ink);
	}
	dd.critical {
		color: var(--critical-ink);
	}
</style>
