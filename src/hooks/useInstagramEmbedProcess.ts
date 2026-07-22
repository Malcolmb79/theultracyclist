import { useEffect } from "react";

const SCRIPT_SRC = "https://www.instagram.com/embed.js";

function loadInstagramScript(onLoad: () => void) {
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
  if (existing) {
    if (window.instgrm) {
      onLoad();
    } else {
      existing.addEventListener("load", onLoad, { once: true });
    }
    return;
  }
  const script = document.createElement("script");
  script.src = SCRIPT_SRC;
  script.async = true;
  script.addEventListener("load", onLoad, { once: true });
  document.body.appendChild(script);
}

// Instagram's embed.js only auto-scans the DOM once, on its own load.
// In an SPA, client-side navigation can mount new blockquote.instagram-media
// elements after the script already loaded, so we need to explicitly ask it
// to re-scan every time the set of posts we render changes.
export function useInstagramEmbedProcess(deps: unknown[]) {
  useEffect(() => {
    loadInstagramScript(() => {
      window.instgrm?.Embeds.process();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
