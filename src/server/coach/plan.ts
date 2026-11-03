/**
 * Plans ROSS-related notifications for one user-day: the morning check-in reminder and its
 * follow-up, the daily nugget, and escalating interview reminders. Interview reminders and the
 * nugget share a per-day cap (interviews win); check-in reminders are not capped, like the
 * evening reminder they extend. Coaching pushes avoid ROSS quiet hours.
 */
import type { Sql } from "../db";
import type { UserSettings } from "../settings";
import { getNugget, nuggetSendAt } from "./nuggets";
import { openScheduledSessions } from "./sessions";
import type { PlannedNotification } from "@/lib/core/reminders";
import { cutoffInstant } from "@/lib/core/days";
import { localDateOf, zonedInstant, type LocalDate } from "@/lib/core/time";
import { escalationMessage, escalationSteps, outOfQuietHours, type ScheduledKind } from "@/lib/core/coach";

function key(userId: string, date: LocalDate, tag: string, at: Date) {
  return `${userId}|${date}|${tag}|${at.toISOString()}`;
}

export async function planCoach(sql: Sql, userId: string, s: UserSettings, date: LocalDate, dayOpen: boolean): Promise<PlannedNotification[]> {
  const out: PlannedNotification[] = [];
  const cutoff = cutoffInstant(date, s);
  const quiet = { start: s.rossQuietStart, end: s.rossQuietEnd, timezone: s.timezone };

  if (dayOpen && s.checkinRemindersEnabled) {
    const morning = zonedInstant(date, s.morningCheckinTime, s.timezone);
    const follow = zonedInstant(date, s.morningFollowupTime, s.timezone);
    const items: [Date, string, string][] = [
      [morning, "Morning check-in", "How's your energy this morning? One tap to log it."],
      [follow, "Morning check-in", "Your energy rating for today is still missing. It takes 2 seconds."],
    ];
    for (const [at, title, body] of items) {
      if (at.getTime() >= cutoff.getTime()) continue;
      if (at === follow && follow.getTime() <= morning.getTime()) continue;
      out.push({ dedupeKey: key(userId, date, "checkin_morning", at), kind: "checkin_morning", itemId: null, localDate: date, scheduledFor: at, title, body });
    }
  }

  if (!s.rossEnabled) return out;
  const coach: PlannedNotification[] = [];

  // Interview escalation: steps that land on this local date.
  const sessions = await openScheduledSessions(sql, userId);
  const endOfDay = zonedInstant(date, "23:59", s.timezone);
  for (const x of sessions) {
    if (!x.dueAt) continue;
    for (const step of escalationSteps(new Date(x.dueAt), endOfDay)) {
      const at = outOfQuietHours(step.at, quiet);
      if (localDateOf(at, s.timezone) !== date) continue;
      const msg = escalationMessage(x.kind as ScheduledKind, step.step);
      coach.push({
        dedupeKey: key(userId, date, `session:${x.id}:${step.step}:${x.dueAt}`, at),
        kind: step.kind,
        itemId: null,
        sessionId: x.id,
        localDate: date,
        scheduledFor: at,
        title: msg.title,
        body: msg.body,
      });
    }
  }
  // At most one interview reminder a day (the latest step), so they never pile up.
  coach.sort((a, b) => b.scheduledFor.getTime() - a.scheduledFor.getTime());
  const interview = coach.slice(0, 1);

  const planned: PlannedNotification[] = [...interview];
  if (dayOpen && s.nuggetEnabled) {
    const at = nuggetSendAt(userId, date, s);
    const n = await getNugget(sql, userId, date);
    if (at.getTime() < cutoff.getTime() && planned.length < s.rossMaxDailyNotifications) {
      planned.push({ dedupeKey: key(userId, date, "nugget", at), kind: "nugget", itemId: null, localDate: date, scheduledFor: at, title: "ROSS", body: n?.body ?? "Your daily nugget is ready." });
    }
  }
  return [...out, ...planned.slice(0, s.rossMaxDailyNotifications)];
}
