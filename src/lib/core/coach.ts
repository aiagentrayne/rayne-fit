/**
 * Pure ROSS coaching rules: check-in completeness, nugget timing, interview scheduling and
 * escalation, ROSS quiet hours and observations from check-ins. No I/O, fully deterministic.
 */
import { addDays, addMinutes, isoWeekday, localTimeOf, minutesOf, formatMinutes, monthRange, zonedInstant, type LocalDate, type LocalTime } from "./time";

export type Metric = "energy" | "mood" | "stress";
export const METRICS: Metric[] = ["energy", "mood", "stress"];

/** Scale is always 1 = difficult/poor state ... 5 = favourable state. */
export const METRIC_INFO: Record<Metric, { title: string; when: "morning" | "evening"; labels: [string, string, string, string, string]; faces: [string, string, string, string, string] }> = {
  energy: {
    title: "Morning energy",
    when: "morning",
    labels: ["Exhausted", "Tired", "Okay", "Rested", "Energized"],
    faces: ["😫", "🥱", "😐", "🙂", "⚡"],
  },
  mood: {
    title: "Overall mood",
    when: "evening",
    labels: ["Very low", "Low", "Neutral", "Good", "Very positive"],
    faces: ["😞", "🙁", "😐", "🙂", "😄"],
  },
  stress: {
    title: "Stress",
    when: "evening",
    labels: ["Extremely stressed", "Stressed", "Moderate", "Mostly calm", "Calm"],
    faces: ["😣", "😟", "😐", "😌", "🧘"],
  },
};

export interface CheckinLike {
  metric: Metric;
  rating: number;
}

export interface ReviewStatus {
  energy: number | null;
  mood: number | null;
  stress: number | null;
  missing: Metric[];
  /** True only when all three ratings are recorded. Missing ratings are "not recorded", never low. */
  complete: boolean;
}

export function reviewStatus(checkins: CheckinLike[]): ReviewStatus {
  const get = (m: Metric) => checkins.find((c) => c.metric === m)?.rating ?? null;
  const s = { energy: get("energy"), mood: get("mood"), stress: get("stress") };
  const missing = METRICS.filter((m) => s[m] === null);
  return { ...s, missing, complete: missing.length === 0 };
}

// ------------------------------------------------------------------ quiet hours and timing

/** FNV-1a: small stable hash so the same user/date always gets the same "random" minute. */
export function stableHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Minutes in the window [start, end) on a 24h clock; a window may wrap past midnight. */
function windowLength(start: LocalTime, end: LocalTime): number {
  const len = (minutesOf(end) - minutesOf(start) + 1440) % 1440;
  return len === 0 ? 1440 : len;
}

/**
 * The nugget's send time for a day: a minute inside the window that varies day to day but is
 * fixed for a given user and date, so re-planning never moves it.
 */
export function nuggetTime(userId: string, date: LocalDate, start: LocalTime, end: LocalTime, tz: string): Date {
  const len = windowLength(start, end);
  const offset = len <= 1 ? 0 : stableHash(`${userId}|${date}|nugget`) % len;
  const minute = minutesOf(start) + offset;
  const day = minute >= 1440 ? addDays(date, 1) : date;
  return zonedInstant(day, formatMinutes(minute), tz);
}

export interface QuietWindow {
  start: LocalTime;
  end: LocalTime;
  timezone: string;
}

export function inWindow(at: Date, q: QuietWindow): boolean {
  if (q.start === q.end) return false;
  const t = minutesOf(localTimeOf(at, q.timezone));
  const s = minutesOf(q.start);
  const e = minutesOf(q.end);
  return s < e ? t >= s && t < e : t >= s || t < e;
}

/** Moves an instant that falls inside ROSS quiet hours to the moment quiet hours end. */
export function outOfQuietHours(at: Date, q: QuietWindow): Date {
  let t = at;
  for (let i = 0; i < 1440 && inWindow(t, q); i++) t = addMinutes(t, 1);
  return t;
}

// ------------------------------------------------------------------ interviews

export type ScheduledKind = "weekly" | "monthly" | "quarterly";

export interface InterviewPrefs {
  timezone: string;
  weeklyDow: number; // ISO weekday 1..7
  weeklyTime: LocalTime;
  monthlyEnabled: boolean;
  quarterlyEnabled: boolean;
}

export interface PlannedInterview {
  kind: ScheduledKind;
  /** Identifies the period; unique per user + kind. */
  periodStart: LocalDate;
  periodEnd: LocalDate;
  dueDate: LocalDate;
  dueAt: Date;
}

/** The date of the first `dow` weekday in the month containing `date`. */
export function firstWeekdayOfMonth(date: LocalDate, dow: number): LocalDate {
  const first = monthRange(date).start;
  const offset = (dow - isoWeekday(first) + 7) % 7;
  return addDays(first, offset);
}

/** The next date on or after `date` that falls on ISO weekday `dow`. */
export function nextWeekday(date: LocalDate, dow: number): LocalDate {
  return addDays(date, (dow - isoWeekday(date) + 7) % 7);
}

/**
 * The interview that is due on or after `today`, choosing monthly over weekly when both land
 * on the same date (the monthly folds that week in). Weekly covers the 7 days ending on its
 * due date; monthly covers the previous calendar month; quarterly covers the 90 days before.
 */
export function upcomingInterviews(today: LocalDate, p: InterviewPrefs, visionStart: LocalDate | null): PlannedInterview[] {
  const out: PlannedInterview[] = [];
  const weeklyDue = nextWeekday(today, p.weeklyDow);
  const firstThisMonth = firstWeekdayOfMonth(today, p.weeklyDow);
  const monthlyDue = firstThisMonth >= today ? firstThisMonth : firstWeekdayOfMonth(addDays(monthRange(today).end, 1), p.weeklyDow);
  const mk = (kind: ScheduledKind, dueDate: LocalDate, periodStart: LocalDate, periodEnd: LocalDate): PlannedInterview => ({
    kind,
    dueDate,
    periodStart,
    periodEnd,
    dueAt: zonedInstant(dueDate, p.weeklyTime, p.timezone),
  });
  if (p.monthlyEnabled && monthlyDue === weeklyDue) {
    const prev = monthRange(addDays(monthRange(monthlyDue).start, -1));
    out.push(mk("monthly", monthlyDue, prev.start, prev.end));
  } else {
    out.push(mk("weekly", weeklyDue, addDays(weeklyDue, -6), weeklyDue));
  }
  if (p.quarterlyEnabled && visionStart) {
    let due = addDays(visionStart, 90);
    while (due < today) due = addDays(due, 90);
    if (due <= addDays(today, 7)) out.push(mk("quarterly", due, addDays(due, -89), due));
  }
  return out;
}

export interface EscalationStep {
  step: number;
  at: Date;
  kind: "interview_due" | "interview_overdue";
}

/** Initial nudge at the due time, firmer ones at +24 h, +48 h and +72 h, then one a day. */
export function escalationSteps(dueAt: Date, until: Date, maxSteps = 30): EscalationStep[] {
  const out: EscalationStep[] = [];
  for (let step = 0; step < maxSteps; step++) {
    const at = addMinutes(dueAt, step * 24 * 60);
    if (at.getTime() > until.getTime()) break;
    out.push({ step, at, kind: step === 0 ? "interview_due" : "interview_overdue" });
  }
  return out;
}

const KIND_NAME: Record<ScheduledKind | "vision", string> = {
  weekly: "weekly",
  monthly: "monthly",
  quarterly: "quarterly",
  vision: "vision",
};

export const INTERVIEW_MINUTES: Record<ScheduledKind, string> = { weekly: "5–10 min", monthly: "20–30 min", quarterly: "30–40 min" };

/** Reminder wording gets firmer with each step, without shaming. */
export function escalationMessage(kind: ScheduledKind, step: number): { title: string; body: string } {
  const name = KIND_NAME[kind];
  const mins = INTERVIEW_MINUTES[kind];
  if (step === 0) return { title: `Your ${name} interview is ready`, body: `ROSS is ready when you are (${mins}). Reviewing now keeps next week on track.` };
  if (step === 1) return { title: `${cap(name)} interview: 1 day overdue`, body: `Take ${mins} today, or reschedule it to a time that works.` };
  if (step === 2) return { title: `${cap(name)} interview: 2 days overdue`, body: `This review is how commitments stay honest. Block ${mins} today.` };
  return { title: `${cap(name)} interview still open`, body: `It's been ${step} days. Do it now, or pick a new time so it stops reminding you.` };
}

function cap(s: string): string {
  return s[0].toUpperCase() + s.slice(1);
}

// ------------------------------------------------------------------ nugget mix

export type NuggetCategory = "accountability" | "educational" | "motivational";
export const NUGGET_CATEGORIES: NuggetCategory[] = ["accountability", "educational", "motivational"];

/**
 * Picks today's category: the one used least in the recent history, ties broken by a stable
 * hash of the date so the mix varies. Accountability is skipped when there is no data to cite.
 */
export function pickNuggetCategory(recent: NuggetCategory[], date: LocalDate, hasData: boolean): NuggetCategory {
  const pool = hasData ? NUGGET_CATEGORIES : NUGGET_CATEGORIES.filter((c) => c !== "accountability");
  const counts = new Map(pool.map((c) => [c, recent.filter((r) => r === c).length]));
  const last = recent[0];
  const min = Math.min(...counts.values());
  const best = pool.filter((c) => counts.get(c) === min && (pool.length < 2 || c !== last));
  const choices = best.length ? best : pool.filter((c) => counts.get(c) === min);
  return choices[stableHash(date) % choices.length];
}

/** Normalised text used to catch near-repeats ("same nugget, different punctuation"). */
export function nuggetFingerprint(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim().split(" ").slice(0, 12).join(" ");
}

// ------------------------------------------------------------------ observations from check-ins

export interface DayObservation {
  date: LocalDate;
  /** Final day score in percent, or null for N/A days. */
  pct: number | null;
  ratings: Partial<Record<Metric, number>>;
}

export interface CheckinObservation {
  metric: Metric;
  highAvg: number;
  highDays: number;
  lowAvg: number;
  lowDays: number;
  text: string;
}

const MIN_DAYS_PER_GROUP = 5;

/**
 * Compares day scores on days rated 4–5 with days rated 1–2 for each metric. Only reported
 * when both groups have at least 5 days, and always phrased as an observation, not a cause.
 * Days with a missing rating are left out (missing is not low).
 */
export function checkinObservations(days: DayObservation[]): CheckinObservation[] {
  const out: CheckinObservation[] = [];
  for (const m of METRICS) {
    const high = days.filter((d) => d.pct !== null && (d.ratings[m] ?? 0) >= 4).map((d) => d.pct!);
    const low = days.filter((d) => d.pct !== null && d.ratings[m] !== undefined && d.ratings[m]! <= 2).map((d) => d.pct!);
    if (high.length < MIN_DAYS_PER_GROUP || low.length < MIN_DAYS_PER_GROUP) continue;
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const h = avg(high);
    const l = avg(low);
    const label = METRIC_INFO[m].title.toLowerCase();
    out.push({
      metric: m,
      highAvg: h,
      highDays: high.length,
      lowAvg: l,
      lowDays: low.length,
      text: `On days you rated ${label} 4–5 you averaged ${Math.round(h)}% (${high.length} days); on days rated 1–2, ${Math.round(l)}% (${low.length} days). This is a pattern, not proof of cause.`,
    });
  }
  return out;
}

export function average(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

// ------------------------------------------------------------------ safety

const CRISIS_PATTERNS: RegExp[] = [
  /\b(kill|hurt|harm)(ing)?\s+my\s*self\b/i,
  /\bkill\s+myself\b/i,
  /\bsuicid(e|al)\b/i,
  /\bend\s+(my|it)\s+(life|all)\b/i,
  /\bend\s+it\s+all\b/i,
  /\b(want|wanna|going)\s+to\s+die\b/i,
  /\bdon'?t\s+want\s+to\s+(be\s+alive|live|wake\s+up)\b/i,
  /\bno\s+(reason|point)\s+(to|in)\s+(live|living|go(ing)?\s+on)\b/i,
  /\bbetter\s+off\s+(dead|without\s+me)\b/i,
  /\bself[-\s]?harm(ing)?\b/i,
  /\bcut(ting)?\s+my\s*self\b/i,
  /\boverdos(e|ing)\b/i,
];

/** Conservative keyword check for crisis language. A hit pauses coaching and shows resources. */
export function detectCrisis(text: string): boolean {
  return CRISIS_PATTERNS.some((r) => r.test(text));
}

export const CRISIS_MESSAGE =
  "I'm really glad you told me, and I'm going to pause the coaching. What you're feeling matters more than any score or streak. " +
  "If you're in the US, you can call or text 988 to reach the Suicide & Crisis Lifeline, any time, free. " +
  "Outside the US, findahelpline.com lists free local lines, and if you might act on these thoughts or are in danger right now, call your local emergency number. " +
  "If you can, reach out to someone you trust and let them know how you're doing. I'm not a substitute for that kind of help, but I'm here, and we can pick the coaching back up whenever you're ready.";
