import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSessionEmail } from "./_lib/session.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const email = getSessionEmail(req);
  res.status(200).json(email ? { authenticated: true, email } : { authenticated: false });
}
