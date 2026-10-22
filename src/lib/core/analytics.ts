import { gradeFor, DEFAULT_GRADE_THRESHOLDS, type GradeThreshold } from "./grading";
import { monthRange, weekStartOf, type LocalDate } from "./time";
import type { Answer, DaySummary, PeriodGrade } from "./scoring";
import { periodGrade } from "./scoring";

export interface DayDetail extends DaySummary {
  items: { itemId: string; name: string; response: Answer | null }[];
}

export interface StreakStats {
  current: number;
  longest: number;
  perfectDays: number;
}

const isPerfect = (d: DaySummary) => d.applicable > 0 && d.yes === d.applicable;

/**
 * Perfect-day streaks over finalized days. N/A days (nothing scheduled) neither extend nor
 * break a streak; any finalized day below 100% breaks it.
 */
export function perfectStreaks(days: DaySummary[]): StreakStats {
  const finals = days.filter((d) => d.status === "final").sort((a, b) => (a.date < b.date ? -1 : 1));
  let run = 0;
  let longest = 0;
  let perfectDays = 0;
  for (const d of finals) {
    if (d.applicable === 0) continue;
    if (isPerfect(d)) {
      run++;
      perfectDays++;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  }
  return { current: run, longest, perfectDays };
}

export function overallAverage(days: DaySummary[]): number | null {
  const counted = days.filter((d) => d.status === "final" && d.applicable > 0);
  if (!counted.length) return null;
  return counted.reduce((s, d) => s + (d.yes / d.applicable) * 100, 0) / counted.length;
}

export interface ItemRate {
  itemId: string;
  name: string;
  /** Completion % over the item's last N applicable finalized days (null if none). */
  rates: Record<7 | 30 | 90 | 365, { pct: number | null; days: number }>;
  missesLast30: number;
}

export function itemCompletionRates(days: DayDetail[]): ItemRate[] {
  const byItem = new Map<string, { name: string; answers: Answer[] }>();
  const finals = days.filter((d) => d.status === "final").sort((a, b) => (a.date > b.date ? -1 : 1)); // newest first
  for (const d of finals) {
    for (const it of d.items) {
      const e = byItem.get(it.itemId) ?? { name: it.name, answers: [] };
      e.answers.push(it.response ?? "no");
      byItem.set(it.itemId, e);
    }
  }
  const windows = [7, 30, 90, 365] as const;
  return [...byItem.entries()].map(([itemId, { name, answers }]) => {
    const rates = {} as ItemRate["rates"];
    for (const w of windows) {
      const slice = answers.slice(0, w);
      rates[w] = { pct: slice.length ? (slice.filter((a) => a === "yes").length / slice.length) * 100 : null, days: slice.length };
    }
    return { itemId, name, rates, missesLast30: answers.slice(0, 30).filter((a) => a === "no").length };
  });
}

export function frequentlyMissed(rates: ItemRate[], limit = 5): ItemRate[] {
  return rates.filter((r) => r.missesLast30 > 0).sort((a, b) => b.missesLast30 - a.missesLast30 || a.name.localeCompare(b.name)).slice(0, limit);
}

/** Week-by-week grades for trend charts, oldest first. */
export function weeklyTrend(days: DaySummary[], today: LocalDate, weekStart: number, count: number, thresholds: GradeThreshold[] = DEFAULT_GRADE_THRESHOLDS): PeriodGrade[] {
  const out: PeriodGrade[] = [];
  let start = weekStartOf(today, weekStart);
  for (let i = 0; i < count; i++) {
    const end = new Date(Date.parse(start + "T00:00:00Z") + 6 * 86400000).toISOString().slice(0, 10);
    out.unshift(periodGrade(days, start, end, today, thresholds));
    start = new Date(Date.parse(start + "T00:00:00Z") - 7 * 86400000).toISOString().slice(0, 10);
  }
  return out;
}

export function monthlyTrend(days: DaySummary[], today: LocalDate, count: number, thresholds: GradeThreshold[] = DEFAULT_GRADE_THRESHOLDS): PeriodGrade[] {
  const out: PeriodGrade[] = [];
  let anchor = today;
  for (let i = 0; i < count; i++) {
    const { start, end } = monthRange(anchor);
    out.unshift(periodGrade(days, start, end, today, thresholds));
    anchor = new Date(Date.parse(start + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
  }
  return out;
}

export type CalendarCellState = "na" | "open" | "future" | "missing" | "graded";

export function calendarCell(d: DaySummary | undefined, date: LocalDate, today: LocalDate, thresholds: GradeThreshold[] = DEFAULT_GRADE_THRESHOLDS) {
  if (date > today) return { state: "future" as CalendarCellState, pct: null, grade: null };
  if (!d) return { state: "missing" as CalendarCellState, pct: null, grade: null };
  if (d.applicable === 0) return { state: "na" as CalendarCellState, pct: null, grade: null };
  const pct = (d.yes / d.applicable) * 100;
  return { state: (d.status === "open" ? "open" : "graded") as CalendarCellState, pct, grade: gradeFor(pct, thresholds) };
}
