<script lang="ts">
	import Section from '../Section.svelte';
	import Eqs from '../Eqs.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import { toolHref } from '$lib/paths';

	const t = String.raw;
</script>

<Section id="discretization" title="Analog → digital mappings" tools={['discretization', 'iir-designer', 'calculators']}>
	<p>T = 1/f<sub>s</sub> is the sampling period, Ω the analog frequency (rad/s) and ω the digital frequency (rad/sample).</p>

	<div class="cols">
		<div>
			<h3 id="bilinear">Bilinear transform (Tustin)</h3>
			<Eqs items={[t`s=\frac{2}{T}\,\frac{1-z^{-1}}{1+z^{-1}}`, t`z=\frac{1+sT/2}{1-sT/2}`]} />
			<p>
				Maps the whole jΩ axis once onto the unit circle and the left half-plane inside it, so stability and the order are preserved and there is no
				aliasing — at the cost of compressing frequency:
			</p>
			<Eqs items={[t`\Omega=\frac{2}{T}\tan\frac{\omega}{2}`, t`\omega=2\arctan\frac{\Omega T}{2}`]} />
			<p>
				<strong>Prewarping:</strong> design the analog filter at <Tex math={t`\Omega_c=\frac{2}{T}\tan\frac{\omega_c}{2}=2f_s\tan\frac{\pi f_c}{f_s}`} /> so the
				critical frequency lands exactly at f<sub>c</sub>. (Equivalently use <Tex math={t`s=\frac{\Omega_c}{\tan(\omega_c/2)}\frac{1-z^{-1}}{1+z^{-1}}`} />.)
				Only one frequency per band edge can be matched exactly; the <a href={toolHref('calculators')}>prewarp calculator</a> does the arithmetic.
			</p>
		</div>
		<div>
			<h3 id="impulse-invariance">Impulse invariance</h3>
			<Eqs items={[t`h[n]=T\,h_a(nT)`, t`\sum_k\frac{r_k}{s-p_k}\;\to\;\sum_k\frac{T\,r_k}{1-e^{p_kT}z^{-1}}`]} />
			<Tex display math={t`H(e^{j\omega})=\sum_{m=-\infty}^{\infty}H_a\!\left(j\,\frac{\omega-2\pi m}{T}\right)`} />
			<p>
				Preserves the impulse response shape and the frequency axis (no warping) but aliases: only usable for responses that are already small near
				f<sub>s</sub>/2 (low-pass, band-pass) — never for high-pass or band-stop.
			</p>
		</div>
	</div>

	<div class="cols">
		<div>
			<h3 id="matched-z">Matched-Z</h3>
			<Tex display math={t`(s-a)\;\to\;(1-e^{aT}z^{-1})`} />
			<p>
				Applied to every pole and finite zero. Poles map exactly like impulse invariance; zeros at infinity are usually placed at z = −1 (Nyquist) and the gain matched at DC or another
				reference frequency. Simple, but zeros near Nyquist and the magnitude near f<sub>s</sub>/2 are inaccurate.
			</p>
		</div>
		<div>
			<h3 id="euler">Euler (finite-difference) methods</h3>
			<Eqs items={[t`\text{forward: } s=\frac{z-1}{T}`, t`\text{backward: } s=\frac{z-1}{zT}=\frac{1-z^{-1}}{T}`]} />
			<p>
				Forward Euler maps the left half-plane to the region left of z = 1, so stable analog poles can land outside the unit circle. Backward Euler maps
				it into the circle <Tex math={t`|z-\tfrac12|<\tfrac12`} />: always stable, but strongly damps resonances. Both are only accurate for
				<Tex math={t`|pT|\ll1`} />.
			</p>
		</div>
	</div>

	<h3 id="step-invariance">Step invariance (zero-order hold)</h3>
	<Tex display math={t`H(z)=(1-z^{-1})\,\mathcal{Z}\Big\{\mathcal{L}^{-1}\Big[\frac{H_a(s)}{s}\Big]_{t=nT}\Big\}`} />
	<p>Matches the step response at the sampling instants — the exact model of a plant driven by a DAC (zero-order hold). Each pole maps as z = e<sup>pT</sup>.</p>

	<div class="tw">
		<table>
			<thead><tr><th>Method</th><th>Stable → stable</th><th>Frequency axis</th><th>Aliasing</th><th>Best for</th></tr></thead>
			<tbody>
				<tr><td>Bilinear</td><td>yes</td><td>warped (tan)</td><td>none</td><td>general IIR design, EQs</td></tr>
				<tr><td>Impulse invariance</td><td>yes</td><td>linear</td><td>yes</td><td>low-pass/band-pass, time-domain fidelity</td></tr>
				<tr><td>Matched-Z</td><td>yes</td><td>linear (poles)</td><td>in the zeros</td><td>quick approximations</td></tr>
				<tr><td>Step invariance</td><td>yes</td><td>linear</td><td>yes</td><td>control (ZOH plants)</td></tr>
				<tr><td>Forward Euler</td><td>no</td><td>approximate</td><td>—</td><td>only at very high f<sub>s</sub></td></tr>
				<tr><td>Backward Euler</td><td>yes</td><td>approximate</td><td>—</td><td>simple, robust smoothing</td></tr>
			</tbody>
		</table>
	</div>
</Section>
