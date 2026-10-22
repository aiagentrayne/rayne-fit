/**
 * LOCAL DEMO DATA ONLY. Gives a user ~5 weeks of realistic history.
 * Usage: DATABASE_URL=... npx tsx scripts/seed-demo.mts <user-id>
 */
import { createSql } from "../src/server/db";
import { getSettings } from "../src/server/settings";
import { createItem } from "../src/server/items";
import { writeResponse } from "../src/server/responses";
import { finalizeDueForUser, getToday } from "../src/server/days";
import { planForUser } from "../src/server/notifications";
import { addDays, zonedInstant } from "../src/lib/core/time";
import { currentDay } from "../src/lib/core/days";
import { DEFAULT_ITEM_RULES } from "../src/lib/core/reminders";

const userId = process.argv[2];
if (!userId || process.env.NODE_ENV === "production") throw new Error("usage: seed-demo <user-id> (dev only)");
const sql = createSql(process.env.DATABASE_URL!, 2);

const now = new Date();
const s = await getSettings(sql, userId, { timezone: "America/New_York", now });
const today = currentDay(now, s);
const start = addDays(today, -35);
await sql`update user_settings set scoring_start_date = ${start}, timezone = 'America/New_York' where user_id = ${userId}`;
const at = (d: string, t: string) => zonedInstant(d, t, "America/New_York");
const created = at(start, "06:00");

const defs = [
  { name: "Exercise", category: "Health", rules: { ...DEFAULT_ITEM_RULES, reminderTimes: ["06:00"], nudgeOffsets: [15, 30, 60], deadlineWarningMinutes: null }, p: 0.75 },
  { name: "Read 20 pages", category: "Mind", dueTime: "21:00", rules: { ...DEFAULT_ITEM_RULES, reminderTimes: ["19:00"], deadlineWarningMinutes: 30 }, p: 0.8 },
  { name: "No sugar", category: "Health", rules: { ...DEFAULT_ITEM_RULES }, p: 0.6 },
  { name: "Drink 3L water", category: "Health", rules: { ...DEFAULT_ITEM_RULES, reminderTimes: ["12:00", "16:00"] }, p: 0.85 },
  { name: "Meal prep", category: "Nutrition", scheduleType: "custom" as const, daysOfWeek: [7, 3], rules: { ...DEFAULT_ITEM_RULES }, p: 0.7 },
  { name: "Lights out by 10:30", category: "Sleep", scheduleType: "weekdays" as const, rules: { ...DEFAULT_ITEM_RULES, reminderTimes: ["22:00"] }, p: 0.55 },
];
const ids: string[] = [];
for (const d of defs) {
  ids.push(await createItem(sql, userId, { name: d.name, category: d.category, scheduleType: d.scheduleType ?? "daily", daysOfWeek: d.daysOfWeek ?? [], startDate: start, dueTime: d.dueTime ?? null, rules: d.rules }, created));
}
let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (let d = start; d < today; d = addDays(d, 1)) {
  const { items } = await getToday(sql, userId, at(d, "07:00"));
  for (const it of items) {
    const p = defs[ids.indexOf(it.itemId)]?.p ?? 0.7;
    const r = rand();
    if (r < 0.06) continue; // occasionally forgotten -> auto NO at cutoff
    const value = r < p + 0.06 ? "yes" : "no";
    await writeResponse(sql, userId, { mutationId: `seed-${d}-${it.itemId}`, date: d, itemId: it.itemId, value, clientTime: at(d, "20:00"), source: "app", isCorrection: false }, at(d, "20:00"));
  }
  await finalizeDueForUser(sql, userId, at(addDays(d, 1), "06:00"));
}
const { items } = await getToday(sql, userId, now);
for (const it of items.slice(0, 2)) {
  await writeResponse(sql, userId, { mutationId: `seed-today-${it.itemId}`, date: today, itemId: it.itemId, value: "yes", clientTime: now, source: "app", isCorrection: false }, now);
}
await planForUser(sql, userId, now);
console.log("seeded", start, "->", today);
await sql.end();
