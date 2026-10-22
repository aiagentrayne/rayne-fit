import { DateTime } from "luxon";

/** A calendar date in the user's time zone, formatted YYYY-MM-DD. */
export type LocalDate = string;
/** A wall-clock time, formatted HH:MM (24h). */
export type LocalTime = string;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isLocalDate(value: unknown): value is LocalDate {
  return typeof value === "string" && DATE_RE.test(value) && DateTime.fromISO(value).isValid;
}

export function isLocalTime(value: unknown): value is LocalTime {
  return typeof value === "string" && TIME_RE.test(value);
}

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0) return false;
  return DateTime.now().setZone(tz).isValid;
}

export function minutesOf(time: LocalTime): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function formatMinutes(total: number): LocalTime {
  const m = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * Converts a wall-clock time on a local date into an absolute instant.
 *
 * DST policy (tested):
 *  - A time that does not exist (spring-forward gap, e.g. 02:30) moves forward by the
 *    length of the gap (02:30 -> 03:30).
 *  - A time that occurs twice (fall-back overlap, e.g. 01:30) resolves to the FIRST
 *    occurrence (the earlier instant, still on daylight time).
 */
export function zonedInstant(date: LocalDate, time: LocalTime, tz: string): Date {
  const dt = DateTime.fromISO(`${date}T${time}`, { zone: tz });
  if (!dt.isValid) throw new Error(`Invalid date/time/zone: ${date} ${time} ${tz}`);
  return dt.toJSDate();
}

export function startOfLocalDay(date: LocalDate, tz: string): Date {
  return DateTime.fromISO(date, { zone: tz }).startOf("day").toJSDate();
}

export function localDateOf(instant: Date, tz: string): LocalDate {
  return DateTime.fromJSDate(instant, { zone: tz }).toISODate()!;
}

export function localTimeOf(instant: Date, tz: string): LocalTime {
  return DateTime.fromJSDate(instant, { zone: tz }).toFormat("HH:mm");
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return DateTime.fromISO(date, { zone: "UTC" }).plus({ days }).toISODate()!;
}

export function compareDates(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** ISO weekday: Monday = 1 ... Sunday = 7. */
export function isoWeekday(date: LocalDate): number {
  return DateTime.fromISO(date, { zone: "UTC" }).weekday;
}

export function daysBetween(from: LocalDate, to: LocalDate): number {
  return Math.round(
    DateTime.fromISO(to, { zone: "UTC" }).diff(DateTime.fromISO(from, { zone: "UTC" }), "days").days,
  );
}

export function eachDate(from: LocalDate, to: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** First day of the week containing `date`, where weeks start on ISO weekday `weekStart`. */
export function weekStartOf(date: LocalDate, weekStart: number): LocalDate {
  const offset = (isoWeekday(date) - weekStart + 7) % 7;
  return addDays(date, -offset);
}

export function weekRange(date: LocalDate, weekStart: number): { start: LocalDate; end: LocalDate } {
  const start = weekStartOf(date, weekStart);
  return { start, end: addDays(start, 6) };
}

export function monthRange(date: LocalDate): { start: LocalDate; end: LocalDate } {
  const dt = DateTime.fromISO(date, { zone: "UTC" });
  return { start: dt.startOf("month").toISODate()!, end: dt.endOf("month").toISODate()! };
}

export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * 60_000);
}
