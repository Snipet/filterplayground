import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// Set BASE_PATH (e.g. "/filterplayground") when deploying to a sub-path such as GitHub Pages.
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
