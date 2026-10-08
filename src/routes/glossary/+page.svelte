<script lang="ts">
	import { tick } from 'svelte';
	import ToolLayout from '$lib/components/layout/ToolLayout.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import { toolBySlug } from '$lib/tools';
	import { toolHref } from '$lib/paths';
	import { TERMS, letterOf, matchTerm, slugify, type Term } from '$lib/features/glossary/terms';

	const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

	let query = $state('');

	const filtered = $derived(TERMS.filter((t) => matchTerm(t, query)));
	const groups = $derived.by(() => {
		const out: { letter: string; terms: Term[] }[] = [];
		for (const t of filtered) {
			const L = letterOf(t.term);
			const last = out[out.length - 1];
			if (last && last.letter === L) last.terms.push(t);
			else out.push({ letter: L, terms: [t] });
		}
		return out;
	});
	const present = $derived(new Set(groups.map((g) => g.letter)));

	/** Split text into plain and highlighted runs for the current query words. */
	function highlight(text: string): { s: string; hit: boolean }[] {
		const words = query
			.trim()
			.split(/\s+/)
			.filter((w) => w.length > 0)
			.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
		if (!words.length) return [{ s: text, hit: false }];
		const splitter = new RegExp(`(${words.join('|')})`, 'gi');
		const whole = new RegExp(`^(?:${words.join('|')})$`, 'i');
		return text
			.split(splitter)
			.filter((s) => s.length > 0)
			.map((s) => ({ s, hit: whole.test(s) }));
	}

	/** Jump to a term even when the current search hides it. */
	async function goTo(e: MouseEvent, id: string) {
		if (!query) return;
		e.preventDefault();
		query = '';
		await tick();
		const el = document.getElementById(id);
		if (!el) return;
		if (location.hash === `#${id}`) el.scrollIntoView();
		else location.hash = id;
		el.focus({ preventScroll: true });
	}
</script>

<ToolLayout slug="glossary" related={['formulas', 'calculators', 'analog-designer', 'fir-designer']}>
	<div class="finder">
		<label class="search">
			<span class="visually-hidden">Search the glossary</span>
			<svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="1.8" /><path d="M13 13l4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
			<input
				type="search"
				placeholder="Search terms and definitions — e.g. “ripple”, “Q”, “delay”"
				bind:value={query}
				onkeydown={(e) => {
					if (e.key === 'Escape') query = '';
				}}
			/>
		</label>
		<nav class="letters" aria-label="Jump to letter">
			{#each LETTERS as L (L)}
				{#if present.has(L)}
					<a href="#letter-{L.toLowerCase()}">{L}</a>
				{:else}
					<span class="off" aria-hidden="true">{L}</span>
				{/if}
			{/each}
		</nav>
		<p class="count small muted" aria-live="polite">
			{#if query.trim()}
				{filtered.length} of {TERMS.length} terms match “{query.trim()}”.
			{:else}
				{TERMS.length} terms. Each has a stable link — click a term's name to copy it from the address bar.
			{/if}
		</p>
	</div>

	{#if filtered.length === 0}
		<p class="muted empty">
			Nothing matches “{query}”. Try a shorter word, or look in the <a href={toolHref('formulas')}>formula reference</a>.
		</p>
	{/if}

	{#each groups as g (g.letter)}
		<section class="letter" id="letter-{g.letter.toLowerCase()}" aria-labelledby="letter-{g.letter.toLowerCase()}-h">
			<h2 id="letter-{g.letter.toLowerCase()}-h">{g.letter}</h2>
			<dl>
				{#each g.terms as t (t.term)}
					{@const id = slugify(t.term)}
					<div class="entry" {id} tabindex="-1">
						<dt>
							<a class="name" href="#{id}">{#each highlight(t.term) as part, i (i)}{#if part.hit}<mark>{part.s}</mark>{:else}{part.s}{/if}{/each}</a>
							{#if t.aka?.length}<span class="aka">also {#each highlight(t.aka.join(', ')) as part, i (i)}{#if part.hit}<mark>{part.s}</mark>{:else}{part.s}{/if}{/each}</span>{/if}
						</dt>
						<dd>
							<p class="def">{#each highlight(t.def) as part, i (i)}{#if part.hit}<mark>{part.s}</mark>{:else}{part.s}{/if}{/each}</p>
							{#if t.tex}<div class="tex"><Tex math={`\\displaystyle ${t.tex}`} /></div>{/if}
							{#if t.see?.length || t.tools?.length}
								<p class="links small">
									{#if t.see?.length}
										<span class="lbl">See also</span>
										{#each t.see as s, i (s)}{#if i > 0}{', '}{/if}<a href="#{slugify(s)}" onclick={(e) => goTo(e, slugify(s))}>{s}</a>{/each}
									{/if}
									{#if t.tools?.length}
										<span class="lbl tools-lbl">Try</span>
										{#each t.tools as slug, i (slug)}{#if i > 0}{', '}{/if}<a class="tool" href={toolHref(slug)}>{toolBySlug(slug)?.nav ?? slug}</a>{/each}
									{/if}
								</p>
							{/if}
						</dd>
					</div>
				{/each}
			</dl>
		</section>
	{/each}
</ToolLayout>

<style>
	.finder {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		padding: 0.8rem 1rem 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}
	@media (min-width: 760px) {
		.finder {
			position: sticky;
			top: 60px;
			z-index: 5;
		}
	}
	.search {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		padding: 0 0.6rem;
		color: var(--muted);
	}
	.search:focus-within {
		border-color: var(--focus);
		box-shadow: 0 0 0 3px var(--accent-wash);
	}
	.search input {
		border: none;
		outline: none;
		background: transparent;
		padding: 0.45rem 0;
		width: 100%;
		min-width: 0;
		color: var(--text);
	}
	.letters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.15rem;
	}
	.letters a,
	.letters span {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.75rem;
		height: 1.75rem;
		border-radius: 5px;
		font-weight: 600;
		font-size: 0.86rem;
		text-decoration: none;
	}
	.letters a {
		color: var(--accent-ink);
		background: var(--surface-2);
	}
	.letters a:hover {
		background: var(--accent-wash);
	}
	.letters .off {
		color: var(--muted);
		opacity: 0.45;
	}
	.count {
		margin: 0;
	}
	.empty {
		margin: 0;
	}
	.letter {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		padding: 0.6rem 1.2rem 0.4rem;
		scroll-margin-top: 64px;
	}
	@media (min-width: 760px) {
		.letter {
			scroll-margin-top: 190px;
		}
	}
	.letter h2 {
		margin: 0 0 0.3rem;
		font-size: 1.4rem;
		color: var(--accent-ink);
	}
	dl {
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr));
		column-gap: 2rem;
	}
	.entry {
		padding: 0.6rem 0 0.7rem;
		border-top: 1px solid var(--border);
		scroll-margin-top: 64px;
		min-width: 0;
	}
	@media (min-width: 760px) {
		.entry {
			scroll-margin-top: 190px;
		}
	}
	.entry:target,
	.entry:focus {
		outline: none;
		background: var(--accent-wash);
		box-shadow: 0 0 0 6px var(--accent-wash);
		border-radius: 4px;
	}
	dt {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.2rem 0.6rem;
	}
	.name {
		font-weight: 650;
		font-size: 1.02rem;
		color: var(--text);
		text-decoration: none;
	}
	.name:hover {
		color: var(--accent-ink);
		text-decoration: underline;
	}
	.aka {
		font-size: 0.82rem;
		color: var(--muted);
	}
	dd {
		margin: 0.2rem 0 0;
	}
	.def {
		margin: 0 0 0.35rem;
	}
	.tex {
		overflow-x: auto;
		overflow-y: hidden;
		margin: 0 0 0.4rem;
		padding: 0.1rem 0;
	}
	.links {
		margin: 0;
		color: var(--text-2);
	}
	.lbl {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--muted);
		font-weight: 650;
		margin-right: 0.3rem;
	}
	.tools-lbl {
		margin-left: 0.6rem;
	}
	mark {
		background: var(--accent-wash);
		color: inherit;
		border-radius: 2px;
		box-shadow: 0 0 0 1px var(--accent-wash);
	}
</style>
