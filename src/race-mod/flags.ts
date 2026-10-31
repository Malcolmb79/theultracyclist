import { useEffect, useState } from "react";

interface Country {
  id: number;
  alpha2: string;
  en: string;
}

/**
 * Sauce's own country list and flag images, served by its web server. The
 * UK's home nations use Zwift-only codes, which Sauce maps to the Union Jack.
 */
export function useFlags(sauceAddress: string) {
  const [flags, setFlags] = useState<Map<number, { src: string; name: string }>>(new Map());
  useEffect(() => {
    let cancelled = false;
    fetch(`http://${sauceAddress}/shared/deps/data/countries.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Country[]>) : []))
      .then((list) => {
        if (cancelled) return;
        const m = new Map(
          list.map((c) => [c.id, { src: `http://${sauceAddress}/pages/deps/flags/${c.alpha2}.png`, name: c.en }]),
        );
        const uk = m.get(826);
        if (uk) for (const id of [900, 901, 902, 903]) m.set(id, uk);
        setFlags(m);
      })
      .catch(() => {
        // No flags - the board works without them.
      });
    return () => {
      cancelled = true;
    };
  }, [sauceAddress]);
  return flags;
}
