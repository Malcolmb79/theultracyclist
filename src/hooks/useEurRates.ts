import { useEffect, useState } from "react";

// Frankfurter (frankfurter.dev) is a free, no-API-key exchange rate service
// backed by the European Central Bank's daily reference rates — that's the
// standard meaning of "real-time" for consumer currency conversion (updated
// once per banking day, not a live tick). Donations arrive in whatever
// currency the donor used (ZAR, USD, ...), so we fetch both rates at once,
// based on EUR, and divide to convert any of them.
const RATES_ENDPOINT = "https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD,ZAR";

export type SupportedCurrency = "ZAR" | "USD" | "EUR";

interface RatesMap {
  USD: number;
  ZAR: number;
}

let cachedRates: RatesMap | null = null;
let inFlight: Promise<RatesMap | null> | null = null;

function fetchRates(): Promise<RatesMap | null> {
  if (cachedRates) return Promise.resolve(cachedRates);
  if (inFlight) return inFlight;

  inFlight = fetch(RATES_ENDPOINT)
    .then((res) => (res.ok ? res.json() : null))
    .then((data: { rates?: { USD?: number; ZAR?: number } } | null) => {
      if (!data?.rates?.USD || !data?.rates?.ZAR) return null;
      const rates = { USD: data.rates.USD, ZAR: data.rates.ZAR };
      cachedRates = rates;
      return rates;
    })
    .catch(() => null);

  return inFlight;
}

export function useEurRates(): { rates: RatesMap | null; loading: boolean } {
  const [rates, setRates] = useState<RatesMap | null>(cachedRates);
  const [loading, setLoading] = useState(cachedRates === null);

  useEffect(() => {
    if (cachedRates) {
      setRates(cachedRates);
      setLoading(false);
      return;
    }
    let cancelled = false;
    fetchRates().then((r) => {
      if (!cancelled) {
        setRates(r);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { rates, loading };
}

export function convertToEur(
  amount: number,
  currency: SupportedCurrency,
  rates: RatesMap | null,
): number | null {
  if (currency === "EUR") return amount;
  if (!rates) return null;
  return amount / rates[currency];
}
