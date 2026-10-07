<script lang="ts" generics="T extends string | number">
	interface Option {
		value: T;
		label: string;
		disabled?: boolean;
		group?: string;
	}
	interface Props {
		value: T;
		options: Option[];
		label?: string;
		disabled?: boolean;
		help?: string;
		onchange?: (v: T) => void;
	}
	let { value = $bindable(), options, label, disabled = false, help, onchange }: Props = $props();
	const id = `sel-${Math.random().toString(36).slice(2, 9)}`;
	const groups = $derived.by(() => {
		const out: { name: string | undefined; items: Option[] }[] = [];
		for (const o of options) {
			const g = out.find((x) => x.name === o.group);
			if (g) g.items.push(o);
			else out.push({ name: o.group, items: [o] });
		}
		return out;
	});
	function onChange(e: Event) {
		const raw = (e.target as HTMLSelectElement).value;
		const opt = options.find((o) => String(o.value) === raw);
		if (opt) {
			value = opt.value;
			onchange?.(opt.value);
		}
	}
</script>

<div class="select">
	{#if label}<label for={id}>{label}</label>{/if}
	<select {id} value={String(value)} {disabled} onchange={onChange}>
		{#each groups as g, gi (gi)}
			{#if g.name}
				<optgroup label={g.name}>
					{#each g.items as o (o.value)}
						<option value={String(o.value)} disabled={o.disabled}>{o.label}</option>
					{/each}
				</optgroup>
			{:else}
				{#each g.items as o (o.value)}
					<option value={String(o.value)} disabled={o.disabled}>{o.label}</option>
				{/each}
			{/if}
		{/each}
	</select>
	{#if help}<div class="help">{help}</div>{/if}
</div>

<style>
	.select {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		min-width: 0;
	}
	label {
		font-size: 0.82rem;
		color: var(--text-2);
		font-weight: 500;
	}
	select {
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		padding: 0.32rem 0.45rem;
		min-width: 0;
		width: 100%;
	}
	select:focus {
		outline: none;
		border-color: var(--focus);
		box-shadow: 0 0 0 3px var(--accent-wash);
	}
	.help {
		font-size: 0.76rem;
		color: var(--muted);
	}
</style>
