import { isoWeekday, type LocalDate, type LocalTime } from "./time";

export type ScheduleType = "daily" | "weekdays" | "weekends" | "custom";

/** An immutable version of an item definition. Edits create a new version. */
export interface ItemVersion {
  id: string;
  itemId: string;
  version: number;
  name: string;
  description: string | null;
  category: string | null;
  scheduleType: ScheduleType;
  /** ISO weekdays (Mon=1..Sun=7); used when scheduleType is "custom". */
  daysOfWeek: number[];
  startDate: LocalDate;
  endDate: LocalDate | null;
  dueTime: LocalTime | null;
  /** False once the item is deactivated, archived, or deleted. */
  isActive: boolean;
  createdAt: Date;
}

export function scheduleDays(scheduleType: ScheduleType, daysOfWeek: number[]): number[] {
  switch (scheduleType) {
    case "daily":
      return [1, 2, 3, 4, 5, 6, 7];
    case "weekdays":
      return [1, 2, 3, 4, 5];
    case "weekends":
      return [6, 7];
    case "custom":
      return [...new Set(daysOfWeek)].filter((d) => d >= 1 && d <= 7).sort();
  }
}

/** True when the version is active, effective on `date`, and its recurrence includes that weekday. */
export function isScheduledOn(v: Pick<ItemVersion, "isActive" | "startDate" | "endDate" | "scheduleType" | "daysOfWeek">, date: LocalDate): boolean {
  if (!v.isActive) return false;
  if (date < v.startDate) return false;
  if (v.endDate && date > v.endDate) return false;
  return scheduleDays(v.scheduleType, v.daysOfWeek).includes(isoWeekday(date));
}

/**
 * Picks the version of each item that governs a day: the latest version created at or
 * before `asOf`. For an open day `asOf` is "now"; when finalizing, it is the day's cutoff,
 * so items created or edited after a day closed can never change that day.
 */
export function versionsAsOf(versions: ItemVersion[], asOf: Date): Map<string, ItemVersion> {
  const out = new Map<string, ItemVersion>();
  for (const v of versions) {
    if (v.createdAt.getTime() > asOf.getTime()) continue;
    const cur = out.get(v.itemId);
    if (!cur || v.version > cur.version) out.set(v.itemId, v);
  }
  return out;
}

export function applicableVersions(versions: ItemVersion[], date: LocalDate, asOf: Date): ItemVersion[] {
  return [...versionsAsOf(versions, asOf).values()].filter((v) => isScheduledOn(v, date));
}

export function describeSchedule(scheduleType: ScheduleType, daysOfWeek: number[]): string {
  const names = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  switch (scheduleType) {
    case "daily":
      return "Every day";
    case "weekdays":
      return "Weekdays";
    case "weekends":
      return "Weekends";
    case "custom":
      return scheduleDays("custom", daysOfWeek).map((d) => names[d]).join(", ") || "No days";
  }
}
