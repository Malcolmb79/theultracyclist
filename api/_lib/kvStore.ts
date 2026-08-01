import { createClient } from "redis";

// Instant, no-redeploy replacement for vercelEnvStore.ts's
// persistEnvVar/triggerDeployHook pair - that mechanism writes to a Vercel
// project env var (only readable after a fresh deployment), so every save
// meant waiting out a full production redeploy, and rapid saves could race
// each other. Redis (REDIS_URL, provisioned via Vercel's Redis marketplace
// integration) gives a plain instant read/write instead.
type RedisClient = ReturnType<typeof createClient>;

let clientPromise: Promise<RedisClient> | null = null;

/**
 * How long any single Redis command may take before it is given up on.
 *
 * node-redis queues commands while it is reconnecting, and if the connection
 * never comes back those commands sit in the queue forever - the request does
 * not fail, it simply never answers. That is what took the dashboards down:
 * /api/coaching-settings hung indefinitely while every endpoint that touches
 * no Redis carried on returning normally, so the page sat on a spinner with no
 * error to show for it. Failing in two seconds is always better than not
 * failing at all.
 */
const COMMAND_TIMEOUT_MS = 2000;

/** Redis could not answer - distinct from "the key isn't there". */
export class KvUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KvUnavailableError";
  }
}

function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    work,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new KvUnavailableError(`Redis ${label} timed out`)), COMMAND_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

function getClient(): Promise<RedisClient> | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  if (!clientPromise) {
    const client = createClient({ url });
    client.on("error", (err) => console.error("Redis client error", err));
    // A rejected connect used to be cached forever, so one bad start meant
    // every later call in that instance inherited the same failure. Clearing
    // it lets the next caller try again from scratch.
    clientPromise = client.connect().then(
      () => client,
      (error) => {
        clientPromise = null;
        throw error;
      },
    );
  }
  return clientPromise;
}

/** Throws away the cached client so the next call reconnects. */
function resetClient(): void {
  clientPromise = null;
}

async function command<T>(label: string, run: (client: RedisClient) => Promise<T>): Promise<T> {
  const promise = getClient();
  if (!promise) throw new KvUnavailableError("REDIS_URL is not configured");

  try {
    const client = await withTimeout(promise, "connect");
    return await withTimeout(run(client), label);
  } catch (error) {
    // A timed-out command means this client is wedged, not that the key was
    // slow. Dropping it is what stops the next request queueing behind the
    // same dead connection.
    if (error instanceof KvUnavailableError) resetClient();
    throw error;
  }
}

/**
 * Reads a key, or throws if the store itself is unreachable.
 *
 * Use this anywhere the value is about to be merged and written back. Treating
 * an unreachable store as "no data" there means writing a fresh, empty record
 * over a perfectly good one - which is how a read-modify-write turns a
 * transient Redis blip into permanent data loss.
 */
export async function readJSON<T>(key: string): Promise<T | null> {
  const raw = await command(`get ${key}`, (client) => client.get(key));
  return raw == null ? null : (JSON.parse(raw) as T);
}

// Returns null both when the key doesn't exist yet and when Redis is
// unreachable/unconfigured - callers use that uniformly as "fall back to
// the legacy env var value" (see vercelEnvStore.ts's read path), which is
// the right behavior in both cases: a fresh key during migration, or a
// transient outage, should both serve the last known-good value rather
// than error out.
//
// Only safe for read-only paths. If the value is going to be written back,
// use readJSON and let the failure surface.
export async function getJSON<T>(key: string): Promise<T | null> {
  try {
    return await readJSON<T>(key);
  } catch (error) {
    console.error(`Failed to read ${key} from Redis`, error);
    return null;
  }
}

export async function setJSON(key: string, value: unknown): Promise<boolean> {
  try {
    await command(`set ${key}`, (client) => client.set(key, JSON.stringify(value)));
    return true;
  } catch (error) {
    console.error(`Failed to write ${key} to Redis`, error);
    return false;
  }
}
