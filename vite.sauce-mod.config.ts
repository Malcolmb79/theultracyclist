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
      // The console and each overlay are separate Sauce windows.
      input: {
        index: fileURLToPath(new URL('./sauce-mod/index.html', import.meta.url)),
        tactics: fileURLToPath(new URL('./sauce-mod/tactics.html', import.meta.url)),
        board: fileURLToPath(new URL('./sauce-mod/board.html', import.meta.url)),
        map: fileURLToPath(new URL('./sauce-mod/map.html', import.meta.url)),
        power: fileURLToPath(new URL('./sauce-mod/power.html', import.meta.url)),
        stats: fileURLToPath(new URL('./sauce-mod/stats.html', import.meta.url)),
        profile: fileURLToPath(new URL('./sauce-mod/profile.html', import.meta.url)),
        groups: fileURLToPath(new URL('./sauce-mod/groups.html', import.meta.url)),
        chat: fileURLToPath(new URL('./sauce-mod/chat.html', import.meta.url)),
        climbView: fileURLToPath(new URL('./sauce-mod/climbView.html', import.meta.url)),
        draft: fileURLToPath(new URL('./sauce-mod/draft.html', import.meta.url)),
      },
    },
  },
})
