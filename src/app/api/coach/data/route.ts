import { db } from "@/server/db";
import { authed, bestEffort, json } from "@/server/http";
import { deleteCoachingData } from "@/server/coach/hub";
import { planForUser } from "@/server/notifications";

export const dynamic = "force-dynamic";

/** Deletes all coaching data (vision, milestones, interviews, memory, nuggets) and turns ROSS off. */
export const DELETE = authed(async (userId) => {
  const sql = db();
  await deleteCoachingData(sql, userId);
  await bestEffort("replan", () => planForUser(sql, userId, new Date()));
  return json({ ok: true });
});
