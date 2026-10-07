<script lang="ts">
	import { CATEGORIES, toolsIn } from '$lib/tools';
	import { toolHref } from '$lib/paths';

	const starts = [
		{ slug: 'pole-zero', why: 'See how pole and zero positions shape a response.' },
		{ slug: 'rlc', why: 'Start from real components you can hold in your hand.' },
		{ slug: 'analog-designer', why: 'Design a classic Butterworth / Chebyshev / elliptic filter.' },
		{ slug: 'biquad', why: 'The building block of almost every digital IIR filter.' },
		{ slug: 'fir-designer', why: 'Design a linear-phase FIR and export its taps.' },
		{ slug: 'signal-lab', why: 'Hear what a filter does to noise and music-like signals.' }
	];
</script>

<svelte:head>
	<title>Filter Playground — analog &amp; digital filter design tools</title>
	<meta
		name="description"
		content="Interactive tools for learning and designing analog and digital filters: pole–zero playground, Butterworth/Chebyshev/elliptic/Bessel design, active filters, biquads, FIR windows, Parks–McClellan, and more."
	/>
</svelte:head>

<section class="hero">
	<h1>Filter Playground</h1>
	<p>
		A workbench for analog and digital filters. Every tool is interactive and runs entirely in your
		browser: drag poles, design prototypes from specifications, size real components, export
		coefficients — and read why it all works along the way.
	</p>
</section>

<section class="starts" aria-labelledby="start-title">
	<h2 id="start-title">Good places to start</h2>
	<div class="start-grid">
		{#each starts as s (s.slug)}
			{@const t = toolsIn('playgrounds').concat(...CATEGORIES.map((c) => toolsIn(c.id))).find((x) => x.slug === s.slug)}
			{#if t}
				<a class="start" href={toolHref(t.slug)}>
					<strong>{t.title}</strong>
					<span>{s.why}</span>
				</a>
			{/if}
		{/each}
	</div>
</section>

{#each CATEGORIES as cat (cat.id)}
	<section class="cat" aria-labelledby="cat-{cat.id}">
		<div class="cat-head">
			<h2 id="cat-{cat.id}">{cat.title}</h2>
			<p>{cat.blurb}</p>
		</div>
		<div class="grid">
			{#each toolsIn(cat.id) as t (t.slug)}
				<a class="card" href={toolHref(t.slug)}>
					<h3>{t.title}</h3>
					<p>{t.description}</p>
				</a>
			{/each}
		</div>
	</section>
{/each}

<style>
	.hero {
		max-width: 76ch;
		margin: 0.6rem 0 1.6rem;
	}
	.hero h1 {
		font-size: 2.1rem;
		margin-bottom: 0.4rem;
	}
	.hero p {
		font-size: 1.05rem;
		color: var(--text-2);
	}
	h2 {
		margin-top: 0;
		font-size: 1.15rem;
	}
	.starts {
		margin-bottom: 2rem;
	}
	.start-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
		gap: 0.6rem;
	}
	.start {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.7rem 0.85rem;
		border-radius: var(--radius);
		border: 1px solid var(--border);
		background: var(--accent-wash);
		text-decoration: none;
		color: var(--text);
	}
	.start span {
		font-size: 0.85rem;
		color: var(--text-2);
	}
	.start:hover {
		border-color: var(--accent);
	}
	.cat {
		margin-bottom: 2rem;
	}
	.cat-head p {
		color: var(--muted);
		margin: -0.2rem 0 0.7rem;
		font-size: 0.92rem;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
		gap: 0.75rem;
	}
	.card {
		display: block;
		padding: 0.85rem 1rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		text-decoration: none;
		color: var(--text);
		transition: border-color 0.12s, transform 0.12s;
	}
	.card:hover {
		border-color: var(--accent);
		transform: translateY(-1px);
	}
	.card h3 {
		margin: 0 0 0.3rem;
		font-size: 1rem;
	}
	.card p {
		margin: 0;
		font-size: 0.87rem;
		color: var(--text-2);
	}
</style>
