<script lang="ts">
	import Section from '../Section.svelte';
	import Eqs from '../Eqs.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import { overshoot } from '$lib/features/calculators/math';
	import { trimNumber } from '$lib/dsp/units';

	const t = String.raw;

	const first: { name: string; H: string; note: string }[] = [
		{
			name: 'Low-pass',
			H: t`\dfrac{\omega_c}{s+\omega_c}`,
			note: '−3 dB and −45° at the corner; −20 dB/decade above'
		},
		{
			name: 'High-pass',
			H: t`\dfrac{s}{s+\omega_c}`,
			note: '−3 dB and +45° at the corner; +20 dB/decade below'
		},
		{
			name: 'All-pass',
			H: t`\dfrac{\omega_c-s}{\omega_c+s}`,
			note: '|H| = 1; phase −2·atan(ω/ωc), −90° at the corner'
		},
		{
			name: 'Low shelf',
			H: t`\dfrac{s+G\,\omega_c}{s+\omega_c}`,
			note: 'gain G at DC, 1 at high frequency'
		}
	];

	const second: { name: string; H: string; note: string }[] = [
		{
			name: 'Low-pass',
			H: t`\dfrac{\omega_0^2}{s^2+\frac{\omega_0}{Q}s+\omega_0^2}`,
			note: '|H(jω₀)| = Q; −40 dB/decade'
		},
		{
			name: 'High-pass',
			H: t`\dfrac{s^2}{s^2+\frac{\omega_0}{Q}s+\omega_0^2}`,
			note: '|H(jω₀)| = Q'
		},
		{
			name: 'Band-pass (0 dB peak)',
			H: t`\dfrac{\frac{\omega_0}{Q}s}{s^2+\frac{\omega_0}{Q}s+\omega_0^2}`,
			note: 'peak 1 at ω₀; −3 dB bandwidth ω₀/Q'
		},
		{
			name: 'Band-pass (peak Q)',
			H: t`\dfrac{\omega_0 s}{s^2+\frac{\omega_0}{Q}s+\omega_0^2}`,
			note: 'constant skirts; peak gain Q'
		},
		{
			name: 'Notch',
			H: t`\dfrac{s^2+\omega_0^2}{s^2+\frac{\omega_0}{Q}s+\omega_0^2}`,
			note: 'zeros at ±jω₀; −3 dB bandwidth ω₀/Q'
		},
		{
			name: 'All-pass',
			H: t`\dfrac{s^2-\frac{\omega_0}{Q}s+\omega_0^2}{s^2+\frac{\omega_0}{Q}s+\omega_0^2}`,
			note: '−180° at ω₀; group delay 4Q/ω₀ there'
		},
		{
			name: 'Peaking (bell)',
			H: t`\dfrac{s^2+\frac{A\omega_0}{Q}s+\omega_0^2}{s^2+\frac{\omega_0}{AQ}s+\omega_0^2}`,
			note: 'gain A² at ω₀, 1 far away'
		}
	];

	const zetas = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, Math.SQRT1_2, 0.8, 1];
</script>

<Section
	id="standard-forms"
	title="Standard first- and second-order sections"
	tools={['rlc', 'bode', 'biquad', 'pole-zero']}
>
	<p>
		Every rational filter factors into first- and second-order sections. In the second-order
		denominator
		<Tex math={t`s^2+\frac{\omega_0}{Q}s+\omega_0^2 = s^2+2\zeta\omega_0 s+\omega_0^2`} />, ω₀ is
		the natural (resonant) frequency and
		<Tex math={t`Q=1/(2\zeta)`} /> the quality factor.
	</p>
	<div class="cols">
		<div>
			<h3 id="first-order">First order (corner ω<sub>c</sub>)</h3>
			<div class="tw">
				<table>
					<thead><tr><th>Type</th><th>H(s)</th><th>Notes</th></tr></thead>
					<tbody>
						{#each first as r (r.name)}<tr
								><td>{r.name}</td><td><Tex math={r.H} /></td><td class="small">{r.note}</td></tr
							>{/each}
					</tbody>
				</table>
			</div>
			<p>
				Time constant <Tex math={t`\tau=1/\omega_c`} />; step response <Tex
					math={t`1-e^{-t/\tau}`}
				/>; 10–90 % rise time <Tex math={t`\tau\ln 9\approx 2.2\tau\approx 0.35/f_c`} />.
			</p>
		</div>
		<div>
			<h3 id="second-order">Second order (ω₀, Q)</h3>
			<div class="tw">
				<table>
					<thead><tr><th>Type</th><th>H(s)</th><th>Notes</th></tr></thead>
					<tbody>
						{#each second as r (r.name)}<tr
								><td>{r.name}</td><td><Tex math={r.H} /></td><td class="small">{r.note}</td></tr
							>{/each}
					</tbody>
				</table>
			</div>
		</div>
	</div>

	<h3 id="second-order-quantities">Key quantities</h3>
	<div class="cols">
		<div>
			<p>Poles and the damped (ringing) frequency:</p>
			<Eqs
				items={[
					t`p_{1,2}=-\zeta\omega_0\pm j\omega_0\sqrt{1-\zeta^2}`,
					t`\omega_d=\omega_0\sqrt{1-\zeta^2}`
				]}
			/>
			<p>Low-pass resonant peak and its frequency (only when <Tex math={t`Q>1/\sqrt2`} />):</p>
			<Eqs
				items={[
					t`|H|_{\max}=\frac{Q}{\sqrt{1-\frac{1}{4Q^2}}}=\frac{1}{2\zeta\sqrt{1-\zeta^2}}`,
					t`\omega_r=\omega_0\sqrt{1-2\zeta^2}`
				]}
			/>
			<p>Low-pass −3 dB frequency (equals ω₀ only for Q = 1/√2):</p>
			<Tex
				display
				math={t`\omega_{-3\text{dB}}=\omega_0\sqrt{1-2\zeta^2+\sqrt{(1-2\zeta^2)^2+1}}`}
			/>
		</div>
		<div>
			<p>
				Band-pass / notch −3 dB edges (geometric-symmetric, <Tex
					math={t`\omega_l\omega_h=\omega_0^2`}
				/>):
			</p>
			<Eqs
				items={[
					t`\omega_{l,h}=\omega_0\left(\sqrt{1+\frac{1}{4Q^2}}\mp\frac{1}{2Q}\right)`,
					t`\omega_h-\omega_l=\frac{\omega_0}{Q}`
				]}
			/>
			<p>Low-pass step response for ζ &lt; 1, with <Tex math={t`\varphi=\arccos\zeta`} />:</p>
			<Tex
				display
				math={t`y(t)=1-\frac{e^{-\zeta\omega_0 t}}{\sqrt{1-\zeta^2}}\sin(\omega_d t+\varphi)`}
			/>
			<Eqs
				items={[
					t`M_p=e^{-\pi\zeta/\sqrt{1-\zeta^2}}`,
					t`t_p=\frac{\pi}{\omega_d}`,
					t`t_{s,2\%}\approx\frac{4}{\zeta\omega_0}`
				]}
			/>
		</div>
	</div>
	<div class="tw">
		<table class="ov">
			<thead>
				<tr
					><th>ζ</th>{#each zetas as z (z)}<td class="num"><strong>{trimNumber(z, 3)}</strong></td
						>{/each}</tr
				>
			</thead>
			<tbody>
				<tr
					><th>Q</th>{#each zetas as z (z)}<td class="num">{trimNumber(1 / (2 * z), 3)}</td
						>{/each}</tr
				>
				<tr
					><th>Overshoot</th>{#each zetas as z (z)}<td class="num"
							>{trimNumber(100 * overshoot(z), 3)} %</td
						>{/each}</tr
				>
			</tbody>
		</table>
	</div>
	<p>
		An N-th order low-pass (all poles) falls at <Tex math={t`20N`} /> dB/decade ≈ <Tex
			math={t`6.02N`}
		/> dB/octave far above its corner. Each pole contributes up to −90° of phase, each left-half-plane
		zero +90°.
	</p>
</Section>

<style>
	.ov th {
		white-space: nowrap;
	}
</style>
