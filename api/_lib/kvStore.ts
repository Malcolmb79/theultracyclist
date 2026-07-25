import { createClient } from "redis";

// Instant, no-redeploy replacement for vercelEnvStore.ts's
// persistEnvVar/triggerDeployHook pair - that mechanism writes to a Vercel
// project env var (only readable after a fresh deployment), so every save
// meant waiting out a full production redeploy, and rapid saves could race
// each other. Redis (REDIS_URL, provisioned via Vercel's Redis marketplace
// integration) gives a plain instant read/write instead.
type RedisClient = ReturnType<typeof createClient>;

let clientPromise: Promise<RedisClient> | null = null;

function getClient(): Promise<RedisClient> | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  if (!clientPromise) {
    const client = createClient({ url });
    client.on("error", (err) => console.error("Redis client error", err));
    clientPromise = client.connect().then(() => client);
  }
  return clientPromise;
}

// Returns null both when the key doesn't exist yet and when Redis is
// unreachable/unconfigured - callers use that uniformly as "fall back to
// the legacy env var value" (see vercelEnvStore.ts's read path), which is
// the right behavior in both cases: a fresh key during migration, or a
// transient outage, should both serve the last known-good value rather
// than error out.
export async function getJSON<T>(key: string): Promise<T | null> {
  const promise = getClient();
  if (!promise) return null;

  try {
    const client = await promise;
    const raw = await client.get(key);
    if (raw == null) return null;
    return JSON.parse(raw) as T;
  } catch (error) {
    console.error(`Failed to read ${key} from Redis`, error);
    return null;
  }
}

export async function setJSON(key: string, value: unknown): Promise<boolean> {
  const promise = getClient();
  if (!promise) return false;

  try {
    const client = await promise;
    await client.set(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error(`Failed to write ${key} to Redis`, error);
    return false;
  }
}
