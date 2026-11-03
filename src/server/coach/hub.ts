/** Read models for the Coach and Progress screens, coaching memory, and data deletion. */
import { z } from "zod";
import { tx, type Sql } from "../db";
import { getSettings } from "../settings";
import { NotFoundError } from "../items";
import { aiConfigured } from "../llm";
import { getVision, listMilestones, visionHistory } from "../vision";
import { listProposals } from "../proposals";
import { getCheckins, periodMeasurables, reviewFor } from "../tracking";
import { ensureNugget, getNugget, nuggetSendAt, recentNuggets } from "./nuggets";
import { ensureScheduledSessions, listCommitments, listSessions, openScheduledSessions, participation } from "./sessions";
import { currentDay } from "@/lib/core/days";
import { addDays, type LocalDate } from "@/lib/core/time";
import { average, checkinObservations, METRICS, type DayObservation, type Metric } from "@/lib/core/coach";

export async function getCoachHub(sql: Sql, userId: string, now: Date) {
  const s = await getSettings(sql, userId, { now });
  const today = currentDay(now, s);
  if (s.rossEnabled) await ensureScheduledSessions(sql, userId, s, now);
  let nugget = s.rossEnabled ? await getNugget(sql, userId, today) : null;
  // Opened after the send time but the nugget wasn't prepared (for example a missed tick)?
  if (s.rossEnabled && s.nuggetEnabled && !nugget && now >= nuggetSendAt(userId, today, s)) {
    nugget = (await ensureNugget(sql, userId, now, { force: true, settings: s }).catch(() => ({ nugget: null }))).nugget;
  }
  const [mem] = await sql`select count(*)::int as n from coaching_memory where user_id = ${userId} and status = 'active'`;
  return {
    today,
    ross: {
      enabled: s.rossEnabled,
      consentAt: s.rossConsentAt,
      aiConfigured: aiConfigured(),
      shareCheckins: s.rossShareCheckins,
      shareJournal: s.rossShareJournal,
    },
    vision: await getVision(sql, userId),
    visionHistory: (await visionHistory(sql, userId)).slice(1, 6),
    milestones: await listMilestones(sql, userId),
    scheduled: await openScheduledSessions(sql, userId),
    recent: (await listSessions(sql, userId, 15)).filter((x) => x.status === "completed" || x.status === "missed" || (x.kind === "vision" && x.status === "in_progress")),
    proposals: await listProposals(sql, userId, "pending"),
    commitments: await listCommitments(sql, userId),
    nugget,
    nuggets: (await recentNuggets(sql, userId, 8)).filter((n) => n.date !== today),
    participation: await participation(sql, userId),
    memoryCount: mem.n as number,
  };
}

/** Dashboard extras: check-in status, period measurables, nugget and coaching prompts. */
export async function getDashboardCoach(sql: Sql, userId: string, today: LocalDate, now: Date) {
  const s = await getSettings(sql, userId, { now });
  const review = await reviewFor(sql, userId, today);
  const periods = await periodMeasurables(sql, userId, today, s);
  let nugget = null;
  let scheduled: Awaited<ReturnType<typeof openScheduledSessions>> = [];
  let pendingProposals = 0;
  if (s.rossEnabled) {
    nugget = await getNugget(sql, userId, today);
    if (!nugget && s.nuggetEnabled && now >= nuggetSendAt(userId, today, s)) {
      nugget = (await ensureNugget(sql, userId, now, { force: true, settings: s }).catch(() => ({ nugget: null }))).nugget;
    }
    scheduled = await openScheduledSessions(sql, userId);
    const [p] = await sql`select count(*)::int as n from proposals where user_id = ${userId} and status = 'pending'`;
    pendingProposals = p.n as number;
  }
  const [v] = await sql`select 1 from visions where user_id = ${userId} and status = 'active'`;
  return {
    rossEnabled: s.rossEnabled,
    hasVision: Boolean(v),
    review,
    periods,
    nugget,
    dueInterview: scheduled.find((x) => x.dueAt && new Date(x.dueAt) <= now) ?? null,
    nextInterview: scheduled.find((x) => x.dueAt && new Date(x.dueAt) > now) ?? null,
    pendingProposals,
  };
}

/** Progress: completion, check-in trends, observations and interview participation. */
export async function getProgress(sql: Sql, userId: string, now: Date) {
  const s = await getSettings(sql, userId, { now });
  const today = currentDay(now, s);
  const from = addDays(today, -89);
  const checkins = await getCheckins(sql, userId, from, today);
  const days = await sql`select local_date, status, score_pct from day_records where user_id = ${userId} and local_date between ${from} and ${today} order by local_date`;
  const byDate = new Map<string, DayObservation>();
  for (const d of days) byDate.set(d.local_date as string, { date: d.local_date as string, pct: d.status === "final" && d.score_pct != null ? Number(d.score_pct) : null, ratings: {} });
  const daily: { date: LocalDate; pct: number | null; energy: number | null; mood: number | null; stress: number | null; complete: boolean }[] = [];
  const ratingsByDate = new Map<string, Partial<Record<Metric, number>>>();
  for (const c of checkins) ratingsByDate.set(c.date, { ...(ratingsByDate.get(c.date) ?? {}), [c.metric]: c.rating });
  for (let d = addDays(today, -29); d <= today; d = addDays(d, 1)) {
    const r = ratingsByDate.get(d) ?? {};
    const obs = byDate.get(d);
    daily.push({ date: d, pct: obs?.pct ?? null, energy: r.energy ?? null, mood: r.mood ?? null, stress: r.stress ?? null, complete: METRICS.every((m) => r[m] !== undefined) });
  }
  for (const [d, r] of ratingsByDate) {
    const o = byDate.get(d);
    if (o) o.ratings = r;
  }
  const last = (n: number, m: Metric) => average(daily.slice(-n).map((x) => x[m]).filter((x): x is number => x !== null));
  const reviewDays = daily.filter((x) => x.date < today);
  return {
    today,
    daily,
    averages: Object.fromEntries(METRICS.map((m) => [m, { last7: last(7, m), last30: last(30, m) }])),
    reviewCompletion: { complete: reviewDays.filter((x) => x.complete).length, of: reviewDays.length },
    observations: checkinObservations([...byDate.values()]),
    periods: await periodMeasurables(sql, userId, today, s),
    participation: await participation(sql, userId),
    rossEnabled: s.rossEnabled,
  };
}

// ------------------------------------------------------------------ coaching memory

export async function listMemory(sql: Sql, userId: string) {
  const rows = await sql`select id, kind, text, status, edited_by_user, created_at, updated_at from coaching_memory where user_id = ${userId} order by status, updated_at desc`;
  return rows.map((r) => ({ id: r.id as string, kind: r.kind as string, text: r.text as string, status: r.status as string, editedByUser: Boolean(r.edited_by_user), updatedAt: (r.updated_at as Date).toISOString() }));
}

export const memoryPatchSchema = z.object({
  text: z.string().trim().min(1).max(500).optional(),
  kind: z.enum(["obstacle", "strategy", "preference", "fact"]).optional(),
  status: z.enum(["active", "archived"]).optional(),
});

export async function updateMemory(sql: Sql, userId: string, id: string, patch: z.infer<typeof memoryPatchSchema>) {
  const [cur] = await sql`select * from coaching_memory where id = ${id} and user_id = ${userId}`;
  if (!cur) throw new NotFoundError("Not found.");
  await sql`update coaching_memory set text = ${patch.text ?? (cur.text as string)}, kind = ${patch.kind ?? (cur.kind as string)},
            status = ${patch.status ?? (cur.status as string)}, edited_by_user = ${patch.text !== undefined || patch.kind !== undefined || Boolean(cur.edited_by_user)},
            updated_at = now() where id = ${id}`;
}

export async function addMemory(sql: Sql, userId: string, kind: string, text: string) {
  await sql`insert into coaching_memory (user_id, kind, text, edited_by_user) values (${userId}, ${kind}, ${text}, true)`;
}

export async function deleteMemory(sql: Sql, userId: string, id: string) {
  await sql`delete from coaching_memory where id = ${id} and user_id = ${userId}`;
}

// ------------------------------------------------------------------ deletion

const COACHING_TABLES = ["coaching_messages", "commitments", "proposals", "coaching_memory", "nuggets", "coaching_sessions", "safety_events", "ai_calls", "visions", "milestones"] as const;

/** Deletes everything ROSS knows (vision, milestones, interviews, memory, nuggets) and turns ROSS off. */
export async function deleteCoachingData(sql: Sql, userId: string) {
  await tx(sql, async (t) => {
    await t`update item_versions set milestone_id = null where user_id = ${userId} and milestone_id is not null`;
    for (const table of COACHING_TABLES) await t`delete from ${t(table)} where user_id = ${userId}`;
    await t`update notification_queue set status = 'cancelled', status_reason = 'coaching_data_deleted', updated_at = now()
            where user_id = ${userId} and status = 'pending' and kind in ('nugget', 'interview_due', 'interview_overdue')`;
    await t`update user_settings set ross_enabled = false, ross_consent_at = null, updated_at = now() where user_id = ${userId}`;
  });
}

const ALL_TABLES = [
  ...COACHING_TABLES, "checkins", "journal_entries", "measurable_logs", "notification_actions", "notification_attempts", "notification_queue",
  "push_subscriptions", "corrections", "response_events", "day_items", "day_records", "item_notification_rules", "item_versions", "items", "user_settings",
] as const;

/** Deletes every Rayne Fit record for the user (the sign-in itself is removed on request). */
export async function deleteAllUserData(sql: Sql, userId: string) {
  await tx(sql, async (t) => {
    for (const table of ALL_TABLES) await t`delete from ${t(table)} where user_id = ${userId}`;
  });
}

export const EXPORT_TABLES = [
  "user_settings", "items", "item_versions", "item_notification_rules", "day_records", "day_items", "corrections", "response_events",
  "checkins", "journal_entries", "measurable_logs", "visions", "milestones", "coaching_sessions", "coaching_messages", "commitments",
  "proposals", "nuggets", "coaching_memory", "ai_calls",
] as const;
