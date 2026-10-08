# Filter Playground

An interactive workbench for **learning and designing analog and digital filters**,
built as a static Svelte 5 site. Every tool runs entirely in the browser — drag
poles and zeros, design prototypes from specifications, size real op-amp and LC
components, compare FIR design methods, listen to filters, and export
coefficients and code.

Each page pairs a live tool with a short theory section (formulas rendered with
KaTeX) and a list of experiments to try, so it works both as a learning aid and
as a reference you keep open while designing.

## Tools

| Area              | Tools                                                                                                                                                                                                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Playgrounds**   | Pole–zero playground (s- and z-plane, geometric evaluation), Bode plot builder, RC/RL/RLC circuit explorer, convolution visualizer, sampling & aliasing                                                                                                               |
| **Analog design** | Analog filter designer (Butterworth, Chebyshev I/II, elliptic, Bessel, Legendre, Gaussian, critically damped; LP/HP/BP/BS; from order or specs), family comparison, active filters (Sallen–Key / MFB with E-series parts), passive LC ladders, loudspeaker crossovers |
| **Digital IIR**   | IIR designer (bilinear, matched-Z, impulse invariance), RBJ biquad cookbook, parametric EQ, simple filters (one-pole, DC blocker, combs, resonators…), analog → digital mapping                                                                                       |
| **Digital FIR**   | FIR designer (window, Kaiser, least squares, frequency sampling, Parks–McClellan), window function explorer, special FIRs (Hilbert, differentiator, raised cosine, Savitzky–Golay, CIC, half-band), linear vs minimum phase                                           |
| **Analysis**      | Transfer function analyzer, signal lab with audio playback, coefficient quantization, filter structures with block diagrams and code                                                                                                                                  |
| **Reference**     | Order calculator, engineering calculators, formula sheet, glossary                                                                                                                                                                                                    |

## Accuracy

The DSP core in `src/lib/dsp/` is plain TypeScript with no runtime dependencies.
Its analog prototypes, order estimation, digital designs, windows and FIR
methods are unit-tested against reference values generated with SciPy
(`tests/fixtures/generate_reference.py`).

## Development

Requires Node 20+.

```bash
npm install
npm run dev       # http://localhost:5173
npm run check     # type-check Svelte + TS
npm test          # unit tests
npm run build     # static site → build/
npm run preview   # serve the built site
```

See [`docs/DEVELOPING.md`](docs/DEVELOPING.md) for the code layout, conventions
and the component APIs used by every tool page.

## Deployment

The build output in `build/` is a fully static site (every page prerendered) and
can be hosted anywhere.

**Cloudflare Workers.** `wrangler.jsonc` serves `build/` as Workers static
assets. To deploy from GitHub, connect the repository to a Worker (Workers &
Pages → Create → Import a repository) and set:

- build command: `npm run build`
- deploy command: `npx wrangler deploy`

The Worker name in the dashboard must match `name` in `wrangler.jsonc`
(`filterplayground`). Every push to `main` then builds and deploys. To deploy
from your machine instead: `npm run build && npx wrangler deploy`.

When the site is served from a sub-path rather than a domain root, set
`BASE_PATH` at build time:

```bash
BASE_PATH=/filterplayground npm run build
```
