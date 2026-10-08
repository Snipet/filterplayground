<script lang="ts">
	import ToolLayout from '$lib/components/layout/ToolLayout.svelte';
	import Laplace from '$lib/features/formulas/sections/Laplace.svelte';
	import ZTransform from '$lib/features/formulas/sections/ZTransform.svelte';
	import StandardForms from '$lib/features/formulas/sections/StandardForms.svelte';
	import Prototypes from '$lib/features/formulas/sections/Prototypes.svelte';
	import OrderTransforms from '$lib/features/formulas/sections/OrderTransforms.svelte';
	import Discretization from '$lib/features/formulas/sections/Discretization.svelte';
	import Cookbook from '$lib/features/formulas/sections/Cookbook.svelte';
	import Fir from '$lib/features/formulas/sections/Fir.svelte';
	import Windows from '$lib/features/formulas/sections/Windows.svelte';
	import Misc from '$lib/features/formulas/sections/Misc.svelte';
	import { toolHref } from '$lib/paths';

	interface TocEntry {
		id: string;
		title: string;
		sub: [string, string][];
	}
	const TOC: TocEntry[] = [
		{ id: 'laplace', title: 'Laplace transform', sub: [['laplace-pairs', 'Pairs'], ['laplace-properties', 'Properties'], ['laplace-limits', 'Initial/final value']] },
		{ id: 'z-transform', title: 'z-transform, DTFT, DFT', sub: [['z-pairs', 'Pairs'], ['z-properties', 'Properties'], ['dtft', 'DTFT, DFT, z = e^sT']] },
		{ id: 'standard-forms', title: 'First- & second-order sections', sub: [['first-order', 'First order'], ['second-order', 'Second order'], ['second-order-quantities', 'Peak, −3 dB, overshoot']] },
		{ id: 'prototypes', title: 'Analog prototypes', sub: [['butterworth', 'Butterworth'], ['chebyshev-1', 'Chebyshev I'], ['chebyshev-2', 'Chebyshev II'], ['elliptic', 'Elliptic'], ['bessel', 'Bessel']] },
		{ id: 'order-transformations', title: 'Order & frequency transformations', sub: [['order-formulas', 'Minimum order'], ['frequency-transformations', 'LP → LP/HP/BP/BS'], ['digital-transformations', 'Digital transformations']] },
		{ id: 'discretization', title: 'Analog → digital', sub: [['bilinear', 'Bilinear & prewarping'], ['impulse-invariance', 'Impulse invariance'], ['matched-z', 'Matched-Z'], ['euler', 'Euler'], ['step-invariance', 'Step invariance']] },
		{ id: 'rbj-cookbook', title: 'RBJ cookbook biquads', sub: [['rbj-variables', 'A, ω₀, α'], ['rbj-filters', 'LPF … peakingEQ'], ['rbj-lowshelf', 'Low shelf'], ['rbj-highshelf', 'High shelf']] },
		{ id: 'fir', title: 'FIR design', sub: [['ideal-lowpass', 'Window method'], ['kaiser-formulas', 'Kaiser β and N'], ['fir-length', 'Equiripple length'], ['linear-phase-types', 'Linear-phase types']] },
		{ id: 'windows', title: 'Window functions', sub: [['window-metrics', 'Metric definitions']] },
		{ id: 'delay-db-sampling', title: 'Delay, dB, Parseval, sampling', sub: [['group-delay', 'Group & phase delay'], ['decibels', 'Decibels'], ['parseval', 'Parseval'], ['sampling-theorem', 'Nyquist–Shannon']] }
	];
</script>

<ToolLayout slug="formulas" related={['calculators', 'glossary', 'order-calculator', 'biquad', 'windows']}>
	<nav class="toc" aria-label="Contents">
		<h2 class="toc-title">Contents</h2>
		<ol>
			{#each TOC as e (e.id)}
				<li>
					<a class="top" href="#{e.id}">{e.title}</a>
					<span class="subs">
						{#each e.sub as [id, label], i (id)}{#if i > 0}<span class="dot" aria-hidden="true">·</span>{/if}<a href="#{id}">{label}</a>{/each}
					</span>
				</li>
			{/each}
		</ol>
		<p class="small muted hint">
			Conventions: analog frequencies Ω or ω in rad/s, digital ω in rad/sample, T = 1/f<sub>s</sub>. Need numbers rather than symbols? Use the
			<a href={toolHref('calculators')}>calculators</a>; unfamiliar term? See the <a href={toolHref('glossary')}>glossary</a>.
		</p>
	</nav>

	<Laplace />
	<ZTransform />
	<StandardForms />
	<Prototypes />
	<OrderTransforms />
	<Discretization />
	<Cookbook />
	<Fir />
	<Windows />
	<Misc />
</ToolLayout>

<style>
	.toc {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		padding: 1rem 1.3rem 0.6rem;
	}
	.toc-title {
		font-size: 1rem;
		margin: 0 0 0.5rem;
	}
	ol {
		margin: 0;
		padding-left: 1.4em;
		columns: 2 360px;
		column-gap: 2rem;
	}
	li {
		break-inside: avoid;
		margin: 0 0 0.45rem;
	}
	.top {
		font-weight: 600;
	}
	.subs {
		display: block;
		font-size: 0.84rem;
		color: var(--muted);
	}
	.subs a {
		color: var(--text-2);
	}
	.dot {
		margin: 0 0.4em;
	}
	.subs a:hover {
		color: var(--accent-ink);
	}
	.hint {
		margin: 0.5rem 0 0.4rem;
	}
</style>
