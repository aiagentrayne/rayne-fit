import type { Sql } from "./db";
import { getSettings } from "./settings";
import { getToday, mapDay, mapDayItem } from "./days";
import { upcomingForDay } from "./notifications";
import { scoreDay, weekGrade, monthGrade, type DaySummary } from "@/lib/core/scoring";
import { addDays, monthRange, weekRange } from "@/lib/core/time";
import {
  frequentlyMissed,
  itemCompletionRates,
  monthlyTrend,
  overallAverage,
  perfectStreaks,
  weeklyTrend,
  type DayDetail,
} from "@/lib/core/analytics";

const toSummary = (d: ReturnType<typeof mapDay>): DaySummary => ({ date: d.date, status: d.status, applicable: d.applicable, yes: d.yes });

/** Everything the Today screen needs, in one round trip. */
export async function getDashboard(sql: Sql, userId: string, now: Date) {
  const settings = await getSettings(sql, userId, { now });
  const { day, items } = await getToday(sql, userId, now, settings);
  const today = day.date;
  const w = weekRange(today, settings.weekStart);
  const m = monthRange(today);
  const from = w.start < m.start ? w.start : m.start;
  const rows = await sql`select * from day_records where user_id = ${userId} and local_date between ${from} and ${today}`;
  const days = rows.map(mapDay).map(toSummary);
  const live = scoreDay(items.map((i) => i.response), settings.gradeThresholds);
  const upcoming = await upcomingForDay(sql, userId, today, now);
  const next = upcoming.find((u) => (u.status === "pending" || u.status === "sending") && new Date(u.scheduledFor) > now) ?? null;
  const unanswered = new Set(items.filter((i) => i.response === null).map((i) => i.itemId));
  // In-app reminders: anything that came due in the last 3 hours for a still-unanswered item.
  const due = upcoming.filter((u) => u.itemId && unanswered.has(u.itemId) && new Date(u.scheduledFor) <= now && u.status !== "cancelled");
  const [subs] = await sql`select count(*)::int as n from push_subscriptions where user_id = ${userId} and disabled_at is null`;

  return {
    now: now.toISOString(),
    settings,
    today: {
      date: today,
      status: day.status,
      cutoffAt: day.cutoffAt.toISOString(),
      applicable: live.applicable,
      yes: live.yes,
      no: live.no,
      pending: live.pending,
      pct: live.pct,
      grade: live.grade,
      items: items.map((i) => ({ ...i, respondedAt: i.respondedAt?.toISOString() ?? null })),
    },
    week: weekGrade(days, today, settings.weekStart, settings.gradeThresholds),
    month: monthGrade(days, today, settings.gradeThresholds),
    nextReminder: next,
    dueReminders: dedupeByItem(due),
    pushSubscriptions: subs.n as number,
  };
}

function dedupeByItem<T extends { itemId: string | null }>(list: T[]): T[] {
  const seen = new Map<string, T>();
  for (const x of list) seen.set(x.itemId!, x);
  return [...seen.values()];
}

/** History & analytics over the last ~13 months. */
export async function getHistory(sql: Sql, userId: string, now: Date) {
  const settings = await getSettings(sql, userId, { now });
  const { day } = await getToday(sql, userId, now, settings);
  const today = day.date;
  const from = addDays(today, -400);
  const records = (await sql`select * from day_records where user_id = ${userId} and local_date between ${from} and ${today} order by local_date`).map(mapDay);
  const itemRows = (await sql`select * from day_items where user_id = ${userId} and local_date between ${from} and ${today} order by position, name`);
  const byDate = new Map<string, DayDetail["items"]>();
  for (const r of itemRows) {
    const di = mapDayItem(r);
    const list = byDate.get(r.local_date as string) ?? [];
    list.push({ itemId: di.itemId, name: di.name, response: di.response });
    byDate.set(r.local_date as string, list);
  }
  const details: DayDetail[] = records.map((d) => ({ ...toSummary(d), items: byDate.get(d.date) ?? [] }));
  const summaries = details.map(({ items: _i, ...s }) => s);
  const rates = itemCompletionRates(details);
  return {
    today,
    settings,
    days: records.map((d) => ({ date: d.date, status: d.status, applicable: d.applicable, yes: d.yes })),
    streaks: perfectStreaks(summaries),
    overallAverage: overallAverage(summaries),
    itemRates: rates.sort((a, b) => a.name.localeCompare(b.name)),
    frequentlyMissed: frequentlyMissed(rates),
    weekly: weeklyTrend(summaries, today, settings.weekStart, 12, settings.gradeThresholds),
    monthly: monthlyTrend(summaries, today, 12, settings.gradeThresholds),
  };
}
