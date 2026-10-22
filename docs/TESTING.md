# Testing

```bash
npm run test:unit                                     # pure logic, no database
TEST_DATABASE_URL=postgres://... npm test             # + integration tests on real Postgres (schema is rebuilt)
npm run build && DEV_AUTH=1 npm start; npm run test:e2e   # offline/PWA smoke test in an emulated iPhone viewport
```

CI (`.github/workflows/ci.yml`) runs typecheck, unit + integration tests against Postgres 16, and a production build on every push.

## Spec §12 acceptance criteria → tests

| Requirement | Test |
| --- | --- |
| 2/2 = 100% A+, 1/2 = 50% F, 24/24 = 100% A+, 12/24 = 50% F (plus 4/5, 7/10, 18/24) | `unit/scoring.test.ts` › binary daily scoring |
| 2/3 = 66.666…%, grade D, round only for display; never show 100% unless perfect | `unit/scoring.test.ts`; `integration/days.test.ts` › 2/3 stores full precision |
| Unanswered becomes NO at cutoff; zero scheduled = N/A | `unit/scoring.test.ts`; `integration/days.test.ts` › 1/2 YES…, N/A day, back-fill |
| Item additions/removals/edits never rewrite past grades | `unit/time-and-schedule.test.ts` › version in force at cutoff; `integration/days.test.ts` › adding, editing, deactivating or deleting… |
| Different item counts per day keep equal-day weighting | `unit/scoring.test.ts`; `integration/days.test.ts` › 2/2 then 12/24 → week 75% |
| Weekly/monthly provisional vs final; N/A when nothing finalized; corrections recompute | `unit/scoring.test.ts` › weekly and monthly; `integration/days.test.ts` › historical corrections… |
| Scheduled-day exclusions, start/end dates | `unit/time-and-schedule.test.ts` › recurring schedules; `integration/days.test.ts` › rejects unscheduled items |
| DST (gap and overlap), time-zone shifts, midnight boundary, late-night cutoff | `unit/time-and-schedule.test.ts` › DST policy, cutoff/midnight; `integration/days.test.ts` › time zone and cutoff changes |
| Reminder creation, repeats, presets/custom intervals, deadline warnings, DST reminders | `unit/reminders.test.ts` › reminder planning; `integration/notifications.test.ts` › plans the Exercise example |
| Snooze | `integration/notifications.test.ts` › Snooze schedules exactly one follow-up |
| Quiet hours, master switch | `unit/reminders.test.ts`; `integration/notifications.test.ts` › quiet hours and the master switch |
| YES cancels remaining nudges immediately; NO behaviour with/without reconsideration | `unit/reminders.test.ts`; `integration/notifications.test.ts` › marking YES…, marking NO… |
| Never notify unscheduled/inactive items; finalization cancels the queue | `integration/notifications.test.ts` |
| Push permission denied / unavailable / not configured | `integration/notifications.test.ts` › no push subscription, test notification when push is not configured (UI states covered by the manual checklist) |
| Retry/backoff, expired reminders, gone subscriptions, idempotency, no duplicate sends under concurrency | `integration/notifications.test.ts` › push delivery |
| Notification actions update the right item/date once; forged tokens rejected | `integration/notifications.test.ts` › notification actions |
| Offline check-ins, reconnect, duplicate prevention, explicit conflict resolution | `unit/analytics-sync.test.ts` › offline sync; `integration/days.test.ts` › retries…, offline YES…, older offline tap…; `e2e/offline-smoke.mjs` |
| Streaks with N/A days, per-item 7/30/90/365 rates, frequently missed | `unit/analytics-sync.test.ts`; `integration/days.test.ts` › history exposes… |
| User isolation (RLS) | `integration/notifications.test.ts` › row-level security |
| iPhone Safari and installed Home Screen PWA | Manual checklist below (needs a real device; automated runs use an emulated iPhone viewport in Chromium) |

## Manual iPhone checklist (iOS 16.4+; run on each release)

Safari tab:
- [ ] Login works with password and with the 6-digit email code.
- [ ] Settings › Notifications shows "Install to Home Screen first" with a link to the guide, and no Enable button.
- [ ] Today screen: YES/NO buttons at least 56px tall, score ring and week/month cards readable in sunlight, VoiceOver reads "Mark Exercise YES, toggle button".

Installed Home Screen app:
- [ ] Opens standalone with the Rayne Fit icon and dark splash; the bottom nav clears the home indicator.
- [ ] Enable notifications prompts for permission; "Send test" arrives within a few seconds, locked and unlocked.
- [ ] An item with a reminder 2 minutes out and nudges every 5 min × 2: reminder and nudges arrive; tapping one opens that item highlighted.
- [ ] Mark it YES in the app: no further nudges arrive.
- [ ] Deny permission in iOS Settings: the app shows "Blocked in settings" and in-app reminders still appear on Today.
- [ ] Airplane mode: tap answers, force-quit, reopen: answers still shown with "Offline · N saved on device"; turn network back on: "Synced".
- [ ] Focus/Silent mode: notifications follow the system (documented limitation, not a bug).
