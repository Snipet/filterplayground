<script lang="ts">
	import Section from '../Section.svelte';
	import Eqs from '../Eqs.svelte';
	import Tex from '$lib/components/content/Tex.svelte';

	const t = String.raw;

	// Metrics computed with the site's windowMetrics() for N = 512 (periodic / DFT-even);
	// they agree with Harris (1978) to the precision shown.
	const rows: { name: string; w: string; psl: string; roll: string; enbw: string; w3: string; mainlobe: string; scallop: string }[] = [
		{ name: 'Rectangular', w: t`1`, psl: '−13.3', roll: '−6', enbw: '1.00', w3: '0.89', mainlobe: '2', scallop: '3.92' },
		{ name: 'Hann', w: t`0.5-0.5\cos\frac{2\pi n}{M}`, psl: '−31.5', roll: '−18', enbw: '1.50', w3: '1.44', mainlobe: '4', scallop: '1.42' },
		{ name: 'Hamming', w: t`0.54-0.46\cos\frac{2\pi n}{M}`, psl: '−42.7', roll: '−6', enbw: '1.36', w3: '1.30', mainlobe: '4', scallop: '1.75' },
		{ name: 'Blackman', w: t`0.42-0.5\cos\frac{2\pi n}{M}+0.08\cos\frac{4\pi n}{M}`, psl: '−58.1', roll: '−18', enbw: '1.73', w3: '1.64', mainlobe: '6', scallop: '1.10' },
		{ name: 'Blackman–Harris (4-term)', w: t`\textstyle\sum_{k=0}^{3}(-1)^k a_k\cos\frac{2\pi kn}{M}`, psl: '−92.0', roll: '−6', enbw: '2.00', w3: '1.90', mainlobe: '8', scallop: '0.83' },
		{ name: 'Kaiser, β = 2π', w: t`\frac{I_0\big(\beta\sqrt{1-(2n/M-1)^2}\big)}{I_0(\beta)}`, psl: '−45.9', roll: '−6', enbw: '1.50', w3: '1.43', mainlobe: '4.47', scallop: '1.45' },
		{ name: 'Kaiser, β = 3π', w: t`\text{(same, larger }\beta)`, psl: '−69.6', roll: '−6', enbw: '1.80', w3: '1.71', mainlobe: '6.32', scallop: '1.02' },
		{ name: 'Gaussian, σ = 0.4', w: t`\exp\!\Big[-\frac12\Big(\frac{n-M/2}{\sigma M/2}\Big)^2\Big]`, psl: '−43.3', roll: '−6', enbw: '1.45', w3: '1.37', mainlobe: '—', scallop: '1.58' },
		{ name: 'Tukey, α = 0.5', w: t`\text{flat centre, cosine tapers over }\alpha M/2\text{ each end}`, psl: '−15.1', roll: '−18', enbw: '1.22', w3: '1.15', mainlobe: '2.66', scallop: '2.24' }
	];
</script>

<Section id="windows" title="Window functions" tools={['windows', 'fir-designer']}>
	<p>
		Symmetric windows for filter design use n = 0 … M with M = N − 1; for spectral analysis use the periodic (DFT-even) form with M = N. Widths are in DFT
		bins (multiples of f<sub>s</sub>/N): ENBW, −3 dB bandwidth and the null-to-null main-lobe width. Peak sidelobe and scalloping loss are in dB, sidelobe
		roll-off in dB/octave.
	</p>
	<div class="tw">
		<table class="win">
			<thead>
				<tr>
					<th>Window</th>
					<th>w[n]</th>
					<th class="num">Peak sidelobe</th>
					<th class="num">Roll-off</th>
					<th class="num">ENBW</th>
					<th class="num">−3 dB BW</th>
					<th class="num">Main lobe</th>
					<th class="num">Scallop</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as r (r.name)}
					<tr>
						<td class="nw">{r.name}</td>
						<td><Tex math={r.w} /></td>
						<td class="num">{r.psl}</td>
						<td class="num">{r.roll}</td>
						<td class="num">{r.enbw}</td>
						<td class="num">{r.w3}</td>
						<td class="num">{r.mainlobe}</td>
						<td class="num">{r.scallop}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<p class="small-note">
		Blackman–Harris: a₀ = 0.35875, a₁ = 0.48829, a₂ = 0.14128, a₃ = 0.01168. Kaiser β = πα in Harris' notation. Gaussian σ is relative to the half-length.
		Tukey: <Tex math={t`w=\tfrac12\big[1+\cos\big(\pi(\tfrac{2n}{\alpha M}-1)\big)\big]`} /> for <Tex math={t`n<\alpha M/2`} />, mirrored at the end, 1 in between (α = 0 → rectangular, α = 1 → Hann).
	</p>
	<div class="cols">
		<div>
			<h3 id="window-metrics">Metric definitions</h3>
			<p>Equivalent noise bandwidth, coherent gain and scalloping loss (SL, the dip for a tone halfway between two bins):</p>
			<Eqs items={[t`\text{ENBW}=N\,\frac{\sum_n w[n]^2}{\big(\sum_n w[n]\big)^2}\;\text{bins}`, t`\text{coherent gain}=\frac{1}{N}\sum_n w[n]`]} />
			<Tex display math={t`\text{SL}=-20\log_{10}\frac{\big|\sum_n w[n]\,e^{-j\pi n/N}\big|}{\sum_n w[n]}`} />
		</div>
		<div>
			<h3 id="window-tradeoff">Trade-off</h3>
			<p>
				A narrower main lobe resolves close tones and gives a sharper FIR transition; lower sidelobes reduce leakage and stopband ripple. Smooth windows
				(continuous derivatives at the ends) have fast-decaying far sidelobes. Dolph–Chebyshev windows give the narrowest main lobe for a given
				(equiripple) sidelobe level; DPSS (Slepian) windows maximise the energy within a chosen bandwidth, which Kaiser approximates.
			</p>
		</div>
	</div>
</Section>

<style>
	.win td,
	.win th {
		font-size: 0.86rem;
	}
</style>
