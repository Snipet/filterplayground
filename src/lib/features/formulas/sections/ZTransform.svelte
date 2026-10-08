<script lang="ts">
	import Section from '../Section.svelte';
	import Eqs from '../Eqs.svelte';
	import Tex from '$lib/components/content/Tex.svelte';

	const t = String.raw;

	const pairs: { x: string; X: string; roc: string }[] = [
		{ x: t`\delta[n]`, X: t`1`, roc: t`\text{all } z` },
		{ x: t`\delta[n-k]`, X: t`z^{-k}`, roc: t`z\neq0\;(k>0)` },
		{ x: t`u[n]`, X: t`\dfrac{1}{1-z^{-1}}`, roc: t`|z|>1` },
		{ x: t`a^n\,u[n]`, X: t`\dfrac{1}{1-az^{-1}}`, roc: t`|z|>|a|` },
		{ x: t`-a^n\,u[-n-1]`, X: t`\dfrac{1}{1-az^{-1}}`, roc: t`|z|<|a|` },
		{ x: t`n\,u[n]`, X: t`\dfrac{z^{-1}}{(1-z^{-1})^2}`, roc: t`|z|>1` },
		{ x: t`n\,a^n\,u[n]`, X: t`\dfrac{az^{-1}}{(1-az^{-1})^2}`, roc: t`|z|>|a|` },
		{ x: t`\cos(\omega_0 n)\,u[n]`, X: t`\dfrac{1-\cos\omega_0\,z^{-1}}{1-2\cos\omega_0\,z^{-1}+z^{-2}}`, roc: t`|z|>1` },
		{ x: t`\sin(\omega_0 n)\,u[n]`, X: t`\dfrac{\sin\omega_0\,z^{-1}}{1-2\cos\omega_0\,z^{-1}+z^{-2}}`, roc: t`|z|>1` },
		{ x: t`r^n\cos(\omega_0 n)\,u[n]`, X: t`\dfrac{1-r\cos\omega_0\,z^{-1}}{1-2r\cos\omega_0\,z^{-1}+r^2z^{-2}}`, roc: t`|z|>r` },
		{ x: t`r^n\sin(\omega_0 n)\,u[n]`, X: t`\dfrac{r\sin\omega_0\,z^{-1}}{1-2r\cos\omega_0\,z^{-1}+r^2z^{-2}}`, roc: t`|z|>r` }
	];

	const props: { name: string; x: string; X: string }[] = [
		{ name: 'Linearity', x: t`a\,x[n]+b\,y[n]`, X: t`a\,X(z)+b\,Y(z)` },
		{ name: 'Time shift', x: t`x[n-k]`, X: t`z^{-k}X(z)` },
		{ name: 'Modulation', x: t`a^n x[n]`, X: t`X(z/a)` },
		{ name: 'Time reversal', x: t`x[-n]`, X: t`X(1/z)` },
		{ name: 'Multiplication by n', x: t`n\,x[n]`, X: t`-z\dfrac{dX(z)}{dz}` },
		{ name: 'Convolution', x: t`(x*h)[n]=\sum_k x[k]\,h[n-k]`, X: t`X(z)\,H(z)` },
		{ name: 'Accumulation', x: t`\sum_{k=-\infty}^{n}x[k]`, X: t`\dfrac{X(z)}{1-z^{-1}}` },
		{ name: 'First difference', x: t`x[n]-x[n-1]`, X: t`(1-z^{-1})X(z)` }
	];
</script>

<Section id="z-transform" title="z-transform, DTFT and DFT" tools={['pole-zero', 'tf-analyzer', 'convolution', 'aliasing']}>
	<p>The z-transform does for difference equations what the Laplace transform does for differential equations. A delay of one sample is a factor z⁻¹.</p>
	<Eqs items={[t`X(z)=\sum_{n=-\infty}^{\infty}x[n]\,z^{-n}`, t`H(z)=\frac{Y(z)}{X(z)}=\frac{\sum_{k=0}^{M}b_k z^{-k}}{1+\sum_{k=1}^{N}a_k z^{-k}}`]} />
	<Tex display math={t`y[n]=\sum_{k=0}^{M}b_k\,x[n-k]-\sum_{k=1}^{N}a_k\,y[n-k]`} />
	<div class="cols">
		<div>
			<h3 id="z-pairs">Transform pairs</h3>
			<div class="tw">
				<table>
					<thead><tr><th>x[n]</th><th>X(z)</th><th>ROC</th></tr></thead>
					<tbody>
						{#each pairs as p (p.x)}
							<tr><td><Tex math={p.x} /></td><td><Tex math={p.X} /></td><td class="nw"><Tex math={p.roc} /></td></tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
		<div>
			<h3 id="z-properties">Properties</h3>
			<div class="tw">
				<table>
					<thead><tr><th>Property</th><th>Sequence</th><th>z-domain</th></tr></thead>
					<tbody>
						{#each props as p (p.name)}
							<tr><td>{p.name}</td><td><Tex math={p.x} /></td><td><Tex math={p.X} /></td></tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p>Initial and final values of a causal sequence:</p>
			<Eqs items={[t`x[0]=\lim_{z\to\infty}X(z)`, t`\lim_{n\to\infty}x[n]=\lim_{z\to1}(z-1)X(z)`]} />
			<p class="small-note">The final-value theorem needs all poles of (z − 1)X(z) strictly inside the unit circle. A causal system is stable iff all poles satisfy |p| &lt; 1.</p>
		</div>
	</div>

	<h3 id="dtft">DTFT, DFT and the s ↔ z link</h3>
	<div class="cols">
		<div>
			<p><strong>Discrete-time Fourier transform</strong> — the z-transform on the unit circle, periodic in ω with period 2π (ω in rad/sample):</p>
			<Eqs items={[t`X(e^{j\omega})=\sum_{n=-\infty}^{\infty}x[n]\,e^{-j\omega n}`, t`x[n]=\frac{1}{2\pi}\int_{-\pi}^{\pi}X(e^{j\omega})\,e^{j\omega n}\,d\omega`]} />
		</div>
		<div>
			<p><strong>Discrete Fourier transform</strong> of N samples (computed by the FFT); bin k sits at f<sub>k</sub> = k·f<sub>s</sub>/N:</p>
			<Eqs items={[t`X[k]=\sum_{n=0}^{N-1}x[n]\,e^{-j2\pi kn/N}`, t`x[n]=\frac{1}{N}\sum_{k=0}^{N-1}X[k]\,e^{j2\pi kn/N}`]} />
		</div>
	</div>
	<p>
		The DFT samples the DTFT at <Tex math={t`\omega_k=2\pi k/N`} />; multiplying DFTs corresponds to <em>circular</em> convolution, so zero-pad to at
		least N₁ + N₂ − 1 points for linear convolution.
	</p>
	<p>Sampling with period T = 1/f<sub>s</sub> relates the two planes and the two spectra:</p>
	<Eqs items={[t`z=e^{sT}`, t`\omega=\Omega T=2\pi\frac{f}{f_s}`, t`X(e^{j\omega})=\frac{1}{T}\sum_{k=-\infty}^{\infty}X_a\!\left(j\,\frac{\omega-2\pi k}{T}\right)`]} />
	<p>
		The jΩ axis wraps onto the unit circle (once every f<sub>s</sub>), the left half-plane maps inside it, and analog frequencies f and f + k·f<sub>s</sub>
		land on the same point — that is aliasing.
	</p>
</Section>
