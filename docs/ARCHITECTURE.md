# Architecture

## Principles

1. **The server is the authority.** Every check-in, correction, finalization and grade is computed on the server. Signed-in clients can read their own rows (row-level security) but cannot write to any table directly; all writes go through validated API routes.
2. **History is immutable unless you say otherwise.** Item definitions are versioned; each day stores a snapshot of the items that applied to it. Only an explicit, audited correction changes a finalized day.
3. **Full precision, display rounding.** Scores are stored as `double precision` and graded unrounded. `66.666…%` is a D. The UI never shows `100%` for an imperfect day.
4. **Idempotent everything.** Check-ins carry client mutation ids, notifications carry dedupe keys, jobs can run twice.
5. **Notifications help; they never score.** A failed push changes nothing about your grades.

## Data model (`supabase/migrations/20261022000001_init.sql`)

| Table | Purpose |
| --- | --- |
| `user_settings` | Time zone, daily cutoff, week start, grading scale, notification master switch, quiet hours, evening reminder, summaries, dashboard prefs, scoring start date. |
| `items` | Identity, display order and status (active / inactive / archived / deleted). |
| `item_versions` | Immutable definitions: name, description, category, recurrence (daily / weekdays / weekends / chosen days), effective start/end, due time, active flag, `created_at`. |
| `item_notification_rules` | Per item: on/off, reminder times, minutes-before-due reminders, nudge offsets, deadline warning, snooze length, reconsider-after-NO, custom message. |
| `day_records` | One row per user-day: open/final, time zone and cutoff used, cutoff instant, counts, full-precision score, grade, finalized time. |
| `day_items` | Dated snapshot of each applicable item (name copied) and its response, response time and source (`app`, `offline`, `notification`, `correction`, `auto`). |
| `response_events` | Every check-in attempt keyed by `(user, mutation_id)` with its outcome. Gives idempotency and a raw log. |
| `corrections` | Audit trail for finalized days: old/new value, old/new score, reason, kind (`correction` or `late_offline_sync`), time. |
| `push_subscriptions` | Device endpoints; disabled automatically on 404/410. |
| `notification_queue` | Planned notifications with unique `dedupe_key`, status (`pending`, `sending`, `sent`, `cancelled`, `suppressed`, `expired`, `failed`), attempts, backoff. |
| `notification_attempts` | One row per delivery attempt per device with status code / error, for troubleshooting. |
| `notification_actions` | `(notification, action)` primary key, so a double tap on "Mark YES" is processed once. |
| `job_leases` | Lease that stops overlapping scheduler runs (pooler-safe, unlike advisory locks). |

## Scoring rules

- **Applicable items for a day** = items whose governing version is active, inside its start/end dates, and scheduled on that weekday.
- **Governing version** = the latest version created at or before `min(now, cutoff)`. Editing, pausing or deleting an item today never reaches yesterday; adding an item with a back-dated start never adds it to already-closed days.
- **Daily** = YES / applicable × 100. Pending is not credit. Zero applicable = **N/A**, excluded from averages and streaks.
- **Finalization** at the cutoff instant: unanswered → NO (`auto`), counts, score and grade saved, queued notifications for that day cancelled. Days you never opened are back-filled the same way, starting from your scoring start date (sign-up day).
- **Weekly / monthly** = arithmetic mean of finalized, applicable day percentages in the period (equal day weight). Periods that include today, or have unfinalized past days, are **Provisional**. No finalized days = **N/A, awaiting finalized days**. Today's live score is shown separately and never mixed into those averages.
- **Corrections** recompute the day; period grades are computed on read, so they update immediately.

## Time policy

- Days are calendar dates in the user's time zone. The default cutoff is 23:59. A cutoff **before noon** is a late-night cutoff: a 01:30 cutoff closes Tuesday at 01:30 on Wednesday, and until then "today" is still Tuesday.
- **DST**: a wall-clock time that doesn't exist (spring forward, e.g. 02:30) moves forward by the gap (03:30). A time that happens twice (fall back, 01:30) means the first occurrence. Week and month boundaries are calendar-based. On 23- and 25-hour days the cutoff is still 23:59 local.
- **Changing time zone or cutoff** applies to the open day only if the new cutoff is still in the future; otherwise the open day keeps its original cutoff and the change starts tomorrow. Each day stores the zone and cutoff it was scored with.
- Due times are wall-clock times on the item's day.

## Offline and conflicts (`src/lib/core/sync.ts`)

Taps are written to an IndexedDB outbox first, shown immediately, and sent in batches (on tap, every 30 s, on reconnect, on focus, and via Background Sync where the browser supports it). The policy:

1. **Open day:** last tap wins by device tap time. An older offline tap that arrives after a newer answer is reported back as `stale`; the server value stays.
2. **Finalized day:** only an explicit correction changes it, except that an offline answer tapped **before** the cutoff and synced within 72 hours replaces the automatic NO. That is audited as `late_offline_sync`.
3. Same value twice = no-op. Device clocks more than 5 minutes ahead of the server are clamped.
4. The UI shows Offline / N waiting to sync / Syncing / Synced, and tells the user when answers were not applied.

## Reminders and nudges

**Planning** (`planDay`): per item, reminders at fixed times and/or N minutes before the due time; nudges at offsets after the first reminder (or the due time when there is no reminder); a deadline warning N minutes before the due time (or the cutoff). Plus an evening reminder and weekly/monthly summaries. Nothing is planned after the cutoff, or for unscheduled/inactive items. Every notification has a stable dedupe key, so the planner can run every minute.

**Re-planning** happens on every tick and after any item, rule, settings or subscription change; rows no longer in the plan are cancelled.

**Answering cancels**: YES cancels all remaining reminders, nudges, deadline warnings and snoozes for that item and day, in the same transaction as the answer. NO does the same unless "keep nudging after a NO" is on, in which case only the "time to…" reminders stop.

**Delivery** (`dispatchDue`): rows are claimed with `FOR UPDATE SKIP LOCKED`, then re-checked right before sending (answered? day closed? item still scheduled? master switch? quiet hours at both scheduled and actual time? more than 20 minutes late → expired). Each device attempt is logged. 404/410 disables the subscription; network/429/5xx errors retry with 1, 2, 4 minute backoff up to 4 attempts. A crashed claim is released after 10 minutes. Devices also collapse duplicates via a per-item notification `tag`.

**Actions** (Mark YES, Mark NO, Snooze, open): the push payload carries an HMAC-signed token bound to one queued notification, so the service worker can act without cookies and cannot touch any other item or date. Each action is processed once.

**When push isn't available** (iPhone in a Safari tab, permission denied, unsupported browser, no VAPID keys): the queue still runs and records `failed: no_push_subscription`, and the Today screen shows due reminders in-app plus the next scheduled reminder and a link to fix notifications.

## Security and privacy

- Supabase Auth (password or one-time email code). Every API route verifies the session with `auth.getUser()` and scopes every query by that user id.
- RLS on every table: `select` own rows only; `insert/update/delete` revoked from `anon` and `authenticated`.
- Zod validation on every input, DB check constraints as a second layer, security headers (HSTS, nosniff, frame deny, referrer policy).
- Secrets: VAPID private key, action token secret and cron secret live only in server env vars. The cron endpoint uses a constant-time bearer comparison.
- Minimal data: email, items, answers, settings, push endpoints. No analytics or third-party scripts. Users can download all their data from Settings. Sign-out clears the device's cached data.

## Native alarm extension path

Web push can't ring like the Clock app, bypass Silent Mode/Focus, or guarantee second-exact delivery. The notification layer is built so a native companion can plug in:

- The planner (`src/lib/core/reminders.ts`) is pure and produces the full schedule with stable keys.
- A small iOS app (Swift, or React Native/Expo) would authenticate with the same Supabase project, fetch the planned rows for the next 24–48 hours, and schedule **local** notifications with `UNUserNotificationCenter` (and Time-Sensitive / Critical Alerts entitlement where Apple approves it), using the dedupe key as the notification identifier so updates replace rather than duplicate.
- Answers from the native app post to the same `/api/responses` endpoint with mutation ids; cancellation is just removing pending local notifications by identifier when the server reports YES.
- `push_subscriptions` would gain a `kind` column (`webpush` | `apns`) and `PushSender` an APNs implementation; nothing in scoring changes.
