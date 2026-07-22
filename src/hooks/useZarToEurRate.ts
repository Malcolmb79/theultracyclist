import { useEffect, useState } from "react";

// Frankfurter (frankfurter.dev) is a free, no-API-key exchange rate service
// backed by the European Central Bank's daily reference rates — that's the
// standard meaning of "real-time" for consumer currency conversion (updated
// once per banking day, not a live tick).
const RATE_ENDPOINT = "https://api.frankfurter.dev/v1/latest?base=ZAR&symbols=EUR";

let cachedRate: number | null = null;
let inFlight: Promise<number | null> | null = null;

function fetchRate(): Promise<number | null> {
  if (cachedRate !== null) return Promise.resolve(cachedRate);
  if (inFlight) return inFlight;

  inFlight = fetch(RATE_ENDPOINT)
    .then((res) => (res.ok ? res.json() : null))
    .then((data: { rates?: { EUR?: number } } | null) => {
      const rate = data?.rates?.EUR ?? null;
      cachedRate = rate;
      return rate;
    })
    .catch(() => null);

  return inFlight;
}

export function useZarToEurRate(): { rate: number | null; loading: boolean } {
  const [rate, setRate] = useState<number | null>(cachedRate);
  const [loading, setLoading] = useState(cachedRate === null);

  useEffect(() => {
    if (cachedRate !== null) {
      setRate(cachedRate);
      setLoading(false);
      return;
    }
    let cancelled = false;
    fetchRate().then((r) => {
      if (!cancelled) {
        setRate(r);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { rate, loading };
}
