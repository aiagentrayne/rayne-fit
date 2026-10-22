import { gradeFor, DEFAULT_GRADE_THRESHOLDS, type GradeThreshold } from "./grading";
import { monthRange, weekRange, type LocalDate } from "./time";

export type Answer = "yes" | "no";
/** null = pending (unanswered while the day is still open). */
export type ResponseValue = Answer | null;

export interface DailyScore {
  applicable: number;
  yes: number;
  no: number;
  pending: number;
  /** Full-precision percentage, or null when no items were scheduled (N/A). */
  pct: number | null;
  grade: string | null;
}

/**
 * Daily score = YES / applicable items x 100. Binary only: every item weighs the same,
 * pending is not credit, and a day with zero scheduled items is N/A (not 0, not 100).
 */
export function scoreDay(responses: ResponseValue[], thresholds: GradeThreshold[] = DEFAULT_GRADE_THRESHOLDS): DailyScore {
  const applicable = responses.length;
  const yes = responses.filter((r) => r === "yes").length;
  const no = responses.filter((r) => r === "no").length;
  const pending = applicable - yes - no;
  if (applicable === 0) return { applicable, yes, no, pending, pct: null, grade: null };
  const pct = (yes / applicable) * 100;
  return { applicable, yes, no, pending, pct, grade: gradeFor(pct, thresholds) };
}

export function pctFromCounts(yes: number, applicable: number): number | null {
  return applicable === 0 ? null : (yes / applicable) * 100;
}

/** At cutoff, every unanswered item becomes NO. */
export function finalizeResponses(responses: ResponseValue[]): Answer[] {
  return responses.map((r) => r ?? "no");
}

export interface DaySummary {
  date: LocalDate;
  status: "open" | "final";
  applicable: number;
  yes: number;
}

export interface PeriodGrade {
  start: LocalDate;
  end: LocalDate;
  /** Arithmetic mean of finalized, applicable day percentages (equal day weighting). */
  pct: number | null;
  grade: string | null;
  /** Number of finalized days with at least one scheduled item. */
  countedDays: number;
  /** True while the period is still in progress (or has unfinalized past days). */
  provisional: boolean;
}

/**
 * Weekly/monthly grade: each finalized, applicable day counts once regardless of how many
 * items it had. Future days, open days and N/A days are excluded.
 */
export function periodGrade(
  days: DaySummary[],
  start: LocalDate,
  end: LocalDate,
  today: LocalDate,
  thresholds: GradeThreshold[] = DEFAULT_GRADE_THRESHOLDS,
): PeriodGrade {
  const inRange = days.filter((d) => d.date >= start && d.date <= end);
  const counted = inRange.filter((d) => d.status === "final" && d.applicable > 0 && d.date <= today);
  const pcts = counted.map((d) => (d.yes / d.applicable) * 100);
  const pct = pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null;
  const pastUnfinalized = inRange.some((d) => d.date < today && d.status !== "final");
  return {
    start,
    end,
    pct,
    grade: pct === null ? null : gradeFor(pct, thresholds),
    countedDays: counted.length,
    provisional: end >= today || pastUnfinalized,
  };
}

export function weekGrade(days: DaySummary[], today: LocalDate, weekStart: number, thresholds?: GradeThreshold[], anchor: LocalDate = today): PeriodGrade {
  const { start, end } = weekRange(anchor, weekStart);
  return periodGrade(days, start, end, today, thresholds);
}

export function monthGrade(days: DaySummary[], today: LocalDate, thresholds?: GradeThreshold[], anchor: LocalDate = today): PeriodGrade {
  const { start, end } = monthRange(anchor);
  return periodGrade(days, start, end, today, thresholds);
}
