# Developing Filter Playground

A Svelte 5 + SvelteKit static site. Every page is prerendered; all computation
runs client-side in TypeScript. This guide covers the conventions every tool
page follows.

## Commands

```bash
npm install
npm run dev        # http://localhost:5173
npm run check      # svelte-check (must report 0 errors, 0 warnings)
npm test           # vitest unit tests (DSP validated against SciPy)
npm run build      # static site in build/
BASE_PATH=/filterplayground npm run build   # for a GitHub Pages project site
```

`tests/fixtures/generate_reference.py` regenerates the SciPy reference data
(`pip install numpy scipy` first).

## Layout of the code

```
src/lib/dsp/            Pure DSP (no Svelte). Validated by tests/dsp.test.ts.
  complex.ts            {re, im} complex numbers: add, mul, div, abs, arg, exp, sqrt…
  poly.ts               Polynomials (descending powers), roots (Aberth–Ehrlich)
  types.ts              ZPK, SOS, TF, Filter (AnalogFilter | DigitalFilter)
  convert.ts            zpk2tf, tf2zpk, zpk2sos (SciPy pairing), sos2tf, sos2zpk,
                        analogStages (1st/2nd-order stages with w0, Q), digitalZpk/Sos/Tf
  response.ts           evaluate(filter, fHz) → { H, mag, magDb, phaseDeg, groupDelay }
                        freqsZpk / freqzZpk / freqzSos / groupDelay*, logspace, linspace, unwrap
  analog.ts             Prototypes: butter, cheby1, cheby2, ellip, bessel, legendre,
                        gaussian, critical; FAMILIES metadata; estimateOrder
  design.ts             designAnalog(spec), designDigital(spec), estimateFromSpecs(...)
  transforms.ts         lp2lp/hp/bp/bs, bilinear, prewarp, matchedZ, impulseInvariance,
                        forward/backwardEuler, discretize(analog, fs, method)
  biquad.ts             RBJ cookbook biquads + first-order sections, Q ↔ bandwidth
  time.ts               lfilter, sosfilt, firfilt, applyDigital, digital impulse/step,
                        analogTimeResponse (exact, state space), analogSimulate (ZOH input)
  fir.ts                firwin, firls, firwin2, Hilbert, differentiator, (root) raised
                        cosine, Gaussian, Savitzky–Golay, CIC, minimumPhase, remezOrderEstimate
  remez.ts              Parks–McClellan equiripple design
  windows.ts            20 windows, windowMetrics, windowSpectrum, kaiserOrder, kaiserBeta
  fft.ts                radix-2 FFT, magnitudeSpectrum, welchPsd
  linalg.ts             small dense matrices: solve, expm, matmul
  units.ts              formatSI, parseSI ("4k7", "10n"), trimNumber, E-series rounding
src/lib/components/
  plot/Plot.svelte          Generic SVG chart (see below)
  plot/PoleZeroPlot.svelte  s/z-plane with draggable handles and optional |H| heatmap
  plot/ResponseView.svelte  Magnitude + phase + group delay + p/z + impulse + step for any Filter
  controls/                 Slider, NumberInput, Select, Segmented, Toggle
  layout/                   ToolLayout (page shell), Card, ControlGroup
  content/                  Tex (KaTeX), CodeBlock, Callout, StatGrid, ExportPanel
src/lib/export.ts       Coefficient formatting & code generation (C, Python, MATLAB, JSON)
src/lib/specmask.ts     specRegions(): forbidden regions for a magnitude spec
src/lib/tools.ts        Registry of all pages (title, nav label, category, description)
src/lib/features/<slug>/  Page-specific helper modules (one folder per tool)
src/routes/<slug>/+page.svelte   One folder per tool
```

## Conventions

- **Units.** Analog ZPKs are in **rad/s**. UI frequencies are in **Hz**.
  `evaluate()` takes Hz for both analog and digital filters. Digital filters carry
  their own `fs`.
- **Polynomials** use descending powers (`[a0, a1, a2]` = a0·s² + a1·s + a2); digital
  `b`/`a` arrays are coefficients of z⁰, z⁻¹, z⁻² … (SciPy convention).
- **Digital ZPK** means H(z) = k·Π(z − zᵢ)/Π(z − pᵢ) exactly; fewer zeros than poles
  is a pure delay, handled correctly by every conversion.
- **Svelte 5 runes only** (`$state`, `$derived`, `$derived.by`, `$effect`, `$props`,
  `$bindable`, snippets). No legacy `export let`, no stores for local state.
- Derive everything you can with `$derived`; avoid `$effect` for computing values.
- Guard computations that can throw (invalid input) with try/catch and show a
  `Callout kind="danger"` instead of crashing the page.
- Keep heavy work proportional: responses use ~700 points; time-domain views a
  few hundred. Sliders must stay smooth while dragging.
- Pages must work at phone width (≥ 360 px): no fixed widths wider than the
  viewport, tables wrapped in an `overflow-x: auto` container.
- Prefer the shared components. Do not copy-paste a chart implementation.

## Page anatomy

```svelte
<script lang="ts">
	import ToolLayout from '$lib/components/layout/ToolLayout.svelte';
	// …
</script>

<ToolLayout slug="my-tool" related={['other-slug']}>
	{#snippet controls()}
		<ControlGroup title="Filter"> …Slider / Select / Segmented… </ControlGroup>
	{/snippet}

	<!-- main area: StatGrid, ResponseView / Plot cards, tables, ExportPanel -->

	{#snippet theory()}
		<h2>How it works</h2>
		<p>… with <Tex math="H(s)=\frac{1}{s+1}" /> inline and <Tex display math="…" /> blocks …</p>
		<Callout kind="try"><ul><li>Experiments to try…</li></ul></Callout>
	{/snippet}
</ToolLayout>
```

`ToolLayout` reads the title and description from `src/lib/tools.ts`, sets the
`<title>`, and renders the sticky control column, main area, theory section and
related links. Omit `controls` for a full-width page; pass `wideControls` for a
360 px control column.

In Svelte templates, write TeX in a JS string to avoid brace issues:
`<Tex math={'\\frac{1}{1+s}'} />`.

`examples`: `src/routes/analog-designer/+page.svelte` and `src/routes/biquad/+page.svelte`.

## Charts (follow these rules)

- `Plot` props: `series` ({x, y, label, color, dash, kind: 'line'|'stem'|'step'|'points'|'area', format}),
  `xScale`/`yScale` ('linear'|'log'), `xDomain`, `yDomain`, `yLimits`, `minYSpan`,
  `xLabel`, `yLabel`, `xFormat`, `yFormat`, `xTooltipFormat`, `title`, `height`,
  `regions` (spec masks), `vlines`/`hlines` (reference lines), `markers`
  (draggable handles; `onmarkerdrag(id, x, y)`, `onmarkerwheel`, `onmarkerselect`),
  `onplotclick(x, y)`, `overlay` snippet (gets scales), `toolbar` snippet,
  `exportName` (adds a CSV button).
- Colours: categorical series use `var(--s1)` … `var(--s8)` **in that fixed order**
  (`seriesColor(i)` from `plot/scales.ts`). Never cycle past 8; never recolour a
  series when others are hidden. Text is never coloured with a series colour.
- Status colours (`--good`, `--warning`, `--critical` and their `-ink` text
  variants) mean status only, and always come with an icon or a label.
- One y-axis per chart. Magnitude and phase are separate charts.
- ≥ 2 series → a legend (automatic when series have labels). The crosshair
  tooltip is on by default.
- Lines are 2 px; grids are hairlines; reference lines may be dashed.
- `freqFormat` (from `plot/scales.ts`) formats Hz ticks as 20, 200, 2k, 20k.

## Theming

All colours are CSS custom properties defined in `src/app.css` for light and dark
(`--surface`, `--surface-2`, `--border`, `--text`, `--text-2`, `--muted`,
`--accent`, `--accent-ink`, `--accent-wash`, chart chrome `--grid`, `--axis`, …).
Never hard-code colours in components; dark mode must look intentional.

## Testing a page visually

With the dev server running, `scratchpad/pw/shot.mjs` (outside the repo) can take
full-page screenshots in light and dark themes:

```bash
THEMES=light,dark node shot.mjs http://localhost:5173 ./out /my-tool/
```
