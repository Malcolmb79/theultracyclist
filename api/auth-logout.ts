import type { VercelRequest, VercelResponse } from "@vercel/node";
import { SESSION_COOKIE_NAME } from "./_lib/session.js";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  res.writeHead(302, { Location: "/dashboard" });
  res.end();
}
