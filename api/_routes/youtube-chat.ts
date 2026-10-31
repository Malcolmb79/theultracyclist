import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyRaceCors, getRaceAuthEmail } from "../_lib/raceToken.js";
import { getJSON, setJSON } from "../_lib/kvStore.js";

/**
 * The live chat of the rider's YouTube stream, for the YouTube chat overlay
 * in the Sauce mod - read with YouTube's Data API, whose key
 * (YOUTUBE_API_KEY) stays here, never in the mod.
 *
 * GET ?channel=@handle (or a channel URL), or ?video=<id or watch/live URL>;
 * &chat=<liveChatId>&page=<token> to carry on from the last answer.
 * Answers { configured, live, video, chat, messages, page, pollMs }.
 *
 * Quota: YouTube allows 10,000 units a day; a chat read costs 5 and the
 * stream's details 1, so the overlay polls no faster than YouTube asks and
 * never under every few seconds. Finding the live stream from a channel
 * uses the channel's public /live page, which costs nothing.
 */

const API = "https://www.googleapis.com/youtube/v3";
/** How long a channel's live stream, and a stream's chat id, are remembered. */
const LIVE_CACHE_MS = 60_000;
const VIDEO_CACHE_MS = 5 * 60_000;
/** Never asked faster than this, to keep within the day's quota. */
const MIN_POLL_MS = 5000;

interface Message {
  id: string;
  author: string;
  avatar?: string;
  text: string;
  at: number;
  owner?: boolean;
  moderator?: boolean;
  member?: boolean;
  /** A Super Chat or Super Sticker: the amount as YouTube writes it. */
  amount?: string;
}

/** A video id from an id or any YouTube link to it. */
function videoIdOf(v: string): string | undefined {
  const s = v.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:v=|youtu\.be\/|\/live\/|\/shorts\/|\/embed\/)([\w-]{11})/);
  return m?.[1];
}

/** The path of a channel's page from a handle, a channel id or a link to it. */
function channelPathOf(c: string): string | undefined {
  const s = c.trim().replace(/\/+$/, "");
  const fromUrl = s.match(/youtube\.com\/((?:@[\w.-]+)|(?:channel\/UC[\w-]{22})|(?:c\/[\w.-]+))/);
  if (fromUrl) return fromUrl[1];
  if (/^@[\w.-]+$/.test(s)) return s;
  if (/^UC[\w-]{22}$/.test(s)) return `channel/${s}`;
  if (/^[\w.-]+$/.test(s)) return `@${s}`;
  return undefined;
}

async function cached<T>(key: string, maxAge: number, load: () => Promise<T>): Promise<T> {
  const hit = await getJSON<{ at: number; value: T }>(key);
  if (hit && Date.now() - hit.at < maxAge) return hit.value;
  const value = await load();
  await setJSON(key, { at: Date.now(), value });
  return value;
}

/** The video a channel is live with now, from its public /live page - free, no quota. */
async function liveVideoOf(channelPath: string): Promise<string | null> {
  const res = await fetch(`https://www.youtube.com/${channelPath}/live`, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36", "Accept-Language": "en" },
  });
  if (!res.ok) return null;
  const html = await res.text();
  // Live (or about to be): the page is the stream's own watch page.
  const canonical = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/);
  if (!canonical) return null;
  return /"isLiveNow":true|"isLive":true|"liveStreamability"/.test(html) ? canonical[1] : null;
}

async function youtube<T>(path: string, params: Record<string, string>, key: string): Promise<T> {
  const res = await fetch(`${API}/${path}?${new URLSearchParams({ ...params, key })}`);
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; errors?: { reason?: string }[] } };
  if (!res.ok) {
    const reason = body.error?.errors?.[0]?.reason;
    throw Object.assign(new Error(body.error?.message ?? `YouTube ${res.status}`), { reason, status: res.status });
  }
  return body;
}

interface VideoInfo {
  title?: string;
  channel?: string;
  chat?: string;
}

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
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    res.status(200).json({ configured: false });
    return;
  }

  try {
    // Which stream: the one asked for, or the channel's live one now.
    let video = videoIdOf(String(req.query.video ?? ""));
    if (!video && req.query.channel) {
      const path = channelPathOf(String(req.query.channel));
      if (!path) {
        res.status(200).json({ configured: true, live: false, error: "That doesn't look like a YouTube channel - use your @handle." });
        return;
      }
      video = (await cached(`youtube:live:${path.toLowerCase()}`, LIVE_CACHE_MS, () => liveVideoOf(path))) ?? undefined;
    }
    if (!video) {
      res.status(200).json({ configured: true, live: false });
      return;
    }

    const info = await cached<VideoInfo>(`youtube:video:${video}`, VIDEO_CACHE_MS, async () => {
      const v = await youtube<{ items?: { snippet?: { title?: string; channelTitle?: string }; liveStreamingDetails?: { activeLiveChatId?: string } }[] }>(
        "videos",
        { part: "snippet,liveStreamingDetails", id: video! },
        key,
      );
      const item = v.items?.[0];
      return { title: item?.snippet?.title, channel: item?.snippet?.channelTitle, chat: item?.liveStreamingDetails?.activeLiveChatId };
    });
    const chat = String(req.query.chat ?? "") || info.chat;
    if (!chat) {
      res.status(200).json({ configured: true, live: false, video: { id: video, title: info.title }, error: "This stream has no live chat (it may have ended)." });
      return;
    }

    const page = String(req.query.page ?? "");
    const list = await youtube<{
      items?: {
        id: string;
        snippet?: {
          publishedAt?: string;
          displayMessage?: string;
          superChatDetails?: { amountDisplayString?: string; userComment?: string };
          superStickerDetails?: { amountDisplayString?: string };
        };
        authorDetails?: { displayName?: string; profileImageUrl?: string; isChatOwner?: boolean; isChatModerator?: boolean; isChatSponsor?: boolean };
      }[];
      nextPageToken?: string;
      pollingIntervalMillis?: number;
    }>("liveChat/messages", { liveChatId: chat, part: "snippet,authorDetails", maxResults: "200", ...(page ? { pageToken: page } : {}) }, key);

    const messages: Message[] = (list.items ?? []).map((m) => ({
      id: m.id,
      author: m.authorDetails?.displayName ?? "Someone",
      avatar: m.authorDetails?.profileImageUrl,
      text: m.snippet?.superChatDetails?.userComment ?? m.snippet?.displayMessage ?? "",
      at: m.snippet?.publishedAt ? Date.parse(m.snippet.publishedAt) : Date.now(),
      owner: m.authorDetails?.isChatOwner || undefined,
      moderator: m.authorDetails?.isChatModerator || undefined,
      member: m.authorDetails?.isChatSponsor || undefined,
      amount: m.snippet?.superChatDetails?.amountDisplayString ?? m.snippet?.superStickerDetails?.amountDisplayString,
    }));
    res.status(200).json({
      configured: true,
      live: true,
      video: { id: video, title: info.title, channel: info.channel },
      chat,
      messages,
      page: list.nextPageToken,
      pollMs: Math.max(MIN_POLL_MS, list.pollingIntervalMillis ?? MIN_POLL_MS),
    });
  } catch (e) {
    const err = e as Error & { reason?: string };
    const quota = err.reason === "quotaExceeded" || err.reason === "dailyLimitExceeded";
    res.status(200).json({
      configured: true,
      live: false,
      error: quota ? "YouTube's daily allowance for chat reading is used up - it resets at midnight Pacific time." : err.message,
      ended: err.reason === "liveChatEnded" || err.reason === "liveChatNotFound" || undefined,
    });
  }
}
