import { useEffect, useState } from "react";
import { useUnits } from "../../context/UnitsContext";
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

type WeatherKind = "clear" | "cloudy" | "fog" | "rain" | "snow" | "storm";

function weatherKind(code: number): WeatherKind {
  if (code <= 1) return "clear";
  if (code <= 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (code >= 95) return "storm";
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return "snow";
  if (code >= 51) return "rain";
  return "cloudy";
}

const KIND_COLOR: Record<WeatherKind, string> = {
  clear: "var(--color-amber)",
  cloudy: "var(--color-text-muted)",
  fog: "var(--color-text-muted)",
  rain: "#4B87F5",
  snow: "#8FA9C5",
  storm: "var(--color-accent)",
};

type WeatherState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; temp: number; feelsLike: number; code: number; wind: number; humidity: number };

// Current weather at the athlete's location - pure client-side (browser
// Geolocation for the coordinates, Open-Meteo's free keyless API for the
// forecast), no server route or account needed. Useful for judging today's
// ride against real conditions, which none of the Whoop/Strava/Health data
// otherwise captures.
export default function WeatherCard() {
  const { system } = useUnits();
  const [state, setState] = useState<WeatherState>({ status: "loading" });
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setState({ status: "error", message: "Geolocation isn't available in this browser." });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const tempUnit = system === "imperial" ? "fahrenheit" : "celsius";
        const windUnit = system === "imperial" ? "mph" : "kmh";
        const url =
          `https://api.open-meteo.com/v1/forecast?latitude=${pos.coords.latitude}&longitude=${pos.coords.longitude}` +
          `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m` +
          `&temperature_unit=${tempUnit}&wind_speed_unit=${windUnit}`;
        fetch(url)
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Weather request failed"))))
          .then((data) => {
            if (cancelled) return;
            const c = data.current;
            setState({
              status: "ready",
              temp: Math.round(c.temperature_2m),
              feelsLike: Math.round(c.apparent_temperature),
              code: c.weather_code,
              wind: Math.round(c.wind_speed_10m),
              humidity: Math.round(c.relative_humidity_2m),
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
  const tempUnitLabel = system === "imperial" ? "°F" : "°C";
  const windUnitLabel = system === "imperial" ? "mph" : "km/h";

  return (
    <div className={styles.wrap}>
      <div className={styles.headline}>
        <span className={styles.temp} style={{ color: KIND_COLOR[kind] }}>
          {state.temp}{tempUnitLabel}
        </span>
        <span className={styles.condition}>{WMO_LABEL[state.code] ?? "—"}</span>
      </div>
      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statValue}>
            {state.feelsLike}{tempUnitLabel}
          </span>
          <span className={styles.statLabel}>Feels like</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>
            {state.wind} {windUnitLabel}
          </span>
          <span className={styles.statLabel}>Wind</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{state.humidity}%</span>
          <span className={styles.statLabel}>Humidity</span>
        </div>
      </div>
    </div>
  );
}
