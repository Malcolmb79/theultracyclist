#!/usr/bin/env node
// Pulls daily wellness data from Garmin Connect (unofficial API) and posts it
// to /api/health-data in the same shape Health Auto Export uses, so Garmin's
// numbers land in the same history as Apple Health and show up in the
// dashboard catalog, trends and the coach with no extra plumbing.
//
// Runs on your own machine rather than on Vercel: Garmin throttles and blocks
// logins from datacenter IPs, and your Garmin password never needs to leave
// this computer. Everything it stores lives in ./.garmin (gitignored).
//
//   node scripts/garmin-sync.mjs login            one-time sign-in (password + MFA typed here)
//   node scripts/garmin-sync.mjs sync [--days N]  fetch the last N days (default 3) and post
//   node scripts/garmin-sync.mjs sync --dry-run   print what would be posted
//   node scripts/garmin-sync.mjs dump [YYYY-MM-DD] save raw Garmin responses to .garmin/dump-<date>.json

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import garmin from "@flow-js/garmin-connect";

const { GarminConnect } = garmin;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATE_DIR = path.join(ROOT, ".garmin");
const TOKEN_DIR = path.join(STATE_DIR, "tokens");
const CONFIG_FILE = path.join(STATE_DIR, "config.json");
const API = "https://connectapi.garmin.com";
const TIMEZONE = "Europe/Dublin";

function ask(question, { hidden = false } = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    rl._writeToOutput = (text) => {
      if (text.includes(question)) rl.output.write(text);
    };
  }
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeConfig(config) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// The library creates only the last folder, so the parent must exist first.
function saveTokens(client) {
  fs.mkdirSync(TOKEN_DIR, { recursive: true });
  client.exportTokenToFile(TOKEN_DIR);
}

function irelandDate(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function irelandMinutes(date) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = Number(parts.find((p) => p.type === "minute")?.value);
  return hour * 60 + minute;
}

function daysBack(count) {
  const out = [];
  for (let i = count - 1; i >= 0; i--) out.push(irelandDate(new Date(Date.now() - i * 86400000)));
  return out;
}

function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function login() {
  const config = readConfig();
  const username = await ask("Garmin email: ");
  const password = await ask("Garmin password (hidden): ", { hidden: true });
  const client = new GarminConnect({ username, password });
  await client.login(undefined, undefined, { mfaHandler: () => ask("Garmin MFA code: ") });
  saveTokens(client);
  console.log(`Signed in. Tokens saved to ${TOKEN_DIR} (your password is not stored).`);

  if (!config.siteUrl || !config.secret) await setup();
}

async function setup() {
  const config = readConfig();
  config.siteUrl = (await ask("Site URL [https://theultracyclist.com]: ")) || "https://theultracyclist.com";
  config.secret = "";
  while (!config.secret) {
    config.secret = await ask("APPLE_HEALTH_WEBHOOK_SECRET (hidden - paste, then Enter): ", { hidden: true });
    if (config.secret.length > 200 || /\s|^[{[]/.test(config.secret)) {
      console.log(`That's ${config.secret.length} characters and doesn't look like a secret - copy just the value from Vercel and paste again.`);
      config.secret = "";
      continue;
    }
    console.log(config.secret ? `Received ${config.secret.length} characters.` : "Nothing received - try pasting again (right-click pastes in PowerShell).");
  }
  writeConfig(config);
  console.log(`Config saved to ${CONFIG_FILE}.`);
}

async function connect() {
  if (!fs.existsSync(path.join(TOKEN_DIR, "oauth1_token.json"))) {
    throw new Error("Not signed in. Run: node scripts/garmin-sync.mjs login");
  }
  // The constructor insists on a credentials object even when tokens are used.
  const client = new GarminConnect({ username: "", password: "" });
  client.loadTokenByFile(TOKEN_DIR);
  return client;
}

async function attempt(label, fn) {
  try {
    return await fn();
  } catch (err) {
    console.warn(`  ! ${label}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Raw Garmin responses for one date - kept separate so `dump` and `sync` read the same thing. */
async function fetchRaw(client, date) {
  const asDate = new Date(`${date}T12:00:00Z`);
  const [sleep, hrv, heartRate, stress, bodyBatteryReport, readiness, steps] = await Promise.all([
    attempt("sleep", () => client.get(`${API}/sleep-service/sleep/dailySleepData`, { params: { date } })),
    attempt("hrv", () => client.get(`${API}/hrv-service/hrv/${date}`)),
    attempt("heart rate", () => client.getHeartRate(asDate)),
    attempt("stress", () => client.get(`${API}/wellness-service/wellness/dailyStress/${date}`)),
    attempt("body battery", () =>
      client.get(`${API}/wellness-service/wellness/bodyBattery/reports/daily`, { params: { startDate: date, endDate: date } }),
    ),
    attempt("training readiness", () => client.get(`${API}/metrics-service/metrics/trainingreadiness/${date}`)),
    attempt("steps", () => client.getSteps(asDate)),
  ]);
  return { sleep, hrv, heartRate, stress, bodyBatteryReport, readiness, steps };
}

/**
 * Body battery readings come back as [timestampMs, level] pairs from the
 * report endpoint and [timestampMs, "MEASURED", level, version] from the
 * stress endpoint - accept either, and drop gaps where the watch wasn't worn.
 */
function batteryReadings(raw) {
  const candidates = [raw.bodyBatteryReport?.[0]?.bodyBatteryValuesArray, raw.stress?.bodyBatteryValuesArray];
  for (const list of candidates) {
    if (!Array.isArray(list)) continue;
    const readings = [];
    for (const entry of list) {
      if (!Array.isArray(entry)) continue;
      const level = typeof entry[1] === "string" ? num(entry[2]) : num(entry[1]);
      const at = num(entry[0]);
      if (level != null && at != null) readings.push({ at, level });
    }
    if (readings.length > 0) return readings.sort((a, b) => a.at - b.at);
  }
  return [];
}

function toMetrics(date, raw, activity) {
  const out = {};
  const put = (name, units, value) => {
    const n = num(value);
    if (n != null) out[name] = { units, value: Math.round(n * 100) / 100 };
  };

  const hours = (seconds) => (num(seconds) != null ? seconds / 3600 : null);
  const sleepDto = raw.sleep?.dailySleepDTO;
  put("garmin_sleep_score", "score", sleepDto?.sleepScores?.overall?.value);
  put("garmin_sleep_hours", "hr", hours(sleepDto?.sleepTimeSeconds));
  put("garmin_sleep_deep_hours", "hr", hours(sleepDto?.deepSleepSeconds));
  put("garmin_sleep_light_hours", "hr", hours(sleepDto?.lightSleepSeconds));
  put("garmin_sleep_rem_hours", "hr", hours(sleepDto?.remSleepSeconds));
  put("garmin_sleep_awake_hours", "hr", hours(sleepDto?.awakeSleepSeconds));
  put("garmin_sleep_need_hours", "hr", num(sleepDto?.sleepNeed?.actual) != null ? sleepDto.sleepNeed.actual / 60 : null);
  put("garmin_sleep_awakenings", "times", sleepDto?.awakeCount);
  put("garmin_sleep_stress", "score", sleepDto?.avgSleepStress);
  put("garmin_respiration", "brpm", sleepDto?.averageRespirationValue);
  put("garmin_sleep_battery_gain", "score", raw.sleep?.bodyBatteryChange);

  put("garmin_hrv", "ms", raw.hrv?.hrvSummary?.lastNightAvg ?? raw.sleep?.avgOvernightHrv);
  put("garmin_hrv_weekly", "ms", raw.hrv?.hrvSummary?.weeklyAvg);
  // History stores numbers only, so the status word travels as a code (see HRV_STATUS_CODES).
  put("garmin_hrv_status", "code", HRV_STATUS_CODES[raw.hrv?.hrvSummary?.status ?? raw.sleep?.hrvStatus]);
  put("garmin_resting_hr", "bpm", raw.heartRate?.restingHeartRate ?? raw.sleep?.restingHeartRate);
  put("garmin_stress", "score", raw.stress?.avgStressLevel);
  put("garmin_steps", "count", raw.steps);

  // One entry per update through the day, newest first - but sort rather than trust the order.
  const readinessEntry = Array.isArray(raw.readiness)
    ? raw.readiness.toSorted((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))[0]
    : raw.readiness;
  put("garmin_training_readiness", "score", readinessEntry?.score);
  put("garmin_acute_load", "load", readinessEntry?.acuteLoad);
  // Reported in minutes (443 the morning after a long race).
  put("garmin_recovery_time", "hr", num(readinessEntry?.recoveryTime) != null ? readinessEntry.recoveryTime / 60 : null);
  // Each factor's contribution to readiness, 0-100, for the detail view.
  put("garmin_readiness_sleep", "pct", readinessEntry?.sleepScoreFactorPercent);
  put("garmin_readiness_recovery", "pct", readinessEntry?.recoveryTimeFactorPercent);
  put("garmin_readiness_hrv", "pct", readinessEntry?.hrvFactorPercent);
  put("garmin_readiness_load", "pct", readinessEntry?.acwrFactorPercent);
  put("garmin_readiness_stress", "pct", readinessEntry?.stressHistoryFactorPercent);
  put("garmin_readiness_sleep_history", "pct", readinessEntry?.sleepHistoryFactorPercent);

  const readings = batteryReadings(raw);
  if (readings.length > 0) {
    const latest = readings.at(-1);
    const levels = readings.map((r) => r.level);
    const wakeAt = num(sleepDto?.sleepEndTimestampGMT);
    // The level the athlete woke with: the first reading at or after waking,
    // else the day's high before 10:00 as a stand-in for overnight recharge.
    const wakeReading = wakeAt != null ? readings.find((r) => r.at >= wakeAt) : null;
    const morning = readings.filter((r) => irelandMinutes(new Date(r.at)) < 10 * 60).map((r) => r.level);
    put("garmin_body_battery", "score", latest.level);
    put("garmin_body_battery_at", "min", irelandMinutes(new Date(latest.at)));
    put("garmin_body_battery_wake", "score", wakeReading?.level ?? (morning.length > 0 ? Math.max(...morning) : null));
    put("garmin_body_battery_high", "score", Math.max(...levels));
    put("garmin_body_battery_low", "score", Math.min(...levels));
  }
  const report = raw.bodyBatteryReport?.[0];
  put("garmin_body_battery_charged", "score", report?.charged);
  put("garmin_body_battery_drained", "score", report?.drained);

  if (activity) {
    put("garmin_training_load", "load", activity.load);
    put("garmin_activity_minutes", "min", activity.minutes);
  }
  return out;
}

// Kept in step with src/utils/garmin.ts, which turns the codes back into words.
const HRV_STATUS_CODES = { NONE: 0, POOR: 1, LOW: 2, UNBALANCED: 3, BALANCED: 4 };

function activityByDate(activities) {
  const byDate = new Map();
  for (const a of activities ?? []) {
    const start = typeof a.startTimeLocal === "string" ? a.startTimeLocal.slice(0, 10) : null;
    if (!start) continue;
    const entry = byDate.get(start) ?? { load: 0, minutes: 0 };
    entry.load += num(a.activityTrainingLoad) ?? 0;
    entry.minutes += (num(a.duration) ?? 0) / 60;
    byDate.set(start, entry);
  }
  return byDate;
}

async function post(payload) {
  const config = readConfig();
  if (!config.siteUrl || !config.secret) throw new Error("Missing site URL or secret. Run: node scripts/garmin-sync.mjs setup");
  const res = await fetch(`${config.siteUrl.replace(/\/$/, "")}/api/health-data`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.secret}` },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Post failed: ${res.status} ${body}`);
  return body;
}

function toPayload(days) {
  const byMetric = new Map();
  for (const { date, metrics } of days) {
    for (const [name, { units, value }] of Object.entries(metrics)) {
      const entry = byMetric.get(name) ?? { name, units, data: [] };
      entry.data.push({ qty: value, date: `${date} 00:00:00 +0000`, source: "Garmin Connect" });
      byMetric.set(name, entry);
    }
  }
  return { data: { metrics: [...byMetric.values()] } };
}

// Backfills post in chunks so a failure late in a long run keeps what came
// before it, and pause between days so Garmin doesn't throttle the account.
const CHUNK_DAYS = 10;

async function sync(args) {
  const dryRun = args.includes("--dry-run");
  const flag = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 ? Number(args[i + 1]) || fallback : fallback;
  };
  const days = Math.max(1, Math.min(120, flag("--days", 3)));
  const delayMs = Math.max(0, flag("--delay", days > 10 ? 3000 : 0));

  const client = await connect();
  const dates = daysBack(days);
  const activities = await attempt("activities", () => client.getActivities(0, Math.min(400, Math.max(60, days * 3))));
  const loads = activityByDate(activities);

  let pending = [];
  let posted = 0;
  const flush = async () => {
    if (pending.length === 0) return;
    const payload = toPayload(pending);
    if (dryRun) console.log(JSON.stringify(payload, null, 2));
    else console.log(`Posted ${pending[0].date}..${pending.at(-1).date}: ${await post(payload)}`);
    posted += pending.length;
    pending = [];
  };

  for (const [i, date] of dates.entries()) {
    console.log(`Fetching ${date}`);
    const metrics = toMetrics(date, await fetchRaw(client, date), loads.get(date) ?? null);
    if (Object.keys(metrics).length > 0) pending.push({ date, metrics });
    if (pending.length >= CHUNK_DAYS) await flush();
    if (delayMs > 0 && i < dates.length - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  await flush();

  // Refreshed OAuth tokens are good for a year; saving them after every run
  // keeps the sign-in alive without ever needing the password again.
  saveTokens(client);

  if (posted === 0) {
    console.error("Nothing to post - every Garmin request came back empty.");
    process.exitCode = 1;
  }
}

async function dump(args) {
  const date = args[0] ?? irelandDate(new Date());
  const client = await connect();
  const raw = await fetchRaw(client, date);
  const activities = await attempt("activities", () => client.getActivities(0, 10));
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const file = path.join(STATE_DIR, `dump-${date}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...raw, activities }, null, 2));
  saveTokens(client);
  console.log(`Saved raw responses to ${file}`);
}

const [command, ...rest] = process.argv.slice(2);
const commands = { login, setup, sync, dump };
if (!commands[command]) {
  console.error("Usage: node scripts/garmin-sync.mjs <login | setup | sync [--days N] [--delay MS] [--dry-run] | dump [YYYY-MM-DD]>");
  process.exit(1);
}
commands[command](rest).catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  // The library has already printed the raw HTTP error.
  if (message.includes("(429)")) {
    console.error("\nGarmin is rate-limiting sign-ins from this network. Wait an hour before trying again - each retry restarts the wait.");
  } else if (!message.startsWith("ERROR: (")) {
    console.error(message);
  }
  process.exit(1);
});
