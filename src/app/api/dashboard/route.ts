import { db } from "@/server/db";
import { authed, json } from "@/server/http";
import { getDashboard } from "@/server/summary";

export const dynamic = "force-dynamic";

export const GET = authed(async (userId, req) => {
  const tz = new URL(req.url).searchParams.get("tz") ?? undefined;
  const sql = db();
  if (tz) {
    // First visit: seed the user's time zone from the device.
    const { getSettings } = await import("@/server/settings");
    await getSettings(sql, userId, { timezone: tz });
  }
  return json(await getDashboard(sql, userId, new Date()));
});
