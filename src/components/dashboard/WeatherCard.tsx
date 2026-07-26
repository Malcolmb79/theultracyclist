import { useEffect, useState } from "react";
import { useUnits } from "../../context/UnitsContext";
import WeatherIcon, { type WeatherKind } from "./WeatherIcon";
import styles from "./WeatherCard.module.css";

const WMO_LABEL: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Dense drizzle",
  56: "Freezing drizzle",
  57: "Freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Light showers",
  81: "Showers",
  82: "Violent showers",
  85: "Snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Thunderstorm with hail",
};

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

function weatherKind(code: number): WeatherKind {
  if (code <= 1) return "clear";
  if (code === 2) return "partlyCloudy";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (code >= 95) return "storm";
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return "snow";
  if (code >= 51) return "rain";
  return "cloudy";
}

function compassLabel(degrees: number): string {
  return COMPASS[Math.round(degrees / 22.5) % 16];
}

type DayForecast = { date: string; code: number; hi: number; lo: number };

type WeatherState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      temp: number;
      feelsLike: number;
      code: number;
      windSpeed: number;
      windDirection: number;
      humidity: number;
      hi: number;
      lo: number;
      days: DayForecast[];
      place: string | null;
    };

function dayLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: "short" });
}

// Current weather at the athlete's location - pure client-side (browser
// Geolocation for the coordinates, Open-Meteo's free keyless API for the
// forecast, BigDataCloud's free keyless reverse-geocode endpoint for the
// place name), no server route or account needed. Useful for judging
// today's ride against real conditions, which none of the Whoop/Strava/
// Health data otherwise captures.
export default function WeatherCard() {
  const { system } = useUnits();
  const [state, setState] = useState<WeatherState>({ status: "loading" });
  const [retryToken, setRetryToken] = useState(0);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setState({ status: "error", message: "Geolocation isn't available in this browser." });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const tempUnit = system === "imperial" ? "fahrenheit" : "celsius";
        const windUnit = system === "imperial" ? "mph" : "kmh";
        const weatherUrl =
          `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
          `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,relative_humidity_2m` +
          `&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=7&timezone=auto` +
          `&temperature_unit=${tempUnit}&wind_speed_unit=${windUnit}`;

        // Best-effort place name - failing this shouldn't block the rest of
        // the card from rendering, so it's fetched independently and simply
        // omitted (place: null) if it errors or is slow.
        const placeUrl = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`;

        Promise.all([
          fetch(weatherUrl).then((r) => (r.ok ? r.json() : Promise.reject(new Error("Weather request failed")))),
          fetch(placeUrl)
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
        ])
          .then(([weather, place]) => {
            if (cancelled) return;
            const c = weather.current;
            const d = weather.daily;
            const days: DayForecast[] = (d?.time ?? []).map((date: string, i: number) => ({
              date,
              code: d.weather_code[i],
              hi: Math.round(d.temperature_2m_max[i]),
              lo: Math.round(d.temperature_2m_min[i]),
            }));
            setState({
              status: "ready",
              temp: Math.round(c.temperature_2m),
              feelsLike: Math.round(c.apparent_temperature),
              code: c.weather_code,
              windSpeed: Math.round(c.wind_speed_10m),
              windDirection: c.wind_direction_10m,
              humidity: Math.round(c.relative_humidity_2m),
              hi: days[0]?.hi ?? Math.round(c.temperature_2m),
              lo: days[0]?.lo ?? Math.round(c.temperature_2m),
              days,
              place: place?.city || place?.locality || place?.principalSubdivision || null,
            });
          })
          .catch(() => {
            if (!cancelled) setState({ status: "error", message: "Couldn't load weather right now." });
          });
      },
      () => {
        if (!cancelled) setState({ status: "error", message: "Location access denied - enable it to see local weather." });
      },
      { maximumAge: 10 * 60 * 1000, timeout: 10000 },
    );

    return () => {
      cancelled = true;
    };
  }, [system, retryToken]);

  if (state.status === "loading") return <p className={styles.empty}>Getting your location…</p>;

  if (state.status === "error") {
    return (
      <div className={styles.errorWrap}>
        <p className={styles.empty}>{state.message}</p>
        <button type="button" className={styles.retryButton} onClick={() => setRetryToken((t) => t + 1)}>
          Retry
        </button>
      </div>
    );
  }

  const kind = weatherKind(state.code);
  const tempUnitLabel = system === "imperial" ? "°" : "°";
  const windUnitLabel = system === "imperial" ? "mph" : "km/h";
  const timeStr = now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  const dateStr = now.toLocaleDateString(undefined, { month: "short", day: "numeric", weekday: "short" });

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={styles.pin} aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <circle cx="12" cy="12" r="9" />
          </svg>
        </span>
        <span className={styles.place}>{state.place ?? "Current location"}</span>
      </div>

      <div className={styles.mainRow}>
        <div className={styles.iconCol}>
          <WeatherIcon kind={kind} size={72} />
          <span className={styles.condition}>{WMO_LABEL[state.code] ?? "—"}</span>
        </div>

        <div className={styles.infoCol}>
          <div className={styles.dateTime}>
            <span className={styles.date}>{dateStr}</span>
            <span className={styles.time}>{timeStr}</span>
          </div>
          <div className={styles.tempRow}>
            <span className={styles.temp}>
              {state.temp}
              {tempUnitLabel}
            </span>
            <div className={styles.statList}>
              <span className={styles.statLine}>
                Feels like {state.feelsLike}
                {tempUnitLabel}
              </span>
              <span className={styles.statLine}>Humidity {state.humidity}%</span>
              <span className={styles.statLine}>
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  className={styles.windArrow}
                  style={{ transform: `rotate(${state.windDirection}deg)` }}
                  aria-hidden="true"
                >
                  <line x1="12" y1="20" x2="12" y2="4" />
                  <polyline points="6,10 12,4 18,10" />
                </svg>
                {" "}
                Wind {state.windSpeed} {windUnitLabel} {compassLabel(state.windDirection)}
              </span>
            </div>
          </div>
          <span className={styles.hiLo}>
            Hi {state.hi}
            {tempUnitLabel} &nbsp; Lo {state.lo}
            {tempUnitLabel}
          </span>
        </div>
      </div>

      {state.days.length > 0 && (
        <div className={styles.forecastRow}>
          {state.days.map((d) => (
            <div key={d.date} className={styles.forecastDay}>
              <span className={styles.forecastDayLabel}>{dayLabel(d.date)}</span>
              <WeatherIcon kind={weatherKind(d.code)} size={28} />
              <span className={styles.forecastHiLo}>
                {d.hi}
                {tempUnitLabel}
              </span>
              <span className={styles.forecastLo}>
                {d.lo}
                {tempUnitLabel}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
