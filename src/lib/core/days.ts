import { addDays, localDateOf, localTimeOf, minutesOf, zonedInstant, type LocalDate, type LocalTime } from "./time";

export interface DayClock {
  timezone: string;
  /** Daily cutoff (HH:MM). Default 23:59. */
  cutoffTime: LocalTime;
}

/**
 * Cutoffs before noon are "late-night" cutoffs: a 01:30 cutoff for Tuesday means
 * 01:30 on Wednesday morning, so night owls can still check in after midnight.
 * Cutoffs at or after noon fall on the day itself.
 */
export const LATE_CUTOFF_BEFORE = "12:00";

export function isLateCutoff(cutoffTime: LocalTime): boolean {
  return minutesOf(cutoffTime) < minutesOf(LATE_CUTOFF_BEFORE);
}

/** The instant a day closes. Unanswered items become NO at this moment. */
export function cutoffInstant(date: LocalDate, clock: DayClock): Date {
  const calendarDate = isLateCutoff(clock.cutoffTime) ? addDays(date, 1) : date;
  return zonedInstant(calendarDate, clock.cutoffTime, clock.timezone);
}

/**
 * The scorecard day the user is living in at `now`.
 * With a same-day cutoff this is the local calendar date (between the cutoff and midnight
 * the day is already closed and the dashboard shows it as final). With a late-night cutoff,
 * the small hours before the cutoff still belong to the previous day.
 */
export function currentDay(now: Date, clock: DayClock): LocalDate {
  const date = localDateOf(now, clock.timezone);
  if (isLateCutoff(clock.cutoffTime) && localTimeOf(now, clock.timezone) < clock.cutoffTime) {
    return addDays(date, -1);
  }
  return date;
}

export function isDayOpen(date: LocalDate, now: Date, clock: DayClock): boolean {
  return now.getTime() < cutoffInstant(date, clock).getTime();
}
