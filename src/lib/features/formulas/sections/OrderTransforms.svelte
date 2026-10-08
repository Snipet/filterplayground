<script lang="ts">
	import Section from '../Section.svelte';
	import Tex from '$lib/components/content/Tex.svelte';

	const t = String.raw;
</script>

<Section id="order-transformations" title="Order estimation and frequency transformations" tools={['order-calculator', 'analog-designer', 'iir-designer']}>
	<h3 id="order-formulas">Minimum order</h3>
	<p>
		For a low-pass spec with passband edge ω<sub>p</sub>, stopband edge ω<sub>s</sub>, selectivity <Tex math={t`k=\omega_p/\omega_s`} /> and
		discrimination <Tex math={t`k_1=\varepsilon_p/\varepsilon_s=\sqrt{(10^{R_p/10}-1)/(10^{R_s/10}-1)}`} />:
	</p>
	<div class="tw">
		<table>
			<thead><tr><th>Family</th><th>Order</th><th>Cutoff to use</th></tr></thead>
			<tbody>
				<tr>
					<td>Butterworth</td>
					<td><Tex math={t`N\ge\dfrac{\log_{10}\big[(10^{R_s/10}-1)/(10^{R_p/10}-1)\big]}{2\log_{10}(\omega_s/\omega_p)}`} /></td>
					<td><Tex math={t`\omega_c=\omega_p\,(10^{R_p/10}-1)^{-1/(2N)}`} /> <span class="small">(meets R<sub>p</sub> exactly)</span></td>
				</tr>
				<tr>
					<td>Chebyshev I / II</td>
					<td><Tex math={t`N\ge\dfrac{\operatorname{arccosh}(1/k_1)}{\operatorname{arccosh}(1/k)}`} /></td>
					<td>I: ω<sub>p</sub>; II: <Tex math={t`\omega_p\cosh\!\big(\tfrac1N\operatorname{arccosh}\tfrac{1}{k_1}\big)`} /></td>
				</tr>
				<tr>
					<td>Elliptic</td>
					<td><Tex math={t`N\ge\dfrac{K(k)\,K'(k_1)}{K'(k)\,K(k_1)}`} /></td>
					<td>ω<sub>p</sub></td>
				</tr>
			</tbody>
		</table>
	</div>
	<p>
		High-pass specs use <Tex math={t`\Omega_s=\omega_p/\omega_s`} />; band-pass specs map each stopband edge through the LP→BP transformation and keep the
		tighter one, <Tex math={t`\Omega_s=\min_i\big|\omega_{s,i}^2-\omega_0^2\big|/(B\,\omega_{s,i})`} />. Digital specs are prewarped first.
	</p>

	<h3 id="frequency-transformations">Analog frequency transformations</h3>
	<p>Substitute into a prototype with cutoff 1 rad/s. ω₀ = √(ω₁ω₂) is the geometric centre and B = ω₂ − ω₁ the bandwidth of a band filter.</p>
	<div class="tw">
		<table>
			<thead><tr><th>Target</th><th>Substitution</th><th>Effect</th></tr></thead>
			<tbody>
				<tr><td>Low-pass</td><td><Tex math={t`s\to\dfrac{s}{\omega_c}`} /></td><td class="small">poles and zeros scale by ω<sub>c</sub></td></tr>
				<tr><td>High-pass</td><td><Tex math={t`s\to\dfrac{\omega_c}{s}`} /></td><td class="small">p → ω<sub>c</sub>/p; N − M zeros appear at s = 0</td></tr>
				<tr><td>Band-pass</td><td><Tex math={t`s\to\dfrac{s^2+\omega_0^2}{B\,s}`} /></td><td class="small">each pole splits in two; order doubles; zeros at 0 and ∞</td></tr>
				<tr><td>Band-stop</td><td><Tex math={t`s\to\dfrac{B\,s}{s^2+\omega_0^2}`} /></td><td class="small">order doubles; zeros at ±jω₀</td></tr>
			</tbody>
		</table>
	</div>
	<p>The band-pass mapping sends prototype frequency Ω to the pair <Tex math={t`\omega=\tfrac{1}{2}\big(\pm B\Omega+\sqrt{B^2\Omega^2+4\omega_0^2}\big)`} />, so band edges are geometrically symmetric about ω₀.</p>

	<h3 id="digital-transformations">Digital (Constantinides) transformations</h3>
	<p>Move the cutoff θ<sub>p</sub> of a digital low-pass prototype to ω<sub>p</sub> by an all-pass substitution of z⁻¹ (frequencies in rad/sample):</p>
	<div class="tw">
		<table>
			<thead><tr><th>Target</th><th>Substitute for z⁻¹</th><th>α</th></tr></thead>
			<tbody>
				<tr><td>Low-pass</td><td><Tex math={t`\dfrac{z^{-1}-\alpha}{1-\alpha z^{-1}}`} /></td><td><Tex math={t`\alpha=\dfrac{\sin\big((\theta_p-\omega_p)/2\big)}{\sin\big((\theta_p+\omega_p)/2\big)}`} /></td></tr>
				<tr><td>High-pass</td><td><Tex math={t`-\dfrac{z^{-1}+\alpha}{1+\alpha z^{-1}}`} /></td><td><Tex math={t`\alpha=-\dfrac{\cos\big((\theta_p+\omega_p)/2\big)}{\cos\big((\theta_p-\omega_p)/2\big)}`} /></td></tr>
			</tbody>
		</table>
	</div>
</Section>
