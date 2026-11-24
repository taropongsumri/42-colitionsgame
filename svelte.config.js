import adapter from 'svelte-adapter-bun';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		// Pin a stable version name so SSR and client builds share one hydration hash.
		// The default is Date.now(), which differs between `svelte-kit sync` and `vite build`.
		version: { name: 'coalition-backrooms' }
	}
};

export default config;
