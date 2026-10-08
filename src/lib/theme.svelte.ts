/** Theme state: 'system' follows the OS; the toggle stamps data-theme on <html>. */
export type ThemeMode = 'system' | 'light' | 'dark';

class ThemeState {
	mode = $state<ThemeMode>('system');
	systemDark = $state(false);
	resolved = $derived<'light' | 'dark'>(
		this.mode === 'system' ? (this.systemDark ? 'dark' : 'light') : this.mode
	);

	init() {
		if (typeof window === 'undefined') return;
		try {
			const saved = localStorage.getItem('fp-theme');
			if (saved === 'light' || saved === 'dark') this.mode = saved;
		} catch {
			/* storage unavailable */
		}
		const mq = window.matchMedia('(prefers-color-scheme: dark)');
		this.systemDark = mq.matches;
		mq.addEventListener('change', (e) => (this.systemDark = e.matches));
	}

	set(mode: ThemeMode) {
		this.mode = mode;
		const root = document.documentElement;
		if (mode === 'system') delete root.dataset.theme;
		else root.dataset.theme = mode;
		try {
			if (mode === 'system') localStorage.removeItem('fp-theme');
			else localStorage.setItem('fp-theme', mode);
		} catch {
			/* storage unavailable */
		}
	}

	cycle() {
		const next: ThemeMode = this.resolved === 'dark' ? 'light' : 'dark';
		this.set(next);
	}
}

export const theme = new ThemeState();

/** Read a CSS custom property as an [r, g, b] triple. */
export function cssColorRgb(
	name: string,
	el: Element = document.documentElement
): [number, number, number] {
	const v = getComputedStyle(el).getPropertyValue(name).trim();
	const m = v.match(/^#([0-9a-f]{6})$/i);
	if (m) {
		const n = parseInt(m[1], 16);
		return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
	}
	const r = v.match(/rgba?\(([^)]+)\)/);
	if (r) {
		const [a, b, c] = r[1].split(',').map((s) => parseFloat(s));
		return [a, b, c];
	}
	return [128, 128, 128];
}
