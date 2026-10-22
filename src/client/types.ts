import type { Period } from "@/components/PeriodCard";
import type { GradeThreshold } from "@/lib/core/grading";
import type { ItemNotificationRules } from "@/lib/core/reminders";
import type { ScheduleType } from "@/lib/core/schedule";

export interface Settings {
  timezone: string;
  cutoffTime: string;
  weekStart: number;
  gradeThresholds: GradeThreshold[];
  notificationsEnabled: boolean;
  quietHoursEnabled: boolean;
  quietStart: string;
  quietEnd: string;
  eveningReminderEnabled: boolean;
  eveningReminderTime: string;
  weeklySummaryEnabled: boolean;
  monthlySummaryEnabled: boolean;
  dashboardPrefs: { showCategories: boolean; showDescriptions: boolean; groupByCategory: boolean };
  scoringStartDate: string;
}

export interface DayItem {
  itemId: string;
  name: string;
  category: string | null;
  dueTime: string | null;
  position: number;
  response: "yes" | "no" | null;
  respondedAt: string | null;
  source: string | null;
  autoFinalized: boolean;
}

export interface Reminder {
  id: string;
  itemId: string | null;
  kind: string;
  scheduledFor: string;
  title: string;
  body: string;
  status: string;
  reason: string | null;
}

export interface Dashboard {
  now: string;
  settings: Settings;
  today: {
    date: string;
    status: "open" | "final";
    cutoffAt: string;
    applicable: number;
    yes: number;
    no: number;
    pending: number;
    pct: number | null;
    grade: string | null;
    items: DayItem[];
  };
  week: Period;
  month: Period;
  nextReminder: Reminder | null;
  dueReminders: Reminder[];
  pushSubscriptions: number;
}

export interface ItemVersion {
  id: string;
  version: number;
  name: string;
  description: string | null;
  category: string | null;
  scheduleType: ScheduleType;
  daysOfWeek: number[];
  startDate: string;
  endDate: string | null;
  dueTime: string | null;
  isActive: boolean;
}

export interface Item {
  id: string;
  position: number;
  status: "active" | "inactive" | "archived" | "deleted";
  current: ItemVersion;
  rules: ItemNotificationRules;
}
