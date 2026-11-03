/** "18:30" -> "6:30 PM" */
export function fmtTime(hhmm: string | null | undefined): string {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function fmtInstant(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
}

export function fmtDate(date: string, opts: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric" }): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
}

export const KIND_LABEL: Record<string, string> = {
  reminder: "Reminder",
  nudge: "Nudge",
  deadline: "Deadline warning",
  snooze: "Snoozed reminder",
  evening: "Evening check-in",
  checkin_morning: "Morning check-in",
  nugget: "Daily nugget",
  interview_due: "Interview reminder",
  interview_overdue: "Interview reminder",
};
