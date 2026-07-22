const zarFormatter = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  maximumFractionDigits: 0,
});

const eurFormatter = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

export function formatZAR(amount: number): string {
  return zarFormatter.format(amount);
}

export function formatEUR(amount: number): string {
  return eurFormatter.format(amount);
}
