import { base } from '$app/paths';

/** Prefix an absolute site path with the configured base path. */
export const href = (path: string): string => `${base}${path.startsWith('/') ? path : `/${path}`}`;

export const toolHref = (slug: string): string => href(`/${slug}/`);
