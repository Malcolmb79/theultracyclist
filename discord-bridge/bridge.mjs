// The Ultra Cyclist Discord bridge: tells the Discord voice overlay in the
// Sauce for Zwift mod who's in your voice channel, who's talking, and who's
// muted - the same things Discord's StreamKit shows in OBS.
//
// A Sauce mod is only web pages, and the Discord app only shares voice
// activity over its local IPC connection (a named pipe), which a web page
// can't open. So this small program sits between them: it talks to Discord
// over IPC as your own Discord application, and serves what it hears to the
// overlay at http://127.0.0.1:<port>/events, on this computer only.
//
// Needs Node.js 18 or newer, and nothing else. Run start.bat (or
// `node bridge.mjs`); the first run asks for your Discord application's
// client ID and secret and keeps them in config.json beside this file.

import { createServer } from "node:http";
import { connect } from "node:net";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = join(HERE, "config.json");
const TOKEN_FILE = join(HERE, "token.json");
const DEFAULT_PORT = 8723;
const SCOPES = ["rpc", "rpc.voice.read"];
const RETRY_MS = 5000;

// ----- Settings -----

async function loadConfig() {
  const config = existsSync(CONFIG_FILE) ? JSON.parse(readFileSync(CONFIG_FILE, "utf8")) : {};
  if (config.clientId && config.clientSecret) return { port: DEFAULT_PORT, redirectUri: "http://localhost", ...config };
  console.log(`
First run: this needs your own Discord application (free, takes a minute).

  1. Open https://discord.com/developers/applications and click "New Application".
     Name it anything, e.g. "Ultra Cyclist overlay".
  2. Under OAuth2, copy the Client ID, then "Reset Secret" and copy the Client Secret.
  3. Still under OAuth2, in Redirects, add:  http://localhost   and save.
`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const clientId = (await rl.question("Client ID: ")).trim();
  const clientSecret = (await rl.question("Client Secret: ")).trim();
  rl.close();
  const saved = { clientId, clientSecret, redirectUri: "http://localhost", port: DEFAULT_PORT };
  writeFileSync(CONFIG_FILE, JSON.stringify(saved, null, 2));
  console.log(`Saved to ${CONFIG_FILE}\n`);
  return saved;
}

const config = await loadConfig();
const API = config.apiBase ?? "https://discord.com/api";

// ----- What the overlay is told -----

/** The voice channel and who's in it, as the overlay shows it. */
const state = { status: "starting", message: "Starting…", channel: null, members: new Map() };
const listeners = new Set();

function snapshot() {
  return {
    status: state.status,
    message: state.message,
    channel: state.channel,
    members: Array.from(state.members.values()),
  };
}

function publish() {
  const data = `data: ${JSON.stringify(snapshot())}\n\n`;
  for (const res of listeners) res.write(data);
}

function setStatus(status, message) {
  if (state.status === status && state.message === message) return;
  state.status = status;
  state.message = message;
  console.log(`[${status}] ${message}`);
  publish();
}

function avatarUrl(user) {
  if (user.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
  // Discord's default avatars, picked from the user's id.
  const index = Number((BigInt(user.id) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

/** One person in the channel, from a Discord voice state. */
function member(vs, speaking = false) {
  const v = vs.voice_state ?? {};
  return {
    id: vs.user.id,
    name: vs.nick || vs.user.global_name || vs.user.username,
    avatar: avatarUrl(vs.user),
    speaking,
    mute: !!(v.self_mute || v.mute || v.suppress),
    deaf: !!(v.self_deaf || v.deaf),
  };
}

// ----- Discord's IPC connection -----

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };

function pipePath(i) {
  if (process.platform === "win32") return `\\\\?\\pipe\\discord-ipc-${i}`;
  const dir = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || "/tmp";
  return join(dir.replace(/\/$/, ""), `discord-ipc-${i}`);
}

function tryPipe(i) {
  return new Promise((resolve, reject) => {
    const sock = connect(pipePath(i));
    sock.once("connect", () => resolve(sock));
    sock.once("error", reject);
  });
}

async function openPipe() {
  for (let i = 0; i < 10; i++) {
    try {
      return await tryPipe(i);
    } catch {
      // Not this one; Discord takes the first free number.
    }
  }
  return null;
}

class Ipc {
  constructor(sock) {
    this.sock = sock;
    this.buf = Buffer.alloc(0);
    this.pending = new Map();
    this.nonce = 0;
    this.onDispatch = () => undefined;
    this.onReady = () => undefined;
    this.onClose = () => undefined;
    sock.on("data", (chunk) => this.read(chunk));
    sock.on("close", () => {
      for (const { reject } of this.pending.values()) reject(new Error("Discord closed the connection"));
      this.pending.clear();
      this.onClose();
    });
    sock.on("error", () => undefined);
  }

  write(op, payload) {
    const body = Buffer.from(JSON.stringify(payload));
    const head = Buffer.alloc(8);
    head.writeInt32LE(op, 0);
    head.writeInt32LE(body.length, 4);
    this.sock.write(Buffer.concat([head, body]));
  }

  read(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= 8) {
      const op = this.buf.readInt32LE(0);
      const len = this.buf.readInt32LE(4);
      if (this.buf.length < 8 + len) return;
      const msg = JSON.parse(this.buf.subarray(8, 8 + len).toString("utf8"));
      this.buf = this.buf.subarray(8 + len);
      this.handle(op, msg);
    }
  }

  handle(op, msg) {
    if (op === OP.PING) return this.write(OP.PONG, msg);
    if (op === OP.CLOSE) {
      setStatus("error", `Discord refused the connection: ${msg.message ?? msg.code}`);
      return this.sock.end();
    }
    if (msg.cmd === "DISPATCH" && msg.evt === "READY") return this.onReady(msg.data);
    if (msg.cmd === "DISPATCH") return this.onDispatch(msg.evt, msg.data);
    const wait = msg.nonce && this.pending.get(msg.nonce);
    if (!wait) return;
    this.pending.delete(msg.nonce);
    if (msg.evt === "ERROR") wait.reject(Object.assign(new Error(msg.data?.message ?? "Discord error"), { code: msg.data?.code }));
    else wait.resolve(msg.data);
  }

  send(cmd, args = {}, evt) {
    const nonce = String(++this.nonce);
    return new Promise((resolve, reject) => {
      this.pending.set(nonce, { resolve, reject });
      this.write(OP.FRAME, { cmd, args, evt, nonce });
    });
  }
}

// ----- Signing in to Discord as your application -----

function loadToken() {
  try {
    return JSON.parse(readFileSync(TOKEN_FILE, "utf8"));
  } catch {
    return null;
  }
}

function saveToken(t) {
  const token = { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + (t.expires_in ?? 604800) * 1000 };
  writeFileSync(TOKEN_FILE, JSON.stringify(token, null, 2));
  return token;
}

async function tokenRequest(fields) {
  const body = new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...fields });
  const res = await fetch(`${API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Discord sign-in failed: ${json.error_description ?? json.error ?? res.status}`);
  return json;
}

async function newToken(ipc) {
  setStatus("authorising", "Approve the request in Discord to let the overlay see your voice channel");
  const { code } = await ipc.send("AUTHORIZE", { client_id: config.clientId, scopes: SCOPES });
  try {
    return saveToken(await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: config.redirectUri }));
  } catch (err) {
    if (!/redirect/i.test(err.message)) throw err;
    // Some Discord apps take the code without a redirect.
    return saveToken(await tokenRequest({ grant_type: "authorization_code", code }));
  }
}

async function signIn(ipc) {
  let token = loadToken();
  if (token && token.expires_at < Date.now() + 60_000 && token.refresh_token) {
    token = await tokenRequest({ grant_type: "refresh_token", refresh_token: token.refresh_token })
      .then(saveToken)
      .catch(() => null);
  }
  if (token) {
    try {
      return await ipc.send("AUTHENTICATE", { access_token: token.access_token });
    } catch {
      // Revoked or out of date: ask again.
    }
  }
  token = await newToken(ipc);
  return ipc.send("AUTHENTICATE", { access_token: token.access_token });
}

// ----- Following the voice channel -----

const CHANNEL_EVENTS = ["VOICE_STATE_CREATE", "VOICE_STATE_UPDATE", "VOICE_STATE_DELETE", "SPEAKING_START", "SPEAKING_STOP"];

async function follow(ipc, channel) {
  const old = state.channel?.id;
  if (old && old !== channel?.id) {
    for (const evt of CHANNEL_EVENTS) await ipc.send("UNSUBSCRIBE", { channel_id: old }, evt).catch(() => undefined);
  }
  state.members.clear();
  if (!channel) {
    state.channel = null;
    setStatus("idle", "Not in a voice channel");
    return publish();
  }
  state.channel = { id: channel.id, name: channel.name };
  for (const vs of channel.voice_states ?? []) state.members.set(vs.user.id, member(vs));
  if (old !== channel.id) {
    for (const evt of CHANNEL_EVENTS) await ipc.send("SUBSCRIBE", { channel_id: channel.id }, evt).catch(() => undefined);
  }
  setStatus("ready", `In ${channel.name}`);
  publish();
}

function onDispatch(ipc, evt, data) {
  if (evt === "VOICE_CHANNEL_SELECT") {
    if (!data?.channel_id) return void follow(ipc, null);
    return void ipc.send("GET_CHANNEL", { channel_id: data.channel_id }).then((ch) => follow(ipc, ch)).catch(() => undefined);
  }
  if (evt === "VOICE_STATE_CREATE" || evt === "VOICE_STATE_UPDATE") {
    const was = state.members.get(data.user.id);
    state.members.set(data.user.id, member(data, was?.speaking));
  } else if (evt === "VOICE_STATE_DELETE") {
    state.members.delete(data.user.id);
  } else if (evt === "SPEAKING_START" || evt === "SPEAKING_STOP") {
    const m = state.members.get(data.user_id);
    if (m) m.speaking = evt === "SPEAKING_START";
  } else {
    return;
  }
  publish();
}

async function run() {
  const sock = await openPipe();
  if (!sock) {
    setStatus("no-discord", "Waiting for the Discord app…");
    return setTimeout(run, RETRY_MS);
  }
  const ipc = new Ipc(sock);
  ipc.onClose = () => {
    state.channel = null;
    state.members.clear();
    setStatus("no-discord", "Discord closed - waiting for it…");
    setTimeout(run, RETRY_MS);
  };
  ipc.onDispatch = (evt, data) => onDispatch(ipc, evt, data);
  ipc.onReady = async () => {
    try {
      setStatus("connecting", "Signing in to Discord…");
      await signIn(ipc);
      await ipc.send("SUBSCRIBE", {}, "VOICE_CHANNEL_SELECT");
      await follow(ipc, await ipc.send("GET_SELECTED_VOICE_CHANNEL"));
    } catch (err) {
      setStatus("error", err.message);
      sock.end();
    }
  };
  ipc.write(OP.HANDSHAKE, { v: 1, client_id: config.clientId });
}

// ----- The overlay's feed, on this computer only -----

/** Only Sauce's own pages (and local files) may read the feed - not any website you visit. */
function allowedOrigin(origin) {
  if (!origin || origin === "null") return "null";
  try {
    const u = new URL(origin);
    return ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) ? origin : null;
  } catch {
    return null;
  }
}

const server = createServer((req, res) => {
  const origin = allowedOrigin(req.headers.origin);
  if (!origin) {
    res.writeHead(403).end();
    return;
  }
  const cors = { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
  const path = new URL(req.url, "http://localhost").pathname;
  if (path === "/events") {
    res.writeHead(200, { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(`retry: 3000\ndata: ${JSON.stringify(snapshot())}\n\n`);
    listeners.add(res);
    const beat = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
    req.on("close", () => {
      clearInterval(beat);
      listeners.delete(res);
    });
    return;
  }
  if (path === "/state") {
    res.writeHead(200, { ...cors, "Content-Type": "application/json" }).end(JSON.stringify(snapshot()));
    return;
  }
  res.writeHead(404, cors).end();
});

server.on("error", (err) => {
  console.error(err.code === "EADDRINUSE" ? `Port ${config.port} is in use - is the bridge already running?` : err.message);
  process.exit(1);
});
server.listen(config.port, "127.0.0.1", () => {
  console.log(`Ultra Cyclist Discord bridge on http://127.0.0.1:${config.port} - leave this window open while you ride.`);
  run();
});
