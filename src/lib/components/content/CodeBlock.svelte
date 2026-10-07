<script lang="ts">
	interface Props {
		code: string;
		language?: string;
		maxHeight?: string;
		filename?: string;
	}
	let { code, language = '', maxHeight = '22rem', filename }: Props = $props();
	let copied = $state(false);
	async function copy() {
		try {
			await navigator.clipboard.writeText(code);
			copied = true;
			setTimeout(() => (copied = false), 1400);
		} catch {
			/* clipboard unavailable */
		}
	}
	function download() {
		const blob = new Blob([code], { type: 'text/plain' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = filename ?? 'code.txt';
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 1000);
	}
</script>

<div class="code">
	<div class="bar">
		<span class="lang">{language}</span>
		<span class="actions">
			{#if filename}<button class="btn ghost small" type="button" onclick={download}>Download</button>{/if}
			<button class="btn ghost small" type="button" onclick={copy} aria-live="polite">{copied ? 'Copied ✓' : 'Copy'}</button>
		</span>
	</div>
	<pre style:max-height={maxHeight}><code>{code}</code></pre>
</div>

<style>
	.code {
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface-2);
		overflow: hidden;
		min-width: 0;
	}
	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.15rem 0.3rem 0.15rem 0.7rem;
		border-bottom: 1px solid var(--border);
		font-size: 0.75rem;
		color: var(--muted);
	}
	pre {
		margin: 0;
		padding: 0.7rem 0.85rem;
		overflow: auto;
		font-size: 0.8rem;
		line-height: 1.5;
		tab-size: 4;
	}
</style>
