<script lang="ts">
	import Section from '../Section.svelte';
	import Eqs from '../Eqs.svelte';
	import Tex from '$lib/components/content/Tex.svelte';

	const t = String.raw;

	const db: { db: string; amp: string; pow: string }[] = [
		{ db: '+20', amp: '10', pow: '100' },
		{ db: '+6.02', amp: '2', pow: '4' },
		{ db: '+3.01', amp: '√2 ≈ 1.414', pow: '2' },
		{ db: '0', amp: '1', pow: '1' },
		{ db: '−3.01', amp: '1/√2 ≈ 0.707', pow: '0.5' },
		{ db: '−6.02', amp: '0.5', pow: '0.25' },
		{ db: '−20', amp: '0.1', pow: '0.01' },
		{ db: '−40', amp: '0.01', pow: '10⁻⁴' },
		{ db: '−60', amp: '0.001', pow: '10⁻⁶' }
	];
</script>

<Section id="delay-db-sampling" title="Delay, decibels, energy and sampling" tools={['linear-phase', 'aliasing', 'calculators', 'tf-analyzer']}>
	<div class="cols">
		<div>
			<h3 id="group-delay">Group delay and phase delay</h3>
			<p>With φ(ω) the (unwrapped) phase of H(jω) or H(e<sup>jω</sup>):</p>
			<Eqs items={[t`\tau_g(\omega)=-\frac{d\varphi(\omega)}{d\omega}`, t`\tau_p(\omega)=-\frac{\varphi(\omega)}{\omega}`]} />
			<p>
				Group delay is the delay of a narrow-band envelope; phase delay is the delay of the carrier. They are equal and constant for a pure delay and for
				linear-phase FIRs (<Tex math={t`\tau=M/2`} /> samples). Digital values are in samples — divide by f<sub>s</sub> for seconds. A factor
				<Tex math={t`(1-re^{j\theta}z^{-1})`} /> contributes the following (a pole contributes the negative):
			</p>
			<Tex display math={t`\tau_g(\omega)=\frac{r^2-r\cos(\omega-\theta)}{1-2r\cos(\omega-\theta)+r^2}`} />
		</div>
		<div>
			<h3 id="decibels">Decibels</h3>
			<Tex display math={t`L=10\log_{10}\frac{P_2}{P_1}=20\log_{10}\frac{V_2}{V_1}`} />
			<p>References: dBV re 1 V, dBu re 0.7746 V (1 mW in 600 Ω), dBm re 1 mW, dBFS re full scale.</p>
			<div class="tw">
				<table>
					<thead><tr><th class="num">dB</th><th class="num">Amplitude ratio</th><th class="num">Power ratio</th></tr></thead>
					<tbody>
						{#each db as r (r.db)}<tr><td class="num">{r.db}</td><td class="num">{r.amp}</td><td class="num">{r.pow}</td></tr>{/each}
					</tbody>
				</table>
			</div>
		</div>
	</div>

	<div class="cols">
		<div>
			<h3 id="parseval">Parseval's theorem</h3>
			<Eqs items={[t`\int_{-\infty}^{\infty}|x(t)|^2dt=\int_{-\infty}^{\infty}|X(f)|^2df`, t`\sum_n|x[n]|^2=\frac{1}{2\pi}\int_{-\pi}^{\pi}|X(e^{j\omega})|^2d\omega`]} />
			<Tex display math={t`\text{DFT: }\sum_{n=0}^{N-1}|x[n]|^2=\frac1N\sum_{k=0}^{N-1}|X[k]|^2`} />
			<p>
				Consequence: white noise of variance σ² through h[n] has output variance <Tex math={t`\sigma^2\sum_n h[n]^2`} />. The equivalent noise bandwidth
				of an analog low-pass is <Tex math={t`B_n=\frac{1}{|H_{\max}|^2}\int_0^\infty|H(f)|^2df`} />; for an N-th-order Butterworth
				<Tex math={t`B_n=f_c\,\frac{\pi/(2N)}{\sin(\pi/(2N))}`} /> (π/2·f<sub>c</sub> for first order).
			</p>
		</div>
		<div>
			<h3 id="sampling-theorem">Nyquist–Shannon sampling theorem</h3>
			<p>A signal containing no energy at or above B Hz is completely determined by samples taken at <Tex math={t`f_s>2B`} />, and is recovered by sinc interpolation:</p>
			<Eqs items={[t`x(t)=\sum_{n=-\infty}^{\infty}x[n]\,\operatorname{sinc}\!\Big(\frac{t-nT}{T}\Big)`, t`\operatorname{sinc}u=\frac{\sin\pi u}{\pi u}`]} />
			<p>
				A tone at f appears at <Tex math={t`|f-k f_s|`} /> for the integer k that brings it into [0, f<sub>s</sub>/2] — aliasing. Ideal quantisation to B bits
				gives <Tex math={t`\text{SNR}\approx6.02B+1.76\text{ dB}`} /> for a full-scale sine; a zero-order-hold DAC adds a
				<Tex math={t`\operatorname{sinc}(f/f_s)`} /> droop (−3.92 dB at f<sub>s</sub>/2).
			</p>
		</div>
	</div>
</Section>
