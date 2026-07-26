const RAD = Math.PI / 180;

function toJulianDate(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

// Standard "sunrise equation" (see https://en.wikipedia.org/wiki/Sunrise_equation) -
// accurate to within a couple of minutes, which is all a light/dark toggle
// needs (this isn't an astronomy tool). Returns null above the polar
// circle on a day with no sunrise/sunset (permanent day or night) - callers
// treat that as "always light" rather than crashing.
export function computeSunTimes(date: Date, latDeg: number, lonDeg: number): { sunrise: Date; sunset: Date } | null {
  const J = toJulianDate(date);
  const n = Math.floor(J - 2451545.0 + 0.0009);
  const Jstar = n - lonDeg / 360;

  const M = (357.5291 + 0.98560028 * Jstar) % 360;
  const Mrad = M * RAD;
  const C = 1.9148 * Math.sin(Mrad) + 0.02 * Math.sin(2 * Mrad) + 0.0003 * Math.sin(3 * Mrad);
  const lambda = (M + 102.9372 + C + 180) % 360;
  const lambdaRad = lambda * RAD;

  const Jtransit = 2451545.0 + Jstar + 0.0053 * Math.sin(Mrad) - 0.0069 * Math.sin(2 * lambdaRad);
  const delta = Math.asin(Math.sin(lambdaRad) * Math.sin(23.44 * RAD));
  const latRad = latDeg * RAD;

  const cosOmega =
    (Math.sin(-0.83 * RAD) - Math.sin(latRad) * Math.sin(delta)) / (Math.cos(latRad) * Math.cos(delta));
  if (cosOmega > 1 || cosOmega < -1) return null;

  const omega0 = Math.acos(cosOmega) / RAD;
  const Jrise = Jtransit - omega0 / 360;
  const Jset = Jtransit + omega0 / 360;

  return {
    sunrise: new Date((Jrise - 2440587.5) * 86400000),
    sunset: new Date((Jset - 2440587.5) * 86400000),
  };
}

export function isDaytime(now: Date, latDeg: number, lonDeg: number): boolean {
  const times = computeSunTimes(now, latDeg, lonDeg);
  if (!times) return true;
  return now >= times.sunrise && now < times.sunset;
}
