import { db } from "@/server/db";
import { authed, body, json } from "@/server/http";
import { saveVision, visionSchema } from "@/server/vision";

export const dynamic = "force-dynamic";

/** The user writes or revises their vision directly (a new version is saved). */
export const PUT = authed(async (userId, req) => {
  const v = await body(req, visionSchema);
  return json({ vision: await saveVision(db(), userId, v, "user") });
});
