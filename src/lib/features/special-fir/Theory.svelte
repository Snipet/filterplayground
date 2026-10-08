<script lang="ts">
	import Tex from '$lib/components/content/Tex.svelte';
	import Callout from '$lib/components/content/Callout.svelte';
	import type { SpecialType } from './special';

	interface Props {
		type: SpecialType;
	}
	let { type }: Props = $props();
</script>

<h2>Special-purpose FIR filters</h2>
<p>
	These filters are defined by a property rather than by a pass/stop mask: a constant phase shift, a
	slope, zero inter-symbol interference, a polynomial fit, a symmetry around fs/4, or the absence of
	multipliers. Most of them are linear phase, so they delay every frequency by the same (N−1)/2
	samples. The section below explains the filter selected above.
</p>

{#if type === 'hilbert'}
	<h3>Hilbert transformer</h3>
	<p>
		The ideal Hilbert transformer shifts positive frequencies by −90° and negative ones by +90°:
	</p>
	<Tex
		display
		math={'H(e^{j\\omega})=-j\\,\\operatorname{sgn}(\\omega)\\quad\\Longleftrightarrow\\quad h[n]=\\begin{cases}\\dfrac{2}{\\pi n} & n\\ \\text{odd}\\\\[4pt] 0 & n\\ \\text{even}\\end{cases}'}
	/>
	<p>
		Pairing a signal with its Hilbert transform gives the <strong>analytic signal</strong>
		<Tex math={'x_a[n]=x[n]+j\\,\\mathcal H\\{x\\}[n]'} />, whose spectrum is zero at negative
		frequencies. Its magnitude is the instantaneous envelope and its angle the instantaneous phase —
		the basis of AM/SSB demodulation, envelope detection and I/Q generation.
	</p>
	<p>
		A causal FIR version delays the ideal response by M = (N−1)/2 samples, so the real path must be
		delayed by the same M samples before the two are combined. That is why type III (odd N,
		antisymmetric) is used: M is an integer. Type III forces zeros at DC and fs/2, so the passband
		is always <Tex math={'[f_\\ell,\\ f_s/2-f_\\ell]'} />; type IV (even N) avoids the zero at fs/2
		but gives a half-sample delay that an integer delay line cannot match. The equiripple design
		minimises
		<Tex math={'\\max|A(f)-1|'} /> over the band; since the odd-offset structure is preserved, every other
		tap stays exactly zero and the filter costs about N/4 multiplies per sample.
	</p>
{:else if type === 'differentiator'}
	<h3>Differentiator</h3>
	<p>
		A discrete-time differentiator approximates <Tex math={'H(e^{j\\omega})=j\\omega'} /> (per sample);
		multiply by f<sub>s</sub> for units per second. The ideal impulse response, delayed by M = (N−1)/2,
		is
	</p>
	<Tex
		display
		math={'h[n]=\\frac{\\cos\\big(\\pi (n-M)\\big)}{n-M}-\\frac{\\sin\\big(\\pi (n-M)\\big)}{\\pi (n-M)^2}'}
	/>
	<p>
		which reduces to <Tex math={'(-1)^{n-M}/(n-M)'} /> when M is an integer. The taps are antisymmetric,
		so the filter is type III (odd N) or type IV (even N). <strong>Type III</strong> has a forced
		zero at z = −1 and cannot follow the ramp up to fs/2 — fine (even helpful) when the signal is
		band-limited, because the differentiator's own high-frequency gain amplifies noise.
		<strong>Type IV</strong> keeps full-band slope up to π at fs/2, at the price of a half-sample delay.
		Windowing (or an equiripple design with weight 1/f) trades accuracy for a smoother response.
	</p>
{:else if type === 'rc'}
	<h3>Raised cosine and root raised cosine</h3>
	<p>
		A pulse p(t) causes no inter-symbol interference if it is zero at every non-zero multiple of the
		symbol period T (Nyquist's criterion). The raised cosine satisfies it with a spectrum that rolls
		off over an excess bandwidth β:
	</p>
	<Tex
		display
		math={'p_{RC}(t)=\\operatorname{sinc}\\!\\Big(\\frac tT\\Big)\\,\\frac{\\cos(\\pi\\beta t/T)}{1-(2\\beta t/T)^2},\\qquad B=\\frac{(1+\\beta)}{2T}'}
	/>
	<p>
		In a real link the filtering is split between transmitter and receiver. Each side uses the <strong
			>root raised cosine</strong
		>, whose spectrum is the square root of the RC spectrum; the receive RRC is then the matched
		filter (maximising SNR in white noise) and the cascade RRC ∗ RRC is a raised cosine with zero
		ISI. An RRC alone is
		<em>not</em> Nyquist. Truncating the pulses to a finite span leaves the RC's zero crossings intact
		but raises the RRC's stopband and introduces a little residual ISI in the RRC → RRC cascade — compare
		the eye diagrams as you change the span. Smaller β means less bandwidth but longer, slower-decaying
		tails and a narrower eye.
	</p>
{:else if type === 'gaussian'}
	<h3>Gaussian pulse shaping</h3>
	<p>
		A Gaussian filter has a Gaussian impulse response and frequency response, with no overshoot and
		no sidelobes:
	</p>
	<Tex
		display
		math={'h(t)=\\frac{\\sqrt\\pi}{a}\\,e^{-(\\pi t/a)^2},\\qquad |H(f)|=e^{-(af)^2},\\qquad a=\\frac{\\sqrt{\\ln 2/2}}{B}'}
	/>
	<p>
		B is the −3 dB bandwidth, usually quoted as the product BT with the symbol period. GSM uses BT =
		0.3, Bluetooth GFSK BT = 0.5. In GMSK the filter shapes the NRZ frequency pulse: a smaller BT
		gives a more compact spectrum but spreads each symbol into its neighbours (ISI), which the eye
		diagram shows as a partly closed eye. The Gaussian is not a Nyquist pulse; the receiver has to
		live with (or equalise) the ISI.
	</p>
{:else if type === 'savgol'}
	<h3>Savitzky–Golay filters</h3>
	<p>
		A Savitzky–Golay filter fits a polynomial of order p to the 2m + 1 samples around each point by
		least squares and returns the fitted value (or its d-th derivative) at the centre. Because the
		fit is linear in the data, it is an FIR filter. Applied as a correlation over the window (y[n] =
		Σ c<sub>i</sub> x[n+i]), its coefficients are a row of the pseudo-inverse:
	</p>
	<Tex
		display
		math={'\\mathbf c=d!\\;\\big[(A^{\\mathsf T}A)^{-1}A^{\\mathsf T}\\big]_{d,:},\\qquad A_{ik}=i^{\\,k},\\ i=-m\\ldots m,\\ k=0\\ldots p'}
	/>
	<p>
		It reproduces polynomials up to order p exactly, so peak heights and widths survive much better
		than with a moving average of the same length — at the cost of less noise reduction and a less
		monotonic frequency response (the negative side taps). Increasing p sharpens features and lets
		more noise through; increasing the window does the opposite. With d &gt; 0 the same fit gives
		smoothed derivatives, far less noisy than finite differences.
	</p>
{:else if type === 'halfband'}
	<h3>Half-band filters</h3>
	<p>
		A half-band filter is a low-pass with cutoff fs/4 whose amplitude is antisymmetric about that
		point:
	</p>
	<Tex
		display
		math={'A(\\omega)+A(\\pi-\\omega)=1\\quad\\Longleftrightarrow\\quad h[M]=\\tfrac12,\\quad h[M\\pm 2k]=0\\ (k\\ge1)'}
	/>
	<p>
		With the ideal response <Tex
			math={'h_d[n]=\\tfrac12\\operatorname{sinc}\\big((n-M)/2\\big)'}
		/>, every even offset from the centre lands on a zero of the sinc, and windowing keeps them
		zero. Nearly half the taps vanish, and the symmetry makes the passband and stopband ripples
		equal (δ<sub>p</sub> = δ<sub>s</sub>). As the decimate-by-2 (or interpolate-by-2) stage of a
		multirate chain, its polyphase form needs only about N/4 multiplies per output sample (N/8 per
		input sample), one branch being a pure delay × ½. Choose N = 4K + 3; with N = 4K + 1 the
		outermost taps are zero. (A window that is itself zero at its ends, such as Hann or Blackman,
		zeroes them at any N.)
	</p>
{:else if type === 'cic'}
	<h3>CIC filters</h3>
	<p>
		A cascaded integrator–comb decimator (Hogenauer) runs N integrators at the input rate, decimates
		by R, then runs N combs with differential delay M at the output rate. It is equivalent to N
		cascaded moving sums of length R·M:
	</p>
	<Tex
		display
		math={'H(z)=\\left(\\frac{1-z^{-RM}}{1-z^{-1}}\\right)^{N},\\qquad |H(f)|=\\left|\\frac{\\sin(\\pi R M f/f_s)}{\\sin(\\pi f/f_s)}\\right|^{N}'}
	/>
	<p>
		It needs no multipliers and no coefficient storage, which is why it is the first stage of almost
		every sigma-delta ADC and digital down-converter. Its nulls at multiples of fs/(R·M) include
		every multiple of fs/R, exactly the frequencies that alias onto DC after decimation, giving the
		best rejection near them. With M = 1 these are all of its nulls; M = 2 adds nulls at the odd
		multiples of fs/(2R), which fold onto fs_out/2. The prices: a DC gain of
		<Tex math={'(RM)^N'} /> (so registers must grow by <Tex math={'\\lceil N\\log_2(RM)\\rceil'} /> bits
		— wrap-around in the integrators is harmless with two's complement), a sinc<sup>N</sup> passband droop
		that a compensating FIR usually corrects, and poor rejection of the alias bands' edges when the band
		of interest is wide.
	</p>
{:else}
	<h3>Moving average</h3>
	<p>The L-point moving average is the box-car FIR</p>
	<Tex
		display
		math={'y[n]=\\frac1L\\sum_{k=0}^{L-1}x[n-k],\\qquad H(e^{j\\omega})=\\frac{1}{L}\\,\\frac{\\sin(\\omega L/2)}{\\sin(\\omega/2)}\\,e^{-j\\omega (L-1)/2}'}
	/>
	<p>
		Its zeros sit on the unit circle at multiples of fs/L (except DC), so it removes anything
		periodic with period L — mains hum when L spans a whole cycle, for instance. It is the optimal
		filter for reducing white noise (variance ÷ L) while keeping a sharp step response (a clean ramp
		of L samples), but a poor frequency-selective filter: its first sidelobe is only −13 dB. As a
		running sum it costs one addition and one subtraction per sample, whatever L is — the same trick
		the CIC uses.
	</p>
{/if}

<Callout kind="try">
	<ul>
		<li>
			Hilbert: switch off the delay compensation in the AM demo — the recovered envelope ripples at
			twice the carrier.
		</li>
		<li>
			Differentiator: add noise and compare the RMS error of types III and IV — type IV's full-band
			gain amplifies the noise near fs/2.
		</li>
		<li>
			Raised cosine: set the span to 4 symbols and switch the eye to RRC → RRC: the eye stays open
			but no longer passes exactly through ±1.
		</li>
		<li>
			Savitzky–Golay: with a 21-point window compare order 2 and order 6 on the narrow peak, then
			try the moving average of the same length.
		</li>
		<li>
			CIC: double N from 3 to 6 and watch the alias rejection double in dB — and the droop double
			too.
		</li>
	</ul>
</Callout>
