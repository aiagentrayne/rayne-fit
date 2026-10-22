import { z } from "zod";
import type { Sql } from "./db";
import { DEFAULT_GRADE_THRESHOLDS, validateThresholds, type GradeThreshold } from "@/lib/core/grading";
import { isLocalTime, isValidTimeZone, type LocalDate, type LocalTime } from "@/lib/core/time";
import { cutoffInstant, currentDay } from "@/lib/core/days";
import type { GlobalNotificationSettings } from "@/lib/core/reminders";

export interface DashboardPrefs {
  showCategories: boolean;
  showDescriptions: boolean;
  groupByCategory: boolean;
}

export const DEFAULT_DASHBOARD_PREFS: DashboardPrefs = { showCategories: true, showDescriptions: false, groupByCategory: false };

export interface UserSettings extends GlobalNotificationSettings {
  gradeThresholds: GradeThreshold[];
  dashboardPrefs: DashboardPrefs;
  scoringStartDate: LocalDate;
}

type Row = Record<string, unknown>;

export function mapSettings(r: Row): UserSettings {
  return {
    timezone: r.timezone as string,
    cutoffTime: r.cutoff_time as LocalTime,
    weekStart: Number(r.week_start),
    gradeThresholds: (r.grade_thresholds as GradeThreshold[]) ?? DEFAULT_GRADE_THRESHOLDS,
    notificationsEnabled: r.notifications_enabled as boolean,
    quietHoursEnabled: r.quiet_hours_enabled as boolean,
    quietStart: r.quiet_start as LocalTime,
    quietEnd: r.quiet_end as LocalTime,
    eveningReminderEnabled: r.evening_reminder_enabled as boolean,
    eveningReminderTime: r.evening_reminder_time as LocalTime,
    weeklySummaryEnabled: r.weekly_summary_enabled as boolean,
    monthlySummaryEnabled: r.monthly_summary_enabled as boolean,
    dashboardPrefs: { ...DEFAULT_DASHBOARD_PREFS, ...((r.dashboard_prefs as Partial<DashboardPrefs>) ?? {}) },
    scoringStartDate: r.scoring_start_date as LocalDate,
  };
}

/** Loads settings, creating defaults on first use. `timezone` seeds a brand-new user's zone. */
export async function getSettings(sql: Sql, userId: string, opts: { timezone?: string; now?: Date } = {}): Promise<UserSettings> {
  const rows = await sql`select * from user_settings where user_id = ${userId}`;
  if (rows.length) return mapSettings(rows[0]);
  const tz = opts.timezone && isValidTimeZone(opts.timezone) ? opts.timezone : "America/New_York";
  const start = currentDay(opts.now ?? new Date(), { timezone: tz, cutoffTime: "23:59" });
  await sql`insert into user_settings (user_id, timezone, scoring_start_date) values (${userId}, ${tz}, ${start}) on conflict (user_id) do nothing`;
  const created = await sql`select * from user_settings where user_id = ${userId}`;
  return mapSettings(created[0]);
}

const time = z.string().refine(isLocalTime, "Use HH:MM (24-hour).");

export const settingsPatchSchema = z
  .object({
    timezone: z.string().refine(isValidTimeZone, "Unknown time zone."),
    cutoffTime: time,
    weekStart: z.number().int().min(1).max(7),
    gradeThresholds: z
      .array(z.object({ grade: z.string(), min: z.number() }))
      .superRefine((v, ctx) => {
        const err = validateThresholds(v);
        if (err) ctx.addIssue({ code: z.ZodIssueCode.custom, message: err });
      }),
    notificationsEnabled: z.boolean(),
    quietHoursEnabled: z.boolean(),
    quietStart: time,
    quietEnd: time,
    eveningReminderEnabled: z.boolean(),
    eveningReminderTime: time,
    weeklySummaryEnabled: z.boolean(),
    monthlySummaryEnabled: z.boolean(),
    dashboardPrefs: z.object({ showCategories: z.boolean(), showDescriptions: z.boolean(), groupByCategory: z.boolean() }).partial(),
  })
  .partial()
  .strict();

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/**
 * Updates settings. Time zone / cutoff changes apply to the currently open day only if its
 * new cutoff is still in the future (so a change can never instantly close a day);
 * otherwise the open day keeps its original cutoff and the change starts tomorrow.
 * Finalized days are never touched.
 */
export async function updateSettings(sql: Sql, userId: string, patch: SettingsPatch, now = new Date()): Promise<UserSettings> {
  const current = await getSettings(sql, userId, { now });
  const next: UserSettings = { ...current, ...patch, dashboardPrefs: { ...current.dashboardPrefs, ...(patch.dashboardPrefs ?? {}) } } as UserSettings;
  await sql`
    update user_settings set
      timezone = ${next.timezone}, cutoff_time = ${next.cutoffTime}, week_start = ${next.weekStart},
      grade_thresholds = ${sql.json(next.gradeThresholds as never)},
      notifications_enabled = ${next.notificationsEnabled}, quiet_hours_enabled = ${next.quietHoursEnabled},
      quiet_start = ${next.quietStart}, quiet_end = ${next.quietEnd},
      evening_reminder_enabled = ${next.eveningReminderEnabled}, evening_reminder_time = ${next.eveningReminderTime},
      weekly_summary_enabled = ${next.weeklySummaryEnabled}, monthly_summary_enabled = ${next.monthlySummaryEnabled},
      dashboard_prefs = ${sql.json(next.dashboardPrefs as never)}, updated_at = now()
    where user_id = ${userId}`;

  if (patch.timezone !== undefined || patch.cutoffTime !== undefined) {
    const open = await sql`select local_date from day_records where user_id = ${userId} and status = 'open'`;
    for (const r of open) {
      const newCutoff = cutoffInstant(r.local_date as string, next);
      if (newCutoff.getTime() > now.getTime()) {
        await sql`update day_records set timezone = ${next.timezone}, cutoff_time = ${next.cutoffTime}, cutoff_at = ${newCutoff}, updated_at = now()
                  where user_id = ${userId} and local_date = ${r.local_date as string} and status = 'open'`;
      }
    }
  }
  return next;
}
