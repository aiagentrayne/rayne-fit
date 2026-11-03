import type { Period } from "@/components/PeriodCard";
import type { GradeThreshold } from "@/lib/core/grading";
import type { ItemNotificationRules } from "@/lib/core/reminders";
import type { Cadence, ScheduleType } from "@/lib/core/schedule";

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
  rossEnabled: boolean;
  rossConsentAt: string | null;
  rossShareCheckins: boolean;
  rossShareJournal: boolean;
  nuggetEnabled: boolean;
  nuggetWindowStart: string;
  nuggetWindowEnd: string;
  checkinRemindersEnabled: boolean;
  morningCheckinTime: string;
  morningFollowupTime: string;
  weeklyInterviewDow: number;
  weeklyInterviewTime: string;
  monthlyInterviewEnabled: boolean;
  quarterlyReviewEnabled: boolean;
  rossMaxDailyNotifications: number;
  rossQuietStart: string;
  rossQuietEnd: string;
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
  coach: DashboardCoach | null;
}

export interface ReviewStatus {
  energy: number | null;
  mood: number | null;
  stress: number | null;
  missing: ("energy" | "mood" | "stress")[];
  complete: boolean;
}

export interface PeriodMeasurable {
  itemId: string;
  name: string;
  category: string | null;
  cadence: "weekly" | "monthly";
  target: number;
  count: number;
  countToday: number;
  periodStart: string;
  periodEnd: string;
  met: boolean;
  previous: { count: number; target: number; met: boolean } | null;
  milestoneId: string | null;
}

export interface Nugget {
  id: string;
  date: string;
  category: "accountability" | "educational" | "motivational";
  body: string;
  grounding: string[];
  fallback: boolean;
  scheduledFor: string;
  readAt: string | null;
}

export interface CoachSession {
  id: string;
  kind: "vision" | "weekly" | "monthly" | "quarterly" | "nugget_chat";
  periodStart: string | null;
  periodEnd: string | null;
  dueAt: string | null;
  status: "scheduled" | "in_progress" | "completed" | "missed" | "cancelled";
  startedAt: string | null;
  completedAt: string | null;
  rescheduleCount: number;
  summary: string | null;
  userTurns: number;
  nuggetId: string | null;
  safetyPaused: boolean;
}

export interface DashboardCoach {
  rossEnabled: boolean;
  hasVision: boolean;
  review: ReviewStatus;
  periods: PeriodMeasurable[];
  nugget: Nugget | null;
  dueInterview: CoachSession | null;
  nextInterview: CoachSession | null;
  pendingProposals: number;
}

export interface Vision {
  id: string;
  version: number;
  identity: string;
  statement: string;
  oneYear: string;
  fiveYear: string;
  source: "user" | "proposal";
  createdAt: string;
}

export interface Milestone {
  id: string;
  title: string;
  detail: string | null;
  horizon: "1y" | "5y" | "other";
  targetDate: string | null;
  status: "active" | "achieved" | "dropped";
  source: "user" | "proposal";
}

export interface Proposal {
  id: string;
  sessionId: string | null;
  kind: string;
  rationale: string;
  status: "pending" | "applied" | "rejected" | "failed";
  error: string | null;
  createdAt: string;
  title: string;
  details: string[];
}

export interface Commitment {
  id: string;
  text: string;
  dueDate: string | null;
  status: string;
}

export interface CoachHub {
  today: string;
  ross: { enabled: boolean; consentAt: string | null; aiConfigured: boolean; shareCheckins: boolean; shareJournal: boolean };
  vision: Vision | null;
  visionHistory: Vision[];
  milestones: Milestone[];
  scheduled: CoachSession[];
  recent: CoachSession[];
  proposals: Proposal[];
  commitments: Commitment[];
  nugget: Nugget | null;
  nuggets: Nugget[];
  participation: { completed: number; missed: number; late: number; rescheduled: number; days: number };
  memoryCount: number;
}

export interface SessionView {
  session: CoachSession;
  nugget: { body: string; category: string } | null;
  messages: { id: string; role: "user" | "assistant"; content: string; viaVoice: boolean; createdAt: string }[];
  commitments: Commitment[];
  proposals: Proposal[];
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
  cadence: Cadence;
  targetCount: number | null;
  milestoneId: string | null;
}

export interface Item {
  id: string;
  position: number;
  status: "active" | "inactive" | "archived" | "deleted";
  current: ItemVersion;
  rules: ItemNotificationRules;
}
