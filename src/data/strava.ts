// Recent rides are pulled live via the Strava API (see api/strava-activities.ts),
// authenticated with STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET / STRAVA_REFRESH_TOKEN
// env vars. profileUrl below is only used as the link-out fallback if that call fails.
export const strava = {
  profileUrl: "https://www.strava.com/athletes/256427",
};
