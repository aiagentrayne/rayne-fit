import { z } from "zod";
import { db } from "@/server/db";
import { authed, bestEffort, body, json } from "@/server/http";
import { planForUser, removeSubscription, saveSubscription } from "@/server/notifications";

export const dynamic = "force-dynamic";

const subSchema = z.object({
  endpoint: z.string().url().max(2000).refine((u) => u.startsWith("https://"), "Push endpoint must be HTTPS"),
  keys: z.object({ p256dh: z.string().min(10).max(500), auth: z.string().min(4).max(200) }),
});

export const GET = authed(async () => json({ publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null }));

export const POST = authed(async (userId, req) => {
  const sub = await body(req, subSchema);
  const sql = db();
  await saveSubscription(sql, userId, { endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: req.headers.get("user-agent")?.slice(0, 300) });
  await bestEffort("replan", () => planForUser(sql, userId, new Date()));
  return json({ ok: true });
});

export const DELETE = authed(async (userId, req) => {
  const { endpoint } = await body(req, z.object({ endpoint: z.string().url() }));
  await removeSubscription(db(), userId, endpoint);
  return json({ ok: true });
});
