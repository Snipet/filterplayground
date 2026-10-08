<script lang="ts">
	import CalcCard from '../CalcCard.svelte';
	import Results, { type ResultRow } from '../Results.svelte';
	import NumberInput from '$lib/components/controls/NumberInput.svelte';
	import Segmented from '$lib/components/controls/Segmented.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import { formatSI, trimNumber } from '$lib/dsp/units';
	import { sPoleInfo, sPolesFromF0Q, zPoleFromF0Q, zPoleInfo, type PoleInfo } from '../math';

	let { id, title }: { id: string; title: string } = $props();

	let plane = $state<'s' | 'z'>('s');
	let dir = $state<'toF0' | 'toPole'>('toF0');
	let sigma = $state(-4442.9);
	let wd = $state(4442.9);
	let r = $state(0.95);
	let thetaDeg = $state(10);
	let fs = $state(48000);
	let f0 = $state(1000);
	let q = $state(Math.SQRT1_2);

	const fromPole = $derived.by((): PoleInfo | null => {
		if (plane === 's') return sigma < 0 ? sPoleInfo(sigma, Math.abs(wd)) : null;
		return r > 0 && r < 1 ? zPoleInfo(r, (Math.abs(thetaDeg) * Math.PI) / 180, fs) : null;
	});

	const rows = $derived.by((): ResultRow[] => {
		if (dir === 'toF0') {
			const p = fromPole;
			if (!p)
				return [
					{
						label: 'Pole',
						value: plane === 's' ? 'unstable (σ ≥ 0)' : 'unstable or invalid (need 0 < r < 1)'
					}
				];
			return [
				{ label: 'Natural frequency f₀', value: formatSI(p.f0, 'Hz', 5), primary: true },
				{ label: 'Quality factor Q', value: trimNumber(p.q, 5), primary: true },
				{ label: 'Damping ratio ζ', value: trimNumber(p.zeta, 5) },
				{
					label: 'Ringing frequency fd',
					value: formatSI(p.wd / (2 * Math.PI), 'Hz', 5),
					hint: 'Damped oscillation frequency ωd/2π'
				},
				{
					label: 'Envelope time constant',
					value:
						formatSI(p.tau, 's', 4) +
						(plane === 'z' ? ` (${trimNumber(p.tau * fs, 4)} samples)` : '')
				},
				{ label: 'Decay to −60 dB', value: formatSI(p.tau * Math.log(1000), 's', 4) }
			];
		}
		const poles = sPolesFromF0Q(f0, q);
		if (plane === 's') {
			const [a, b] = poles;
			return a.im !== 0
				? [
						{
							label: 'Poles s = σ ± jωd',
							value: `${trimNumber(a.re, 6)} ± j${trimNumber(a.im, 6)} rad/s`,
							primary: true
						},
						{ label: '|p| = ω₀', value: `${trimNumber(2 * Math.PI * f0, 6)} rad/s` },
						{
							label: 'Pole angle from −σ axis',
							value: `${trimNumber((Math.acos(1 / (2 * q)) * 180) / Math.PI, 5)}°`,
							hint: 'cos θ = ζ'
						}
					]
				: [
						{
							label: 'Two real poles (Q < 0.5)',
							value: `${trimNumber(a.re, 6)}, ${trimNumber(b.re, 6)} rad/s`,
							primary: true
						},
						{
							label: 'Corner frequencies',
							value: `${formatSI(-a.re / (2 * Math.PI), 'Hz', 4)}, ${formatSI(-b.re / (2 * Math.PI), 'Hz', 4)}`
						}
					];
		}
		const zp = zPoleFromF0Q(f0, q, fs);
		if (!zp) {
			const [a, b] = poles;
			return [
				{
					label: 'Two real poles z = e^(sT)',
					value: `${trimNumber(Math.exp(a.re / fs), 6)}, ${trimNumber(Math.exp(b.re / fs), 6)}`,
					primary: true
				}
			];
		}
		return [
			{ label: 'Pole radius r', value: trimNumber(zp.r, 7), primary: true },
			{
				label: 'Pole angle θ',
				value: `±${trimNumber((zp.theta * 180) / Math.PI, 6)}° (${trimNumber(zp.theta, 6)} rad)`,
				primary: true
			},
			{
				label: 'Denominator a₁, a₂',
				value: `${trimNumber(-2 * zp.r * Math.cos(zp.theta), 6)}, ${trimNumber(zp.r * zp.r, 6)}`,
				hint: '1 + a₁z⁻¹ + a₂z⁻² = 1 − 2r cos θ z⁻¹ + r² z⁻²'
			}
		];
	});
</script>

<CalcCard
	{id}
	{title}
	blurb="Read a complex pole pair as a resonance. The z-plane mapping is z = e^(sT) (impulse invariance / matched-Z), not the bilinear transform."
>
	{#snippet head()}
		<Segmented
			size="small"
			bind:value={plane}
			options={[
				{ value: 's', label: 's-plane' },
				{ value: 'z', label: 'z-plane' }
			]}
		/>
		<Segmented
			size="small"
			bind:value={dir}
			options={[
				{ value: 'toF0', label: 'Pole → f₀, Q' },
				{ value: 'toPole', label: 'f₀, Q → pole' }
			]}
		/>
	{/snippet}

	<div class="fields">
		{#if dir === 'toF0'}
			{#if plane === 's'}
				<NumberInput label="Real part σ" bind:value={sigma} unit="1/s" digits={6} />
				<NumberInput label="Imaginary part ±ωd" bind:value={wd} unit="rad/s" digits={6} min={0} />
			{:else}
				<NumberInput
					label="Pole radius r"
					bind:value={r}
					digits={8}
					min={0}
					max={1.5}
					step={0.001}
				/>
				<NumberInput
					label="Pole angle ±θ"
					bind:value={thetaDeg}
					unit="°"
					digits={6}
					min={0}
					max={180}
				/>
			{/if}
		{:else}
			<NumberInput
				label="Natural frequency f₀"
				bind:value={f0}
				unit="Hz"
				si
				min={1e-9}
				logStep={1.05}
			/>
			<NumberInput label="Quality factor Q" bind:value={q} digits={6} min={1e-6} logStep={1.05} />
		{/if}
		{#if plane === 'z'}<NumberInput
				label="Sample rate fs"
				bind:value={fs}
				unit="Hz"
				si
				min={1e-9}
				logStep={1.05}
			/>{/if}
	</div>
	<Results {rows} />

	{#snippet formula()}
		<Tex
			display
			math={'\\begin{gathered}p=-\\zeta\\omega_0\\pm j\\omega_0\\sqrt{1-\\zeta^2}\\\\[7pt] \\omega_0=|p|,\\qquad Q=\\frac{|p|}{2|\\sigma|}=\\frac{1}{2\\zeta}\\\\[7pt] z=e^{pT}:\\quad r=e^{\\sigma/f_s},\\quad\\theta=\\frac{\\omega_d}{f_s}\\\\[7pt] p = f_s\\,(\\ln r \\pm j\\theta)\\end{gathered}'}
		/>
	{/snippet}
</CalcCard>
