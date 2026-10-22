import { db } from "@/server/db";
import { authed, bestEffort, body, json } from "@/server/http";
import { getSettings, settingsPatchSchema, updateSettings } from "@/server/settings";
import { planForUser } from "@/server/notifications";

export const dynamic = "force-dynamic";

export const GET = authed(async (userId) => json({ settings: await getSettings(db(), userId) }));

export const PATCH = authed(async (userId, req) => {
  const patch = await body(req, settingsPatchSchema);
  const sql = db();
  const settings = await updateSettings(sql, userId, patch);
  await bestEffort("replan", () => planForUser(sql, userId, new Date()));
  return json({ settings });
});
