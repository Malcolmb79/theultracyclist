import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSessionEmail } from "./_lib/session.js";
import { fetchWhoopHistory } from "./whoop-data.js";
import { fetchStravaRides } from "./strava-activities.js";
import { fetchHealthHistory } from "./health-data.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";
const MAX_HISTORY = 20;
const MAX_TOOL_ROUNDS = 5; // bounds worst-case latency/cost of the tool-use loop below.

type ChatMessage = { role: "user" | "assistant"; content: string };

type ChatContext = {
  recoveryScore: number | null;
  hrvMs: number | null;
  restingHeartRate: number | null;
  strainScore: number | null;
  recentAvgStrain: number | null;
  sleepPerformance: number | null;
  weeklyDistanceKm: number | null;
  weeklyTargetKm: number | null;
  phase: "build" | "recovery" | "taper" | null;
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
      "rate, relative effort, and elevation profile. Use this for questions about specific rides, recent " +
      "training volume, or power/pacing patterns.",
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
        return await fetchStravaRides(count);
      }
      case "get_health_metrics": {
        const days = typeof input.days === "number" ? input.days : undefined;
        const metric = typeof input.metric === "string" ? input.metric : undefined;
        return fetchHealthHistory(days, metric ? [metric] : undefined);
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
  if (context.strainScore != null) lines.push(`Yesterday's strain: ${context.strainScore}`);
  if (context.recentAvgStrain != null) lines.push(`Average strain, last 3 days: ${context.recentAvgStrain}`);
  if (context.sleepPerformance != null) lines.push(`Sleep performance: ${context.sleepPerformance}%`);
  if (context.weeklyDistanceKm != null && context.weeklyTargetKm != null) {
    lines.push(`This week's distance so far: ${context.weeklyDistanceKm}km of a ${context.weeklyTargetKm}km target`);
  }
  if (context.phase) lines.push(`Current training phase: ${context.phase}`);

  return (
    "You are an experienced cycling coach chatting with an athlete preparing for an unsupported ultra-distance " +
    "record attempt (Ireland, north to south, roughly 570km solo, one continuous unsupported effort). Coach " +
    "with real depth: periodized training load across build/recovery/taper phases; HRV- and RHR-informed " +
    "readiness (a depressed HRV or elevated RHR relative to the athlete's own baseline signals accumulated " +
    "fatigue earlier and more reliably than recovery score alone); power-zone-based training (Z1-2 endurance, " +
    "Z3 tempo, Z4 threshold, Z5 VO2/anaerobic) - for an effort this long, time-in-zone and durability at low-Z " +
    "power matter far more than peak numbers; sleep's role in adaptation, since poor sleep performance blunts " +
    "the training effect of the same load; and the specific demands of a multi-day unsupported solo record " +
    "attempt - fueling strategy and gut training at race pace, pacing conservatively enough to avoid a " +
    "mid-attempt bonk or overuse injury, taper design in the final one to two weeks, and managing cumulative " +
    "sleep deprivation and fatigue during the attempt itself, not just the training leading up to it.\n\n" +
    "You have tools to pull the athlete's actual historical data (Whoop recovery/strain/sleep, Strava rides, " +
    "Apple Health) beyond the snapshot below - use them whenever a specific number, trend, or past date would " +
    "make your answer better than a general one, rather than guessing or saying you don't have the data. " +
    "Answer directly and practically. Keep replies conversational and concise - a few sentences unless they " +
    "ask for real detail. Do not use markdown formatting.\n\n" +
    "Current snapshot:\n" +
    (lines.length ? lines.join("\n") : "No recent recovery/training data available.")
  );
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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
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

  const messages: AnthropicMessage[] = inputMessages.map((m) => ({ role: m.role, content: m.content }));
  const system = [
    { type: "text" as const, text: buildSystemPrompt(body.context ?? {}), cache_control: { type: "ephemeral" as const } },
  ];

  try {
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
          messages,
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

      messages.push({ role: "assistant", content: data.content });

      const toolUses = data.content.filter(isToolUseBlock);
      const toolResults: ToolResultBlock[] = await Promise.all(
        toolUses.map(async (call) => ({
          type: "tool_result" as const,
          tool_use_id: call.id,
          content: JSON.stringify(await executeTool(call.name, call.input)),
        })),
      );
      messages.push({ role: "user", content: toolResults });

      // Ran out of rounds while the model still wanted another tool call -
      // fall back to whatever text (if any) came with that last response.
      if (round === MAX_TOOL_ROUNDS - 1) {
        finalText = textSoFar;
      }
    }

    res.status(200).json({
      configured: true,
      reply: finalText || "I wasn't able to pull that together - try asking again.",
    });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: "Unable to get a reply from the coach" });
  }
}
