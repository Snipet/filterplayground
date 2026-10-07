<script lang="ts">
	import '../app.css';
	import 'katex/dist/katex.min.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { CATEGORIES, searchTools, toolsIn } from '$lib/tools';
	import { href, toolHref } from '$lib/paths';
	import { theme } from '$lib/theme.svelte';

	let { children } = $props();

	let navOpen = $state(false);
	let query = $state('');
	let searchEl: HTMLInputElement | undefined = $state();

	const results = $derived(query.trim() ? searchTools(query) : null);
	const path = $derived(page.url.pathname);
	const isActive = (slug: string) => path.replace(/\/$/, '').endsWith(`/${slug}`);

	onMount(() => {
		theme.init();
		const onKey = (e: KeyboardEvent) => {
			const t = e.target as HTMLElement;
			const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
			if (e.key === '/' && !typing) {
				e.preventDefault();
				navOpen = true;
				searchEl?.focus();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	$effect(() => {
		// close the mobile drawer on navigation
		void path;
		navOpen = false;
	});
</script>

<div class="app" class:nav-open={navOpen}>
	<header class="topbar">
		<button class="menu btn ghost" type="button" aria-label="Toggle navigation" aria-expanded={navOpen} onclick={() => (navOpen = !navOpen)}>
			<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
		</button>
		<a class="brand" href={href('/')}>
			<svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="var(--accent)" /><path d="M4 11h9c3 0 4 1 5.5 4.5S22 24 28 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" /><circle cx="18" cy="9" r="2.4" fill="none" stroke="#fff" stroke-width="2" /></svg>
			<span>Filter Playground</span>
		</a>
		<span class="spacer"></span>
		<a class="btn ghost small gh" href="https://github.com/Snipet/filterplayground" rel="noopener" target="_blank">GitHub</a>
		<button class="btn ghost theme" type="button" onclick={() => theme.cycle()} aria-label="Switch to {theme.resolved === 'dark' ? 'light' : 'dark'} theme" title="Toggle theme">
			{#if theme.resolved === 'dark'}
				<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" stroke-width="1.8" /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
			{:else}
				<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" /></svg>
			{/if}
		</button>
	</header>

	<nav class="sidebar" aria-label="Tools">
		<div class="search">
			<input
				bind:this={searchEl}
				type="search"
				placeholder="Search tools…  ( / )"
				aria-label="Search tools"
				bind:value={query}
				onkeydown={(e) => {
					if (e.key === 'Escape') query = '';
				}}
			/>
		</div>
		{#if results}
			<ul class="links">
				{#each results as t (t.slug)}
					<li><a href={toolHref(t.slug)} class:active={isActive(t.slug)} onclick={() => (query = '')}>{t.nav}</a></li>
				{:else}
					<li class="empty">No tools match “{query}”.</li>
				{/each}
			</ul>
		{:else}
			<a class="home-link" class:active={path === href('/') || path === '/'} href={href('/')}>Overview</a>
			{#each CATEGORIES as cat (cat.id)}
				<div class="cat">
					<div class="cat-title">{cat.title}</div>
					<ul class="links">
						{#each toolsIn(cat.id) as t (t.slug)}
							<li><a href={toolHref(t.slug)} class:active={isActive(t.slug)} aria-current={isActive(t.slug) ? 'page' : undefined}>{t.nav}</a></li>
						{/each}
					</ul>
				</div>
			{/each}
		{/if}
	</nav>
	<button class="scrim" type="button" aria-label="Close navigation" tabindex="-1" onclick={() => (navOpen = false)}></button>

	<main class="content">
		{@render children()}
		<footer class="site-footer">
			<span>Filter Playground — an open toolkit for learning and designing analog &amp; digital filters. All computation runs in your browser.</span>
		</footer>
	</main>
</div>

<style>
	.app {
		min-height: 100vh;
	}
	.topbar {
		position: sticky;
		top: 0;
		z-index: 30;
		height: 52px;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0 0.9rem;
		background: color-mix(in srgb, var(--surface) 88%, transparent);
		backdrop-filter: blur(8px);
		border-bottom: 1px solid var(--border);
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
		font-weight: 700;
		color: var(--text);
		text-decoration: none;
		letter-spacing: -0.01em;
	}
	.spacer {
		flex: 1;
	}
	.menu {
		display: none;
		padding: 0.3rem;
	}
	.theme {
		padding: 0.35rem;
	}
	.sidebar {
		position: fixed;
		top: 52px;
		bottom: 0;
		left: 0;
		width: var(--sidebar-w);
		overflow-y: auto;
		padding: 0.8rem 0.7rem 2rem;
		border-right: 1px solid var(--border);
		background: var(--surface);
		z-index: 20;
	}
	.search input {
		width: 100%;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		padding: 0.4rem 0.6rem;
		background: var(--surface-2);
		font-size: 0.88rem;
	}
	.search input:focus {
		outline: none;
		border-color: var(--focus);
		background: var(--surface);
		box-shadow: 0 0 0 3px var(--accent-wash);
	}
	.search {
		margin-bottom: 0.7rem;
	}
	.home-link {
		display: block;
		padding: 0.3rem 0.6rem;
		border-radius: 6px;
		text-decoration: none;
		color: var(--text);
		font-size: 0.9rem;
		font-weight: 550;
	}
	.cat {
		margin-top: 0.9rem;
	}
	.cat-title {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--muted);
		font-weight: 650;
		padding: 0 0.6rem;
		margin-bottom: 0.2rem;
	}
	.links {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.links li {
		margin: 0;
	}
	.links a {
		display: block;
		padding: 0.26rem 0.6rem;
		border-radius: 6px;
		text-decoration: none;
		color: var(--text-2);
		font-size: 0.88rem;
		line-height: 1.35;
	}
	.links a:hover,
	.home-link:hover {
		background: var(--surface-2);
		color: var(--text);
	}
	.links a.active,
	.home-link.active {
		background: var(--accent-wash);
		color: var(--accent-ink);
		font-weight: 600;
	}
	.empty {
		padding: 0.4rem 0.6rem;
		color: var(--muted);
		font-size: 0.85rem;
	}
	.content {
		margin-left: var(--sidebar-w);
		padding: 1.4rem 1.6rem 1rem;
		min-width: 0;
	}
	.site-footer {
		margin-top: 3rem;
		padding: 1.2rem 0 0.4rem;
		border-top: 1px solid var(--border);
		font-size: 0.8rem;
		color: var(--muted);
	}
	.scrim {
		display: none;
	}
	@media (max-width: 960px) {
		.menu {
			display: inline-flex;
		}
		.gh {
			display: none;
		}
		.sidebar {
			transform: translateX(-100%);
			transition: transform 0.2s ease;
			box-shadow: var(--shadow);
		}
		.nav-open .sidebar {
			transform: none;
		}
		.nav-open .scrim {
			display: block;
			position: fixed;
			inset: 52px 0 0 0;
			background: rgba(0, 0, 0, 0.3);
			border: none;
			z-index: 15;
		}
		.content {
			margin-left: 0;
			padding: 1rem 16px;
		}
	}
</style>
