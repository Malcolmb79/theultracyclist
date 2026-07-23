// Generate the embed snippet from your own Strava account:
// Strava Settings -> My Profile -> "Embed a Widget", choose "Latest Activities",
// and paste the resulting iframe src below. No OAuth/API token needed — this is
// Strava's public no-auth widget.
export const strava = {
  profileUrl: "https://www.strava.com/athletes/256427",
  // TODO: this widget URL was confirmed (3x) to redirect to a Strava login
  // wall even when directly visited outside the site, despite Activity
  // Privacy being set to Everyone -- either a stale/invalid hash or this
  // embed type has been restricted. Cleared back to empty so the site shows
  // the working link-only fallback instead of a broken iframe. Replace with
  // a fresh widget URL if a working one is generated later.
  widgetSrc: "",
};
