<script lang="ts">
	import ToolLayout from '$lib/components/layout/ToolLayout.svelte';
	import ControlGroup from '$lib/components/layout/ControlGroup.svelte';
	import Card from '$lib/components/layout/Card.svelte';
	import Select from '$lib/components/controls/Select.svelte';
	import Segmented from '$lib/components/controls/Segmented.svelte';
	import NumberInput from '$lib/components/controls/NumberInput.svelte';
	import ResponseView from '$lib/components/plot/ResponseView.svelte';
	import StatGrid, { type Stat } from '$lib/components/content/StatGrid.svelte';
	import Callout from '$lib/components/content/Callout.svelte';
	import Tex from '$lib/components/content/Tex.svelte';
	import CodeBlock from '$lib/components/content/CodeBlock.svelte';
	import ExportPanel from '$lib/components/content/ExportPanel.svelte';
	import { format as fmtC, type Complex } from '$lib/dsp/complex';
	import { formatSI, trimNumber } from '$lib/dsp/units';
	import { num } from '$lib/export';
	import {
		completeConjugates,
		formatError,
		formatReal,
		parseComplexList,
		parseNumbers,
		parseScalar,
		parseSos,
		type ParseResult
	} from '$lib/features/tf-analyzer/parse';
	import {
		analyze,
		buildModel,
		rootRows,
		sensitivity,
		type Domain,
		type InputForm,
		type Model,
		type RawInput
	} from '$lib/features/tf-analyzer/analyze';
	import {
		residue,
		residuez,
		impulseFromResidues,
		evalAnalogPfe
	} from '$lib/features/tf-analyzer/pfe';
	import { EXAMPLES, type ExampleTexts } from '$lib/features/tf-analyzer/examples';
	import { lfilter } from '$lib/dsp/time';
	import { freqsZpk } from '$lib/dsp/response';

	type Texts = Required<ExampleTexts>;
	type Field = keyof Texts;

	const first = EXAMPLES.find((e) => e.id === 'ellip-sos')!;
	let exampleId = $state(first.id);
	let domain = $state<Domain>(first.domain);
	let fs = $state(first.fs ?? 48000);
	let form = $state<InputForm>(first.form);
	let texts = $state<Texts>({
		b: '',
		a: '',
		sos: '',
		z: '',
		p: '',
		k: '1',
		taps: '',
		...first.texts
	});
	let reprTab = $state<'ba' | 'zpk' | 'sos' | 'pfe'>('ba');
	let xScale = $state<'log' | 'linear' | undefined>('log');

	const example = $derived(EXAMPLES.find((e) => e.id === exampleId));

	// ---------------- parsing ----------------
	interface Parsed {
		raw: RawInput | null;
		errors: Partial<Record<Field, string>>;
		notes: string[];
	}

	function take<T>(
		r: ParseResult<T>,
		field: Field,
		errors: Parsed['errors'],
		notes: string[]
	): T | undefined {
		if (!r.ok) {
			errors[field] = formatError(r.error);
			return undefined;
		}
		notes.push(...r.notes);
		return r.value;
	}

	const parsed = $derived.by((): Parsed => {
		const errors: Parsed['errors'] = {};
		const notes: string[] = [];
		const raw: RawInput = {};
		if (form === 'ba') {
			raw.b = take(parseNumbers(texts.b, 'numerator b'), 'b', errors, notes);
			raw.a = take(parseNumbers(texts.a, 'denominator a'), 'a', errors, notes);
		} else if (form === 'sos') {
			raw.sos = take(parseSos(texts.sos), 'sos', errors, notes);
		} else if (form === 'zpk') {
			const z = take(parseComplexList(texts.z), 'z', errors, notes);
			const p = take(parseComplexList(texts.p), 'p', errors, notes);
			raw.k = take(parseScalar(texts.k, 'gain k'), 'k', errors, notes);
			if (z) {
				const cz = completeConjugates(z);
				raw.z = cz.roots;
				if (cz.added.length)
					notes.push(
						`Added the conjugate${cz.added.length > 1 ? 's' : ''} of ${cz.added.map((v) => fmtC({ re: v.re, im: -v.im }, 5)).join(', ')} to the zeros so that the coefficients are real.`
					);
			}
			if (p) {
				const cp = completeConjugates(p);
				raw.p = cp.roots;
				if (cp.added.length)
					notes.push(
						`Added the conjugate${cp.added.length > 1 ? 's' : ''} of ${cp.added.map((v) => fmtC({ re: v.re, im: -v.im }, 5)).join(', ')} to the poles so that the coefficients are real.`
					);
			}
		} else {
			raw.taps = take(parseNumbers(texts.taps, 'FIR taps'), 'taps', errors, notes);
		}
		return { raw: Object.keys(errors).length ? null : raw, errors, notes };
	});

	let lastGood: Model | null = null;
	const result = $derived.by(() => {
		let error: string | null = null;
		let model: Model | null = null;
		if (parsed.raw) {
			try {
				model = buildModel(domain, fs, form, parsed.raw);
				lastGood = model;
			} catch (e) {
				error = e instanceof Error ? e.message : String(e);
			}
		}
		return { model: model ?? lastGood, stale: !model, error };
	});
	const model = $derived(result.model);
	const errorList = $derived(Object.values(parsed.errors) as string[]);

	// ---------------- analysis ----------------
	const props = $derived.by(() => {
		if (!model) return null;
		try {
			return analyze(model);
		} catch {
			return null;
		}
	});
	const rows = $derived(model ? rootRows(model) : []);
	const sens = $derived(model ? sensitivity(model) : []);

	const fmtHz = (f: number) => (f === Infinity ? '∞' : formatSI(f, 'Hz', 4));
	const fmtDb = (m: number) => {
		const db = 20 * Math.log10(m);
		return Math.abs(db) < 5e-6 ? '0' : trimNumber(db, 4);
	};
	const fmtGain = (m: number) =>
		m === Infinity ? '∞' : m === 0 ? '0 (−∞ dB)' : `${trimNumber(m, 4)} (${fmtDb(m)} dB)`;

	const stats = $derived.by((): Stat[] => {
		if (!model || !props) return [];
		const p = props;
		const digital = model.domain === 'digital';
		const out: Stat[] = [
			{
				label: 'Order',
				value: String(p.order),
				hint: digital
					? 'Number of poles of the causal realisation (= max(len b, len a) − 1).'
					: 'Degree of the denominator A(s).'
			},
			{
				label: 'Stability',
				value:
					p.stability === 'stable'
						? 'Stable'
						: p.stability === 'marginal'
							? 'Marginal'
							: 'Unstable',
				status:
					p.stability === 'stable' ? 'good' : p.stability === 'marginal' ? 'warning' : 'critical',
				hint: digital
					? 'All poles strictly inside the unit circle?'
					: 'All poles strictly in the left half-plane?'
			}
		];
		if (p.worstPole !== null)
			out.push({
				label: digital ? 'Largest |pole|' : 'Largest Re(pole)',
				value: digital ? trimNumber(p.worstPole, 6) : `${trimNumber(p.worstPole, 4)} rad/s`,
				hint: digital
					? 'Distance of the outermost pole from the origin. Close to 1 = long ringing.'
					: 'Real part of the right-most pole (rad/s). Must be negative.'
			});
		out.push({
			label: 'Minimum phase',
			value: p.minPhase.status === 'yes' ? 'Yes' : p.minPhase.status === 'no' ? 'No' : 'Borderline',
			status:
				p.minPhase.status === 'yes' ? 'good' : p.minPhase.status === 'no' ? 'critical' : 'warning',
			hint: p.minPhase.reason
		});
		out.push({
			label: 'All-pass',
			value: p.allPass.status ? 'Yes' : 'No',
			hint: p.allPass.status
				? `|H| is flat to within ${trimNumber(p.allPass.rippleDb, 2)} dB`
				: 'The magnitude is not constant'
		});
		out.push({
			label: 'Linear phase',
			value:
				p.linearPhase.status === 'yes'
					? `Yes (type ${p.linearPhase.type})`
					: p.linearPhase.status === 'no'
						? 'No'
						: 'n/a',
			hint: p.linearPhase.reason
		});
		out.push({
			label: 'DC gain',
			value: fmtGain(p.dcGain),
			hint: digital ? '|H(z = 1)|' : '|H(s = 0)|'
		});
		if (p.nyquistGain !== null)
			out.push({
				label: 'Nyquist gain',
				value: fmtGain(p.nyquistGain),
				hint: '|H(z = −1)| at fs/2'
			});
		out.push({
			label: 'Peak gain',
			value:
				p.peak.mag === Infinity
					? '∞'
					: `${fmtDb(p.peak.mag)} dB @ ${p.peak.atInfinity ? 'f → ∞' : fmtHz(p.peak.f)}`,
			hint: 'Maximum of |H| over frequency'
		});
		out.push({
			label: '−3 dB point' + (p.minus3.length > 1 ? 's' : ''),
			value: p.minus3.length
				? p.minus3
						.slice(0, 4)
						.map((f) => fmtHz(f))
						.join(', ') + (p.minus3.length > 4 ? ', …' : '')
				: '—',
			hint: 'Frequencies where |H| is 3.01 dB below the peak gain'
		});
		out.push({
			label: 'Sections (SOS)',
			value: String(p.sections),
			hint: 'Number of second-order sections in the cascade'
		});
		return out;
	});

	// ---------------- partial fractions ----------------
	const pfe = $derived.by(() => {
		if (!model) return null;
		try {
			if (model.domain === 'digital') {
				if (model.fir) return { fir: true as const };
				const r = residuez(model.tf.b, model.tf.a, model.zpk.p);
				let err = 0;
				if (!r.repeated) {
					const N = 64;
					const x = new Array(N).fill(0);
					x[0] = 1;
					const ref = lfilter(model.tf.b, model.tf.a, x);
					const h = impulseFromResidues(r, N);
					const scale = Math.max(1e-300, ...Array.from(ref, Math.abs));
					for (let n = 0; n < N; n++) err = Math.max(err, Math.abs(h[n] - ref[n]) / scale);
				}
				return { fir: false as const, r, err };
			}
			const r = residue(model.tf.b, model.tf.a, model.zpk.p);
			let err = 0;
			if (!r.repeated) {
				const w0 = Math.max(1, ...model.zpk.p.map((p) => Math.hypot(p.re, p.im)));
				for (const w of [0.1 * w0, 0.7 * w0, 3.3 * w0]) {
					const s = { re: 0, im: w };
					const h = evalAnalogPfe(r, s);
					const ref = freqsZpk(model.zpk, [w])[0];
					err = Math.max(
						err,
						Math.hypot(h.re - ref.re, h.im - ref.im) / Math.max(1e-300, Math.hypot(ref.re, ref.im))
					);
				}
			}
			return { fir: false as const, r, err };
		} catch {
			return null;
		}
	});

	// ---------------- formatting ----------------
	const f15 = (v: number) => formatReal(v, 15);
	const listText = (vs: number[]) => vs.map(f15).join(', ');
	const sosText = (sos: number[][]) => sos.map((r) => r.map(f15).join(', ')).join('\n');
	function rootsText(rs: Complex[]): string {
		const lines: string[] = [];
		const used = new Array(rs.length).fill(false);
		rs.forEach((r, i) => {
			if (used[i]) return;
			used[i] = true;
			if (Math.abs(r.im) > 1e-14 * Math.max(1, Math.abs(r.re))) {
				const j = rs.findIndex(
					(s, k) =>
						!used[k] &&
						Math.abs(s.re - r.re) <= 1e-12 * Math.max(1, Math.abs(r.re)) &&
						Math.abs(s.im + r.im) <= 1e-12 * Math.max(1, Math.abs(r.im))
				);
				if (j >= 0) {
					used[j] = true;
					lines.push(`${Math.abs(r.re) > 0 ? f15(r.re) : ''}±${f15(Math.abs(r.im))}j`);
					return;
				}
				lines.push(`${f15(r.re)}${r.im < 0 ? '-' : '+'}${f15(Math.abs(r.im))}j`);
			} else lines.push(f15(r.re));
		});
		return lines.join('\n');
	}

	function textsFor(m: Model, target: InputForm): Partial<Texts> | null {
		switch (target) {
			case 'ba':
				return { b: listText(m.tf.b), a: listText(m.tf.a) };
			case 'sos':
				return { sos: sosText(m.sos) };
			case 'zpk':
				return { z: rootsText(m.zpk.z), p: rootsText(m.zpk.p), k: f15(m.zpk.k) };
			case 'fir':
				return m.fir ? { taps: listText(m.fir) } : null;
		}
	}

	function switchForm(target: InputForm) {
		const m = model;
		if (m && target !== form) {
			const t = textsFor(m, target);
			if (t) texts = { ...texts, ...t };
		}
		form = target;
	}

	function switchDomain(d: Domain) {
		domain = d;
		if (d === 'analog' && form === 'fir') form = 'ba';
	}

	function loadExample(id: string) {
		const ex = EXAMPLES.find((e) => e.id === id);
		if (!ex) return;
		exampleId = id;
		domain = ex.domain;
		if (ex.fs) fs = ex.fs;
		form = ex.form;
		texts = { b: '', a: '', sos: '', z: '', p: '', k: '1', taps: '', ...ex.texts };
		xScale =
			ex.domain === 'analog' ||
			ex.id.startsWith('ellip') ||
			ex.id === 'notch' ||
			ex.id === 'butter-biquad'
				? 'log'
				: 'linear';
	}

	const formOptions = $derived([
		{ value: 'ba' as const, label: 'b / a' },
		{ value: 'sos' as const, label: 'SOS' },
		{ value: 'zpk' as const, label: 'Z / P / k' },
		...(domain === 'digital' ? [{ value: 'fir' as const, label: 'FIR' }] : [])
	]);

	// ---------------- equations ----------------
	function polyTex(c: number[], v: 'z' | 's'): string {
		const n = c.length - 1;
		const terms: string[] = [];
		c.forEach((coef, i) => {
			if (coef === 0) return;
			const pow = v === 'z' ? i : n - i;
			const mag = Math.abs(coef);
			const val = num(mag, 5);
			const sym = pow === 0 ? '' : v === 'z' ? `z^{-${pow}}` : pow === 1 ? 's' : `s^{${pow}}`;
			const body = sym && mag === 1 ? sym : `${val}${sym ? '\\,' + sym : ''}`;
			const sign = coef < 0 ? '-' : '+';
			terms.push(terms.length === 0 ? (coef < 0 ? '-' : '') + body : `${sign} ${body}`);
		});
		return terms.length ? terms.join(' ') : '0';
	}
	const tfTex = $derived.by(() => {
		if (!model) return '';
		const { b, a } = model.tf;
		if (Math.max(b.length, a.length) > 9) return '';
		const a0 = a[0] || 1;
		const v = model.domain === 'digital' ? 'z' : 's';
		return `H(${v}) = \\dfrac{${polyTex(
			b.map((x) => x / a0),
			v
		)}}{${polyTex(
			a.map((x) => x / a0),
			v
		)}}`;
	});

	const exportTf = $derived(
		model
			? {
					b: model.tf.b.map((v) => v / (model.tf.a[0] || 1)),
					a: model.tf.a.map((v) => v / (model.tf.a[0] || 1))
				}
			: undefined
	);

	const statusIcon = (ok: boolean) => (ok ? '✓' : '✕');
</script>

<ToolLayout
	slug="tf-analyzer"
	related={['pole-zero', 'iir-designer', 'quantization', 'structures', 'linear-phase']}
	wideControls
>
	{#snippet controls()}
		<ControlGroup title="Example">
			<Select
				label="Load an example"
				value={exampleId}
				options={EXAMPLES.map((e) => ({
					value: e.id,
					label: e.label,
					group: e.domain === 'digital' ? 'Digital' : 'Analog'
				}))}
				onchange={loadExample}
			/>
			{#if example}<p class="small muted desc">{example.description}</p>{/if}
		</ControlGroup>

		<ControlGroup title="Domain">
			<Segmented
				value={domain}
				options={[
					{ value: 'digital', label: 'Digital H(z)' },
					{ value: 'analog', label: 'Analog H(s)' }
				]}
				onchange={switchDomain}
			/>
			{#if domain === 'digital'}
				<NumberInput
					label="Sample rate fs"
					bind:value={fs}
					unit="Hz"
					min={1}
					max={1e9}
					logStep={2}
					si
				/>
			{/if}
		</ControlGroup>

		<ControlGroup title="Input format">
			<Segmented value={form} options={formOptions} onchange={switchForm} size="small" />
			{#if form === 'ba'}
				<div class="field">
					<label for="in-b">Numerator b</label>
					<textarea
						id="in-b"
						rows="3"
						spellcheck="false"
						bind:value={texts.b}
						class:bad={parsed.errors.b}
						aria-invalid={!!parsed.errors.b}
					></textarea>
					{#if parsed.errors.b}<p class="err" role="alert">
							<span aria-hidden="true">✕</span>
							{parsed.errors.b}
						</p>{/if}
				</div>
				<div class="field">
					<label for="in-a">Denominator a</label>
					<textarea
						id="in-a"
						rows="3"
						spellcheck="false"
						bind:value={texts.a}
						class:bad={parsed.errors.a}
						aria-invalid={!!parsed.errors.a}
					></textarea>
					{#if parsed.errors.a}<p class="err" role="alert">
							<span aria-hidden="true">✕</span>
							{parsed.errors.a}
						</p>{/if}
				</div>
				<p class="small muted hint">
					{#if domain === 'digital'}Coefficients of z⁰, z⁻¹, z⁻², … (SciPy / MATLAB convention).{:else}Descending
						powers of s: <span class="mono">1, 2, 2, 1</span> = s³ + 2s² + 2s + 1.{/if}
				</p>
			{:else if form === 'sos'}
				<div class="field">
					<label for="in-sos">Sections (one row each: b0 b1 b2 a0 a1 a2)</label>
					<textarea
						id="in-sos"
						rows="7"
						spellcheck="false"
						bind:value={texts.sos}
						class:bad={parsed.errors.sos}
						aria-invalid={!!parsed.errors.sos}
					></textarea>
					{#if parsed.errors.sos}<p class="err" role="alert">
							<span aria-hidden="true">✕</span>
							{parsed.errors.sos}
						</p>{/if}
				</div>
				<p class="small muted hint">
					{#if domain === 'digital'}Each row is (b0 + b1 z⁻¹ + b2 z⁻²)/(a0 + a1 z⁻¹ + a2 z⁻²), the
						layout of scipy.signal.sosfilt.{:else}Each row is (b0 s² + b1 s + b2)/(a0 s² + a1 s +
						a2).{/if}
				</p>
			{:else if form === 'zpk'}
				<div class="field">
					<label for="in-z">Zeros</label>
					<textarea
						id="in-z"
						rows="3"
						spellcheck="false"
						bind:value={texts.z}
						class:bad={parsed.errors.z}
						aria-invalid={!!parsed.errors.z}
					></textarea>
					{#if parsed.errors.z}<p class="err" role="alert">
							<span aria-hidden="true">✕</span>
							{parsed.errors.z}
						</p>{/if}
				</div>
				<div class="field">
					<label for="in-p">Poles</label>
					<textarea
						id="in-p"
						rows="3"
						spellcheck="false"
						bind:value={texts.p}
						class:bad={parsed.errors.p}
						aria-invalid={!!parsed.errors.p}
					></textarea>
					{#if parsed.errors.p}<p class="err" role="alert">
							<span aria-hidden="true">✕</span>
							{parsed.errors.p}
						</p>{/if}
				</div>
				<div class="field">
					<label for="in-k">Gain k</label>
					<input
						id="in-k"
						type="text"
						spellcheck="false"
						bind:value={texts.k}
						class:bad={parsed.errors.k}
						aria-invalid={!!parsed.errors.k}
					/>
					{#if parsed.errors.k}<p class="err" role="alert">
							<span aria-hidden="true">✕</span>
							{parsed.errors.k}
						</p>{/if}
				</div>
				<p class="small muted hint">
					H({domain === 'digital' ? 'z' : 's'}) = k·Π({domain === 'digital' ? 'z' : 's'} − zᵢ)/Π({domain ===
					'digital'
						? 'z'
						: 's'} − pᵢ){domain === 'analog' ? ', in rad/s' : ''}. Write
					<span class="mono">0.5+0.3j</span>, <span class="mono">1-2i</span>,
					<span class="mono">0.5±0.3j</span>
					(a conjugate pair) or
					<span class="mono">0.9∠30°</span>. Missing conjugates are added.
				</p>
			{:else}
				<div class="field">
					<label for="in-taps">Taps h[0], h[1], …</label>
					<textarea
						id="in-taps"
						rows="5"
						spellcheck="false"
						bind:value={texts.taps}
						class:bad={parsed.errors.taps}
						aria-invalid={!!parsed.errors.taps}
					></textarea>
					{#if parsed.errors.taps}<p class="err" role="alert">
							<span aria-hidden="true">✕</span>
							{parsed.errors.taps}
						</p>{/if}
				</div>
			{/if}
			<p class="small muted hint">
				Separators: commas, spaces, newlines or <span class="mono">;</span>. Brackets,
				<span class="mono">np.array(…)</span>, <span class="mono">b =</span> and comments are ignored.
				Switching format converts the current filter.
			</p>
		</ControlGroup>
	{/snippet}

	{#if errorList.length || result.error}
		<Callout kind="danger" title="Input problem">
			<ul>
				{#each errorList as e (e)}<li>{e}</li>{/each}
				{#if result.error}<li>{result.error}</li>{/if}
			</ul>
			{#if model}<p>The analysis below still shows the last valid filter.</p>{/if}
		</Callout>
	{/if}
	{#if !result.stale && (parsed.notes.length || model?.notes.length)}
		<Callout kind="note" title="Interpreted as">
			<ul>
				{#each [...parsed.notes, ...(model?.notes ?? [])] as n (n)}<li>{n}</li>{/each}
			</ul>
		</Callout>
	{/if}

	{#if model && props}
		<StatGrid {stats} />

		<ResponseView filters={[{ filter: model.filter }]} bind:xScale />

		<Card
			title="Poles and zeros"
			subtitle={model.domain === 'digital'
				? 'Conjugate pairs are listed once (±). Q is that of the equivalent analog pole s = fs·ln z; T₆₀ is the time for the mode to decay by 60 dB.'
				: 'Conjugate pairs are listed once (±). f₀ = |p|/2π, Q = |p|/(2|Re p|); T₆₀ is the time for the mode to decay by 60 dB.'}
		>
			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th>Type</th>
							<th>Value</th>
							<th class="num">Mult.</th>
							<th class="num">{model.domain === 'digital' ? '|z|' : '|s| (rad/s)'}</th>
							{#if model.domain === 'digital'}<th class="num">Angle</th>{/if}
							<th class="num">{model.domain === 'digital' ? 'Frequency' : 'f₀'}</th>
							<th class="num">Q</th>
							<th class="num">T₆₀</th>
						</tr>
					</thead>
					<tbody>
						{#each rows as r, i (i)}
							{@const outside =
								r.kind === 'pole' &&
								(model.domain === 'digital' ? r.mag >= 1 - 1e-9 : r.value.re >= 0)}
							<tr>
								<td class="nowrap">{r.kind === 'pole' ? '× pole' : '○ zero'}</td>
								<td class="mono small nowrap"
									>{r.pair ? fmtC(r.value, 6).replace(' + ', ' ± ') : fmtC(r.value, 6)}</td
								>
								<td class="num">{r.multiplicity > 1 ? r.multiplicity : ''}</td>
								<td class="num">
									{trimNumber(r.mag, 6)}
									{#if outside}<span class="flag" title="Outside the stable region">✕ unstable</span
										>{/if}
								</td>
								{#if model.domain === 'digital'}<td class="num"
										>{trimNumber(Math.abs(r.angleDeg), 5)}°</td
									>{/if}
								<td class="num">{r.mag === 0 ? '—' : formatSI(r.freqHz, 'Hz', 4)}</td>
								<td class="num"
									>{r.q === null ? '—' : r.q === Infinity ? '∞' : trimNumber(r.q, 4)}</td
								>
								<td class="num">{r.t60 === null ? '—' : formatSI(r.t60, 's', 3)}</td>
							</tr>
						{:else}
							<tr><td colspan="8" class="muted">No poles or zeros: H is a constant gain.</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="small muted">Overall gain k = {trimNumber(model.zpk.k, 8)}.</p>
		</Card>

		{#if sens.length}
			<Card
				title="Coefficient sensitivity"
				subtitle="What happens if the denominator is written down with only d significant digits — once as a single polynomial a, once section by section."
			>
				<div class="table-wrap">
					<table>
						<thead>
							<tr>
								<th>Digits</th>
								<th class="num">b/a: pole shift</th>
								<th class="num">b/a: max |p|</th>
								<th class="num">SOS: pole shift</th>
								<th class="num">SOS: max |p|</th>
							</tr>
						</thead>
						<tbody>
							{#each sens as s (s.digits)}
								<tr>
									<td>{s.digits}</td>
									<td class="num">{trimNumber(s.ba.shift, 2)}</td>
									<td class="num"
										><span class={s.ba.maxRadius < 1 ? 'ok' : 'bad-ink'}
											>{statusIcon(s.ba.maxRadius < 1)} {trimNumber(s.ba.maxRadius, 6)}</span
										></td
									>
									<td class="num">{trimNumber(s.sos.shift, 2)}</td>
									<td class="num"
										><span class={s.sos.maxRadius < 1 ? 'ok' : 'bad-ink'}
											>{statusIcon(s.sos.maxRadius < 1)} {trimNumber(s.sos.maxRadius, 6)}</span
										></td
									>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<p class="small muted">
					Pole shift = largest distance between an exact pole and its rounded counterpart. ✓/✕ mark
					whether the rounded filter is still stable.
				</p>
			</Card>
		{/if}

		<Card
			title="Representations"
			subtitle="The same filter in every standard form. “Edit as …” loads it into the input box."
		>
			<Segmented
				size="small"
				bind:value={reprTab}
				options={[
					{ value: 'ba', label: 'b / a' },
					{ value: 'zpk', label: 'Poles / zeros' },
					{ value: 'sos', label: 'SOS' },
					{ value: 'pfe', label: 'Partial fractions' }
				]}
			/>
			<div class="repr">
				{#if reprTab === 'ba'}
					{#if tfTex}<Tex display math={tfTex} />{/if}
					<CodeBlock
						code={`b = [${model.tf.b.map((v) => num(v)).join(', ')}]\na = [${model.tf.a.map((v) => num(v)).join(', ')}]`}
						language={model.domain === 'digital' ? 'powers of z⁻¹' : 'descending powers of s'}
						maxHeight="14rem"
					/>
					{#if model.domain === 'digital' && model.tf.a[0] !== 1}
						<p class="small muted">
							Normalised (a₀ = 1): b = [{model.tf.b
								.map((v) => num(v / model.tf.a[0], 8))
								.join(', ')}], a = [{model.tf.a.map((v) => num(v / model.tf.a[0], 8)).join(', ')}]
						</p>
					{/if}
					{#if form !== 'ba'}<button
							class="btn small"
							type="button"
							onclick={() => switchForm('ba')}>Edit as b / a</button
						>{/if}
				{:else if reprTab === 'zpk'}
					<CodeBlock
						code={`z = [${model.zpk.z.map((v) => fmtC(v, 12).replace(/ /g, '')).join(', ')}]\np = [${model.zpk.p.map((v) => fmtC(v, 12).replace(/ /g, '')).join(', ')}]\nk = ${num(model.zpk.k)}`}
						language={model.domain === 'digital'
							? 'H(z) = k·Π(z − zᵢ)/Π(z − pᵢ)'
							: 'H(s) = k·Π(s − zᵢ)/Π(s − pᵢ), rad/s'}
						maxHeight="14rem"
					/>
					{#if form !== 'zpk'}<button
							class="btn small"
							type="button"
							onclick={() => switchForm('zpk')}>Edit as poles / zeros</button
						>{/if}
				{:else if reprTab === 'sos'}
					<div class="table-wrap">
						<table class="coef">
							<thead
								><tr
									><th>#</th><th>b0</th><th>b1</th><th>b2</th><th>a0</th><th>a1</th><th>a2</th></tr
								></thead
							>
							<tbody>
								{#each model.sos as row, i (i)}
									<tr
										><td>{i + 1}</td>{#each row as v, j (j)}<td class="mono">{num(v, 10)}</td
											>{/each}</tr
									>
								{/each}
							</tbody>
						</table>
					</div>
					<p class="small muted">
						{#if model.domain === 'digital'}Pairing as in scipy.signal.zpk2sos: each pole pair gets
							the nearest zeros, the poles closest to the unit circle go last, and the overall gain
							sits in the first section.{:else}Stages ordered by increasing Q (as for an
							active-filter cascade); the overall gain sits in the first section.{/if}
					</p>
					{#if form !== 'sos'}<button
							class="btn small"
							type="button"
							onclick={() => switchForm('sos')}>Edit as SOS</button
						>{/if}
				{:else if pfe === null}
					<p class="muted">The expansion could not be computed for this filter.</p>
				{:else if pfe.fir}
					<p>
						An FIR filter has no poles away from the origin, so its expansion consists of direct
						terms only — the taps themselves: <span class="mono"
							>{model.fir?.map((v) => num(v, 6)).join(', ')}</span
						>.
					</p>
				{:else}
					{@const r = pfe.r}
					{#if model.domain === 'digital'}
						<Tex
							display
							math={'H(z) = \\sum_i \\frac{r_i}{1 - p_i z^{-1}} + \\sum_j k_j z^{-j} \\quad\\Rightarrow\\quad h[n] = \\sum_i r_i\\, p_i^{\\,n} + k_n'}
						/>
					{:else}
						<Tex
							display
							math={'H(s) = \\sum_i \\frac{r_i}{s - p_i} + k(s) \\quad\\Rightarrow\\quad h(t) = \\sum_i r_i\\, e^{p_i t}\\ \\ (t \\ge 0)'}
						/>
					{/if}
					{#if r.repeated}
						<Callout kind="warning" title="Repeated poles">
							Two poles coincide (relative distance {trimNumber(r.minSeparation, 2)}). The
							simple-pole expansion does not apply: repeated poles need terms like
							<Tex
								math={model.domain === 'digital'
									? '\\frac{r}{(1-pz^{-1})^2}'
									: '\\frac{r}{(s-p)^2}'}
							/>, which this table does not show.
						</Callout>
					{:else}
						<div class="table-wrap">
							<table>
								<thead><tr><th>i</th><th>Pole pᵢ</th><th>Residue rᵢ</th></tr></thead>
								<tbody>
									{#each r.poles as p, i (i)}
										<tr
											><td>{i + 1}</td><td class="mono small">{fmtC(p, 8)}</td><td
												class="mono small">{fmtC(r.residues[i], 8)}</td
											></tr
										>
									{/each}
								</tbody>
							</table>
						</div>
						<p class="small">
							Direct terms {model.domain === 'digital' ? 'k₀, k₁, …' : 'k(s)'}:
							<span class="mono"
								>{r.direct.length ? r.direct.map((v) => num(v, 8)).join(', ') : 'none'}</span
							>.
							<span class="muted"
								>Check: {model.domain === 'digital'
									? 'the impulse response rebuilt from the expansion'
									: 'H(jω) rebuilt from the expansion'} matches the filter to {trimNumber(
									pfe.err,
									2
								)} (relative).</span
							>
						</p>
					{/if}
				{/if}
			</div>
		</Card>

		<Card title="Export">
			<ExportPanel
				kind={model.domain}
				sos={model.domain === 'digital' ? model.sos : undefined}
				tf={exportTf}
				zpk={model.zpk}
				fir={model.fir ?? undefined}
				{fs}
				name="filter"
			/>
		</Card>
	{/if}

	{#snippet theory()}
		<h2>One filter, four descriptions</h2>
		<p>
			A linear time-invariant filter of finite order can be written down in several equivalent ways.
			They describe exactly the same system, but each makes different properties visible — and they
			behave very differently once numbers are rounded.
		</p>
		<h3>Transfer function (b / a)</h3>
		<Tex
			display
			math={'H(z)=\\frac{B(z)}{A(z)}=\\frac{b_0+b_1z^{-1}+\\dots+b_Mz^{-M}}{a_0+a_1z^{-1}+\\dots+a_Nz^{-N}}\\quad\\Longleftrightarrow\\quad a_0\\,y[n]=\\sum_{k=0}^{M} b_k\\,x[n-k]-\\sum_{k=1}^{N} a_k\\,y[n-k]'}
		/>
		<p>
			The coefficients are literally the difference equation, so this is what textbooks print and
			what <code>lfilter</code> runs. For analog filters the polynomials are in <Tex math="s" />,
			written in descending powers.
		</p>
		<h3>Poles, zeros and gain (ZPK)</h3>
		<Tex display math={'H(z)=k\\,\\frac{\\prod_i (z-z_i)}{\\prod_i (z-p_i)}'} />
		<p>
			Factoring the polynomials exposes the behaviour directly: a pole near the unit circle at angle
			θ makes a resonance at <Tex math={'f = \\theta f_s / 2\\pi'} />, a zero on the circle makes a
			notch. Analog poles are read the same way in the s-plane, with <Tex math={'\\omega_0=|p|'} /> and
			<Tex math={'Q=|p|/(2|\\operatorname{Re}p|)'} />.
		</p>
		<h3>Second-order sections (SOS)</h3>
		<Tex
			display
			math={'H(z)=\\prod_{i=1}^{L}\\frac{b_{0i}+b_{1i}z^{-1}+b_{2i}z^{-2}}{1+a_{1i}z^{-1}+a_{2i}z^{-2}}'}
		/>
		<p>
			Each conjugate pole pair is grouped with a nearby zero pair into a biquad, and the biquads are
			cascaded. This is how IIR filters of order above two should be stored and implemented.
		</p>
		<h3>Partial fractions</h3>
		<p>
			With distinct poles, <Tex math={'H(z)=\\sum_i r_i/(1-p_iz^{-1})+\\sum_j k_jz^{-j}'} />, so the
			impulse response is a sum of geometric sequences <Tex math={'h[n]=\\sum_i r_i p_i^{\\,n}'} /> (plus
			the FIR part <Tex math="k_n" />). This form gives the parallel realisation and shows how
			strongly each mode is excited. The residue is <Tex
				math={'r_i = \\big[(1-p_iz^{-1})H(z)\\big]_{z=p_i}'}
			/>.
		</p>

		<h2>Why high-order b / a breaks</h2>
		<p>
			The roots of a polynomial can be extremely sensitive to its coefficients. For a simple pole <Tex
				math="p_i"
			/> of <Tex math={'A(z)=\\prod_j(1-p_jz^{-1})'} />, a change in coefficient <Tex math="a_k" /> moves
			it by
		</p>
		<Tex
			display
			math={'\\frac{\\partial p_i}{\\partial a_k} = -\\frac{p_i^{\\,N-k}}{\\prod_{j\\ne i}(p_i-p_j)}'}
		/>
		<p>
			The denominator is the product of distances to all the other poles. A narrow-band filter
			(cutoff far below fs/2) has all its poles clustered near z = 1, so these distances are tiny
			and the sensitivity is enormous — often large enough that printing the coefficients with 7
			digits makes the filter unstable. In a second-order section each pole only “sees” its own
			conjugate, so the sensitivity stays small. That is why design tools return SOS and why you
			should never convert an SOS design of order ≳ 6 to b/a for implementation. (The same reasoning
			applies to multiplying out analog polynomials.)
		</p>

		<h2>Reading the properties</h2>
		<ul>
			<li>
				<strong>Stability.</strong> Digital: all poles strictly inside the unit circle, <Tex
					math={'|p_i|<1'}
				/>. Analog: all poles in the left half-plane, <Tex math={'\\operatorname{Re}p_i<0'} />. A
				simple pole on the boundary gives a sustained oscillation (marginal); a repeated one grows
				without bound. Each pole contributes a mode that decays by 60 dB in <Tex
					math={'T_{60} = -3\\ln 10/(f_s\\ln|p|)'}
				/>.
			</li>
			<li>
				<strong>Minimum phase.</strong> All zeros inside the unit circle (left half-plane). Then the
				inverse filter 1/H is also causal and stable, and of all filters with the same |H| this one
				has the least group delay and its energy arrives earliest. Reflecting a zero to its
				reciprocal <Tex math={'1/z_i^*'} /> leaves |H| unchanged (up to a gain) but adds an all-pass phase:
				every filter is a minimum-phase filter times an all-pass.
			</li>
			<li>
				<strong>All-pass.</strong> |H| constant: every pole <Tex math="p" /> is paired with a zero at
				<Tex math={'1/p^*'} /> (digital) or <Tex math={'-p^*'} /> (analog); for real coefficients the
				numerator is the reversed denominator.
			</li>
			<li>
				<strong>Linear phase.</strong> Only FIR filters can have exactly linear phase; they need
				symmetric (<Tex math={'h[n]=h[N-1-n]'} />, types I/II) or antisymmetric (types III/IV) taps.
				Types II and III must have a zero at z = −1; types III and IV a zero at z = 1.
			</li>
		</ul>
		<Callout kind="try">
			<ul>
				<li>
					Load <em>6th-order elliptic as b/a, 7 digits</em>: the poles leave the unit circle. Then
					load the same filter as SOS — also 7 digits, and nothing is wrong. Compare the sensitivity
					tables.
				</li>
				<li>
					In the <em>unstable resonator</em>, change <span class="mono">-0.81</span> to
					<span class="mono">0.81</span> and watch the pole move back inside the circle.
				</li>
				<li>
					In the <em>notch</em>, change the pole radius from 0.98 to 0.995: the −3 dB points close
					in and the T₆₀ of the poles grows.
				</li>
				<li>
					Load the <em>linear-phase but not minimum-phase FIR</em>, switch to Z / P / k, replace the
					zero at 2 by 0.5 and double k: the magnitude is unchanged, the filter becomes minimum
					phase and loses its linear phase.
				</li>
				<li>
					Switch to <em>Analog</em>, choose b / a and enter b = <span class="mono">1</span>, a =
					<span class="mono">1, 2, 2, 1</span> — a third-order Butterworth with cutoff 1 rad/s.
				</li>
			</ul>
		</Callout>
	{/snippet}
</ToolLayout>

<style>
	.desc {
		margin: -0.1rem 0 0;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.field label {
		font-size: 0.82rem;
		color: var(--text-2);
		font-weight: 550;
	}
	textarea,
	input[type='text'] {
		width: 100%;
		font-family: var(--font-mono);
		font-size: 0.8rem;
		line-height: 1.45;
		padding: 0.35rem 0.5rem;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		resize: vertical;
	}
	textarea.bad,
	input.bad {
		border-color: var(--critical);
	}
	.err {
		margin: 0;
		font-size: 0.8rem;
		color: var(--critical-ink);
	}
	.hint {
		margin: 0;
	}
	.table-wrap {
		overflow-x: auto;
	}
	.repr {
		margin-top: 0.7rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		align-items: flex-start;
	}
	.repr > :global(*) {
		max-width: 100%;
		align-self: stretch;
	}
	.repr > button {
		align-self: flex-start;
	}
	.coef td {
		font-size: 0.8rem;
		white-space: nowrap;
	}
	.flag {
		display: block;
		font-size: 0.75rem;
		color: var(--critical-ink);
		white-space: nowrap;
	}
	.ok {
		color: var(--good-ink);
	}
	.nowrap {
		white-space: nowrap;
	}
	.bad-ink {
		color: var(--critical-ink);
	}
</style>
