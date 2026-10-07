<script lang="ts">
	import type { Snippet } from 'svelte';
	interface Props {
		kind?: 'tip' | 'note' | 'warning' | 'danger' | 'try';
		title?: string;
		children: Snippet;
	}
	let { kind = 'note', title, children }: Props = $props();
	const meta = {
		tip: { icon: '💡', label: 'Tip' },
		note: { icon: 'ℹ', label: 'Note' },
		warning: { icon: '⚠', label: 'Warning' },
		danger: { icon: '⛔', label: 'Problem' },
		try: { icon: '🧪', label: 'Try this' }
	};
</script>

<aside class="callout {kind}" role={kind === 'warning' || kind === 'danger' ? 'alert' : 'note'}>
	<div class="head"><span class="icon" aria-hidden="true">{meta[kind].icon}</span><strong>{title ?? meta[kind].label}</strong></div>
	<div class="body">{@render children()}</div>
</aside>

<style>
	.callout {
		border: 1px solid var(--border);
		border-left: 3px solid var(--accent);
		background: var(--surface);
		border-radius: var(--radius-sm);
		padding: 0.55rem 0.8rem;
		margin: 0.8rem 0;
		font-size: 0.9rem;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin-bottom: 0.15rem;
	}
	.icon {
		width: 1.2em;
		text-align: center;
	}
	.body :global(p:last-child),
	.body :global(ul:last-child) {
		margin-bottom: 0;
	}
	.warning {
		border-left-color: var(--warning);
	}
	.warning strong {
		color: var(--warning-ink);
	}
	.danger {
		border-left-color: var(--critical);
	}
	.danger strong {
		color: var(--critical-ink);
	}
	.tip {
		border-left-color: var(--good);
	}
	.try {
		border-left-color: var(--s7);
	}
</style>
