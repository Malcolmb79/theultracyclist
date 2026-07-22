import { useEffect, useState } from "react";

// Strips a near-white background from an image client-side via canvas, so a
// plain JPEG export (no alpha channel) can still float over the dark page.
// Runs once per src and caches the result for the session.
const cache = new Map<string, string>();
const inFlight = new Map<string, Promise<string>>();

const LOW_THRESHOLD = 222;
const HIGH_THRESHOLD = 246;

function removeWhiteBackground(src: string): Promise<string> {
  if (cache.has(src)) return Promise.resolve(cache.get(src)!);
  if (inFlight.has(src)) return inFlight.get(src)!;

  const promise = new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(src);
        return;
      }
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const min = Math.min(data[i], data[i + 1], data[i + 2]);
        if (min >= LOW_THRESHOLD) {
          const t = Math.min(1, (min - LOW_THRESHOLD) / (HIGH_THRESHOLD - LOW_THRESHOLD));
          data[i + 3] = Math.round(data[i + 3] * (1 - t));
        }
      }
      ctx.putImageData(imageData, 0, 0);
      const dataUrl = canvas.toDataURL("image/png");
      cache.set(src, dataUrl);
      resolve(dataUrl);
    };
    img.onerror = () => resolve(src);
    img.src = src;
  });

  inFlight.set(src, promise);
  return promise;
}

export function useTransparentImage(src: string): string {
  const [resolved, setResolved] = useState<string>(cache.get(src) ?? src);

  useEffect(() => {
    let cancelled = false;
    removeWhiteBackground(src).then((result) => {
      if (!cancelled) setResolved(result);
    });
    return () => {
      cancelled = true;
    };
  }, [src]);

  return resolved;
}
