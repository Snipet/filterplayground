<script lang="ts">
	import { page } from '$app/state';
	import { href } from '$lib/paths';
	import { TOOLS } from '$lib/tools';
	import { toolHref } from '$lib/paths';

	const suggestions = TOOLS.slice(0, 6);
</script>

<svelte:head><title>{page.status} · Filter Playground</title></svelte:head>

<section class="err">
	<p class="code">{page.status}</p>
	<h1>{page.status === 404 ? 'This page is not in the filter bank' : 'Something went wrong'}</h1>
	<p class="muted">{page.error?.message ?? ''}</p>
	<p><a href={href('/')}>Back to the overview</a> or jump to a tool:</p>
	<ul>
		{#each suggestions as t (t.slug)}
			<li><a href={toolHref(t.slug)}>{t.title}</a></li>
		{/each}
	</ul>
</section>

<style>
	.err {
		max-width: 60ch;
		margin: 3rem 0;
	}
	.code {
		font-size: 3rem;
		font-weight: 700;
		color: var(--muted);
		margin: 0;
	}
</style>
