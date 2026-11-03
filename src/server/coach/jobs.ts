/** Scheduler work for ROSS, run from the every-minute tick. Each step is idempotent. */
import type { Sql } from "../db";
import { getSettings } from "../settings";
import { ensureScheduledSessions } from "./sessions";
import { prepareDueNuggets } from "./nuggets";

/** Transcripts are kept 12 months (summaries stay); AI call logs 90 days. */
export async function applyRetention(sql: Sql) {
  const m = await sql`delete from coaching_messages where id in (select id from coaching_messages where created_at < now() - interval '12 months' limit 1000)`;
  const a = await sql`delete from ai_calls where id in (select id from ai_calls where created_at < now() - interval '90 days' limit 1000)`;
  return { messages: m.count, aiCalls: a.count };
}

export async function coachTick(sql: Sql, now: Date) {
  const users = await sql`select user_id from user_settings where ross_enabled`;
  for (const u of users) {
    try {
      const s = await getSettings(sql, u.user_id as string, { now });
      await ensureScheduledSessions(sql, u.user_id as string, s, now);
    } catch (e) {
      console.error("[coachTick sessions]", e);
    }
  }
  const nuggets = await prepareDueNuggets(sql, now).catch((e) => (console.error("[coachTick nuggets]", e), 0));
  // Retention runs a few times an hour; each pass is small.
  const retention = now.getUTCMinutes() % 15 === 7 ? await applyRetention(sql).catch(() => null) : null;
  return { rossUsers: users.length, nuggets, retention };
}
