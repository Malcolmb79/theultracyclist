import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyRaceCors, getRaceAuthEmail } from "../_lib/raceToken.js";
import { getJSON, setJSON } from "../_lib/kvStore.js";
import { zwiftGet, ZwiftApiUnavailable } from "../_lib/zwiftApi.js";

/**
 * Which races a cyclist has signed up for in the next 24 hours, for the
 * mod's Sign-up search window. Zwift lists who's signed up per race
 * category, not a rider's sign-ups, so every race starting in the next day
 * is looked through: its sign-up counts (Zwift's public list leaves them
 * out), then the entrants of each category anyone has signed up for - a
 * batch of races a call, all of it kept for a while - and the mod asks
 * again until the sweep is done, showing what's found as it goes.
 *
 * GET ?q=<name or Zwift id> with the race key. Answers
 * { configured, total, checked, done, matches: [...] }.
 */

const API = "https://us-or-rly101.zwift.com";
const HOURS = 24;
const RACES_KEY = "zwift:races-24h";
const RACES_MS = 15 * 60_000;
/** A category's entrants are kept this long - longer once the count stops changing. */
const ENTRANTS_MS = 30 * 60_000;
/** Time a call may spend fetching before answering with what it has. */
const BUDGET_MS = 7000;
const PARALLEL = 6;
/** A race's sign-up counts are kept this long. */
const COUNTS_MS = 10 * 60_000;
const PAGE = 100;

interface ZwiftEvent {
  id: number;
  name: string;
  eventType?: string;
  eventStart: string;
  routeId?: number;
  laps?: number;
  distanceInMeters?: number;
  eventSubgroups?: { id: number; subgroupLabel?: string; label?: number; eventSubgroupStart?: string; totalSignedUpCount?: number }[];
}

interface Race {
  id: number;
  name: string;
  start: number;
  laps?: number;
  distanceKm?: number;
  subgroups: { id: number; label: string; start: number; signedUp: number }[];
}

type Entrants = { at: number; count: number; riders: [number, string][] };

/** The races starting in the next day, from Zwift's public event list, a page at a time. */
async function races(): Promise<Race[]> {
  const kept = await getJSON<{ at: number; races: Race[] }>(RACES_KEY);
  if (kept && Date.now() - kept.at < RACES_MS) return kept.races;
  const until = Date.now() + HOURS * 3_600_000;
  const out: Race[] = [];
  for (let start = 0; start < 2000; start += 200) {
    const res = await fetch(`${API}/api/public/events/upcoming?start=${start}`, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Zwift's event list failed (${res.status})`);
    const page = (await res.json()) as ZwiftEvent[];
    if (!Array.isArray(page) || !page.length) break;
    for (const e of page) {
      const at = Date.parse(e.eventStart);
      if (e.eventType !== "RACE" || !(at <= until) || at < Date.now() - 30 * 60_000) continue;
      out.push({
        id: e.id,
        name: e.name,
        start: at,
        laps: e.laps || undefined,
        distanceKm: e.distanceInMeters ? Math.round(e.distanceInMeters / 100) / 10 : undefined,
        subgroups: (e.eventSubgroups ?? []).map((g) => ({
          id: g.id,
          label: g.subgroupLabel ?? (g.label ? "ABCDE"[g.label - 1] ?? String(g.label) : ""),
          start: Date.parse(g.eventSubgroupStart ?? e.eventStart),
          signedUp: g.totalSignedUpCount ?? 0,
        })),
      });
    }
    if (Math.max(...page.map((e) => Date.parse(e.eventStart))) > until) break;
  }
  const unique = Array.from(new Map(out.map((r) => [r.id, r])).values()).sort((a, b) => a.start - b.start);
  await setJSON(RACES_KEY, { at: Date.now(), races: unique });
  return unique;
}

const entrantsKey = (id: number) => `zwift:signups:${id}`;

/** Whether a category's kept entrants still do: fresh, and the sign-up count hasn't moved. */
function fresh(e: Entrants | null, signedUp: number): e is Entrants {
  return !!e && Date.now() - e.at < ENTRANTS_MS && e.count === signedUp;
}

async function fetchEntrants(id: number, signedUp: number): Promise<Entrants> {
  const riders: [number, string][] = [];
  for (let start = 0; start < 2000; start += PAGE) {
    const page = await zwiftGet<{ id: number; firstName?: string; lastName?: string }[]>(
      `/api/events/subgroups/entrants/${id}?participation=signed_up&type=all&limit=${PAGE}&start=${start}`,
    );
    for (const p of page) riders.push([p.id, `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim()]);
    if (page.length < PAGE) break;
  }
  const value = { at: Date.now(), count: signedUp, riders };
  await setJSON(entrantsKey(id), value);
  return value;
}

/** Folded for matching: no case, accents or punctuation. */
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyRaceCors(req, (name, value) => res.setHeader(name, value));
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (!getRaceAuthEmail(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  const q = String(req.query.q ?? "").trim();
  if (!q) {
    res.status(400).json({ error: "Give a name or Zwift id to search for." });
    return;
  }
  const byId = /^\d+$/.test(q) ? Number(q) : undefined;
  const words = fold(q).split(" ").filter(Boolean);
  const matches = (name: string, id: number) => (byId != null ? id === byId : words.every((w) => fold(name).includes(w)));

  try {
    const list = await races();
    const countsKey = (id: number) => `zwift:signup-counts:${id}`;
    type Counts = { at: number; counts: Record<string, number> };
    const counts = await Promise.all(list.map((r) => getJSON<Counts>(countsKey(r.id))));
    const entrants = new Map<number, Entrants | null>();
    // If Zwift's counts turn out empty everywhere, they can't be trusted to skip categories: every one is looked through.
    const COUNTS_OK_KEY = "zwift:signup-counts-ok";
    const countsOk = (await getJSON<boolean>(COUNTS_OK_KEY)) ?? true;
    const raceDone = new Array<boolean>(list.length).fill(false);

    /** One race looked through: its counts, then each signed-up category's entrants. */
    const sweep = async (i: number, fetchMissing: boolean) => {
      const r = list[i];
      let c = counts[i];
      if (!c || Date.now() - c.at > COUNTS_MS) {
        if (!fetchMissing) return;
        const ev = await zwiftGet<ZwiftEvent>(`/api/events/${r.id}`);
        c = { at: Date.now(), counts: Object.fromEntries((ev.eventSubgroups ?? []).map((g) => [String(g.id), g.totalSignedUpCount ?? 0])) };
        counts[i] = c;
        await setJSON(countsKey(r.id), c);
      }
      let complete = true;
      for (const g of r.subgroups) {
        // -1: the count isn't known, so the category is looked through anyway.
        const n = countsOk ? (c.counts[String(g.id)] ?? 0) : -1;
        if (!n) continue;
        let e = entrants.get(g.id) ?? (await getJSON<Entrants>(entrantsKey(g.id)));
        if (!fresh(e, n)) e = fetchMissing ? await fetchEntrants(g.id, n) : null;
        entrants.set(g.id, e);
        if (!e) complete = false;
      }
      raceDone[i] = complete;
    };

    // What's already kept, without asking Zwift; then the rest, soonest first, until this call's time is up.
    await Promise.all(list.map((_, i) => sweep(i, false).catch(() => undefined)));
    const todo = list.map((_, i) => i).filter((i) => !raceDone[i]);
    const began = Date.now();
    for (let k = 0; k < todo.length && Date.now() - began < BUDGET_MS; k += PARALLEL) {
      await Promise.all(todo.slice(k, k + PARALLEL).map((i) => sweep(i, true).catch(() => undefined)));
    }

    const counted = counts.filter(Boolean) as Counts[];
    if (countsOk && counted.length >= 10 && counted.every((c) => Object.values(c.counts).every((n) => !n))) await setJSON(COUNTS_OK_KEY, false);

    const found: unknown[] = [];
    list.forEach((r) => {
      for (const g of r.subgroups) {
        const e = entrants.get(g.id);
        if (!e) continue;
        for (const [id, name] of e.riders) {
          if (!matches(name, id)) continue;
          found.push({
            eventId: r.id,
            event: r.name,
            start: g.start,
            category: g.label,
            signedUp: e.count >= 0 ? e.count : e.riders.length,
            laps: r.laps,
            distanceKm: r.distanceKm,
            rider: { id, name },
          });
        }
      }
    });
    const checked = raceDone.filter(Boolean).length;
    res.status(200).json({ configured: true, total: list.length, checked, done: checked >= list.length, matches: found });
  } catch (e) {
    if (e instanceof ZwiftApiUnavailable) {
      res.status(200).json({ configured: false, error: e.message, matches: [] });
      return;
    }
    res.status(502).json({ error: e instanceof Error ? e.message : "Search failed", matches: [] });
  }
}
