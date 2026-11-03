import { db } from "@/server/db";
import { authed, json } from "@/server/http";
import { deleteAllUserData } from "@/server/coach/hub";

export const dynamic = "force-dynamic";

/** Deletes every Rayne Fit record for the signed-in user. */
export const DELETE = authed(async (userId) => {
  await deleteAllUserData(db(), userId);
  return json({ ok: true });
});
