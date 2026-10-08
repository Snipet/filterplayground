/**
 * Shareable page state: a design is encoded as base64url JSON in the `s` query
 * parameter. Pages read it once on mount and offer a "Copy link" button.
 */

function toBase64Url(s: string): string {
	const bytes = new TextEncoder().encode(s);
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
	const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
	const bin = atob(b64);
	const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}

export function encodeState(state: unknown): string {
	return toBase64Url(JSON.stringify(state));
}

export function decodeState<T = Record<string, unknown>>(s: string): T | null {
	try {
		const v = JSON.parse(fromBase64Url(s));
		return v && typeof v === 'object' ? (v as T) : null;
	} catch {
		return null;
	}
}

/** Read the shared state from the current URL (client only). */
export function readSharedState<T = Record<string, unknown>>(): Partial<T> | null {
	if (typeof window === 'undefined') return null;
	const s = new URL(window.location.href).searchParams.get('s');
	return s ? decodeState<Partial<T>>(s) : null;
}

/** Absolute URL of the current page carrying `state`. */
export function shareUrl(state: unknown): string {
	const url = new URL(window.location.href);
	url.search = '';
	url.hash = '';
	url.searchParams.set('s', encodeState(state));
	return url.toString();
}

/** Assign known keys from `src` onto `target` when the types match. */
export function applyState<T extends Record<string, unknown>>(
	target: T,
	src: Partial<T> | null
): void {
	if (!src) return;
	for (const k of Object.keys(target) as (keyof T)[]) {
		const v = src[k];
		if (v === undefined) continue;
		const cur = target[k];
		if (typeof v === typeof cur || (Array.isArray(cur) && Array.isArray(v)))
			target[k] = v as T[keyof T];
	}
}
