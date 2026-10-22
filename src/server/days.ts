import { tx, type Sql } from "./db";
import { getSettings, type UserSettings } from "./settings";
import { loadVersions } from "./items";
import { applicableVersions } from "@/lib/core/schedule";
import { cutoffInstant, currentDay } from "@/lib/core/days";
import { gradeFor } from "@/lib/core/grading";
import { pctFromCounts, type ResponseValue } from "@/lib/core/scoring";
import { addDays, type LocalDate } from "@/lib/core/time";

export interface DayRecord {
  date: LocalDate;
  status: "open" | "final";
  timezone: string;
  cutoffTime: string;
  cutoffAt: Date;
  applicable: number;
  yes: number;
  scorePct: number | null;
  grade: string | null;
  finalizedAt: Date | null;
}

export interface DayItem {
  itemId: string;
  itemVersionId: string;
  name: string;
  category: string | null;
  dueTime: string | null;
  position: number;
  response: ResponseValue;
  respondedAt: Date | null;
  source: string | null;
  autoFinalized: boolean;
}

type Row = Record<string, unknown>;

export function mapDay(r: Row): DayRecord {
  return {
    date: r.local_date as LocalDate,
    status: r.status as "open" | "final",
    timezone: r.timezone as string,
    cutoffTime: r.cutoff_time as string,
    cutoffAt: r.cutoff_at as Date,
    applicable: Number(r.applicable_count),
    yes: Number(r.yes_count),
    scorePct: r.score_pct == null ? null : Number(r.score_pct),
    grade: (r.grade as string) ?? null,
    finalizedAt: (r.finalized_at as Date) ?? null,
  };
}

export function mapDayItem(r: Row): DayItem {
  return {
    itemId: r.item_id as string,
    itemVersionId: r.item_version_id as string,
    name: r.name as string,
    category: (r.category as string) ?? null,
    dueTime: (r.due_time as string) ?? null,
    position: Number(r.position),
    response: (r.response as ResponseValue) ?? null,
    respondedAt: (r.responded_at as Date) ?? null,
    source: (r.response_source as string) ?? null,
    autoFinalized: r.auto_finalized as boolean,
  };
}

/**
 * Brings an OPEN day's item snapshot in line with the item definitions in force at `asOf`.
 * Items that stop applying are dropped (with their pending/answered state) while the day is
 * open; once finalized, a day's snapshot is never reconciled again.
 */
async function reconcileOpenDay(t: Sql, userId: string, date: LocalDate, asOf: Date) {
  const versions = await loadVersions(t, userId);
  const applicable = applicableVersions(versions, date, asOf);
  const positions = new Map((await t`select id, position from items where user_id = ${userId}`).map((r) => [r.id as string, Number(r.position)]));
  const existing = new Set((await t`select item_id from day_items where user_id = ${userId} and local_date = ${date}`).map((r) => r.item_id as string));
  const keep = new Set<string>();
  for (const v of applicable) {
    keep.add(v.itemId);
    const pos = positions.get(v.itemId) ?? 0;
    if (existing.has(v.itemId)) {
      await t`update day_items set item_version_id = ${v.id}, name = ${v.name}, category = ${v.category}, due_time = ${v.dueTime}, position = ${pos}
              where user_id = ${userId} and local_date = ${date} and item_id = ${v.itemId}`;
    } else {
      await t`insert into day_items (user_id, local_date, item_id, item_version_id, name, category, due_time, position)
              values (${userId}, ${date}, ${v.itemId}, ${v.id}, ${v.name}, ${v.category}, ${v.dueTime}, ${pos})`;
    }
  }
  const drop = [...existing].filter((id) => !keep.has(id));
  if (drop.length) await t`delete from day_items where user_id = ${userId} and local_date = ${date} and item_id in ${t(drop)}`;
}

/** Recomputes a day's counts and grade from its snapshot (full precision). */
export async function recount(t: Sql, userId: string, date: LocalDate, settings: UserSettings) {
  const [c] = await t`select count(*)::int as applicable, count(*) filter (where response = 'yes')::int as yes
                      from day_items where user_id = ${userId} and local_date = ${date}`;
  const pct = pctFromCounts(c.yes, c.applicable);
  await t`update day_records set applicable_count = ${c.applicable}, yes_count = ${c.yes}, score_pct = ${pct},
          grade = ${pct === null ? null : gradeFor(pct, settings.gradeThresholds)}, updated_at = now()
          where user_id = ${userId} and local_date = ${date}`;
}

/** Creates (or refreshes, if still open) the record for a day. Returns it locked for update. */
export async function ensureDay(t: Sql, userId: string, date: LocalDate, settings: UserSettings, now: Date): Promise<DayRecord> {
  const cutoffAt = cutoffInstant(date, settings);
  await t`insert into day_records (user_id, local_date, timezone, cutoff_time, cutoff_at)
          values (${userId}, ${date}, ${settings.timezone}, ${settings.cutoffTime}, ${cutoffAt})
          on conflict (user_id, local_date) do nothing`;
  let [row] = await t`select * from day_records where user_id = ${userId} and local_date = ${date} for update`;
  let day = mapDay(row);
  if (day.status === "open") {
    const asOf = new Date(Math.min(now.getTime(), day.cutoffAt.getTime()));
    await reconcileOpenDay(t, userId, date, asOf);
    await recount(t, userId, date, settings);
    [row] = await t`select * from day_records where user_id = ${userId} and local_date = ${date}`;
    day = mapDay(row);
  }
  return day;
}

/**
 * Closes a day at its cutoff: unanswered items become NO, the final score and grade are
 * saved, and any notifications still queued for that day are cancelled. Idempotent.
 */
export async function finalizeDay(sql: Sql, userId: string, date: LocalDate, now: Date, settings?: UserSettings): Promise<DayRecord> {
  return tx(sql, async (t) => {
    const s = settings ?? (await getSettings(t, userId, { now }));
    const day = await ensureDay(t, userId, date, s, now);
    if (day.status === "final") return day;
    if (now.getTime() < day.cutoffAt.getTime()) throw new Error(`Day ${date} is still open until ${day.cutoffAt.toISOString()}`);
    await t`update day_items set response = 'no', response_source = 'auto', auto_finalized = true, responded_at = ${day.cutoffAt}
            where user_id = ${userId} and local_date = ${date} and response is null`;
    await recount(t, userId, date, s);
    await t`update day_records set status = 'final', finalized_at = ${now} where user_id = ${userId} and local_date = ${date}`;
    await t`update notification_queue set status = 'cancelled', status_reason = 'day_finalized', updated_at = now()
            where user_id = ${userId} and local_date = ${date} and status = 'pending'
              and kind not in ('weekly_summary', 'monthly_summary', 'test')`;
    const [row] = await t`select * from day_records where user_id = ${userId} and local_date = ${date}`;
    return mapDay(row);
  });
}

/** Max days back-filled in one pass (protects the job after long outages). */
const BACKFILL_LIMIT = 400;

/**
 * Finalizes every day whose cutoff has passed for one user, including days the user never
 * opened the app (every scheduled item on such a day is a NO). Idempotent and safe to run
 * concurrently: each day is finalized under a row lock.
 */
export async function finalizeDueForUser(sql: Sql, userId: string, now: Date): Promise<LocalDate[]> {
  const settings = await getSettings(sql, userId, { now });
  const done: LocalDate[] = [];
  const open = await sql`select local_date from day_records where user_id = ${userId} and status = 'open' and cutoff_at <= ${now} order by local_date`;
  for (const r of open) {
    await finalizeDay(sql, userId, r.local_date as string, now, settings);
    done.push(r.local_date as string);
  }
  const [{ last }] = await sql`select max(local_date) as last from day_records where user_id = ${userId}`;
  let d: LocalDate = last ? addDays(last as string, 1) : settings.scoringStartDate;
  if (d < settings.scoringStartDate) d = settings.scoringStartDate;
  const today = currentDay(now, settings);
  for (let i = 0; i < BACKFILL_LIMIT && d <= today; i++, d = addDays(d, 1)) {
    if (cutoffInstant(d, settings).getTime() > now.getTime()) break;
    await finalizeDay(sql, userId, d, now, settings);
    done.push(d);
  }
  return done;
}

export async function finalizeDueForAll(sql: Sql, now: Date): Promise<number> {
  const users = await sql`select user_id from user_settings`;
  let n = 0;
  for (const u of users) n += (await finalizeDueForUser(sql, u.user_id as string, now)).length;
  return n;
}

export async function getDay(sql: Sql, userId: string, date: LocalDate): Promise<{ day: DayRecord; items: DayItem[] } | null> {
  const [row] = await sql`select * from day_records where user_id = ${userId} and local_date = ${date}`;
  if (!row) return null;
  const items = await sql`select * from day_items where user_id = ${userId} and local_date = ${date} order by position, name`;
  return { day: mapDay(row), items: items.map(mapDayItem) };
}

/** Loads (creating/refreshing as needed) the user's current day. */
export async function getToday(sql: Sql, userId: string, now: Date, settings?: UserSettings) {
  await finalizeDueForUser(sql, userId, now);
  const s = settings ?? (await getSettings(sql, userId, { now }));
  const date = currentDay(now, s);
  await tx(sql, (t) => ensureDay(t, userId, date, s, now));
  return (await getDay(sql, userId, date))!;
}
