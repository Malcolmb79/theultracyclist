import { defineConfig } from 'vite'
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
  },
})
