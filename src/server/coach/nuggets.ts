/**
 * One short coaching nugget per day, generated shortly before its send time inside the user's
 * window and always saved to the dashboard (even if the push never arrives). If OpenAI is
 * unavailable, a plain template nugget built from the user's real numbers is saved instead,
 * clearly marked as such.
 */
import type { Sql } from "../db";
import { getSettings, type UserSettings } from "../settings";
import { AiUnavailableError, aiConfigured, callJson, MODELS } from "../llm";
import { buildContext } from "./context";
import { NUGGET_INSTRUCTIONS, nuggetSchema } from "./prompts";
import { currentDay, cutoffInstant } from "@/lib/core/days";
import { addMinutes, type LocalDate } from "@/lib/core/time";
import { nuggetFingerprint, nuggetTime, outOfQuietHours, pickNuggetCategory, stableHash, type NuggetCategory } from "@/lib/core/coach";

/** Nuggets are prepared up to this long before their send time. */
export const PREPARE_AHEAD_MINUTES = 90;

export interface Nugget {
  id: string;
  date: LocalDate;
  category: NuggetCategory;
  body: string;
  grounding: string[];
  fallback: boolean;
  scheduledFor: string;
  readAt: string | null;
}

type Row = Record<string, unknown>;
export const mapNugget = (r: Row): Nugget => ({
  id: r.id as string,
  date: r.local_date as LocalDate,
  category: r.category as NuggetCategory,
  body: r.body as string,
  grounding: (r.grounding as string[]) ?? [],
  fallback: Boolean(r.fallback),
  scheduledFor: (r.scheduled_for as Date).toISOString(),
  readAt: r.read_at ? (r.read_at as Date).toISOString() : null,
});

export function nuggetSendAt(userId: string, date: LocalDate, s: UserSettings): Date {
  const at = nuggetTime(userId, date, s.nuggetWindowStart, s.nuggetWindowEnd, s.timezone);
  return outOfQuietHours(at, { start: s.rossQuietStart, end: s.rossQuietEnd, timezone: s.timezone });
}

const EDUCATIONAL = [
  "Make the first step of a habit tiny enough that you can't say no: shoes on, mat out, one page open. Starting is the hard part; momentum does the rest.",
  "Decide the when and where in advance. \"After coffee, at the kitchen table, I plan tomorrow\" beats \"I'll plan sometime.\"",
  "Missing once is an accident; missing twice starts a new pattern. If yesterday slipped, today's job is just to get back on the board.",
  "Protect sleep like a work appointment. A consistent wake time does more for energy than an occasional long lie-in.",
  "Make the right move the easy move: lay out gear the night before, keep the distraction in another room.",
  "Track it where you'll see it. What gets checked daily gets done more often than what lives in your head.",
  "Hard day? Do the minimum version of the habit. A 10-minute walk still counts and keeps the identity intact.",
  "Stack a new habit onto one you already do every day. The old habit becomes the reminder.",
];
const MOTIVATIONAL = [
  "Every YES today is a vote for the person you said you want to become. Cast a few.",
  "You don't need a perfect day. You need an honest one. Go earn the checkmarks you can.",
  "Discipline is just keeping promises to yourself. Keep one before noon.",
  "Nobody builds anything solid in one pour. Today is one more layer.",
  "Show up for the boring version of the work. That's where the results are.",
];

/** A template nugget from real numbers, used when AI is off or fails. */
export function fallbackNugget(category: NuggetCategory, citable: string[], date: LocalDate): { category: NuggetCategory; body: string; grounding: string[] } {
  const h = stableHash(date);
  if (category === "accountability" && citable.length) {
    const fact = citable[h % citable.length];
    return { category, body: `${fact}. Pick the one action that moves that number today and get it done early.`, grounding: [fact] };
  }
  if (category === "motivational") return { category, body: MOTIVATIONAL[h % MOTIVATIONAL.length], grounding: [] };
  return { category: "educational", body: EDUCATIONAL[h % EDUCATIONAL.length], grounding: [] };
}

export async function getNugget(sql: Sql, userId: string, date: LocalDate): Promise<Nugget | null> {
  const [r] = await sql`select * from nuggets where user_id = ${userId} and local_date = ${date}`;
  return r ? mapNugget(r) : null;
}

/**
 * Creates today's nugget once it's within PREPARE_AHEAD_MINUTES of its send time (or when
 * `force` is set, e.g. the user opened the dashboard after the window). Returns whether an AI
 * call was made, so the scheduler can limit work per tick.
 */
export async function ensureNugget(sql: Sql, userId: string, now: Date, opts: { force?: boolean; settings?: UserSettings } = {}): Promise<{ nugget: Nugget | null; usedAi: boolean }> {
  const s = opts.settings ?? (await getSettings(sql, userId, { now }));
  if (!s.rossEnabled || !s.nuggetEnabled) return { nugget: null, usedAi: false };
  const date = currentDay(now, s);
  const existing = await getNugget(sql, userId, date);
  if (existing) return { nugget: existing, usedAi: false };
  const sendAt = nuggetSendAt(userId, date, s);
  const due = now.getTime() >= addMinutes(sendAt, -PREPARE_AHEAD_MINUTES).getTime();
  if (!due && !opts.force) return { nugget: null, usedAi: false };
  if (now.getTime() >= cutoffInstant(date, s).getTime()) return { nugget: null, usedAi: false };

  const recent = await sql`select category, body from nuggets where user_id = ${userId} order by local_date desc limit 14`;
  const ctx = await buildContext(sql, userId, date, s, { days: 14, forNugget: true });
  const category = pickNuggetCategory(recent.map((r) => r.category as NuggetCategory), date, ctx.citable.length > 0);
  const seen = new Set(recent.map((r) => nuggetFingerprint(r.body as string)));

  let made: { category: NuggetCategory; body: string; grounding: string[] } | null = null;
  let model: string | null = null;
  let usedAi = false;
  if (aiConfigured()) {
    usedAi = true;
    try {
      model = MODELS.nugget();
      const instructions = NUGGET_INSTRUCTIONS.replace("{CATEGORY}", category).replace(
        "{LOW_STATE}",
        ctx.lowState ? "The user recently reported low mood or high stress: be supportive and gentle today; no challenges." : "",
      );
      const recentText = recent.length ? `\n\n# Recent nuggets (do not repeat)\n${recent.map((r) => `- ${r.body}`).join("\n")}` : "";
      const r = await callJson<{ body: string; category: NuggetCategory; based_on: string[] }>(sql, {
        userId,
        purpose: "nugget",
        model,
        instructions: `${instructions}\n\n# Facts about this user (computed by Rayne Fit)\n${ctx.text}${recentText}`,
        input: [{ role: "user", content: "Write today's nugget." }],
        schemaName: "ross_nugget",
        schema: nuggetSchema as unknown as Record<string, unknown>,
        maxOutputTokens: 600,
      });
      const body = (r.body ?? "").trim();
      if (body.length >= 20 && body.length <= 480 && !seen.has(nuggetFingerprint(body))) {
        made = { category: r.category ?? category, body, grounding: (r.based_on ?? []).slice(0, 5).map((x) => String(x).slice(0, 200)) };
      }
    } catch (e) {
      if (!(e instanceof AiUnavailableError)) console.error("[nugget]", e);
    }
  }
  const fallback = !made;
  if (!made) made = fallbackNugget(category, ctx.citable, date);
  await sql`insert into nuggets (user_id, local_date, category, body, grounding, model, fallback, scheduled_for)
            values (${userId}, ${date}, ${made.category}, ${made.body}, ${sql.json(made.grounding as never)}, ${fallback ? null : model}, ${fallback}, ${sendAt})
            on conflict (user_id, local_date) do nothing`;
  return { nugget: await getNugget(sql, userId, date), usedAi };
}

export async function markNuggetRead(sql: Sql, userId: string, id: string, now = new Date()) {
  await sql`update nuggets set read_at = coalesce(read_at, ${now}) where id = ${id} and user_id = ${userId}`;
}

export async function recentNuggets(sql: Sql, userId: string, limit = 14): Promise<Nugget[]> {
  return (await sql`select * from nuggets where user_id = ${userId} order by local_date desc limit ${limit}`).map(mapNugget);
}

/** Prepares due nuggets for all ROSS users, making at most `aiLimit` AI calls per run. */
export async function prepareDueNuggets(sql: Sql, now: Date, aiLimit = 3): Promise<number> {
  const users = await sql`select user_id from user_settings where ross_enabled and nugget_enabled`;
  let made = 0;
  let ai = 0;
  for (const u of users) {
    if (ai >= aiLimit) break;
    try {
      const r = await ensureNugget(sql, u.user_id as string, now);
      if (r.usedAi) ai++;
      if (r.nugget) made++;
    } catch (e) {
      console.error("[prepareDueNuggets]", e);
    }
  }
  return made;
}
