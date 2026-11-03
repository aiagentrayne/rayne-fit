/** Daily check-ins (energy, mood, stress), journal notes, and weekly/monthly measurable logs. */
import { z } from "zod";
import type { Sql } from "./db";
import { getSettings, type UserSettings } from "./settings";
import { listItems, NotFoundError } from "./items";
import { HttpError } from "./auth";
import { currentDay } from "@/lib/core/days";
import { addDays, isLocalDate, monthRange, weekRange, type LocalDate } from "@/lib/core/time";
import { detectCrisis, reviewStatus, type Metric, type ReviewStatus } from "@/lib/core/coach";

/** Late entries are accepted for up to a week back; each keeps its real entry time. */
export const LATE_ENTRY_DAYS = 7;

export const checkinSchema = z.object({
  date: z.string().refine(isLocalDate, "Invalid date."),
  metric: z.enum(["energy", "mood", "stress"]),
  rating: z.number().int().min(1).max(5),
  note: z.string().trim().max(500).nullable().optional(),
});

export interface Checkin {
  date: LocalDate;
  metric: Metric;
  rating: number;
  note: string | null;
  recordedAt: string;
  late: boolean;
}

type Row = Record<string, unknown>;
const mapCheckin = (r: Row): Checkin => ({
  date: r.local_date as LocalDate,
  metric: r.metric as Metric,
  rating: Number(r.rating),
  note: (r.note as string) ?? null,
  recordedAt: (r.recorded_at as Date).toISOString(),
  late: Boolean(r.late),
});

function assertEditableDate(date: LocalDate, today: LocalDate) {
  if (date > today) throw new HttpError(400, "You can't check in for a future day.");
  if (date < addDays(today, -LATE_ENTRY_DAYS)) throw new HttpError(400, `Check-ins can be added up to ${LATE_ENTRY_DAYS} days late.`);
}

async function recordSafety(sql: Sql, userId: string, source: "journal" | "interview" | "model_flag", sessionId: string | null = null) {
  await sql`insert into safety_events (user_id, session_id, source) values (${userId}, ${sessionId}, ${source})`;
}

export async function saveCheckin(sql: Sql, userId: string, input: z.infer<typeof checkinSchema>, now = new Date()) {
  const s = await getSettings(sql, userId, { now });
  const today = currentDay(now, s);
  assertEditableDate(input.date, today);
  const late = input.date < today;
  const note = input.note?.trim() || null;
  await sql`
    insert into checkins (user_id, local_date, metric, rating, note, timezone, recorded_at, late)
    values (${userId}, ${input.date}, ${input.metric}, ${input.rating}, ${note}, ${s.timezone}, ${now}, ${late})
    on conflict (user_id, local_date, metric) do update set rating = excluded.rating, note = excluded.note,
      timezone = excluded.timezone, recorded_at = excluded.recorded_at, late = excluded.late, updated_at = now()`;
  const crisis = note ? detectCrisis(note) : false;
  if (crisis) await recordSafety(sql, userId, "journal");
  return { crisis };
}

export async function deleteCheckin(sql: Sql, userId: string, date: LocalDate, metric: Metric, now = new Date()) {
  const s = await getSettings(sql, userId, { now });
  assertEditableDate(date, currentDay(now, s));
  await sql`delete from checkins where user_id = ${userId} and local_date = ${date} and metric = ${metric}`;
}

export async function getCheckins(sql: Sql, userId: string, from: LocalDate, to: LocalDate): Promise<Checkin[]> {
  const rows = await sql`select * from checkins where user_id = ${userId} and local_date between ${from} and ${to} order by local_date, metric`;
  return rows.map(mapCheckin);
}

export const journalSchema = z.object({
  date: z.string().refine(isLocalDate, "Invalid date."),
  body: z.string().max(4000),
});

export async function saveJournal(sql: Sql, userId: string, date: LocalDate, body: string, now = new Date()) {
  const s = await getSettings(sql, userId, { now });
  assertEditableDate(date, currentDay(now, s));
  const text = body.trim();
  if (!text) {
    await sql`delete from journal_entries where user_id = ${userId} and local_date = ${date}`;
    return { crisis: false };
  }
  await sql`insert into journal_entries (user_id, local_date, body) values (${userId}, ${date}, ${text})
            on conflict (user_id, local_date) do update set body = excluded.body, updated_at = now()`;
  const crisis = detectCrisis(text);
  if (crisis) await recordSafety(sql, userId, "journal");
  return { crisis };
}

export async function getJournal(sql: Sql, userId: string, from: LocalDate, to: LocalDate) {
  const rows = await sql`select local_date, body, updated_at from journal_entries where user_id = ${userId} and local_date between ${from} and ${to} order by local_date`;
  return rows.map((r) => ({ date: r.local_date as LocalDate, body: r.body as string, updatedAt: (r.updated_at as Date).toISOString() }));
}

/** The check-in screen for one day: ratings, review completeness and the journal note. */
export async function getCheckinDay(sql: Sql, userId: string, date: LocalDate | null, now = new Date()) {
  const s = await getSettings(sql, userId, { now });
  const today = currentDay(now, s);
  const d = date ?? today;
  const checkins = await getCheckins(sql, userId, d, d);
  const [j] = await sql`select body from journal_entries where user_id = ${userId} and local_date = ${d}`;
  return {
    date: d,
    today,
    earliest: addDays(today, -LATE_ENTRY_DAYS),
    checkins,
    review: reviewStatus(checkins),
    journal: (j?.body as string) ?? "",
  };
}

export async function reviewFor(sql: Sql, userId: string, date: LocalDate): Promise<ReviewStatus> {
  return reviewStatus(await getCheckins(sql, userId, date, date));
}

// ------------------------------------------------------------------ weekly / monthly measurables

export interface PeriodMeasurable {
  itemId: string;
  name: string;
  category: string | null;
  cadence: "weekly" | "monthly";
  target: number;
  count: number;
  countToday: number;
  periodStart: LocalDate;
  periodEnd: LocalDate;
  met: boolean;
  /** Result of the previous period, for context. */
  previous: { count: number; target: number; met: boolean } | null;
  milestoneId: string | null;
}

export function periodFor(cadence: "weekly" | "monthly", date: LocalDate, weekStart: number) {
  return cadence === "weekly" ? weekRange(date, weekStart) : monthRange(date);
}

export async function periodMeasurables(sql: Sql, userId: string, today: LocalDate, settings: UserSettings): Promise<PeriodMeasurable[]> {
  const items = (await listItems(sql, userId)).filter((i) => i.status === "active" && i.current.cadence !== "daily");
  if (!items.length) return [];
  const from = addDays(monthRange(addDays(monthRange(today).start, -1)).start, -7);
  const logs = await sql`select item_id, local_date from measurable_logs where user_id = ${userId} and local_date >= ${from} and item_id in ${sql(items.map((i) => i.id))}`;
  return items.map((i) => {
    const cadence = i.current.cadence as "weekly" | "monthly";
    const target = i.current.targetCount ?? 1;
    const cur = periodFor(cadence, today, settings.weekStart);
    const prev = periodFor(cadence, addDays(cur.start, -1), settings.weekStart);
    const mine = logs.filter((l) => l.item_id === i.id).map((l) => l.local_date as LocalDate);
    const count = mine.filter((d) => d >= cur.start && d <= cur.end).length;
    const prevCount = mine.filter((d) => d >= prev.start && d <= prev.end).length;
    const startedBefore = i.current.startDate <= prev.end;
    return {
      itemId: i.id,
      name: i.current.name,
      category: i.current.category,
      cadence,
      target,
      count,
      countToday: mine.filter((d) => d === today).length,
      periodStart: cur.start,
      periodEnd: cur.end,
      met: count >= target,
      previous: startedBefore ? { count: prevCount, target, met: prevCount >= target } : null,
      milestoneId: i.current.milestoneId,
    };
  });
}

export const logSchema = z.object({
  itemId: z.string().uuid(),
  date: z.string().refine(isLocalDate, "Invalid date."),
  mutationId: z.string().min(8).max(100),
});

/** Logs one completion of a weekly/monthly measurable. Idempotent per mutation id. */
export async function logCompletion(sql: Sql, userId: string, input: z.infer<typeof logSchema>, now = new Date()) {
  const s = await getSettings(sql, userId, { now });
  assertEditableDate(input.date, currentDay(now, s));
  const item = (await listItems(sql, userId)).find((i) => i.id === input.itemId);
  if (!item || item.current.cadence === "daily") throw new NotFoundError("Measurable not found.");
  if (item.status !== "active") throw new HttpError(400, "This measurable is paused or archived.");
  await sql`insert into measurable_logs (user_id, item_id, local_date, mutation_id) values (${userId}, ${input.itemId}, ${input.date}, ${input.mutationId})
            on conflict (user_id, mutation_id) do nothing`;
}

/** Removes the most recent completion logged on `date` (an undo). */
export async function undoCompletion(sql: Sql, userId: string, itemId: string, date: LocalDate, now = new Date()) {
  const s = await getSettings(sql, userId, { now });
  assertEditableDate(date, currentDay(now, s));
  await sql`delete from measurable_logs where id = (
              select id from measurable_logs where user_id = ${userId} and item_id = ${itemId} and local_date = ${date}
              order by created_at desc limit 1)`;
}
