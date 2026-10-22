import { tx, type Sql } from "./db";
import { getSettings, type UserSettings } from "./settings";
import { getToday, mapDay } from "./days";
import { listItems, mapRules } from "./items";
import { writeResponse } from "./responses";
import { makeActionToken, verifyActionToken } from "./tokens";
import type { PushSender } from "./push";
import { classifyStatus } from "./push";
import {
  decideSend,
  kindsCancelledBy,
  messages,
  planDay,
  planSummaries,
  MAX_LATENESS_MINUTES,
  type NotificationKind,
  type PlannedNotification,
} from "@/lib/core/reminders";
import { isoWeekday, addDays, addMinutes, monthRange, weekRange, type LocalDate } from "@/lib/core/time";
import { periodGrade } from "@/lib/core/scoring";
import { formatPct } from "@/lib/core/grading";
import { perfectStreaks } from "@/lib/core/analytics";
import type { ResponseValue } from "@/lib/core/scoring";

const PLANNED_KINDS: NotificationKind[] = ["reminder", "nudge", "deadline", "evening", "weekly_summary", "monthly_summary"];
export const MAX_SEND_ATTEMPTS = 4;
const STALE_CLAIM_MINUTES = 10;

async function insertPlanned(t: Sql, userId: string, plan: PlannedNotification[], now: Date) {
  const earliest = addMinutes(now, -MAX_LATENESS_MINUTES);
  for (const p of plan) {
    if (p.scheduledFor < earliest) continue;
    // New rows are inserted; a row cancelled earlier (e.g. the answer was cleared, or the
    // item re-enabled) is revived if it is still upcoming. Sent rows are never touched.
    await t`
      insert into notification_queue (user_id, item_id, local_date, kind, scheduled_for, dedupe_key, title, body)
      values (${userId}, ${p.itemId}, ${p.localDate}, ${p.kind}, ${p.scheduledFor}, ${p.dedupeKey}, ${p.title}, ${p.body})
      on conflict (dedupe_key) do update set status = 'pending', status_reason = null, title = excluded.title, body = excluded.body, updated_at = now()
        where notification_queue.status = 'cancelled' and notification_queue.scheduled_for > ${now}`;
  }
}

/**
 * Idempotently (re)plans the user's notifications for their current day. Safe to call on
 * every cron tick and after any item, rule, settings or answer change.
 */
export async function planForUser(sql: Sql, userId: string, now: Date): Promise<number> {
  const settings = await getSettings(sql, userId, { now });
  const { day, items: dayItems } = await getToday(sql, userId, now, settings);
  const date = day.date;
  let plan: PlannedNotification[] = [];
  if (day.status === "open") {
    const items = await listItems(sql, userId);
    const rulesById = new Map(items.map((i) => [i.id, i.rules]));
    const plannable = dayItems
      .filter((di) => {
        const r = rulesById.get(di.itemId);
        return di.response === null || (di.response === "no" && r?.reconsiderAfterNo);
      })
      .map((di) => {
        // After a NO with reconsideration on, only follow-ups remain (no fresh "time to" reminder).
        return { itemId: di.itemId, name: di.name, dueTime: di.dueTime, rules: rulesById.get(di.itemId)!, followUpsOnly: di.response === "no" };
      });
    plan = planDay(userId, date, plannable, settings);
  }
  plan.push(...planSummaries(userId, date, settings, isoWeekday(date)));
  if (!settings.notificationsEnabled) plan = [];

  await tx(sql, async (t) => {
    await insertPlanned(t, userId, plan, now);
    const keep = plan.map((p) => p.dedupeKey);
    await t`
      update notification_queue set status = 'cancelled', status_reason = 'replanned', updated_at = now()
      where user_id = ${userId} and local_date = ${date} and status = 'pending' and kind in ${t(PLANNED_KINDS)}
        ${keep.length ? t`and dedupe_key not in ${t(keep)}` : t``}`;
  });
  return plan.length;
}

/** Cancels queued notifications made pointless by an answer. Runs inside the answer's transaction. */
export async function cancelForAnswer(t: Sql, userId: string, date: LocalDate, itemId: string, value: ResponseValue) {
  const [r] = await t`select * from item_notification_rules where item_id = ${itemId} and user_id = ${userId}`;
  const kinds = kindsCancelledBy(value, mapRules(r).reconsiderAfterNo);
  if (!kinds.length) return;
  await t`update notification_queue set status = 'cancelled', status_reason = ${value === "yes" ? "answered_yes" : "answered_no"}, updated_at = now()
          where user_id = ${userId} and local_date = ${date} and item_id = ${itemId} and status = 'pending' and kind in ${t(kinds)}`;
}

interface QueueRow {
  id: string;
  user_id: string;
  item_id: string | null;
  local_date: string;
  kind: NotificationKind;
  scheduled_for: Date;
  dedupe_key: string;
  title: string;
  body: string;
  attempts: number;
}

async function summaryBody(sql: Sql, userId: string, kind: NotificationKind, date: LocalDate, s: UserSettings): Promise<string> {
  const range = kind === "weekly_summary" ? weekRange(addDays(date, -1), s.weekStart) : monthRange(addDays(date, -1));
  const rows = await sql`select * from day_records where user_id = ${userId} and local_date between ${range.start} and ${range.end}`;
  const days = rows.map(mapDay).map((d) => ({ date: d.date, status: d.status, applicable: d.applicable, yes: d.yes }));
  const g = periodGrade(days, range.start, range.end, date, s.gradeThresholds);
  const label = kind === "weekly_summary" ? "Last week" : "Last month";
  if (g.pct === null) return `${label}: no scored days.`;
  const perfect = perfectStreaks(days).perfectDays;
  return `${label}: ${formatPct(g.pct)} (${g.grade}) over ${g.countedDays} day${g.countedDays === 1 ? "" : "s"}, ${perfect} perfect.`;
}

export interface DispatchStats {
  claimed: number;
  sent: number;
  cancelled: number;
  suppressed: number;
  expired: number;
  failed: number;
  retrying: number;
}

/**
 * Delivers due notifications. Each row is claimed with SKIP LOCKED so concurrent runs never
 * double-send, every attempt is logged, and validity is re-checked right before sending.
 * Failures never affect scores.
 */
export async function dispatchDue(sql: Sql, sender: PushSender, now: Date, limit = 200): Promise<DispatchStats> {
  const stats: DispatchStats = { claimed: 0, sent: 0, cancelled: 0, suppressed: 0, expired: 0, failed: 0, retrying: 0 };
  await sql`update notification_queue set status = 'pending', claimed_at = null
            where status = 'sending' and claimed_at < ${addMinutes(now, -STALE_CLAIM_MINUTES)}`;
  const claimed = (await sql`
    update notification_queue set status = 'sending', claimed_at = ${now}, updated_at = now()
    where id in (
      select id from notification_queue
      where status = 'pending' and scheduled_for <= ${now} and (next_attempt_at is null or next_attempt_at <= ${now})
      order by scheduled_for limit ${limit} for update skip locked)
    returning *`) as unknown as QueueRow[];
  stats.claimed = claimed.length;

  const settingsCache = new Map<string, UserSettings>();
  for (const n of claimed) {
    const s = settingsCache.get(n.user_id) ?? (await getSettings(sql, n.user_id, { now }));
    settingsCache.set(n.user_id, s);
    const finish = (status: string, reason: string | null) =>
      sql`update notification_queue set status = ${status}, status_reason = ${reason}, updated_at = now(), sent_at = ${status === "sent" ? now : null} where id = ${n.id}`;

    const [dayRow] = await sql`select * from day_records where user_id = ${n.user_id} and local_date = ${n.local_date}`;
    const dayFinal = dayRow ? dayRow.status === "final" : false;
    let response: ResponseValue | undefined;
    let itemScheduled: boolean | undefined;
    let rulesEnabled: boolean | undefined;
    let reconsider: boolean | undefined;
    let unanswered: number | undefined;
    let body = n.body;
    let title = n.title;
    if (n.item_id) {
      const [di] = await sql`select * from day_items where user_id = ${n.user_id} and local_date = ${n.local_date} and item_id = ${n.item_id}`;
      const [st] = await sql`select status from items where id = ${n.item_id}`;
      const [r] = await sql`select * from item_notification_rules where item_id = ${n.item_id}`;
      const rules = mapRules(r);
      itemScheduled = Boolean(di) && st?.status === "active";
      response = (di?.response as ResponseValue) ?? null;
      rulesEnabled = rules.enabled;
      reconsider = rules.reconsiderAfterNo;
      if (di) title = di.name as string;
    } else if (n.kind === "evening") {
      const [c] = await sql`select count(*) filter (where response is null)::int as n from day_items where user_id = ${n.user_id} and local_date = ${n.local_date}`;
      unanswered = c.n;
      body = messages.evening(unanswered ?? 0);
    } else if (n.kind === "weekly_summary" || n.kind === "monthly_summary") {
      body = await summaryBody(sql, n.user_id, n.kind, n.local_date, s);
    }

    const decision = decideSend(n.kind, n.scheduled_for, {
      now,
      notificationsEnabled: s.notificationsEnabled,
      quietHoursEnabled: s.quietHoursEnabled,
      quietStart: s.quietStart,
      quietEnd: s.quietEnd,
      timezone: s.timezone,
      dayFinal,
      itemScheduled,
      itemRulesEnabled: rulesEnabled,
      response,
      reconsiderAfterNo: reconsider,
      unansweredCount: unanswered,
    });
    if (decision.action !== "send") {
      const status = decision.action === "cancel" ? "cancelled" : decision.action === "suppress" ? "suppressed" : "expired";
      stats[status === "cancelled" ? "cancelled" : status === "suppressed" ? "suppressed" : "expired"]++;
      await finish(status, decision.reason);
      continue;
    }

    const subs = await sql`select id, endpoint, p256dh, auth from push_subscriptions where user_id = ${n.user_id} and disabled_at is null`;
    if (!subs.length || !sender.configured) {
      stats.failed++;
      await sql`insert into notification_attempts (queue_id, user_id, success, error) values (${n.id}, ${n.user_id}, false, ${!sender.configured ? "push_not_configured" : "no_push_subscription"})`;
      await finish("failed", !sender.configured ? "push_not_configured" : "no_push_subscription");
      continue;
    }

    const payload = JSON.stringify({
      title,
      body,
      kind: n.kind,
      tag: n.item_id ? `${n.item_id}:${n.local_date}` : `${n.kind}:${n.local_date}`,
      url: n.item_id ? `/?date=${n.local_date}&item=${n.item_id}` : n.kind.endsWith("summary") ? "/history" : "/",
      token: makeActionToken(n.id),
      itemActions: Boolean(n.item_id),
    });
    let anyOk = false;
    let anyTransient = false;
    let lastError: string | null = null;
    for (const sub of subs) {
      const res = await sender.send(sub as never, payload, 60 * MAX_LATENESS_MINUTES);
      const cls = res.ok ? {} : { ...classifyStatus(res.statusCode), ...res };
      await sql`insert into notification_attempts (queue_id, user_id, subscription_id, success, status_code, error)
                values (${n.id}, ${n.user_id}, ${sub.id}, ${res.ok}, ${res.statusCode ?? null}, ${res.error ?? null})`;
      if (res.ok) {
        anyOk = true;
        await sql`update push_subscriptions set last_success_at = ${now} where id = ${sub.id}`;
      } else {
        lastError = res.error ?? `status_${res.statusCode}`;
        if ("gone" in cls && cls.gone) await sql`update push_subscriptions set disabled_at = ${now}, disabled_reason = ${"gone_" + res.statusCode} where id = ${sub.id}`;
        if ("transient" in cls && cls.transient) anyTransient = true;
      }
    }
    if (anyOk) {
      stats.sent++;
      await finish("sent", null);
    } else if (anyTransient && n.attempts + 1 < MAX_SEND_ATTEMPTS) {
      stats.retrying++;
      const backoff = 2 ** n.attempts; // 1, 2, 4 minutes
      await sql`update notification_queue set status = 'pending', attempts = attempts + 1, next_attempt_at = ${addMinutes(now, backoff)},
                status_reason = ${lastError}, claimed_at = null, updated_at = now() where id = ${n.id}`;
    } else {
      stats.failed++;
      await sql`update notification_queue set attempts = attempts + 1 where id = ${n.id}`;
      await finish("failed", lastError);
    }
  }
  return stats;
}

export type NotificationAction = "yes" | "no" | "snooze" | "open";

/** Handles a tap on a notification action. Idempotent per (notification, action). */
export async function handleNotificationAction(sql: Sql, token: string, action: NotificationAction, now = new Date()) {
  const queueId = verifyActionToken(token);
  if (!queueId) return { ok: false as const, error: "invalid_token" };
  const [n] = (await sql`select * from notification_queue where id = ${queueId}`) as unknown as QueueRow[];
  if (!n) return { ok: false as const, error: "not_found" };
  const fresh = await sql`insert into notification_actions (queue_id, action, user_id) values (${queueId}, ${action}, ${n.user_id})
                          on conflict do nothing returning queue_id`;
  if (!fresh.length) return { ok: true as const, duplicate: true, userId: n.user_id };

  if ((action === "yes" || action === "no") && n.item_id) {
    const res = await writeResponse(sql, n.user_id, {
      mutationId: `notif:${queueId}:${action}`,
      date: n.local_date,
      itemId: n.item_id,
      value: action,
      clientTime: now,
      source: "notification",
      isCorrection: false,
    }, now);
    return { ok: true as const, duplicate: false, userId: n.user_id, result: res };
  }
  if (action === "snooze" && n.item_id) {
    const [r] = await sql`select * from item_notification_rules where item_id = ${n.item_id}`;
    const at = addMinutes(now, mapRules(r).snoozeMinutes);
    await sql`insert into notification_queue (user_id, item_id, local_date, kind, scheduled_for, dedupe_key, title, body)
              values (${n.user_id}, ${n.item_id}, ${n.local_date}, 'snooze', ${at}, ${`snooze|${queueId}`}, ${n.title}, ${messages.nudge(n.title)})
              on conflict (dedupe_key) do nothing`;
    return { ok: true as const, duplicate: false, userId: n.user_id, snoozedUntil: at };
  }
  return { ok: true as const, duplicate: false, userId: n.user_id };
}

/** Queues and immediately attempts a test notification for the settings screen. */
export async function sendTestNotification(sql: Sql, sender: PushSender, userId: string, now = new Date()) {
  const [row] = await sql`insert into notification_queue (user_id, local_date, kind, scheduled_for, dedupe_key, title, body)
                          values (${userId}, ${now.toISOString().slice(0, 10)}, 'test', ${now}, ${`test|${userId}|${now.toISOString()}`},
                                  'Rayne Fit', 'Notifications are working. Stay accountable.') returning id`;
  await dispatchDue(sql, sender, now);
  const [after] = await sql`select status, status_reason from notification_queue where id = ${row.id}`;
  return { status: after.status as string, reason: after.status_reason as string | null };
}

/** Upcoming and recently due reminders for the dashboard (in-app reminders when push is unavailable). */
export async function upcomingForDay(sql: Sql, userId: string, date: LocalDate, now: Date) {
  const rows = await sql`
    select id, item_id, kind, scheduled_for, title, body, status, status_reason from notification_queue
    where user_id = ${userId} and local_date = ${date} and kind in ('reminder','nudge','deadline','snooze','evening')
      and (status in ('pending','sending') or (status in ('sent','failed','suppressed','expired') and scheduled_for >= ${addMinutes(now, -180)}))
    order by scheduled_for`;
  return rows.map((r) => ({
    id: r.id as string,
    itemId: (r.item_id as string) ?? null,
    kind: r.kind as NotificationKind,
    scheduledFor: (r.scheduled_for as Date).toISOString(),
    title: r.title as string,
    body: r.body as string,
    status: r.status as string,
    reason: (r.status_reason as string) ?? null,
  }));
}

export async function saveSubscription(sql: Sql, userId: string, sub: { endpoint: string; p256dh: string; auth: string; userAgent?: string | null }) {
  await sql`insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
            values (${userId}, ${sub.endpoint}, ${sub.p256dh}, ${sub.auth}, ${sub.userAgent ?? null})
            on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
              user_agent = excluded.user_agent, disabled_at = null, disabled_reason = null`;
}

export async function removeSubscription(sql: Sql, userId: string, endpoint: string) {
  await sql`update push_subscriptions set disabled_at = now(), disabled_reason = 'unsubscribed' where user_id = ${userId} and endpoint = ${endpoint}`;
}

export async function planForAll(sql: Sql, now: Date) {
  const users = await sql`select user_id from user_settings`;
  for (const u of users) await planForUser(sql, u.user_id as string, now);
  return users.length;
}
