import { randomUUID, timingSafeEqual } from "node:crypto";
import { db } from "@/server/db";
import { json, open } from "@/server/http";
import { finalizeDueForAll } from "@/server/days";
import { dispatchDue, planForAll } from "@/server/notifications";
import { defaultSender } from "@/server/push";
import { coachTick } from "@/server/coach/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * The scheduler heartbeat. Call every minute (Supabase pg_cron + pg_net, or any cron).
 * 1) finalize days whose cutoff passed, 2) schedule ROSS interviews and prepare nuggets,
 * 3) plan today's reminders, 4) deliver due pushes.
 * Every step is idempotent, and a lease row prevents overlapping runs.
 */
async function tick(req: Request) {
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);
  const sql = db();
  const now = new Date();
  const holder = randomUUID();
  const lease = await sql`update job_leases set holder = ${holder}, expires_at = now() + interval '55 seconds'
                          where name = 'tick' and expires_at < now() returning name`;
  if (!lease.length) return json({ skipped: "another tick is running" });
  try {
    const finalized = await finalizeDueForAll(sql, now);
    const coach = await coachTick(sql, now).catch((e) => (console.error("[coachTick]", e), null));
    const users = await planForAll(sql, now);
    const dispatch = await dispatchDue(sql, defaultSender(), now);
    return json({ at: now.toISOString(), finalized, coach, users, dispatch });
  } finally {
    await sql`update job_leases set expires_at = '-infinity' where name = 'tick' and holder = ${holder}`;
  }
}

export const GET = open(tick);
export const POST = open(tick);
