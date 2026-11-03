import { z } from "zod";
import { db } from "@/server/db";
import { authed, bestEffort, body, json } from "@/server/http";
import { decideProposal } from "@/server/proposals";
import { planForUser } from "@/server/notifications";

export const dynamic = "force-dynamic";

/** The user's explicit decision on one of ROSS's suggestions. */
export const POST = authed<{ id: string }>(async (userId, req, p) => {
  const { approve } = await body(req, z.object({ approve: z.boolean() }));
  const sql = db();
  const result = await decideProposal(sql, userId, z.string().uuid().parse(p.id), approve);
  if (result.status === "applied") await bestEffort("replan", () => planForUser(sql, userId, new Date()));
  return json(result);
});
