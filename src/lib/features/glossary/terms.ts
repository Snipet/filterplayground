/**
 * Glossary data. Each entry's anchor id is slugify(term); `see` lists other
 * entries by their display term (validated in tests/glossary.test.ts) and
 * `tools` lists page slugs from src/lib/tools.ts.
 */

import { foldDashes } from '$lib/utils/text';

export interface Term {
	term: string;
	/** Synonyms and abbreviations — searchable and shown under the term. */
	aka?: string[];
	/** Plain-language definition, 1–3 sentences. */
	def: string;
	/** Optional formula (KaTeX), shown after the definition. */
	tex?: string;
	see?: string[];
	tools?: string[];
}

export function slugify(s: string): string {
	return s
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

const t = String.raw;

const TERMS_UNSORTED: Term[] = [
	{
		term: 'Active filter',
		def: 'A filter that uses an amplifier (usually an op-amp) together with resistors and capacitors. It can provide gain and realise complex poles without inductors, which makes it the standard choice at audio and low frequencies.',
		see: ['Sallen–Key topology', 'Multiple feedback (MFB) topology', 'Passive filter'],
		tools: ['active-filters']
	},
	{
		term: 'Aliasing',
		def: 'When a signal is sampled at fs, any component above fs/2 becomes indistinguishable from one folded back into 0 … fs/2: a tone at f appears at |f − k·fs|. Aliased components cannot be removed afterwards, so they must be filtered out before sampling or decimating.',
		see: ['Nyquist frequency', 'Anti-aliasing filter', 'Sampling theorem', 'Decimation'],
		tools: ['aliasing']
	},
	{
		term: 'All-pass filter',
		def: 'A filter with constant magnitude at every frequency whose phase varies with frequency. Used to correct phase (delay equalisation), to build crossovers, reverbs and Hilbert-transform pairs. Every pole p is paired with a zero at 1/p* (digital) or at −p*, its mirror image across the jω axis (analog).',
		tex: t`H(z)=\frac{a+z^{-1}}{1+a\,z^{-1}},\;\; |H(e^{j\omega})|=1`,
		see: ['Phase response', 'Group delay', 'Minimum phase'],
		tools: ['biquad', 'simple-filters', 'crossover']
	},
	{
		term: 'Amplitude response',
		aka: ['magnitude response'],
		def: 'How much a filter scales a sinusoid at each frequency: |H(jω)| or |H(e^(jω))|, usually plotted in dB. For linear-phase FIR filters "amplitude response" sometimes means the real-valued A(ω), which may go negative.',
		see: ['Frequency response', 'Phase response', 'Decibel'],
		tools: ['tf-analyzer', 'bode']
	},
	{
		term: 'Analog prototype',
		def: 'A normalised low-pass filter (cutoff 1 rad/s) from a classical family such as Butterworth or Chebyshev. Frequency transformations turn it into the required low-pass, high-pass, band-pass or band-stop filter, and a mapping such as the bilinear transform turns it into a digital filter.',
		see: ['Frequency transformation', 'Bilinear transform', 'Butterworth filter'],
		tools: ['analog-designer']
	},
	{
		term: 'Anti-aliasing filter',
		def: 'A low-pass filter in front of an ADC (or before a digital decimator) that removes everything that would alias into the band of interest. It must reach the required attenuation by fs − f_pass, the lowest frequency that folds back onto the passband edge.',
		see: ['Aliasing', 'Nyquist frequency', 'Decimation'],
		tools: ['aliasing', 'order-calculator']
	},
	{
		term: 'Attenuation',
		def: 'Reduction of signal level, expressed as a positive number of decibels: 60 dB of stopband attenuation means the gain is at most 0.001.',
		tex: t`A=-20\log_{10}|H|`,
		see: ['Decibel', 'Stopband', 'Insertion loss']
	},
	{
		term: 'Band-pass filter',
		aka: ['BPF'],
		def: 'Passes frequencies between a lower and an upper edge and attenuates those below and above. Its centre is usually the geometric mean √(f₁f₂) of the edges, and a low-pass prototype of order N gives a band-pass of order 2N.',
		see: ['Band-stop filter', 'Bandwidth', 'Q factor', 'Frequency transformation'],
		tools: ['analog-designer', 'biquad']
	},
	{
		term: 'Band-stop filter',
		aka: ['band-reject filter', 'BSF'],
		def: 'Attenuates a band of frequencies and passes those on both sides. A very narrow band-stop filter is called a notch.',
		see: ['Notch filter', 'Band-pass filter'],
		tools: ['analog-designer', 'iir-designer']
	},
	{
		term: 'Bandwidth',
		def: 'The width of a passband, normally between the −3 dB (half-power) points. For a second-order resonance the bandwidth is f₀/Q. The word is also used for the range of frequencies a signal occupies.',
		tex: t`\text{BW}=f_h-f_l=\frac{f_0}{Q}`,
		see: ['Q factor', 'Cutoff frequency', 'Octave'],
		tools: ['calculators']
	},
	{
		term: 'Bessel filter',
		aka: ['Thomson filter'],
		def: 'Analog filter family with maximally flat group delay: nearly linear phase in the passband, almost no overshoot, but a very gradual magnitude roll-off. The bilinear transform does not preserve its flat delay near Nyquist.',
		see: ['Group delay', 'Linear phase', 'Overshoot', 'Butterworth filter'],
		tools: ['analog-designer', 'family-compare']
	},
	{
		term: 'Bilinear transform',
		aka: ['Tustin transform'],
		def: 'Converts an analog transfer function into a digital one by substituting s = (2/T)(z − 1)/(z + 1). It maps the whole jω axis onto the unit circle exactly once, so stability is kept and nothing aliases, but frequencies are compressed (warped) towards Nyquist.',
		tex: t`s=\frac{2}{T}\,\frac{1-z^{-1}}{1+z^{-1}}`,
		see: ['Frequency warping', 'Prewarping', 'Impulse invariance', 'Matched-Z transform'],
		tools: ['discretization', 'iir-designer']
	},
	{
		term: 'Biquad',
		aka: ['biquadratic section'],
		def: 'A second-order IIR section: the ratio of two quadratics in z⁻¹. Biquads are the building blocks of higher-order IIR filters and of equalisers.',
		tex: t`H(z)=\frac{b_0+b_1z^{-1}+b_2z^{-2}}{1+a_1z^{-1}+a_2z^{-2}}`,
		see: ['Second-order section', 'Direct form', 'Cascade'],
		tools: ['biquad', 'structures']
	},
	{
		term: 'Blackman window',
		def: "Three-term cosine window (0.42, 0.5, 0.08) with −58 dB sidelobes falling at 18 dB/octave; its main lobe is three times as wide as the rectangular window's.",
		see: ['Window function', 'Hann window', 'Hamming window'],
		tools: ['windows']
	},
	{
		term: 'Bode plot',
		def: 'Magnitude in dB and phase plotted against logarithmic frequency on separate graphs. Every real pole or zero adds a straight-line asymptote of ∓20 dB per decade, which makes responses easy to sketch by hand.',
		see: ['Corner frequency', 'Decade', 'Roll-off'],
		tools: ['bode']
	},
	{
		term: 'Brick-wall filter',
		aka: ['ideal filter'],
		def: 'An ideal filter with unity gain in the passband, zero gain in the stopband and no transition band. It is not realisable: its impulse response (a sinc) is infinitely long and non-causal; real filters approximate it.',
		see: ['Sinc function', 'Transition band', 'Gibbs phenomenon']
	},
	{
		term: 'Butterworth filter',
		def: 'Filter with a maximally flat passband: the first 2N − 1 derivatives of |H|² vanish at DC. The response is monotonic, −3 dB at the cutoff for every order, with moderate overshoot — the default all-rounder.',
		tex: t`|H(j\omega)|^2=\frac{1}{1+(\omega/\omega_c)^{2N}}`,
		see: ['Maximally flat', 'Chebyshev filter', 'Linkwitz–Riley filter'],
		tools: ['analog-designer', 'family-compare']
	},
	{
		term: 'Cascade',
		def: 'Filters connected in series so that each output feeds the next input; their transfer functions multiply and their dB responses add. High-order IIR filters are implemented as cascades of second-order sections for numerical robustness.',
		see: ['Second-order section', 'Biquad'],
		tools: ['structures']
	},
	{
		term: 'Causal',
		def: 'A system whose output depends only on present and past inputs, so h[n] = 0 for n < 0. Real-time filters must be causal; offline processing can use non-causal tricks such as zero-phase filtering.',
		see: ['Zero-phase filtering', 'Impulse response', 'Stability']
	},
	{
		term: 'Chebyshev filter',
		aka: ['Chebyshev type I', 'Chebyshev type II', 'inverse Chebyshev'],
		def: 'Type I has an equiripple passband and a monotonic stopband; type II (inverse Chebyshev) has a flat passband and an equiripple stopband with transmission zeros. Both are steeper than Butterworth for the same order, at the cost of ripple and less uniform group delay.',
		tex: t`|H(j\omega)|^2=\frac{1}{1+\varepsilon^2T_N^2(\omega/\omega_p)}`,
		see: ['Ripple', 'Equiripple', 'Elliptic filter', 'Butterworth filter'],
		tools: ['analog-designer', 'family-compare']
	},
	{
		term: 'CIC filter',
		aka: ['cascaded integrator–comb', 'Hogenauer filter'],
		def: 'A multiplier-free decimation or interpolation filter built from N integrators and N combs around a rate change by R. Its response is a cascade of N moving averages, with a sinc-shaped passband droop that is usually corrected afterwards.',
		tex: t`H(z)=\left(\frac{1-z^{-RM}}{1-z^{-1}}\right)^{N}`,
		see: ['Moving average', 'Comb filter', 'Decimation', 'Multirate'],
		tools: ['special-fir']
	},
	{
		term: 'Circular convolution',
		def: 'Convolution in which indices wrap around modulo N; it is what multiplying two N-point DFTs computes. To obtain ordinary (linear) convolution, zero-pad both sequences to at least N₁ + N₂ − 1 points.',
		see: ['Convolution', 'DFT', 'Fast convolution']
	},
	{
		term: 'Coefficient quantization',
		def: 'Rounding filter coefficients to the available word length moves poles and zeros. High-order direct-form IIR filters with clustered poles are extremely sensitive — they can even become unstable — which is why filters are built from second-order sections.',
		see: ['Fixed point', 'Second-order section', 'Sensitivity', 'Quantization'],
		tools: ['quantization']
	},
	{
		term: 'Coherent gain',
		def: 'The DC gain of a window divided by its length (the mean of its samples). It scales the amplitude of a tone measured with that window: 1 for rectangular, 0.5 for Hann.',
		see: ['Window function', 'Scalloping loss', 'Equivalent noise bandwidth'],
		tools: ['windows']
	},
	{
		term: 'Comb filter',
		def: 'Adds a delayed copy of the signal to itself, either forward or through feedback. Its magnitude response has equally spaced notches or peaks every fs/D, like the teeth of a comb.',
		tex: t`y[n]=x[n]+g\,x[n-D]\quad\text{or}\quad y[n]=x[n]+g\,y[n-D]`,
		see: ['CIC filter', 'Notch filter'],
		tools: ['simple-filters']
	},
	{
		term: 'Convolution',
		def: 'The operation that gives the output of an LTI system from its input and impulse response: flip, shift, multiply and sum. Convolution in time is multiplication in frequency.',
		tex: t`y[n]=\sum_{k}x[k]\,h[n-k]`,
		see: ['Impulse response', 'LTI system', 'Circular convolution', 'FIR filter'],
		tools: ['convolution']
	},
	{
		term: 'Corner frequency',
		aka: ['break frequency'],
		def: 'The frequency where the straight-line asymptotes of a Bode plot meet. For a first-order section it is ω = 1/τ, where the true response is 3 dB below the asymptote.',
		see: ['Cutoff frequency', 'Bode plot', 'Time constant'],
		tools: ['bode']
	},
	{
		term: 'Crossover',
		def: 'A set of filters that splits an audio signal into frequency bands for different loudspeaker drivers (e.g. woofer and tweeter), designed so that the outputs sum back to a flat response.',
		see: ['Linkwitz–Riley filter', 'All-pass filter'],
		tools: ['crossover']
	},
	{
		term: 'Cutoff frequency',
		aka: ['−3 dB frequency', 'half-power frequency'],
		def: 'The edge of a passband, conventionally where the gain has fallen by 3 dB (half power). Chebyshev I and elliptic designs instead quote the frequency where the ripple band ends.',
		see: ['Corner frequency', 'Passband', 'Bandwidth'],
		tools: ['calculators']
	},
	{
		term: 'Damping ratio',
		aka: ['ζ', 'zeta'],
		def: 'Dimensionless measure of how quickly oscillations die out in a second-order system. ζ < 1 is under-damped (rings), ζ = 1 critically damped, ζ > 1 over-damped.',
		tex: t`\zeta=\frac{1}{2Q}`,
		see: ['Q factor', 'Overshoot', 'Natural frequency'],
		tools: ['rlc', 'calculators']
	},
	{
		term: 'DC blocker',
		def: 'A high-pass filter with a very low cutoff that removes a constant offset while passing everything else. The classic form has a zero at z = 1 and a pole just inside it.',
		tex: t`y[n]=x[n]-x[n-1]+R\,y[n-1],\;\;R\approx0.995`,
		see: ['High-pass filter', 'Pole', 'Zero'],
		tools: ['simple-filters']
	},
	{
		term: 'Decade',
		def: 'A frequency ratio of 10. Slopes are quoted per decade (an all-pole N-th-order low-pass such as Butterworth, Chebyshev I or Bessel eventually falls at 20N dB/decade).',
		see: ['Octave', 'Roll-off', 'Bode plot'],
		tools: ['calculators']
	},
	{
		term: 'Decibel',
		aka: ['dB'],
		def: 'A logarithmic ratio: 10·log₁₀ of a power ratio or 20·log₁₀ of an amplitude ratio. +6 dB is about twice the amplitude, −3 dB half the power; absolute levels use a reference (dBV, dBu, dBm, dBFS).',
		tex: t`L=10\log_{10}\frac{P_2}{P_1}=20\log_{10}\frac{V_2}{V_1}`,
		see: ['Attenuation', 'Gain'],
		tools: ['calculators']
	},
	{
		term: 'Decimation',
		aka: ['downsampling'],
		def: 'Reducing the sample rate by an integer factor M: low-pass filter below the new Nyquist frequency fs/(2M), then keep every M-th sample. Without the filter, the discarded band aliases into the result.',
		see: ['Interpolation', 'Multirate', 'Anti-aliasing filter', 'Half-band filter', 'CIC filter'],
		tools: ['special-fir', 'order-calculator']
	},
	{
		term: 'DFT',
		aka: ['discrete Fourier transform'],
		def: 'Transforms N samples into N complex frequency bins spaced fs/N apart. It samples the spectrum of one block of the signal, assuming the block repeats periodically.',
		tex: t`X[k]=\sum_{n=0}^{N-1}x[n]\,e^{-j2\pi kn/N}`,
		see: ['FFT', 'Leakage', 'Window function', 'Zero padding'],
		tools: ['windows']
	},
	{
		term: 'Difference equation',
		def: 'The recursion a digital filter evaluates every sample, combining current and past inputs with past outputs. Its coefficients are those of the transfer function.',
		tex: t`y[n]=\sum_{k=0}^{M}b_k\,x[n-k]-\sum_{k=1}^{N}a_k\,y[n-k]`,
		see: ['Transfer function', 'Direct form', 'Z-transform'],
		tools: ['structures', 'tf-analyzer']
	},
	{
		term: 'Differentiator',
		def: 'A filter whose response is proportional to frequency, H = jω, approximating the derivative of the signal. Digital differentiators are usually antisymmetric (type III or IV) FIR filters limited to the band where the signal lives, because differentiation amplifies high-frequency noise.',
		see: ['Linear phase', 'Savitzky–Golay filter'],
		tools: ['special-fir']
	},
	{
		term: 'Direct form',
		aka: ['DF-I', 'DF-II'],
		def: 'Structures that use the transfer-function coefficients directly. Direct form I keeps separate delay lines for input and output (2N delays); direct form II shares one (N delays, "canonical") but has larger internal signals.',
		see: ['Transposed form', 'Biquad', 'Lattice filter'],
		tools: ['structures']
	},
	{
		term: 'Discrimination factor',
		def: 'In a filter specification, the ratio k₁ = εp/εs of passband to stopband ripple factors. Together with the selectivity it determines the minimum order.',
		tex: t`k_1=\sqrt{\frac{10^{R_p/10}-1}{10^{R_s/10}-1}}`,
		see: ['Selectivity', 'Order', 'Ripple'],
		tools: ['order-calculator']
	},
	{
		term: 'Dither',
		def: 'A small random signal added before quantisation so the quantisation error becomes noise-like and uncorrelated with the signal, instead of producing harmonic distortion on low-level signals.',
		see: ['Quantization', 'White noise']
	},
	{
		term: 'Dolph–Chebyshev window',
		def: 'Window whose sidelobes all have exactly the same specified level; for that sidelobe level it has the narrowest possible main lobe.',
		see: ['Window function', 'Equiripple', 'Sidelobe'],
		tools: ['windows']
	},
	{
		term: 'E-series',
		aka: ['preferred values', 'E12', 'E24', 'E96'],
		def: 'Standard (IEC 60063) sets of preferred component values: E6, E12, E24, E48, E96 with 6 … 96 values per decade, spaced roughly 10^(1/n) apart to match the component tolerance.',
		see: ['Sensitivity', 'Active filter'],
		tools: ['calculators', 'active-filters']
	},
	{
		term: 'Elliptic filter',
		aka: ['Cauer filter'],
		def: 'Filter that is equiripple in both passband and stopband, with transmission zeros just beyond the passband edge. It achieves the narrowest transition band for a given order (or the lowest order for a given specification) but has the least uniform group delay.',
		see: ['Equiripple', 'Chebyshev filter', 'Transmission zero', 'Order'],
		tools: ['analog-designer', 'order-calculator']
	},
	{
		term: 'Equalizer',
		aka: ['EQ', 'parametric equalizer'],
		def: 'A filter (usually a cascade of peaking and shelving biquads) that shapes the tonal balance of a signal. A parametric EQ lets you set the frequency, gain and Q of each band.',
		see: ['Peaking filter', 'Shelving filter', 'Biquad'],
		tools: ['parametric-eq', 'biquad']
	},
	{
		term: 'Equiripple',
		def: 'An approximation error that oscillates between equal maxima and minima across a band. It is the signature of minimax-optimal designs: Chebyshev and elliptic IIR filters, and Parks–McClellan FIR filters.',
		see: ['Ripple', 'Parks–McClellan algorithm', 'Elliptic filter'],
		tools: ['fir-designer']
	},
	{
		term: 'Equivalent noise bandwidth',
		aka: ['ENBW', 'noise bandwidth'],
		def: 'The width of an ideal rectangular filter, with the same peak gain, that would pass the same white-noise power. For DFT windows it is quoted in bins (1 for rectangular, 1.5 for Hann).',
		tex: t`B_n=\frac{1}{|H|_{\max}^2}\int_0^\infty|H(f)|^2\,df,\qquad \text{ENBW}=N\frac{\sum w^2}{(\sum w)^2}`,
		see: ['Window function', 'White noise', 'Bandwidth'],
		tools: ['windows']
	},
	{
		term: 'Exponential moving average',
		aka: ['EMA', 'one-pole low-pass', 'leaky integrator'],
		def: 'The simplest IIR smoother: each output moves a fraction α of the way towards the new input. It is a first-order low-pass with a pole at 1 − α.',
		tex: t`y[n]=y[n-1]+\alpha\,(x[n]-y[n-1])`,
		see: ['Moving average', 'Time constant', 'IIR filter'],
		tools: ['simple-filters']
	},
	{
		term: 'Fast convolution',
		aka: ['overlap-add', 'overlap-save'],
		def: 'Computing long FIR filters with FFTs: split the input into blocks, multiply their spectra by the filter spectrum and stitch the results (overlap-add or overlap-save). Much cheaper than direct convolution for long impulse responses.',
		see: ['Convolution', 'Circular convolution', 'FFT']
	},
	{
		term: 'FFT',
		aka: ['fast Fourier transform'],
		def: 'Any fast algorithm for the DFT, costing O(N log N) instead of O(N²) operations; radix-2 Cooley–Tukey is the most common.',
		see: ['DFT', 'Fast convolution']
	},
	{
		term: 'FIR filter',
		aka: ['finite impulse response', 'transversal filter', 'tapped delay line'],
		def: 'A filter whose output is a weighted sum of a finite number of past inputs, with no feedback. FIR filters are always stable and can have exactly linear phase, but need many more coefficients than IIR filters for sharp responses.',
		tex: t`y[n]=\sum_{k=0}^{N-1}h[k]\,x[n-k]`,
		see: ['IIR filter', 'Linear phase', 'Tap', 'Window function'],
		tools: ['fir-designer', 'convolution']
	},
	{
		term: 'Fixed point',
		aka: ['Q15', 'Q31', 'Q format'],
		def: 'Number format with a fixed binary point, e.g. Q15: one sign bit and 15 fractional bits covering [−1, 1). Cheap and deterministic in hardware, but signals must be scaled to avoid overflow and every operation adds quantisation noise.',
		see: ['Quantization', 'Overflow', 'Limit cycle', 'Coefficient quantization'],
		tools: ['quantization']
	},
	{
		term: 'Fractional delay',
		def: 'A delay that is not a whole number of samples, realised by interpolation — for example a Lagrange FIR or a Thiran all-pass filter. Used in resampling, beam-forming and physical modelling.',
		see: ['All-pass filter', 'Interpolation', 'Phase delay']
	},
	{
		term: 'Frequency response',
		def: 'The transfer function evaluated for sinusoids: on the jω axis (s = jω) for analog systems or on the unit circle (z = e^(jω)) for digital ones. Its magnitude is the gain and its angle the phase shift at each frequency.',
		tex: t`H(j\omega)\quad\text{or}\quad H(e^{j\omega})`,
		see: ['Amplitude response', 'Phase response', 'Transfer function'],
		tools: ['tf-analyzer', 'pole-zero']
	},
	{
		term: 'Frequency sampling',
		def: 'FIR design method that specifies the desired response at N equally spaced frequencies and takes the inverse DFT. Optimising a few samples in the transition band greatly reduces ripple.',
		see: ['FIR filter', 'DFT', 'Window function'],
		tools: ['fir-designer']
	},
	{
		term: 'Frequency transformation',
		def: 'A substitution for s (or z⁻¹) that turns a low-pass prototype into a low-pass with another cutoff, a high-pass, a band-pass or a band-stop filter: s → s/ωc, ωc/s, (s² + ω₀²)/(Bs) or Bs/(s² + ω₀²).',
		see: ['Analog prototype', 'Band-pass filter', 'Band-stop filter'],
		tools: ['analog-designer', 'formulas']
	},
	{
		term: 'Frequency warping',
		aka: ['warping'],
		def: 'The non-linear frequency compression introduced by the bilinear transform: the analog frequency axis 0 … ∞ is squeezed into 0 … fs/2, so responses designed in the analog domain shift downward near Nyquist.',
		tex: t`\omega=2\arctan\frac{\Omega T}{2}`,
		see: ['Bilinear transform', 'Prewarping'],
		tools: ['discretization', 'calculators']
	},
	{
		term: 'Gain',
		def: 'Ratio of output to input amplitude (|H| at a frequency), often expressed in decibels. Negative dB gain is attenuation.',
		see: ['Decibel', 'Attenuation', 'Amplitude response']
	},
	{
		term: 'Gaussian filter',
		def: 'Filter whose magnitude (and impulse response) approximates a Gaussian bell. A Gaussian has the smallest possible time–bandwidth product and a step response without overshoot; used for pulse shaping (GMSK) and smoothing.',
		see: ['Bessel filter', 'Overshoot', 'Raised-cosine filter'],
		tools: ['analog-designer', 'special-fir']
	},
	{
		term: 'Gibbs phenomenon',
		def: 'Truncating a Fourier series or an ideal impulse response creates ripple around a discontinuity whose peak (about 9 % of the jump) does not shrink as more terms are kept — it only gets narrower. Windows trade this ripple for a wider transition band.',
		see: ['Window function', 'Ripple', 'Brick-wall filter'],
		tools: ['fir-designer', 'windows']
	},
	{
		term: 'Group delay',
		def: 'The delay experienced by the envelope of a narrow-band signal around frequency ω: the negative slope of the phase. A constant group delay means no phase distortion.',
		tex: t`\tau_g(\omega)=-\frac{d\varphi(\omega)}{d\omega}`,
		see: ['Phase delay', 'Linear phase', 'Bessel filter'],
		tools: ['linear-phase', 'family-compare']
	},
	{
		term: 'Half-band filter',
		def: 'Linear-phase FIR low-pass with its cutoff at fs/4 and a response symmetric about that point, so nearly every other coefficient is zero. Roughly halves the work of decimating or interpolating by 2.',
		see: ['Decimation', 'Interpolation', 'Multirate'],
		tools: ['special-fir']
	},
	{
		term: 'Hamming window',
		def: 'Raised-cosine window (0.54 − 0.46 cos) tuned to cancel the first sidelobe, giving −43 dB peak sidelobes — but the far sidelobes decay only at 6 dB/octave because the window does not reach zero at its ends.',
		see: ['Window function', 'Hann window'],
		tools: ['windows']
	},
	{
		term: 'Hann window',
		aka: ['Hanning window', 'raised cosine window'],
		def: 'Raised-cosine window that reaches zero at both ends: −31.5 dB first sidelobe, 18 dB/octave sidelobe roll-off. A good default for spectral analysis.',
		tex: t`w[n]=0.5-0.5\cos\frac{2\pi n}{M}`,
		see: ['Window function', 'Hamming window', 'Leakage'],
		tools: ['windows']
	},
	{
		term: 'High-pass filter',
		aka: ['HPF'],
		def: 'Passes frequencies above its cutoff and attenuates those below. Obtained from a low-pass prototype by s → ωc/s.',
		see: ['Low-pass filter', 'DC blocker', 'Cutoff frequency'],
		tools: ['analog-designer', 'biquad']
	},
	{
		term: 'Hilbert transformer',
		aka: ['Hilbert transform'],
		def: 'Shifts every positive-frequency component by −90° (and negative ones by +90°) without changing its magnitude, H(f) = −j·sgn(f). Used to build analytic signals for envelope and instantaneous-frequency detection; FIR Hilbert transformers approximate it over a band.',
		see: ['All-pass filter', 'Linear phase'],
		tools: ['special-fir']
	},
	{
		term: 'IIR filter',
		aka: ['infinite impulse response', 'recursive filter'],
		def: 'A filter with feedback (poles), so its impulse response decays forever. IIR filters achieve sharp magnitude responses with few coefficients, but have non-linear phase and can be unstable or suffer limit cycles in fixed point.',
		see: ['FIR filter', 'Biquad', 'Stability', 'Pole'],
		tools: ['iir-designer']
	},
	{
		term: 'Image',
		aka: ['spectral image', 'imaging'],
		def: 'Copies of a spectrum that appear around multiples of the sample rate after upsampling or digital-to-analog conversion. They are removed by an interpolation or reconstruction filter.',
		see: ['Interpolation', 'Zero-order hold', 'Aliasing'],
		tools: ['aliasing']
	},
	{
		term: 'Impedance',
		def: 'The complex ratio of voltage to current, Z = R + jX, combining resistance and reactance. A capacitor has Z = 1/(jωC), an inductor Z = jωL.',
		see: ['Reactance', 'Ladder network'],
		tools: ['calculators', 'rlc']
	},
	{
		term: 'Impulse invariance',
		def: 'Analog-to-digital conversion that samples the analog impulse response, h[n] = T·hₐ(nT); each pole maps as z = e^(pT). The time response is preserved but the frequency response aliases, so it is unsuitable for high-pass and band-stop filters.',
		see: ['Bilinear transform', 'Matched-Z transform', 'Aliasing'],
		tools: ['discretization']
	},
	{
		term: 'Impulse response',
		aka: ['kernel'],
		def: 'The output of a system when the input is a unit impulse. It completely characterises an LTI system; for an FIR filter it is simply the list of coefficients.',
		see: ['Convolution', 'Step response', 'LTI system'],
		tools: ['convolution', 'tf-analyzer']
	},
	{
		term: 'Insertion loss',
		def: 'The loss in signal power caused by inserting a filter between a source and a load, compared with a direct connection; in a passband it is ideally close to 0 dB.',
		see: ['Attenuation', 'Return loss', 'Ladder network'],
		tools: ['lc-ladder']
	},
	{
		term: 'Interpolation',
		aka: ['upsampling'],
		def: 'Raising the sample rate by an integer factor L: insert L − 1 zeros between samples, then low-pass filter at the original Nyquist frequency (with gain L) to remove the spectral images.',
		see: ['Decimation', 'Image', 'Multirate', 'Polyphase filter'],
		tools: ['special-fir']
	},
	{
		term: 'Intersymbol interference',
		aka: ['ISI'],
		def: "In digital communications, the overlap of one symbol's pulse with its neighbours at the sampling instants, caused by band-limiting. Nyquist pulses such as the raised cosine avoid it.",
		see: ['Raised-cosine filter', 'Matched filter'],
		tools: ['special-fir']
	},
	{
		term: 'Kaiser window',
		def: "Near-optimal window with a single parameter β that trades main-lobe width for sidelobe level. Kaiser's empirical formulas give β and the filter length directly from the required attenuation and transition width.",
		tex: t`w[n]=\frac{I_0\big(\beta\sqrt{1-(2n/M-1)^2}\big)}{I_0(\beta)}`,
		see: ['Window function', 'FIR filter', 'Main lobe'],
		tools: ['windows', 'fir-designer', 'order-calculator']
	},
	{
		term: 'Ladder network',
		def: 'An LC network of alternating series and shunt elements between a source and a load resistor. Doubly terminated lossless ladders have very low sensitivity to component tolerances in the passband.',
		see: ['Passive filter', 'Sensitivity', 'Insertion loss'],
		tools: ['lc-ladder']
	},
	{
		term: 'Laplace transform',
		def: 'Converts a time function into a function of the complex frequency s, turning linear differential equations into algebra. Analog filters are described by transfer functions in s.',
		tex: t`F(s)=\int_{0^-}^{\infty}f(t)\,e^{-st}\,dt`,
		see: ['S-plane', 'Transfer function', 'Z-transform'],
		tools: ['formulas', 'pole-zero']
	},
	{
		term: 'Lattice filter',
		def: 'Structure built from cascaded stages parameterised by reflection coefficients kᵢ. An all-pole lattice is stable exactly when every |kᵢ| < 1, which makes it robust to quantisation; widely used in speech coding (LPC).',
		see: ['Direct form', 'Stability'],
		tools: ['structures']
	},
	{
		term: 'Leakage',
		aka: ['spectral leakage'],
		def: "When a signal is not periodic within the DFT block, its energy spreads into other bins through the window's sidelobes. Tapered windows reduce leakage at the cost of frequency resolution.",
		see: ['Window function', 'Sidelobe', 'DFT', 'Scalloping loss'],
		tools: ['windows']
	},
	{
		term: 'Legendre filter',
		aka: ['optimum-L filter', 'Papoulis filter'],
		def: 'Analog family with the steepest possible roll-off at the cutoff for a monotonic (ripple-free) passband — a compromise between Butterworth and Chebyshev.',
		see: ['Butterworth filter', 'Chebyshev filter'],
		tools: ['analog-designer', 'family-compare']
	},
	{
		term: 'Limit cycle',
		def: 'A self-sustained oscillation in a fixed-point IIR filter with zero or constant input, caused by rounding or overflow in the feedback loop. Granular limit cycles are a few LSBs; overflow limit cycles can be full scale.',
		see: ['Fixed point', 'Overflow', 'IIR filter'],
		tools: ['quantization']
	},
	{
		term: 'Linear phase',
		def: 'Phase proportional to frequency, φ(ω) = −ωτ, so every frequency is delayed by the same τ and waveshapes are preserved. Symmetric FIR filters (types I, II) have exactly linear phase (apart from π jumps where their amplitude changes sign); antisymmetric ones (types III, IV) have generalised linear phase φ(ω) = π/2 − ωτ, a constant group delay plus a fixed 90° shift that suits differentiators and Hilbert transformers but does not preserve waveshapes. Causal IIR filters cannot have linear phase.',
		see: ['Group delay', 'Phase delay', 'FIR filter', 'Minimum phase', 'Pre-ringing'],
		tools: ['linear-phase']
	},
	{
		term: 'Linkwitz–Riley filter',
		def: 'Two identical Butterworth filters in cascade (LR4 = two second-order Butterworth sections). Low- and high-pass outputs are both −6 dB at the crossover; for LR4 they are in phase and sum to an all-pass with a flat magnitude (LR2 needs one output inverted).',
		see: ['Crossover', 'Butterworth filter', 'All-pass filter'],
		tools: ['crossover']
	},
	{
		term: 'Low-pass filter',
		aka: ['LPF'],
		def: 'Passes frequencies below its cutoff and attenuates those above; the most common filter and the basis of all analog prototypes.',
		see: ['High-pass filter', 'Cutoff frequency', 'Analog prototype'],
		tools: ['analog-designer', 'biquad']
	},
	{
		term: 'LTI system',
		aka: ['linear time-invariant'],
		def: 'A system that is linear (superposition holds) and time-invariant (delaying the input delays the output equally). It is fully described by its impulse response or transfer function, and turns sinusoids into sinusoids of the same frequency.',
		see: ['Impulse response', 'Convolution', 'Transfer function']
	},
	{
		term: 'Main lobe',
		def: "The central peak of a window's or filter's spectrum. Its width sets the frequency resolution of a spectrum analyser and the transition width of a window-designed FIR filter.",
		see: ['Sidelobe', 'Window function', 'Frequency resolution'],
		tools: ['windows']
	},
	{
		term: 'Matched filter',
		def: 'The filter that maximises the signal-to-noise ratio when detecting a known pulse in white noise: its impulse response is the time-reversed (and conjugated) pulse.',
		tex: t`h[n]=s^*[N-1-n]`,
		see: ['Raised-cosine filter', 'Convolution']
	},
	{
		term: 'Matched-Z transform',
		def: 'Maps every analog pole and zero directly to the z-plane by z = e^(sT), with zeros at infinity usually placed at z = −1 and the gain matched at one frequency. Simple, but the frequency response is only approximately preserved.',
		see: ['Impulse invariance', 'Bilinear transform'],
		tools: ['discretization']
	},
	{
		term: 'Maximally flat',
		def: 'A response whose first derivatives (as many as possible) are zero at one frequency, usually DC. Butterworth is maximally flat in magnitude, Bessel in group delay.',
		see: ['Butterworth filter', 'Bessel filter']
	},
	{
		term: 'Minimum phase',
		def: 'A filter with all its zeros (and poles) inside the unit circle, or in the left half-plane for analog. Among all filters with the same magnitude it has the smallest delay, and its inverse is also stable.',
		see: ['Linear phase', 'All-pass filter', 'Zero'],
		tools: ['linear-phase']
	},
	{
		term: 'Moving average',
		aka: ['boxcar filter'],
		def: 'FIR filter with N equal taps 1/N. It is the best filter for reducing white noise while keeping a sharp step response, but a poor frequency-domain filter: its response is a periodic sinc with nulls at multiples of fs/N.',
		tex: t`y[n]=\frac1N\sum_{k=0}^{N-1}x[n-k]`,
		see: ['Exponential moving average', 'CIC filter', 'Savitzky–Golay filter'],
		tools: ['simple-filters']
	},
	{
		term: 'Multiple feedback (MFB) topology',
		aka: ['MFB', 'Rauch filter'],
		def: 'Inverting active second-order filter with two feedback paths around an op-amp. Compared with Sallen–Key it is less sensitive to op-amp limitations and keeps its stopband at high frequencies; well suited to band-pass and higher-Q sections.',
		see: ['Sallen–Key topology', 'Active filter'],
		tools: ['active-filters']
	},
	{
		term: 'Multirate',
		def: 'Signal processing with more than one sample rate — decimation, interpolation, polyphase filter banks — so that each operation runs at the lowest rate that suffices.',
		see: ['Decimation', 'Interpolation', 'Polyphase filter', 'Half-band filter'],
		tools: ['special-fir']
	},
	{
		term: 'Natural frequency',
		aka: ['ω₀', 'undamped natural frequency'],
		def: 'The frequency at which a second-order system would oscillate without damping; equal to the distance of its pole pair from the origin. With damping it rings at ωd = ω₀√(1 − ζ²).',
		tex: t`p=-\zeta\omega_0\pm j\omega_0\sqrt{1-\zeta^2}`,
		see: ['Damping ratio', 'Q factor', 'Resonance'],
		tools: ['pole-zero', 'calculators']
	},
	{
		term: 'Normalized frequency',
		def: "A frequency divided by a reference so that it no longer depends on the sample rate. Conventions differ: cycles/sample (f/fs), rad/sample (ω = 2πf/fs, Nyquist = π) or MATLAB's fraction of Nyquist (f/(fs/2)).",
		see: ['Nyquist frequency', 'Sample rate'],
		tools: ['calculators']
	},
	{
		term: 'Notch filter',
		def: 'A narrow band-stop filter that removes a single frequency, such as 50/60 Hz mains hum. Zeros on the jω axis or unit circle create the null; nearby poles keep the notch narrow, with Q setting its width.',
		tex: t`H(s)=\frac{s^2+\omega_0^2}{s^2+\frac{\omega_0}{Q}s+\omega_0^2}`,
		see: ['Band-stop filter', 'Zero', 'Q factor'],
		tools: ['biquad', 'simple-filters']
	},
	{
		term: 'Nyquist frequency',
		def: 'Half the sample rate, fs/2: the highest frequency a sampled signal can represent unambiguously. Not to be confused with the Nyquist rate.',
		see: ['Nyquist rate', 'Aliasing', 'Sample rate'],
		tools: ['aliasing']
	},
	{
		term: 'Nyquist rate',
		def: 'The minimum sample rate, 2B, needed to capture a signal band-limited to B Hz without aliasing.',
		see: ['Nyquist frequency', 'Sampling theorem']
	},
	{
		term: 'Octave',
		def: 'A frequency ratio of 2. Slopes are often quoted per octave: 6.02 dB/octave per pole; bandwidths of EQ bands are given in octaves.',
		tex: t`N_\text{oct}=\log_2\frac{f_2}{f_1}`,
		see: ['Decade', 'Bandwidth'],
		tools: ['calculators']
	},
	{
		term: 'Order',
		def: 'For an IIR filter, the number of poles (degree of the denominator); for an FIR filter, the number of delays (taps − 1). Higher order gives a steeper transition at the cost of computation, delay and sensitivity.',
		see: ['Selectivity', 'Transition band', 'Roll-off'],
		tools: ['order-calculator']
	},
	{
		term: 'Overflow',
		def: "Exceeding the largest representable value in fixed-point arithmetic. Two's-complement wrap-around produces large errors (and can trigger limit cycles); saturation clips instead.",
		see: ['Fixed point', 'Limit cycle'],
		tools: ['quantization']
	},
	{
		term: 'Overshoot',
		def: 'How far a step response rises above its final value, as a fraction of that value (multiply by 100 to quote it in percent). For a second-order low-pass without zeros it depends only on the damping ratio and vanishes for ζ ≥ 1.',
		tex: t`M_p=e^{-\pi\zeta/\sqrt{1-\zeta^2}}\quad(\zeta<1)`,
		see: ['Step response', 'Damping ratio', 'Ringing'],
		tools: ['rlc', 'family-compare']
	},
	{
		term: 'Parks–McClellan algorithm',
		aka: ['Remez exchange', 'equiripple FIR'],
		def: 'Iterative algorithm (Remez exchange) that designs optimal linear-phase FIR filters in the minimax sense: for a given length, band edges and weights it minimises the largest weighted error, giving equiripple bands.',
		see: ['Equiripple', 'FIR filter', 'Linear phase'],
		tools: ['fir-designer', 'order-calculator']
	},
	{
		term: 'Partial fraction expansion',
		aka: ['residues'],
		def: 'Writing a rational transfer function as a sum of first-order terms rₖ/(s − pₖ) (or rₖ/(1 − pₖz⁻¹)). Each term is one exponential mode of the impulse response; the numerators rₖ are the residues.',
		tex: t`H(s)=\sum_k\frac{r_k}{s-p_k}\;\Rightarrow\;h(t)=\sum_k r_k e^{p_kt}`,
		see: ['Pole', 'Impulse response', 'Impulse invariance']
	},
	{
		term: 'Passband',
		def: 'The range of frequencies a filter should pass with little change, specified by its edge frequency and the allowed ripple Rp.',
		see: ['Stopband', 'Transition band', 'Ripple'],
		tools: ['order-calculator']
	},
	{
		term: 'Passive filter',
		def: 'A filter built only from resistors, capacitors and inductors, with no amplification. Passive LC filters dominate at radio frequencies and at high power.',
		see: ['Active filter', 'Ladder network'],
		tools: ['lc-ladder', 'rlc']
	},
	{
		term: 'Peaking filter',
		aka: ['bell filter', 'peaking EQ'],
		def: 'A second-order filter that boosts or cuts a band around f₀ by a set gain while leaving frequencies far away at 0 dB; Q sets the width. The basic band of a parametric equaliser.',
		see: ['Equalizer', 'Shelving filter', 'Biquad'],
		tools: ['biquad', 'parametric-eq']
	},
	{
		term: 'Phase delay',
		def: 'The delay experienced by a single sinusoid at frequency ω: the phase divided by the frequency. Equal to the group delay only when the phase is linear through the origin.',
		tex: t`\tau_p(\omega)=-\frac{\varphi(\omega)}{\omega}`,
		see: ['Group delay', 'Phase response'],
		tools: ['calculators']
	},
	{
		term: 'Phase response',
		def: 'The angle of the frequency response as a function of frequency: how far each sinusoid is shifted. It is usually unwrapped (2π jumps removed) for plotting.',
		see: ['Group delay', 'Phase delay', 'Frequency response'],
		tools: ['bode', 'tf-analyzer']
	},
	{
		term: 'Pole',
		def: 'A value of s or z where the transfer function becomes infinite (a root of the denominator). Poles define the natural modes of a system: their position sets stability, resonant frequency and damping.',
		see: ['Zero', 'Stability', 'Pole–zero plot', 'Q factor'],
		tools: ['pole-zero']
	},
	{
		term: 'Pole–zero plot',
		def: "A map of a transfer function's poles (×) and zeros (○) in the s- or z-plane. The magnitude response can be read from distances: the gain at a frequency is |k| times the product of the distances from its point (jω, or e^(jω) on the unit circle) to the zeros, divided by the product of the distances to the poles. The gain constant k is not shown on the plot.",
		tex: t`|H|=|k|\,\frac{\prod_i|x-z_i|}{\prod_i|x-p_i|},\qquad x=j\omega\;\text{or}\;e^{j\omega}`,
		see: ['Pole', 'Zero', 'S-plane', 'Z-plane'],
		tools: ['pole-zero']
	},
	{
		term: 'Polyphase filter',
		def: 'Splitting a filter into M sub-filters made of every M-th coefficient, so that decimation or interpolation filtering runs entirely at the low sample rate without computing discarded outputs.',
		see: ['Multirate', 'Decimation', 'Interpolation']
	},
	{
		term: 'Pre-ringing',
		def: 'Ringing that appears before a transient in the output of a linear-phase FIR filter, because its impulse response is symmetric. Minimum-phase filters move all the ringing after the transient.',
		see: ['Ringing', 'Linear phase', 'Minimum phase'],
		tools: ['linear-phase']
	},
	{
		term: 'Prewarping',
		def: 'Compensating the frequency warping of the bilinear transform by designing the analog filter at Ωc = (2/T)·tan(ωc/2), so the critical frequency lands exactly where intended in the digital filter.',
		tex: t`\Omega_c=2f_s\tan\frac{\pi f_c}{f_s}`,
		see: ['Bilinear transform', 'Frequency warping'],
		tools: ['calculators', 'discretization']
	},
	{
		term: 'Q factor',
		aka: ['quality factor', 'Q'],
		def: 'Sharpness of a resonance: the centre frequency divided by the −3 dB bandwidth. For a second-order section Q = 1/(2ζ); high Q means a tall, narrow peak and long ringing.',
		tex: t`Q=\frac{f_0}{\text{BW}}=\frac{1}{2\zeta}`,
		see: ['Damping ratio', 'Bandwidth', 'Resonance'],
		tools: ['calculators', 'rlc', 'biquad']
	},
	{
		term: 'Quantization',
		def: 'Mapping continuous values to a finite set of levels — in an ADC or in fixed-point arithmetic. A uniform quantiser with step Δ adds error of variance Δ²/12; B bits give about 6.02B + 1.76 dB SNR for a full-scale sine.',
		see: ['Fixed point', 'Dither', 'Coefficient quantization'],
		tools: ['quantization']
	},
	{
		term: 'Raised-cosine filter',
		def: 'Pulse-shaping filter with a cosine-tapered transition set by the roll-off factor β. Its impulse response is zero at all other symbol instants, so it causes no intersymbol interference; in practice it is split into two root-raised-cosine filters at transmitter and receiver.',
		see: [
			'Root-raised-cosine filter',
			'Intersymbol interference',
			'Matched filter',
			'Sinc function'
		],
		tools: ['special-fir']
	},
	{
		term: 'Reactance',
		def: 'The imaginary part of an impedance, X: positive (inductive, X_L = 2πfL) or negative (capacitive, X_C = −1/(2πfC)). It stores energy instead of dissipating it.',
		see: ['Impedance', 'Resonance'],
		tools: ['calculators']
	},
	{
		term: 'Rectangular window',
		aka: ['boxcar window'],
		def: 'No tapering at all — simply truncating the signal or impulse response. It has the narrowest main lobe but high (−13 dB) sidelobes that decay slowly.',
		see: ['Window function', 'Leakage', 'Gibbs phenomenon'],
		tools: ['windows']
	},
	{
		term: 'Reflection coefficient',
		aka: ['ρ', 'Γ'],
		def: 'The ratio of the reflected to the incident wave at a port where an impedance Z meets the reference impedance Z₀. It is complex, with |ρ| ≤ 1 for a passive load and ρ = 0 for a perfect match; return loss and VSWR are both functions of |ρ|.',
		tex: t`\rho=\frac{Z-Z_0}{Z+Z_0}`,
		see: ['Return loss', 'VSWR', 'Impedance'],
		tools: ['calculators', 'lc-ladder']
	},
	{
		term: 'Region of convergence',
		aka: ['ROC'],
		def: 'The set of s or z values for which a Laplace or z-transform converges. The same algebraic transform can describe different signals with different ROCs; a causal stable system has an ROC that includes the jω axis or unit circle.',
		see: ['Z-transform', 'Laplace transform', 'Stability'],
		tools: ['formulas']
	},
	{
		term: 'Resonance',
		def: "A strong response at a system's natural frequency, produced by complex poles close to the jω axis or unit circle. The peak height of a second-order resonance is about Q.",
		see: ['Q factor', 'Natural frequency', 'Resonator'],
		tools: ['rlc', 'pole-zero']
	},
	{
		term: 'Resonator',
		def: 'A two-pole filter with its poles placed close to the unit circle at the desired frequency, producing a narrow peak; the pole radius r sets the bandwidth (≈ (1 − r)·fs/π Hz).',
		see: ['Resonance', 'Pole', 'Q factor'],
		tools: ['simple-filters']
	},
	{
		term: 'Return loss',
		def: 'How much power is reflected from a port, as a positive dB value: RL = −20·log₁₀|ρ|, where ρ is the reflection coefficient. For a lossless doubly-terminated filter, passband ripple and return loss are linked through |ρ|² = 1 − 10^(−Rp/10).',
		tex: t`\text{RL}=-20\log_{10}|\rho|`,
		see: ['Reflection coefficient', 'VSWR', 'Insertion loss', 'Ripple', 'Ladder network'],
		tools: ['calculators', 'lc-ladder']
	},
	{
		term: 'Ringing',
		def: 'Decaying oscillation after a sudden change in the input, caused by high-Q poles or a sharp transition band. The ringing frequency is near the filter edge and its decay is set by the pole damping.',
		see: ['Overshoot', 'Pre-ringing', 'Gibbs phenomenon'],
		tools: ['family-compare']
	},
	{
		term: 'Ripple',
		def: 'Variation of gain inside a passband (Rp, in dB) or of attenuation inside a stopband. Chebyshev, elliptic and equiripple FIR designs deliberately allow equal ripple peaks in return for a steeper transition.',
		tex: t`\varepsilon=\sqrt{10^{R_p/10}-1}`,
		see: ['Equiripple', 'Passband', 'Chebyshev filter'],
		tools: ['calculators']
	},
	{
		term: 'Roll-off',
		def: 'How fast the attenuation grows beyond the cutoff. Far from the corner an all-pole N-th-order low-pass (Butterworth, Chebyshev I, Bessel) falls at 20N dB/decade (≈ 6N dB/octave), but M finite zeros reduce this to 20(N − M) dB/decade: Chebyshev II and elliptic low-passes level off at their stopband floor for even N and fall at only 20 dB/decade for odd N. Near the corner the family determines the steepness.',
		see: ['Order', 'Decade', 'Octave', 'Transition band', 'Transmission zero'],
		tools: ['bode', 'family-compare']
	},
	{
		term: 'Root-raised-cosine filter',
		aka: ['RRC', 'square-root raised cosine'],
		def: 'Pulse-shaping filter whose frequency response is the square root of a raised cosine. One RRC at the transmitter and a matched one at the receiver cascade to a raised cosine, so the link is free of intersymbol interference and the receiver is matched to the pulse; a single RRC pulse is not zero at the other symbol instants.',
		see: ['Raised-cosine filter', 'Matched filter', 'Intersymbol interference'],
		tools: ['special-fir']
	},
	{
		term: 'S-plane',
		def: 'The complex plane of the Laplace variable s = σ + jω, where the poles and zeros of analog systems are plotted. The jω axis is the frequency axis and the left half-plane is the stable region.',
		see: ['Z-plane', 'Pole', 'Laplace transform'],
		tools: ['pole-zero']
	},
	{
		term: 'Sallen–Key topology',
		def: 'Popular active second-order filter: an op-amp (often a unity-gain buffer) with two resistors and two capacitors. Non-inverting, simple and well behaved at low Q; its stopband degrades at high frequencies where the op-amp output impedance rises.',
		see: ['Multiple feedback (MFB) topology', 'Active filter', 'Q factor'],
		tools: ['active-filters']
	},
	{
		term: 'Sample rate',
		aka: ['sampling frequency', 'fs'],
		def: 'The number of samples taken per second, fs; the sampling period is T = 1/fs. It fixes the Nyquist frequency and the scale of every digital frequency.',
		see: ['Nyquist frequency', 'Sampling theorem', 'Normalized frequency'],
		tools: ['aliasing', 'calculators']
	},
	{
		term: 'Sampling theorem',
		aka: ['Nyquist–Shannon theorem'],
		def: 'A signal with no energy at or above B Hz is completely determined by samples taken faster than 2B per second, and can be rebuilt exactly by sinc interpolation.',
		tex: t`x(t)=\sum_n x[n]\,\operatorname{sinc}\!\Big(\frac{t-nT}{T}\Big)`,
		see: ['Nyquist rate', 'Aliasing', 'Sinc function'],
		tools: ['aliasing']
	},
	{
		term: 'Savitzky–Golay filter',
		def: 'FIR smoothing filter that fits a low-degree polynomial by least squares to each window of samples and outputs its value (or derivative) at the centre. It preserves peak heights and widths much better than a moving average.',
		see: ['Moving average', 'Differentiator', 'FIR filter'],
		tools: ['special-fir']
	},
	{
		term: 'Scalloping loss',
		aka: ['picket-fence effect'],
		def: 'The drop in measured amplitude when a tone falls halfway between two DFT bins: 3.92 dB with a rectangular window, 1.42 dB with Hann and almost none with a flat-top window, which is why flat-top windows are used for amplitude measurements.',
		see: ['DFT', 'Window function', 'Coherent gain'],
		tools: ['windows']
	},
	{
		term: 'Second-order section',
		aka: ['SOS'],
		def: 'One biquad stage in a cascade. Representing an IIR filter as second-order sections instead of one high-degree polynomial keeps the poles accurate under rounding and is the standard way to implement IIR filters.',
		see: ['Biquad', 'Cascade', 'Coefficient quantization'],
		tools: ['iir-designer', 'structures']
	},
	{
		term: 'Selectivity',
		def: 'In a low-pass specification, the ratio of stopband to passband edge frequencies, Ωs = ωs/ωp (or its inverse k). The closer it is to 1, the sharper — and higher order — the filter must be.',
		see: ['Discrimination factor', 'Order', 'Transition band'],
		tools: ['order-calculator']
	},
	{
		term: 'Sensitivity',
		def: "How much a filter's response changes for a small change in a component value or coefficient, often S = (∂H/H)/(∂x/x). High-Q sections and high-order direct forms are the most sensitive.",
		see: ['Coefficient quantization', 'E-series', 'Ladder network'],
		tools: ['active-filters', 'quantization']
	},
	{
		term: 'Settling time',
		def: 'Time for a step response to enter and stay within a tolerance band (e.g. ±2 %) of its final value. About 4τ for a first-order system and 4/(ζω₀) for a second-order one.',
		see: ['Step response', 'Time constant', 'Damping ratio'],
		tools: ['calculators', 'rlc']
	},
	{
		term: 'Shelving filter',
		aka: ['shelf filter', 'tone control'],
		def: 'Boosts or cuts all frequencies above (high shelf) or below (low shelf) a corner by a fixed amount, leaving the other side unchanged — the bass and treble controls of an amplifier.',
		see: ['Peaking filter', 'Equalizer'],
		tools: ['biquad', 'parametric-eq']
	},
	{
		term: 'Sidelobe',
		def: "Any secondary peak outside the main lobe of a window's or filter's spectrum. The highest sidelobe, together with how fast the sidelobes decay, sets how far a strong tone leaks into other bins in spectral analysis. Lower sidelobes also give a window-designed FIR filter more stopband attenuation, but that depends on the integrated sidelobes and is about 8–17 dB better than the peak sidelobe (Hann: −31.5 dB sidelobe, ≈ 44 dB stopband).",
		see: ['Main lobe', 'Leakage', 'Window function'],
		tools: ['windows', 'fir-designer']
	},
	{
		term: 'Sinc function',
		def: 'sinc(x) = sin(πx)/(πx): the Fourier transform of a rectangular pulse and the impulse response of an ideal low-pass filter.',
		tex: t`\operatorname{sinc}x=\frac{\sin\pi x}{\pi x}`,
		see: ['Brick-wall filter', 'Sampling theorem', 'Zero-order hold'],
		tools: ['fir-designer']
	},
	{
		term: 'Stability',
		aka: ['BIBO stability'],
		def: 'A system is (BIBO) stable if every bounded input gives a bounded output. That requires all poles in the left half of the s-plane (analog) or strictly inside the unit circle (digital); FIR filters are always stable.',
		see: ['Pole', 'Unit circle', 'S-plane'],
		tools: ['pole-zero', 'tf-analyzer']
	},
	{
		term: 'State space',
		def: 'Description of a system by first-order matrix equations, x′ = Ax + Bu, y = Cx + Du (or x[n+1] = Ax[n] + Bu[n]). It handles multiple inputs and outputs and is numerically better behaved than high-degree polynomials.',
		see: ['Transfer function', 'Lattice filter']
	},
	{
		term: 'Step response',
		def: 'The output when the input jumps from 0 to 1 and stays there; the running sum (integral) of the impulse response. It shows rise time, overshoot, ringing and settling at a glance.',
		see: ['Impulse response', 'Overshoot', 'Settling time'],
		tools: ['family-compare', 'rlc']
	},
	{
		term: 'Stopband',
		def: 'The range of frequencies a filter should reject, specified by its edge and the minimum attenuation Rs.',
		see: ['Passband', 'Transition band', 'Attenuation'],
		tools: ['order-calculator']
	},
	{
		term: 'Tap',
		def: 'One coefficient of an FIR filter together with its delay element; an N-tap filter has N coefficients and order N − 1.',
		see: ['FIR filter', 'Order']
	},
	{
		term: 'Time constant',
		aka: ['τ', 'tau'],
		def: 'For a first-order system, the time to reach 63.2 % (1 − 1/e) of a step; τ = RC = L/R = 1/(2πfc). After 5τ the response is within 1 % of its final value.',
		tex: t`y(t)=1-e^{-t/\tau}`,
		see: ['Corner frequency', 'Settling time', 'Exponential moving average'],
		tools: ['calculators', 'rlc']
	},
	{
		term: 'Transfer function',
		def: 'The ratio of output to input transforms, H(s) = Y(s)/X(s) or H(z) = Y(z)/X(z), with zero initial conditions. For LTI filters it is a ratio of polynomials whose roots are the zeros and poles.',
		tex: t`H(z)=\frac{\sum_k b_k z^{-k}}{1+\sum_k a_k z^{-k}}`,
		see: ['Pole', 'Zero', 'Frequency response', 'Difference equation'],
		tools: ['tf-analyzer']
	},
	{
		term: 'Transition band',
		def: 'The frequency range between the passband edge and the stopband edge, where the response is unconstrained. Its width mainly determines the required order: as a frequency ratio for IIR filters, as a fraction of fs for FIR filters.',
		see: ['Passband', 'Stopband', 'Selectivity', 'Order'],
		tools: ['order-calculator']
	},
	{
		term: 'Transmission zero',
		def: 'A frequency at which a filter passes nothing at all — a zero on the jω axis or unit circle. Elliptic and Chebyshev II filters place them in the stopband to sharpen the transition.',
		see: ['Zero', 'Elliptic filter', 'Notch filter'],
		tools: ['pole-zero', 'analog-designer']
	},
	{
		term: 'Transposed form',
		def: 'The structure obtained by reversing every signal path, swapping input and output and exchanging adders with branch points; it has the same transfer function. Transposed direct form II is the usual choice for floating-point biquads.',
		see: ['Direct form', 'Biquad'],
		tools: ['structures']
	},
	{
		term: 'Unit circle',
		def: 'The circle |z| = 1 in the z-plane. The frequency response is the transfer function evaluated on it (z = e^(jω), angle = frequency); a causal digital filter is stable when all its poles lie strictly inside.',
		see: ['Z-plane', 'Stability', 'Frequency response'],
		tools: ['pole-zero']
	},
	{
		term: 'VSWR',
		aka: ['voltage standing-wave ratio', 'SWR'],
		def: 'Voltage standing-wave ratio: the ratio of the largest to the smallest voltage amplitude along a line feeding a mismatched load. It is 1 for a perfect match and grows without bound as |ρ| approaches 1 (total reflection).',
		tex: t`\text{VSWR}=\frac{1+|\rho|}{1-|\rho|}`,
		see: ['Reflection coefficient', 'Return loss'],
		tools: ['calculators']
	},
	{
		term: 'White noise',
		def: 'A random signal whose power is spread evenly over all frequencies (a flat power spectral density). Filtering white noise shapes its spectrum by |H(f)|².',
		see: ['Equivalent noise bandwidth', 'Dither'],
		tools: ['signal-lab']
	},
	{
		term: 'Window function',
		def: 'A tapering sequence multiplied with a block of signal (spectral analysis) or with an ideal impulse response (FIR design) to soften the abrupt truncation, reducing leakage or Gibbs ripple at the cost of resolution or transition width.',
		see: ['Kaiser window', 'Hann window', 'Leakage', 'Main lobe', 'Sidelobe'],
		tools: ['windows', 'fir-designer']
	},
	{
		term: 'Z-plane',
		def: 'The complex plane of z where digital poles and zeros are plotted. The unit circle is the frequency axis (angle 0 = DC, angle π = Nyquist) and its interior is the stable region.',
		see: ['S-plane', 'Unit circle', 'Pole–zero plot'],
		tools: ['pole-zero']
	},
	{
		term: 'Z-transform',
		def: 'The discrete-time counterpart of the Laplace transform; z⁻¹ represents a one-sample delay, turning difference equations into algebra.',
		tex: t`X(z)=\sum_{n=-\infty}^{\infty}x[n]\,z^{-n}`,
		see: ['Laplace transform', 'Region of convergence', 'Transfer function'],
		tools: ['formulas', 'pole-zero']
	},
	{
		term: 'Zero',
		def: 'A value of s or z where the transfer function is zero (a root of the numerator). Zeros on the jω axis or unit circle create perfect notches; zeros outside make a filter non-minimum-phase.',
		see: ['Pole', 'Transmission zero', 'Minimum phase'],
		tools: ['pole-zero']
	},
	{
		term: 'Zero padding',
		def: 'Appending zeros to a block before the DFT. It interpolates the spectrum onto a finer grid of bins but does not improve the true frequency resolution, which is fixed by the block length and window.',
		see: ['DFT', 'Frequency resolution']
	},
	{
		term: 'Zero-order hold',
		aka: ['ZOH'],
		def: 'Holding each sample constant for one sampling period, as a DAC does. Its frequency response sinc(f/fs) droops by 3.92 dB at fs/2 and leaves images around multiples of fs that a reconstruction filter must remove.',
		tex: t`H(f)=e^{-j\pi f/f_s}\,\operatorname{sinc}\frac{f}{f_s}`,
		see: ['Image', 'Sinc function', 'Sample rate'],
		tools: ['aliasing']
	},
	{
		term: 'Zero-phase filtering',
		aka: ['forward–backward filtering', 'filtfilt'],
		def: 'Running a filter forwards and then backwards over a recorded signal. The phase shifts cancel, giving zero phase and squared magnitude response; it is non-causal, so only possible offline.',
		see: ['Causal', 'Linear phase', 'Phase response']
	},
	{
		term: 'Frequency resolution',
		def: "The ability to separate two close tones in a spectrum. It is set by the observation time: tones closer than a few bins (each fs/N wide, depending on the window's main-lobe width) merge, so longer blocks resolve finer detail.",
		see: ['Main lobe', 'Zero padding', 'DFT'],
		tools: ['windows']
	}
];

export const TERMS: Term[] = [...TERMS_UNSORTED].sort((a, b) =>
	a.term.localeCompare(b.term, 'en', { sensitivity: 'base' })
);

/** First letter used for the A–Z index ('#' for anything that is not a letter). */
export function letterOf(term: string): string {
	const ch = term.normalize('NFKD').replace(/[̀-ͯ]/g, '').charAt(0).toUpperCase();
	return /[A-Z]/.test(ch) ? ch : '#';
}

const BY_TERM = new Map(TERMS.map((tm) => [tm.term, tm]));
export const termByName = (name: string): Term | undefined => BY_TERM.get(name);

export { foldDashes };

/** Case- and dash-insensitive search over term, synonyms and definition (every word must match). */
export function matchTerm(tm: Term, query: string): boolean {
	const q = foldDashes(query.trim().toLowerCase());
	if (!q) return true;
	const hay = foldDashes(`${tm.term} ${(tm.aka ?? []).join(' ')} ${tm.def}`.toLowerCase());
	return q.split(/\s+/).every((w) => hay.includes(w));
}

/**
 * Split text into plain and highlighted runs for the words of a search query, matching the
 * way matchTerm does (case- and dash-insensitive) while keeping the text's own characters.
 */
export function highlightRuns(text: string, query: string): { s: string; hit: boolean }[] {
	const words = query
		.trim()
		.split(/\s+/)
		.filter((w) => w.length > 0)
		.map((w) =>
			foldDashes(w)
				.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
				.replace(/-/g, '[-\\u2010-\\u2015\\u2212]')
		);
	if (!words.length) return [{ s: text, hit: false }];
	const splitter = new RegExp(`(${words.join('|')})`, 'gi');
	const whole = new RegExp(`^(?:${words.join('|')})$`, 'i');
	return text
		.split(splitter)
		.filter((s) => s.length > 0)
		.map((s) => ({ s, hit: whole.test(s) }));
}
