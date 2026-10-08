<script lang="ts">
	import Section from '../Section.svelte';
	import Eqs from '../Eqs.svelte';
	import Tex from '$lib/components/content/Tex.svelte';

	const t = String.raw;
</script>

<Section id="fir" title="FIR filter design" tools={['fir-designer', 'linear-phase', 'special-fir', 'convolution']}>
	<p>An N-tap FIR filter (order M = N − 1) computes a finite weighted sum; it has no feedback, so it is always stable.</p>
	<Eqs items={[t`y[n]=\sum_{k=0}^{N-1}h[k]\,x[n-k]`, t`H(e^{j\omega})=\sum_{k=0}^{N-1}h[k]\,e^{-j\omega k}`]} />

	<div class="cols">
		<div>
			<h3 id="ideal-lowpass">Ideal responses and the window method</h3>
			<p>With cutoff f<sub>c</sub> in cycles/sample (<Tex math={t`\omega_c=2\pi f_c`} />) and <Tex math={t`\operatorname{sinc}x=\frac{\sin\pi x}{\pi x}`} />, delayed by M/2 to make it causal:</p>
			<Eqs items={[t`h_{LP}[n]=\frac{\sin\big(\omega_c(n-\frac M2)\big)}{\pi(n-\frac M2)}`, t`=2f_c\operatorname{sinc}\!\big(2f_c(n-\tfrac M2)\big)`]} />
			<Eqs items={[t`h_{HP}=\delta[n-\tfrac M2]-h_{LP}`, t`h_{BP}=h_{LP,f_2}-h_{LP,f_1}`, t`h_{BS}=\delta[n-\tfrac M2]-h_{BP}`]} />
			<Eqs items={[t`h[n]=h_d[n]\,w[n]`, t`n=0,\dots,M`]} />
			<p>
				Truncation convolves the ideal response with the window's spectrum: the main-lobe width sets the transition width and the sidelobes set the
				ripple (Gibbs phenomenon), equally in both bands. High-pass and band-stop designs need odd N.
			</p>
		</div>
		<div>
			<h3 id="kaiser-formulas">Kaiser window design</h3>
			<Eqs items={[t`w[n]=\frac{I_0\!\Big(\beta\sqrt{1-\big(\frac{2n}{M}-1\big)^2}\Big)}{I_0(\beta)}`, t`A=-20\log_{10}\min(\delta_p,\delta_s)`]} />
			<Tex display math={t`\beta=\begin{cases}0.1102\,(A-8.7) & A>50\\ 0.5842\,(A-21)^{0.4}+0.07886\,(A-21) & 21\le A\le50\\ 0 & A<21\end{cases}`} />
			<Eqs items={[t`N\approx\frac{A-7.95}{14.36\,\Delta f}+1`, t`\Delta f=\frac{|f_\text{stop}-f_\text{pass}|}{f_s}`]} />
			<p class="small-note">I₀ is the zeroth-order modified Bessel function of the first kind. In SciPy, <code>kaiserord(A, 2Δf)</code> (width relative to Nyquist).</p>
		</div>
	</div>

	<h3 id="fir-length">Equiripple (Parks–McClellan) length estimates</h3>
	<div class="cols">
		<div>
			<p>Herrmann, Rabiner &amp; Chan (1973), with <Tex math={t`L_p=\log_{10}\delta_p`} />, <Tex math={t`L_s=\log_{10}\delta_s`} />:</p>
			<Tex display math={t`N\approx\frac{D_\infty(\delta_p,\delta_s)}{\Delta f}-f(\delta_p,\delta_s)\,\Delta f+1`} />
			<Tex display math={t`D_\infty=(a_1L_p^2+a_2L_p+a_3)L_s+(a_4L_p^2+a_5L_p+a_6)`} />
			<Tex display math={t`f(\delta_p,\delta_s)=11.01217+0.51244\,(L_p-L_s)`} />
			<p class="small-note">a₁ = 5.309·10⁻³, a₂ = 7.114·10⁻², a₃ = −0.4761, a₄ = −2.66·10⁻³, a₅ = −0.5941, a₆ = −0.4278.</p>
		</div>
		<div>
			<p>Simpler rules of thumb (Kaiser; Bellanger):</p>
			<Eqs items={[t`N\approx\frac{-20\log_{10}\sqrt{\delta_p\delta_s}-13}{14.6\,\Delta f}+1`, t`N\approx\frac{2}{3\,\Delta f}\log_{10}\frac{1}{10\,\delta_p\delta_s}`]} />
			<p>Ripple specs in dB convert as (passband 1 ± δ<sub>p</sub>):</p>
			<Eqs items={[t`\delta_p=\frac{10^{R_p/20}-1}{10^{R_p/20}+1}`, t`\delta_s=10^{-R_s/20}`]} />
			<p>Fixed-window rules (transition Δf, attenuation): Hann 3.1/N, 44 dB · Hamming 3.3/N, 53 dB · Blackman 5.5/N, 74 dB.</p>
		</div>
	</div>

	<h3 id="linear-phase-types">Linear-phase FIR types</h3>
	<p>
		Symmetric or antisymmetric coefficients give exactly linear phase: <Tex math={t`H(e^{j\omega})=A(\omega)\,e^{-j\omega M/2}`} /> (types I, II) or
		<Tex math={t`A(\omega)\,e^{\,j(\pi/2-\omega M/2)}`} /> (types III, IV), with A(ω) real. The group delay is M/2 samples at every frequency, and zeros
		come in groups <Tex math={t`\{z,\,z^*,\,1/z,\,1/z^*\}`} />.
	</p>
	<div class="tw">
		<table>
			<thead><tr><th>Type</th><th>Symmetry</th><th>Length N</th><th>Forced zeros</th><th>A(ω) at 0 / π</th><th>Usable for</th></tr></thead>
			<tbody>
				<tr><td>I</td><td><Tex math={t`h[n]=h[M-n]`} /></td><td>odd</td><td>none</td><td>any / any</td><td>LP, HP, BP, BS — everything</td></tr>
				<tr><td>II</td><td><Tex math={t`h[n]=h[M-n]`} /></td><td>even</td><td>z = −1</td><td>any / 0</td><td>LP, BP (not HP, BS)</td></tr>
				<tr><td>III</td><td><Tex math={t`h[n]=-h[M-n]`} /></td><td>odd</td><td>z = ±1</td><td>0 / 0</td><td>BP, Hilbert transformers, band-limited differentiators</td></tr>
				<tr><td>IV</td><td><Tex math={t`h[n]=-h[M-n]`} /></td><td>even</td><td>z = +1</td><td>0 / any</td><td>HP, BP, differentiators, Hilbert transformers</td></tr>
			</tbody>
		</table>
	</div>
	<p>For example, the real amplitude of a type I filter is</p>
	<Tex display math={t`A(\omega)=h\big[\tfrac M2\big]+2\sum_{k=1}^{M/2}h\big[\tfrac M2-k\big]\cos(\omega k)`} />
	<p>
		<strong>Other methods:</strong> least squares (minimise the integrated squared error, <code>firls</code>), frequency sampling (specify H at N equally
		spaced frequencies and inverse-DFT), and minimum-phase conversion (same magnitude, smallest delay, non-linear phase).
	</p>
</Section>
