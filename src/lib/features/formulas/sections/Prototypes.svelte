<script lang="ts">
	import Section from '../Section.svelte';
	import Eqs from '../Eqs.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import { toolHref } from '$lib/paths';

	const t = String.raw;

	const bessel: { n: number; p: string; w3: string }[] = [
		{ n: 1, p: t`s+1`, w3: '1.0000' },
		{ n: 2, p: t`s^2+3s+3`, w3: '1.3617' },
		{ n: 3, p: t`s^3+6s^2+15s+15`, w3: '1.7557' },
		{ n: 4, p: t`s^4+10s^3+45s^2+105s+105`, w3: '2.1139' },
		{ n: 5, p: t`s^5+15s^4+105s^3+420s^2+945s+945`, w3: '2.4274' },
		{ n: 6, p: t`s^6+21s^5+210s^4+1260s^3+4725s^2+10395s+10395`, w3: '2.7034' }
	];
</script>

<Section id="prototypes" title="Analog low-pass prototypes" tools={['analog-designer', 'family-compare', 'pole-zero']}>
	<p>
		Prototypes are normalised to a cutoff of 1 rad/s; scale by <Tex math={t`s\to s/\omega_c`} /> (see the frequency transformations below). Ripple
		factors: <Tex math={t`\varepsilon_p=\sqrt{10^{R_p/10}-1}`} />, <Tex math={t`\varepsilon_s=\sqrt{10^{R_s/10}-1}`} />.
	</p>

	<div class="cols">
		<div>
			<h3 id="butterworth">Butterworth (maximally flat)</h3>
			<Eqs items={[t`|H(j\omega)|^2=\frac{1}{1+\omega^{2N}}`, t`p_k=e^{\,j\pi(2k+N-1)/(2N)},\quad k=1,\dots,N`]} />
			<p>
				Compare all the families side by side in the <a href={toolHref('family-compare')}>family comparison</a>. The poles are equally spaced on the unit circle in the left half-plane: <Tex math={t`p_k=-\sin\theta_k+j\cos\theta_k`} /> with
				<Tex math={t`\theta_k=\frac{(2k-1)\pi}{2N}`} />, so each pair has <Tex math={t`Q_k=\frac{1}{2\sin\theta_k}`} />. −3 dB at ω = 1 for every N.
			</p>
		</div>
		<div>
			<h3 id="chebyshev-1">Chebyshev type I (equiripple passband)</h3>
			<Eqs items={[t`|H(j\omega)|^2=\frac{1}{1+\varepsilon^2T_N^2(\omega)}`, t`\varepsilon=\varepsilon_p`, t`\mu=\frac{1}{N}\operatorname{asinh}\frac{1}{\varepsilon}`]} />
			<Eqs items={[t`p_k=-\sinh\mu\,\sin\theta_k+j\cosh\mu\,\cos\theta_k`, t`\theta_k=\frac{(2k-1)\pi}{2N}`]} />
			<p>
				The poles lie on an ellipse. The passband ripples between 1 and <Tex math={t`1/\sqrt{1+\varepsilon^2}`} />; the gain at DC is 1 for odd N and
				<Tex math={t`1/\sqrt{1+\varepsilon^2}`} /> for even N. The −3 dB frequency is <Tex math={t`\cosh\!\big(\tfrac1N\operatorname{acosh}\tfrac1\varepsilon\big)`} /> (for ε &lt; 1).
			</p>
			<Eqs items={[t`T_N(x)=\begin{cases}\cos(N\arccos x) & |x|\le1\\ \cosh(N\operatorname{arccosh}x) & |x|>1\end{cases}`, t`T_{N+1}=2xT_N-T_{N-1}`]} />
		</div>
	</div>

	<div class="cols">
		<div>
			<h3 id="chebyshev-2">Chebyshev type II (inverse Chebyshev)</h3>
			<Eqs items={[t`|H(j\omega)|^2=\frac{\varepsilon^2T_N^2(1/\omega)}{1+\varepsilon^2T_N^2(1/\omega)}`, t`\varepsilon=\frac{1}{\varepsilon_s}=\frac{1}{\sqrt{10^{R_s/10}-1}}`]} />
			<p>
				Normalised to the <em>stopband</em> edge: the attenuation is exactly R<sub>s</sub> at ω = 1 and never less beyond it. Zeros on the jω axis at
				<Tex math={t`z_k=\pm j\sec\theta_k`} /> (the one at infinity is dropped for odd N); the poles are the reciprocals <Tex math={t`p_k=1/q_k`} /> of
				Chebyshev-I-shaped poles <Tex math={t`q_k`} /> computed with this ε.
			</p>
		</div>
		<div>
			<h3 id="elliptic">Elliptic (Cauer)</h3>
			<Eqs items={[t`|H(j\omega)|^2=\frac{1}{1+\varepsilon_p^2\,R_N^2(\omega)}`, t`k=\frac{\omega_p}{\omega_s}`, t`k_1=\frac{\varepsilon_p}{\varepsilon_s}`]} />
			<p>The degree equation ties the order to selectivity and discrimination (K = complete elliptic integral, <Tex math={t`K'(k)=K(\sqrt{1-k^2})`} />):</p>
			<Tex display math={t`N\,\frac{K'(k)}{K(k)}=\frac{K'(k_1)}{K(k_1)}`} />
			<p>With <Tex math={t`u_i=\frac{2i-1}{N}`} />, i = 1…⌊N/2⌋, and Jacobi elliptic functions of modulus k (Orfanidis' form):</p>
			<Eqs items={[t`z_i=\frac{j}{k\,\operatorname{cd}(u_iK,k)}`, t`p_i=j\,\operatorname{cd}\big((u_i-jv_0)K,\,k\big)`, t`v_0=\frac{F\big(\arctan(1/\varepsilon_p),\,k_1'\big)}{N\,K(k_1)}`]} />
			<p class="small-note">Odd N adds the real pole <Tex math={t`p_0=j\,\operatorname{sn}(jv_0K,k)`} />. R<sub>N</sub> is the Chebyshev (elliptic) rational function; F is the incomplete elliptic integral of the first kind.</p>
		</div>
	</div>

	<h3 id="bessel">Bessel–Thomson (maximally flat delay)</h3>
	<Eqs items={[t`H(s)=\frac{\theta_N(0)}{\theta_N(s)}`, t`\theta_N(s)=\sum_{k=0}^{N}\frac{(2N-k)!}{2^{N-k}\,k!\,(N-k)!}\,s^k`, t`\theta_N=(2N-1)\,\theta_{N-1}+s^2\,\theta_{N-2}`]} />
	<p>
		with θ₀ = 1, θ₁ = s + 1. These reverse Bessel polynomials give a group delay of exactly 1 s at DC that stays flat as long as possible; the −3 dB
		frequency of this delay-normalised form grows with N:
	</p>
	<div class="tw">
		<table>
			<thead><tr><th class="num">N</th><th>θ<sub>N</sub>(s)</th><th class="num">ω<sub>−3 dB</sub> (rad/s)</th></tr></thead>
			<tbody>
				{#each bessel as b (b.n)}<tr><td class="num">{b.n}</td><td><Tex math={b.p} /></td><td class="num">{b.w3}</td></tr>{/each}
			</tbody>
		</table>
	</div>
	<p class="small-note">
		Divide s by ω<sub>−3 dB</sub> for a −3 dB cutoff at 1 rad/s (SciPy <code>norm='mag'</code>); SciPy's default <code>norm='phase'</code> instead places the
		phase midpoint (−Nπ/4) at the cutoff.
	</p>
</Section>
