import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

// In development the app talks to PocketBase through this proxy, so the
// frontend always uses its own origin, exactly like in production.
const pocketbase = process.env.PB_URL ?? 'http://127.0.0.1:8090';

export default defineConfig({
  plugins: [
    sveltekit({
      preprocess: vitePreprocess(),
      // Single-page app: PocketBase serves build/ as pb_public and falls back
      // to index.html for client-side routes.
      adapter: adapter({ pages: 'build', assets: 'build', fallback: 'index.html' }),
      serviceWorker: { register: true },
      // Content-Security-Policy, emitted as a <meta> tag with hashes for
      // SvelteKit's inline bootstrap script. Limits the damage of any XSS bug:
      // no foreign scripts, and data can only be sent to our own origin.
      // (frame-ancestors can't be set via <meta>; nginx sends it as a header.)
      csp: {
        mode: 'hash',
        directives: {
          'default-src': ['self'],
          'script-src': ['self'],
          'style-src': ['self', 'unsafe-inline'],
          'img-src': ['self', 'data:', 'blob:'],
          'font-src': ['self'],
          'connect-src': ['self'],
          'manifest-src': ['self'],
          'worker-src': ['self'],
          'object-src': ['none'],
          'base-uri': ['self'],
          'form-action': ['self']
        }
      }
    })
  ],
  server: {
    host: true,
    proxy: {
      '/api': { target: pocketbase, changeOrigin: true },
      '/_': { target: pocketbase, changeOrigin: true }
    }
  }
});
