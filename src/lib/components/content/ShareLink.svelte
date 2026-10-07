<script lang="ts">
	import { replaceState } from '$app/navigation';
	import { shareUrl } from '$lib/share';

	interface Props {
		/** Serializable design state to embed in the link. */
		value: unknown;
		label?: string;
	}
	let { value, label = 'Copy link' }: Props = $props();
	let done = $state(false);

	async function copy() {
		const url = shareUrl(value);
		try {
			await navigator.clipboard.writeText(url);
		} catch {
			window.prompt('Copy this link', url);
		}
		replaceState(url, {});
		done = true;
		setTimeout(() => (done = false), 1600);
	}
</script>

<button type="button" class="btn small" onclick={copy} title="Copy a link that reopens this exact design" aria-live="polite">
	<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"
		><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg
	>
	{done ? 'Link copied ✓' : label}
</button>
