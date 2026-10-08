<script lang="ts">
	import Section from '../Section.svelte';
	import Eqs from '../Eqs.svelte';
	import Tex from '$lib/components/content/Tex.svelte';

	const t = String.raw;

	const pairs: { f: string; F: string; roc: string }[] = [
		{ f: t`\delta(t)`, F: t`1`, roc: t`\text{all } s` },
		{ f: t`u(t)`, F: t`\dfrac{1}{s}`, roc: t`\sigma>0` },
		{ f: t`t\,u(t)`, F: t`\dfrac{1}{s^2}`, roc: t`\sigma>0` },
		{ f: t`t^n\,u(t)`, F: t`\dfrac{n!}{s^{n+1}}`, roc: t`\sigma>0` },
		{ f: t`e^{-at}\,u(t)`, F: t`\dfrac{1}{s+a}`, roc: t`\sigma>-a` },
		{ f: t`t^n e^{-at}\,u(t)`, F: t`\dfrac{n!}{(s+a)^{n+1}}`, roc: t`\sigma>-a` },
		{ f: t`(1-e^{-at})\,u(t)`, F: t`\dfrac{a}{s(s+a)}`, roc: t`\sigma>\max(0,-a)` },
		{ f: t`\sin(\omega_0 t)\,u(t)`, F: t`\dfrac{\omega_0}{s^2+\omega_0^2}`, roc: t`\sigma>0` },
		{ f: t`\cos(\omega_0 t)\,u(t)`, F: t`\dfrac{s}{s^2+\omega_0^2}`, roc: t`\sigma>0` },
		{
			f: t`e^{-at}\sin(\omega_0 t)\,u(t)`,
			F: t`\dfrac{\omega_0}{(s+a)^2+\omega_0^2}`,
			roc: t`\sigma>-a`
		},
		{
			f: t`e^{-at}\cos(\omega_0 t)\,u(t)`,
			F: t`\dfrac{s+a}{(s+a)^2+\omega_0^2}`,
			roc: t`\sigma>-a`
		}
	];

	const props: { name: string; f: string; F: string }[] = [
		{ name: 'Linearity', f: t`a\,f(t)+b\,g(t)`, F: t`a\,F(s)+b\,G(s)` },
		{ name: 'Time shift (t₀ ≥ 0)', f: t`f(t-t_0)\,u(t-t_0)`, F: t`e^{-st_0}F(s)` },
		{ name: 'Frequency shift', f: t`e^{-at}f(t)`, F: t`F(s+a)` },
		{ name: 'Time scaling (a > 0)', f: t`f(at)`, F: t`\tfrac{1}{a}F\!\left(\tfrac{s}{a}\right)` },
		{ name: 'Differentiation', f: t`\dfrac{df}{dt}`, F: t`sF(s)-f(0^-)` },
		{ name: 'Second derivative', f: t`\dfrac{d^2f}{dt^2}`, F: t`s^2F(s)-sf(0^-)-f'(0^-)` },
		{
			name: 'Integration',
			f: t`\displaystyle\int_{0^-}^{t} f(\tau)\,d\tau`,
			F: t`\dfrac{F(s)}{s}`
		},
		{ name: 'Multiplication by t', f: t`t\,f(t)`, F: t`-\dfrac{dF(s)}{ds}` },
		{
			name: 'Convolution',
			f: t`(f*g)(t)=\displaystyle\int_0^t f(\tau)g(t-\tau)\,d\tau`,
			F: t`F(s)\,G(s)`
		}
	];
</script>

<Section id="laplace" title="Laplace transform" tools={['bode', 'pole-zero', 'rlc']}>
	<p>
		The (unilateral) Laplace transform turns linear differential equations into algebra. Analog
		filters are rational functions of s.
	</p>
	<Eqs
		items={[
			t`F(s)=\mathcal{L}\{f(t)\}=\int_{0^-}^{\infty} f(t)\,e^{-st}\,dt`,
			t`s=\sigma+j\omega`,
			t`H(j\omega)=H(s)\big|_{s=j\omega}`
		]}
	/>
	<div class="cols">
		<div>
			<h3 id="laplace-pairs">Transform pairs</h3>
			<div class="tw">
				<table>
					<thead><tr><th>f(t)</th><th>F(s)</th><th>Region of convergence</th></tr></thead>
					<tbody>
						{#each pairs as p (p.f)}
							<tr
								><td><Tex math={p.f} /></td><td><Tex math={p.F} /></td><td><Tex math={p.roc} /></td
								></tr
							>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="small-note">u(t) is the unit step, δ(t) the Dirac impulse, σ = Re s.</p>
		</div>
		<div>
			<h3 id="laplace-properties">Properties</h3>
			<div class="tw">
				<table>
					<thead><tr><th>Property</th><th>Time domain</th><th>s-domain</th></tr></thead>
					<tbody>
						{#each props as p (p.name)}
							<tr><td>{p.name}</td><td><Tex math={p.f} /></td><td><Tex math={p.F} /></td></tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	</div>
	<h3 id="laplace-limits">Initial- and final-value theorems</h3>
	<Eqs items={[t`f(0^+)=\lim_{s\to\infty} sF(s)`, t`\lim_{t\to\infty} f(t)=\lim_{s\to 0} sF(s)`]} />
	<p>
		The initial-value theorem needs F(s) strictly proper. The final-value theorem only holds if
		every pole of <Tex math={t`sF(s)`} /> lies in the open left half-plane (it gives nonsense for oscillating
		or growing signals). Example: the DC gain of a filter is H(0), and the final value of its step response
		is <Tex math={t`\lim_{s\to0} s\cdot H(s)/s = H(0)`} />.
	</p>
	<p>
		<strong>Stability:</strong> a causal LTI system is BIBO-stable if and only if all poles of H(s)
		have negative real parts. Partial fractions
		<Tex math={t`H(s)=\sum_k \frac{r_k}{s-p_k}`} /> give the impulse response <Tex
			math={t`h(t)=\sum_k r_k e^{p_k t}u(t)`}
		/>.
	</p>
</Section>
