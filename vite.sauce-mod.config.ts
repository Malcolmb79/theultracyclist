import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'

// Builds the Race console as a Sauce for Zwift mod page (see
// scripts/build-sauce-mod.mjs, which wraps this output in the mod's
// manifest and zips it). Relative asset paths because Sauce serves the page
// from /mods/<id>/web/, not the root.
export default defineConfig({
  plugins: [react()],
  root: 'sauce-mod',
  base: './',
  publicDir: false,
  build: {
    outDir: '../dist-sauce-mod/web',
    emptyOutDir: true,
    rollupOptions: {
      // The console and the tactics overlay are separate Sauce windows.
      input: {
        index: fileURLToPath(new URL('./sauce-mod/index.html', import.meta.url)),
        tactics: fileURLToPath(new URL('./sauce-mod/tactics.html', import.meta.url)),
      },
    },
  },
})
