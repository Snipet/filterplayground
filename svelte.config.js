import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// Set BASE_PATH (e.g. "/filterplayground") only when the site is served from a sub-path.
const base = process.env.BASE_PATH ?? '';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	compilerOptions: {
		runes: true
	},
	kit: {
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: '404.html',
			precompress: false,
			strict: true
		}),
		paths: {
			base,
			relative: true
		},
		prerender: {
			handleHttpError: 'fail',
			handleMissingId: 'warn'
		}
	}
};

export default config;
