// Packages the Race console as a Sauce for Zwift mod and puts the zip in the
// site's build output, so every deploy serves an up-to-date copy at
// /downloads/ultracyclist-race-sauce-mod.zip (see src/components/race/sauceMod.ts).
//
// The zip holds one folder, ultracyclist-race/, with Sauce's manifest.json
// and the built page under web/. Extracted into Documents\SauceMods, Sauce
// lists it as a mod on its next start and serves the page at
// http://localhost:1080/mods/ultracyclist-race/web/index.html.
//
// Runs after the main `vite build`, which empties dist/.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { zipSync } from "fflate";

const MOD_ID = "ultracyclist-race";
const BUILD_DIR = "dist-sauce-mod";
const OUT = join("dist", "downloads", `${MOD_ID}-sauce-mod.zip`);

execFileSync("npx", ["vite", "build", "--config", "vite.sauce-mod.config.ts"], { stdio: "inherit" });
writeFileSync(join(BUILD_DIR, "manifest.json"), readFileSync(join("sauce-mod", "manifest.json")));

const files = {};
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else files[`${MOD_ID}/${relative(BUILD_DIR, path).split("\\").join("/")}`] = readFileSync(path);
  }
};
walk(BUILD_DIR);

mkdirSync(join("dist", "downloads"), { recursive: true });
writeFileSync(OUT, zipSync(files, { level: 9 }));
console.log(`Sauce mod: ${OUT} (${Object.keys(files).length} files)`);
