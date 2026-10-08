<script lang="ts">
	import Section from '../Section.svelte';
	import Eqs from '../Eqs.svelte';
	import Tex from '$lib/components/content/Tex.svelte';

	const t = String.raw;

	const D = { a0: t`1+\alpha`, a1: t`-2\cos\omega_0`, a2: t`1-\alpha` };
	const rows: { name: string; b0: string; b1: string; b2: string; a0: string; a1: string; a2: string }[] = [
		{ name: 'LPF', b0: t`\frac{1-\cos\omega_0}{2}`, b1: t`1-\cos\omega_0`, b2: t`\frac{1-\cos\omega_0}{2}`, ...D },
		{ name: 'HPF', b0: t`\frac{1+\cos\omega_0}{2}`, b1: t`-(1+\cos\omega_0)`, b2: t`\frac{1+\cos\omega_0}{2}`, ...D },
		{ name: 'BPF (skirt gain, peak = Q)', b0: t`\frac{\sin\omega_0}{2}=Q\alpha`, b1: t`0`, b2: t`-\frac{\sin\omega_0}{2}`, ...D },
		{ name: 'BPF (0 dB peak)', b0: t`\alpha`, b1: t`0`, b2: t`-\alpha`, ...D },
		{ name: 'Notch', b0: t`1`, b1: t`-2\cos\omega_0`, b2: t`1`, ...D },
		{ name: 'APF', b0: t`1-\alpha`, b1: t`-2\cos\omega_0`, b2: t`1+\alpha`, ...D },
		{ name: 'PeakingEQ', b0: t`1+\alpha A`, b1: t`-2\cos\omega_0`, b2: t`1-\alpha A`, a0: t`1+\alpha/A`, a1: t`-2\cos\omega_0`, a2: t`1-\alpha/A` }
	];
</script>

<Section id="rbj-cookbook" title="Audio EQ Cookbook biquads (RBJ)" tools={['biquad', 'parametric-eq', 'structures']}>
	<p>
		Robert Bristow-Johnson's bilinear-transformed second-order sections. Every filter is
		<Tex math={t`H(z)=\dfrac{b_0+b_1z^{-1}+b_2z^{-2}}{a_0+a_1z^{-1}+a_2z^{-2}}`} />; divide all six coefficients by a₀ before use.
	</p>
	<h3 id="rbj-variables">Intermediate variables</h3>
	<div class="cols">
		<div>
			<Eqs items={[t`A=10^{\,\text{dBgain}/40}`, t`\omega_0=2\pi\frac{f_0}{F_s}`]} />
			<Eqs items={[t`\alpha=\frac{\sin\omega_0}{2Q}`, t`(\text{from }Q)`]} />
		</div>
		<div>
			<Eqs items={[t`\alpha=\sin\omega_0\,\sinh\!\Big(\frac{\ln 2}{2}\,\text{BW}\,\frac{\omega_0}{\sin\omega_0}\Big)`, t`(\text{BW in octaves})`]} />
			<Eqs items={[t`\alpha=\frac{\sin\omega_0}{2}\sqrt{\Big(A+\frac1A\Big)\Big(\frac1S-1\Big)+2}`, t`(\text{shelf slope }S)`]} />
		</div>
	</div>
	<p class="small-note">
		A is used by the peaking and shelving filters only. BW is measured between −3 dB points (BPF, notch) or midpoint-gain points (peakingEQ) in the digital domain. Shelf slope S = 1 is the steepest
		shelf that stays monotonic. Q, BW and S are alternatives: use one.
	</p>

	<h3 id="rbj-filters">Coefficients</h3>
	<div class="tw">
		<table class="rbj">
			<thead><tr><th>Type</th><th>b₀</th><th>b₁</th><th>b₂</th><th>a₀</th><th>a₁</th><th>a₂</th></tr></thead>
			<tbody>
				{#each rows as r (r.name)}
					<tr>
						<td>{r.name}</td>
						<td><Tex math={r.b0} /></td>
						<td><Tex math={r.b1} /></td>
						<td><Tex math={r.b2} /></td>
						<td><Tex math={r.a0} /></td>
						<td><Tex math={r.a1} /></td>
						<td><Tex math={r.a2} /></td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<div class="cols">
		<div>
			<h3 id="rbj-lowshelf">Low shelf</h3>
			<Tex display math={t`\begin{aligned}b_0&=A\big[(A+1)-(A-1)\cos\omega_0+2\sqrt A\,\alpha\big]\\ b_1&=2A\big[(A-1)-(A+1)\cos\omega_0\big]\\ b_2&=A\big[(A+1)-(A-1)\cos\omega_0-2\sqrt A\,\alpha\big]\\ a_0&=(A+1)+(A-1)\cos\omega_0+2\sqrt A\,\alpha\\ a_1&=-2\big[(A-1)+(A+1)\cos\omega_0\big]\\ a_2&=(A+1)+(A-1)\cos\omega_0-2\sqrt A\,\alpha\end{aligned}`} />
		</div>
		<div>
			<h3 id="rbj-highshelf">High shelf</h3>
			<Tex display math={t`\begin{aligned}b_0&=A\big[(A+1)+(A-1)\cos\omega_0+2\sqrt A\,\alpha\big]\\ b_1&=-2A\big[(A-1)+(A+1)\cos\omega_0\big]\\ b_2&=A\big[(A+1)+(A-1)\cos\omega_0-2\sqrt A\,\alpha\big]\\ a_0&=(A+1)-(A-1)\cos\omega_0+2\sqrt A\,\alpha\\ a_1&=2\big[(A-1)-(A+1)\cos\omega_0\big]\\ a_2&=(A+1)-(A-1)\cos\omega_0-2\sqrt A\,\alpha\end{aligned}`} />
		</div>
	</div>
	<p>
		All second-order types share the denominator 1 + α, −2cos ω₀, 1 − α (except peaking and shelving), so they have the same poles for a given f₀ and
		Q. Analog prototypes (normalised to ω₀ = 1): LPF <Tex math={t`\frac{1}{s^2+s/Q+1}`} />, peakingEQ
		<Tex math={t`\frac{s^2+s\,A/Q+1}{s^2+s/(AQ)+1}`} />, low shelf <Tex math={t`A\,\frac{s^2+\sqrt A\,s/Q+A}{As^2+\sqrt A\,s/Q+1}`} />.
	</p>
</Section>

<style>
	.rbj td {
		white-space: nowrap;
	}
</style>
