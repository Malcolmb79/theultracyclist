import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSessionEmail } from "./_lib/session.js";
import { irelandTimeContext } from "./_lib/timeContext.js";
import { ATHLETE_PROFILE, DATA_SEMANTICS, SEASON_PLAN, LANGUAGE_STYLE } from "./_lib/coachContext.js";
import { fetchWhoopHistory } from "./whoop-data.js";
import { fetchStravaRides } from "./strava-activities.js";
import { fetchHealthHistory } from "./health-data.js";
import { fetchCoachingSettings } from "./coaching-settings.js";
import { computeTss } from "./_lib/tss.js";
import { computeFitnessSeries } from "./_lib/fitness.js";
import { irelandTodayDateStr, irelandDateStr } from "./_lib/timeContext.js";
import {
  listPlannedWorkouts,
  createPlannedWorkout,
  updatePlannedWorkout,
  deletePlannedWorkout,
  type PlannedWorkout,
} from "./_lib/plannedWorkouts.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";
const MAX_HISTORY = 20;
const MAX_TOOL_ROUNDS = 5; // bounds worst-case latency/cost of the tool-use loop below.

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ChatContext = {
  recoveryScore: number | null;
  hrvMs: number | null;
  restingHeartRate: number | null;
  strainScore: number | null;
  recentAvgStrain: number | null;
  sleepPerformance: number | null;
  weeklyDistanceKm: number | null;
  weeklyTargetKm: number | null;
  phase: "build" | "recovery" | "taper" | null;
  customRules: string | null;
  hasRiddenToday: boolean;
  todayDistanceKm: number | null;
};

type TextBlock = { type: "text"; text: string };
type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string };
type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

type AnthropicMessage = { role: "user" | "assistant"; content: string | ContentBlock[] };

function isTextBlock(block: ContentBlock): block is TextBlock {
  return block.type === "text";
}

function isToolUseBlock(block: ContentBlock): block is ToolUseBlock {
  return block.type === "tool_use";
}

// Tools give the model on-demand access to full historical data instead of
// relying on the single latest-value snapshot baked into the system prompt.
const TOOLS = [
  {
    name: "get_recovery_history",
    description:
      "Fetch daily Whoop history: recovery score, HRV (ms), resting heart rate, day strain, heart-rate " +
      "zone minutes, and sleep (performance, stages, consistency, efficiency). Use this whenever the athlete " +
      "asks about a trend, a specific past date, or anything beyond the single latest data point already " +
      "given in context.",
    input_schema: {
      type: "object",
      properties: {
        days: {
          type: "number",
          description: "How many days of history to fetch, most recent first. Defaults to 25 if omitted.",
        },
      },
    },
  },
  {
    name: "get_rides",
    description:
      "Fetch the athlete's most recent Strava rides: distance, moving time, average/weighted power, heart " +
      "rate, relative effort, elevation profile, and Training Stress Score (tss - null on a ride with no " +
      "power data or if FTP isn't set). Use this for questions about specific rides, recent training volume, " +
      "power/pacing patterns, or TSS - sum the tss field across rides in range for a weekly/period total.",
    input_schema: {
      type: "object",
      properties: {
        count: {
          type: "number",
          description:
            "How many of the most recent rides to fetch. Defaults to 6 if omitted; pass a higher number " +
            "for a longer look-back (e.g. 30 for the last month of rides).",
        },
      },
    },
  },
  {
    name: "get_fitness",
    description:
      "Get current CTL (fitness, 42-day training load average), ATL (fatigue, 7-day average), and TSB " +
      "(form/freshness, CTL minus ATL - positive means fresh, very negative means high accumulated fatigue), " +
      "plus their trend over the recent days requested. Computed from Strava TSS history against the " +
      "athlete's FTP - null values mean not enough ride/power history yet. Use this for questions about " +
      "fitness, fatigue, form, training load, or whether today is a good day to push hard vs back off.",
    input_schema: {
      type: "object",
      properties: {
        trendDays: {
          type: "number",
          description: "How many recent days of CTL/ATL/TSB trend to include alongside the current values. Defaults to 14 if omitted.",
        },
      },
    },
  },
  {
    name: "get_health_metrics",
    description:
      "Fetch daily Apple Health history (whatever the athlete's export includes - e.g. body weight, resting " +
      "energy, VO2 max, step count). Use this for body weight trends or anything tracked outside Whoop/Strava.",
    input_schema: {
      type: "object",
      properties: {
        metric: {
          type: "string",
          description: "Optional exact metric name to filter to. Omit to get every tracked metric.",
        },
        days: {
          type: "number",
          description: "How many days of history to fetch. Defaults to 90 if omitted.",
        },
      },
    },
  },
  {
    name: "get_workouts",
    description:
      "List the athlete's planned (structured) workouts in a date range - title, sport, planned duration/TSS/IF, " +
      "and full interval structure. Use this to check what's already scheduled before creating or changing " +
      "something, or when asked what's coming up.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start date, YYYY-MM-DD. Omit for no lower bound." },
        to: { type: "string", description: "End date, YYYY-MM-DD. Omit for no upper bound." },
      },
    },
  },
  {
    name: "create_workout",
    description:
      "Schedule a new structured workout. Build interval structure naturally from what the athlete describes " +
      "(e.g. \"4x8min threshold with 3min recovery, 10min warm-up and cool-down\") using percent-of-FTP " +
      "intensity - duration/TSS/IF are auto-computed from the structure when primaryIntensityMetric is " +
      "percentOfFtp, so don't set those yourself unless the athlete gives an explicit target. A plain " +
      "non-interval session (e.g. \"90min endurance ride\") can omit steps entirely and just set durationMinutes.",
    input_schema: {
      type: "object",
      required: ["date", "sport", "title"],
      properties: {
        date: {
          type: "string",
          description: "YYYY-MM-DD for an all-day plan, or YYYY-MM-DDTHH:MM:SS for a specific planned start time.",
        },
        sport: { type: "string", enum: ["Bike", "Run", "Strength", "Other"] },
        title: { type: "string" },
        description: { type: "string" },
        primaryIntensityMetric: { type: "string", enum: ["percentOfFtp", "percentOfThresholdHr"] },
        steps: {
          type: "array",
          description:
            "Ordered list of steps and/or repeated blocks making up the session. Each item is either a plain " +
            "step, or {type:'repetition', reps, steps:[...]} repeating a short block of steps that many times " +
            "(e.g. 4x(8min work + 3min rest)).",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["step", "repetition"] },
              name: { type: "string" },
              durationSeconds: { type: "number", description: "Required for a plain step." },
              intensityMin: { type: "number", description: "Percent of FTP or threshold HR." },
              intensityMax: { type: "number" },
              intensityClass: { type: "string", enum: ["warmUp", "active", "rest", "coolDown"] },
              reps: { type: "number", description: "Required when type is 'repetition'." },
              steps: {
                type: "array",
                description: "Required when type is 'repetition' - the steps to repeat.",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    durationSeconds: { type: "number" },
                    intensityMin: { type: "number" },
                    intensityMax: { type: "number" },
                    intensityClass: { type: "string", enum: ["warmUp", "active", "rest", "coolDown"] },
                  },
                },
              },
            },
          },
        },
        durationMinutes: { type: "number", description: "Only needed for a non-interval session with no steps, or to override the auto-computed value." },
        tssPlanned: { type: "number", description: "Override only - normally auto-computed from steps." },
      },
    },
  },
  {
    name: "update_workout",
    description: "Change any field of an existing planned workout (reschedule, edit structure, rename, etc). Fetch it with get_workouts first if you need its id.",
    input_schema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        date: { type: "string" },
        sport: { type: "string", enum: ["Bike", "Run", "Strength", "Other"] },
        title: { type: "string" },
        description: { type: "string" },
        primaryIntensityMetric: { type: "string", enum: ["percentOfFtp", "percentOfThresholdHr"] },
        steps: { type: "array", description: "Same shape as create_workout's steps - replaces the entire structure." },
        durationMinutes: { type: "number" },
        tssPlanned: { type: "number" },
      },
    },
  },
  {
    name: "delete_workout",
    description: "Cancel/remove a planned workout.",
    input_schema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
      },
    },
  },
] as const;

async function executeTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  try {
    switch (name) {
      case "get_recovery_history": {
        const days = typeof input.days === "number" ? input.days : undefined;
        const result = await fetchWhoopHistory(days);
        return result.history;
      }
      case "get_rides": {
        const count = typeof input.count === "number" ? input.count : undefined;
        const [rides, settings] = await Promise.all([fetchStravaRides(count), fetchCoachingSettings()]);
        return rides.map((r) => ({
          ...r,
          tss: computeTss(r.weightedAvgWatts ?? r.avgWatts, r.movingTimeMinutes, settings.ftpWatts),
        }));
      }
      case "get_health_metrics": {
        const days = typeof input.days === "number" ? input.days : undefined;
        const metric = typeof input.metric === "string" ? input.metric : undefined;
        return fetchHealthHistory(days, metric ? [metric] : undefined);
      }
      case "get_fitness": {
        const trendDays = typeof input.trendDays === "number" ? input.trendDays : 14;
        // A generous ride count (not the default 6) so CTL's 42-day window
        // has real history behind it rather than ramping up from an
        // artificially recent start.
        const [rides, settings] = await Promise.all([fetchStravaRides(200), fetchCoachingSettings()]);

        const dailyTssByDate = new Map<string, number>();
        let earliest: string | null = null;
        for (const r of rides) {
          const date = irelandDateStr(new Date(r.startDate));
          const tss = computeTss(r.weightedAvgWatts ?? r.avgWatts, r.movingTimeMinutes, settings.ftpWatts) ?? 0;
          dailyTssByDate.set(date, (dailyTssByDate.get(date) ?? 0) + tss);
          if (!earliest || date < earliest) earliest = date;
        }

        const today = irelandTodayDateStr();
        if (!earliest) return { current: null, trend: [], note: "No ride history available yet." };

        const series = computeFitnessSeries(dailyTssByDate, earliest, today);
        const points = Array.from(series.values());
        const current = points[points.length - 1] ?? null;
        const trend = points.slice(-trendDays);
        return { current, trend };
      }
      case "get_workouts": {
        const from = typeof input.from === "string" ? input.from : undefined;
        const to = typeof input.to === "string" ? input.to : undefined;
        return await listPlannedWorkouts(from, to);
      }
      case "create_workout": {
        const { date, sport, title } = input;
        if (typeof date !== "string" || typeof sport !== "string" || typeof title !== "string") {
          return { error: "date, sport, and title are required strings" };
        }
        return await createPlannedWorkout(input as unknown as Omit<PlannedWorkout, "id" | "createdAt" | "updatedAt">);
      }
      case "update_workout": {
        const { id, ...patch } = input;
        if (typeof id !== "string") return { error: "id is required" };
        const workout = await updatePlannedWorkout(id, patch as Partial<PlannedWorkout>);
        return workout ?? { error: `No workout found with id ${id}` };
      }
      case "delete_workout": {
        const { id } = input;
        if (typeof id !== "string") return { error: "id is required" };
        const ok = await deletePlannedWorkout(id);
        return { ok };
      }
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Tool call failed" };
  }
}

function buildSystemPrompt(context: Partial<ChatContext>): string {
  const lines: string[] = [];
  if (context.recoveryScore != null) lines.push(`Recovery score: ${context.recoveryScore}%`);
  if (context.hrvMs != null) lines.push(`HRV: ${context.hrvMs} ms`);
  if (context.restingHeartRate != null) lines.push(`Resting heart rate: ${context.restingHeartRate} bpm`);
  if (context.strainScore != null) lines.push(`Today's strain so far (live, still rising through the day): ${context.strainScore}`);
  if (context.recentAvgStrain != null) lines.push(`Average strain, last 3 days: ${context.recentAvgStrain}`);
  if (context.sleepPerformance != null) lines.push(`Sleep performance: ${context.sleepPerformance}%`);
  if (context.weeklyDistanceKm != null && context.weeklyTargetKm != null) {
    lines.push(`This week's distance so far: ${context.weeklyDistanceKm}km of a ${context.weeklyTargetKm}km target`);
  }
  if (context.phase) lines.push(`Current training phase: ${context.phase}`);
  lines.push(
    context.hasRiddenToday
      ? `Already completed a ride today: ${context.todayDistanceKm}km`
      : "No ride logged yet today",
  );

  return (
    "You are a professional cycling coach chatting with an athlete preparing for an unsupported ultra-distance " +
    "record attempt (Ireland, north to south, roughly 570km solo, one continuous unsupported effort). Before " +
    "anything else, note the time of day below and let it shape your tone and advice.\n\n" +
    irelandTimeContext() +
    "\n\n" +
    ATHLETE_PROFILE +
    "\n\n" +
    DATA_SEMANTICS +
    "\n\n" +
    SEASON_PLAN +
    "\n\n" +
    LANGUAGE_STYLE +
    "\n\n" +
    "Coach with real depth: periodised training load across build/recovery/taper phases; HRV- and RHR-informed " +
    "readiness (a depressed HRV or elevated RHR relative to the athlete's own baseline signals accumulated " +
    "fatigue earlier and more reliably than recovery score alone); power-zone-based training (Z1-2 endurance, " +
    "Z3 tempo, Z4 threshold, Z5 VO2/anaerobic) - for an effort this long, time-in-zone and durability at low-Z " +
    "power matter far more than peak numbers; sleep's role in adaptation, since poor sleep performance blunts " +
    "the training effect of the same load; and the specific demands of a multi-day unsupported solo record " +
    "attempt - fueling strategy and gut training at race pace, pacing conservatively enough to avoid a " +
    "mid-attempt bonk or overuse injury, taper design in the final one to two weeks, and managing cumulative " +
    "sleep deprivation and fatigue during the attempt itself, not just the training leading up to it.\n\n" +
    "You have tools to pull the athlete's actual historical data (Whoop recovery/strain/sleep, Strava rides, " +
    "Apple Health, current CTL/ATL/TSB fitness/fatigue/form) beyond the snapshot below - use them whenever a " +
    "specific number, trend, or past date would make your answer better than a general one, rather than " +
    "guessing or saying you don't have the data. You can also schedule, edit, and cancel structured workouts " +
    "directly - when the athlete describes a session in words (e.g. \"give me 4x8min threshold for Tuesday\"), " +
    "build the interval structure yourself and create it rather than just describing what they should do; " +
    "check get_workouts first if you need to see what's already planned or find a workout's id to edit. " +
    "Check whether they've already ridden today (in the snapshot below) before asking what's on their " +
    "schedule or suggesting a session for today - if they've already trained, talk about recovery from that " +
    "ride and what's next instead. Answer directly and practically. Keep replies conversational and concise - " +
    "a few sentences unless they ask for real detail. Do not use markdown formatting.\n\n" +
    (context.customRules
      ? `The athlete has set these standing rules - always follow them, even over generic best practice:\n${context.customRules}\n\n`
      : "") +
    "Current snapshot:\n" +
    (lines.length ? lines.join("\n") : "No recent recovery/training data available.")
  );
}

// The tool-use loop + prompt, extracted so both the browser chat route below
// and the WhatsApp webhook (api/whatsapp-webhook.ts, which has no browser to
// compute a context snapshot or hold conversation state client-side) can
// share the exact same coaching logic instead of two divergent copies.
// Throws on an Anthropic API error; callers decide how to surface that.
export async function generateCoachReply(messages: ChatMessage[], context: Partial<ChatContext>): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  const anthropicMessages: AnthropicMessage[] = messages.map((m) => ({ role: m.role, content: m.content }));
  const system = [
    { type: "text" as const, text: buildSystemPrompt(context), cache_control: { type: "ephemeral" as const } },
  ];

  let finalText = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600,
        system,
        tools: TOOLS,
        messages: anthropicMessages,
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const data = (await response.json()) as { content: ContentBlock[]; stop_reason: string };
    const textSoFar = data.content.filter(isTextBlock).map((b) => b.text).join("\n");

    if (data.stop_reason !== "tool_use") {
      finalText = textSoFar;
      break;
    }

    anthropicMessages.push({ role: "assistant", content: data.content });

    const toolUses = data.content.filter(isToolUseBlock);
    const toolResults: ToolResultBlock[] = await Promise.all(
      toolUses.map(async (call) => ({
        type: "tool_result" as const,
        tool_use_id: call.id,
        content: JSON.stringify(await executeTool(call.name, call.input)),
      })),
    );
    anthropicMessages.push({ role: "user", content: toolResults });

    // Ran out of rounds while the model still wanted another tool call -
    // fall back to whatever text (if any) came with that last response.
    if (round === MAX_TOOL_ROUNDS - 1) {
      finalText = textSoFar;
    }
  }

  return finalText || "I wasn't able to pull that together - try asking again.";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!getSessionEmail(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(200).json({ configured: false });
    return;
  }

  const body = req.body as { messages?: ChatMessage[]; context?: Partial<ChatContext> };
  const inputMessages = (body.messages ?? [])
    .filter(
      (m): m is ChatMessage =>
        (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim().length > 0,
    )
    .slice(-MAX_HISTORY);

  if (inputMessages.length === 0 || inputMessages[inputMessages.length - 1].role !== "user") {
    res.status(400).json({ error: "Expected a trailing user message" });
    return;
  }

  try {
    const reply = await generateCoachReply(inputMessages, body.context ?? {});
    res.status(200).json({ configured: true, reply });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: "Unable to get a reply from the coach" });
  }
}
