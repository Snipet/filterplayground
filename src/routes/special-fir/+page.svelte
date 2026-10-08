<script lang="ts">
	import ToolLayout from '$lib/components/layout/ToolLayout.svelte';
	import ControlGroup from '$lib/components/layout/ControlGroup.svelte';
	import Select from '$lib/components/controls/Select.svelte';
	import Segmented from '$lib/components/controls/Segmented.svelte';
	import Slider from '$lib/components/controls/Slider.svelte';
	import NumberInput from '$lib/components/controls/NumberInput.svelte';
	import Toggle from '$lib/components/controls/Toggle.svelte';
	import type { WindowSpec } from '$lib/dsp/fir';
	import { formatSI } from '$lib/dsp/units';
	import { SPECIAL_TYPES, type SpecialType } from '$lib/features/special-fir/special';
	import WindowPicker from '$lib/features/special-fir/WindowPicker.svelte';
	import HilbertPanel from '$lib/features/special-fir/HilbertPanel.svelte';
	import DifferentiatorPanel from '$lib/features/special-fir/DifferentiatorPanel.svelte';
	import PulsePanel from '$lib/features/special-fir/PulsePanel.svelte';
	import SmoothPanel from '$lib/features/special-fir/SmoothPanel.svelte';
	import HalfbandPanel from '$lib/features/special-fir/HalfbandPanel.svelte';
	import CicPanel from '$lib/features/special-fir/CicPanel.svelte';
	import Theory from '$lib/features/special-fir/Theory.svelte';

	let type = $state<SpecialType>('hilbert');
	let fs = $state(48000);

	// per-type settings (kept when switching types)
	let hil = $state({ N: 31, win: { type: 'blackman' } as WindowSpec, edge: 1200, method: 'equiripple' as 'window' | 'equiripple', compensate: true, depth: 0.6 });
	let dif = $state({ L: 21, win: { type: 'hann' } as WindowSpec, sel: 'III' as 'III' | 'IV', f0: 1500, noise: 0 });
	let rc = $state({ sps: 8, beta: 0.35, span: 8, eye: 'rc' as 'rc' | 'rrc' });
	let gau = $state({ sps: 8, bt: 0.3, span: 4 });
	let sg = $state({ L: 21, order: 4, deriv: 0, noise: 0.05 });
	let ma = $state({ L: 9, noise: 0.05 });
	let hb = $state({ N: 31, win: { type: 'kaiser', param: 6 } as WindowSpec, fp: 0.2 });
	let cic = $state({ R: 8, M: 1, N: 4, bw: 0.25, bits: 16 });

	const info = $derived(SPECIAL_TYPES.find((t) => t.id === type)!);
	const typeOptions = SPECIAL_TYPES.map((t) => ({ value: t.id, label: t.name }));
	const fsOptions = [8000, 16000, 44100, 48000, 96000, 1e6].map((v) => ({ value: v, label: formatSI(v, 'Hz', 4) }));
</script>

<ToolLayout slug="special-fir" related={['fir-designer', 'linear-phase', 'windows', 'simple-filters', 'aliasing']}>
	{#snippet controls()}
		<ControlGroup title="Filter">
			<Select label="Type" bind:value={type} options={typeOptions} />
			<p class="small muted desc">{info.summary}</p>
			<NumberInput label="Sample rate fs" bind:value={fs} unit="Hz" si min={1} logStep={1.25} />
		</ControlGroup>

		{#if type === 'hilbert'}
			<ControlGroup title="Design">
				<Segmented
					label="Method"
					bind:value={hil.method}
					options={[
						{ value: 'window', label: 'Window' },
						{ value: 'equiripple', label: 'Equiripple' }
					]}
				/>
				<Slider label="Taps N (odd)" bind:value={hil.N} min={7} max={255} step={2} integer onchange={(v) => (hil.N = v % 2 ? v : v + 1)} />
				<WindowPicker bind:value={hil.win} label="Window (window method)" />
				<Slider label="Band edge (equiripple)" bind:value={hil.edge} min={fs / 1000} max={fs / 4.2} log si unit="Hz" />
			</ControlGroup>
			<ControlGroup title="Demo">
				<Slider label="Modulation depth m" bind:value={hil.depth} min={0} max={1} step={0.05} />
				<Toggle label="Delay the real path by (N−1)/2" bind:checked={hil.compensate} />
			</ControlGroup>
		{:else if type === 'differentiator'}
			<ControlGroup title="Design">
				<Slider label="Length (type III, odd)" bind:value={dif.L} min={3} max={101} step={2} integer onchange={(v) => (dif.L = v % 2 ? v : v + 1)} help="Type IV uses one more tap." />
				<WindowPicker bind:value={dif.win} />
			</ControlGroup>
			<ControlGroup title="Demo">
				<Segmented
					label="Filter used"
					bind:value={dif.sel}
					options={[
						{ value: 'III', label: 'Type III (odd)' },
						{ value: 'IV', label: 'Type IV (even)' }
					]}
				/>
				<Slider label="Sine frequency" bind:value={dif.f0} min={fs / 1000} max={fs / 2.2} log si unit="Hz" />
				<Slider label="Noise σ" bind:value={dif.noise} min={0} max={0.2} step={0.005} />
			</ControlGroup>
		{:else if type === 'rc'}
			<ControlGroup title="Pulse">
				<Slider label="Samples per symbol" bind:value={rc.sps} min={2} max={16} integer />
				<Slider label="Roll-off β" bind:value={rc.beta} min={0} max={1} step={0.01} />
				<Slider label="Span (symbols)" bind:value={rc.span} min={2} max={24} step={2} integer />
			</ControlGroup>
			<ControlGroup title="Eye diagram">
				<Segmented
					bind:value={rc.eye}
					options={[
						{ value: 'rc', label: 'RC' },
						{ value: 'rrc', label: 'RRC → RRC' }
					]}
				/>
			</ControlGroup>
		{:else if type === 'gaussian'}
			<ControlGroup title="Pulse">
				<Slider label="Bandwidth–time BT" bind:value={gau.bt} min={0.1} max={1} step={0.01} help="GSM: 0.3 · Bluetooth: 0.5" />
				<Slider label="Samples per symbol" bind:value={gau.sps} min={2} max={16} integer />
				<Slider label="Span (symbols)" bind:value={gau.span} min={2} max={12} step={2} integer />
			</ControlGroup>
		{:else if type === 'savgol'}
			<ControlGroup title="Fit">
				<Slider label="Window length (odd)" bind:value={sg.L} min={3} max={101} step={2} integer onchange={(v) => (sg.L = v % 2 ? v : v + 1)} />
				<Slider label="Polynomial order" bind:value={sg.order} min={0} max={Math.min(10, sg.L - 1)} integer />
				<Segmented
					label="Output"
					bind:value={sg.deriv}
					options={[
						{ value: 0, label: 'Smoothed' },
						{ value: 1, label: '1st derivative', disabled: sg.order < 1 },
						{ value: 2, label: '2nd derivative', disabled: sg.order < 2 }
					]}
				/>
			</ControlGroup>
			<ControlGroup title="Demo">
				<Slider label="Noise σ" bind:value={sg.noise} min={0} max={0.3} step={0.005} />
			</ControlGroup>
		{:else if type === 'halfband'}
			<ControlGroup title="Design">
				<Slider label="Taps N (odd)" bind:value={hb.N} min={7} max={255} step={2} integer onchange={(v) => (hb.N = v % 2 ? v : v + 1)} help="Best as 4K + 3: 7, 11, 15, …" />
				<WindowPicker bind:value={hb.win} />
				<Slider label="Passband edge (for the ripple stats)" bind:value={hb.fp} min={0.05} max={0.24} step={0.005} unit="·fs" />
			</ControlGroup>
		{:else if type === 'cic'}
			<ControlGroup title="Structure">
				<Slider label="Decimation R" bind:value={cic.R} min={2} max={64} integer />
				<Segmented
					label="Differential delay M"
					bind:value={cic.M}
					options={[
						{ value: 1, label: 'M = 1' },
						{ value: 2, label: 'M = 2' }
					]}
				/>
				<Slider label="Stages N" bind:value={cic.N} min={1} max={6} integer />
			</ControlGroup>
			<ControlGroup title="Application">
				<Slider label="Band of interest" bind:value={cic.bw} min={0.02} max={1} step={0.01} unit="·fs_out/2" />
				<Slider label="Input word length" bind:value={cic.bits} min={4} max={32} integer unit="bits" />
			</ControlGroup>
		{:else}
			<ControlGroup title="Filter">
				<Slider label="Length L" bind:value={ma.L} min={2} max={128} integer />
			</ControlGroup>
			<ControlGroup title="Demo">
				<Slider label="Noise σ" bind:value={ma.noise} min={0} max={0.3} step={0.005} />
			</ControlGroup>
		{/if}
		{#if type === 'rc' || type === 'gaussian' || type === 'cic'}
			<Select label="Quick sample rate" value={fs} options={fsOptions} onchange={(v) => (fs = v)} />
		{/if}
	{/snippet}

	{#if type === 'hilbert'}
		<HilbertPanel {fs} N={hil.N} win={hil.win} edge={hil.edge} method={hil.method} compensate={hil.compensate} depth={hil.depth} />
	{:else if type === 'differentiator'}
		<DifferentiatorPanel {fs} L={dif.L} win={dif.win} sel={dif.sel} f0={dif.f0} noise={dif.noise} />
	{:else if type === 'rc'}
		<PulsePanel kind="rc" {fs} sps={rc.sps} span={rc.span} beta={rc.beta} bt={0.3} eyeMode={rc.eye} />
	{:else if type === 'gaussian'}
		<PulsePanel kind="gaussian" {fs} sps={gau.sps} span={gau.span} beta={0} bt={gau.bt} eyeMode="rc" />
	{:else if type === 'savgol'}
		<SmoothPanel kind="savgol" {fs} L={sg.L} order={Math.min(sg.order, sg.L - 1)} deriv={sg.deriv} noise={sg.noise} />
	{:else if type === 'halfband'}
		<HalfbandPanel {fs} N={hb.N} win={hb.win} fp={hb.fp} />
	{:else if type === 'cic'}
		<CicPanel {fs} R={cic.R} M={cic.M} N={cic.N} bw={cic.bw} inBits={cic.bits} />
	{:else}
		<SmoothPanel kind="movavg" {fs} L={ma.L} order={0} deriv={0} noise={ma.noise} />
	{/if}

	{#snippet theory()}
		<Theory {type} />
	{/snippet}
</ToolLayout>

<style>
	.desc {
		margin: -0.2rem 0 0;
	}
</style>
