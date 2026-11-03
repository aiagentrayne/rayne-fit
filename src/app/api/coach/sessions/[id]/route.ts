import { z } from "zod";
import { db } from "@/server/db";
import { authed, json } from "@/server/http";
import { getSession } from "@/server/coach/sessions";
import { listProposals } from "@/server/proposals";

export const dynamic = "force-dynamic";

export const GET = authed<{ id: string }>(async (userId, _req, p) => {
  const sql = db();
  const data = await getSession(sql, userId, z.string().uuid().parse(p.id));
  const proposals = (await listProposals(sql, userId, "all")).filter((x) => data.proposalIds.includes(x.id));
  return json({ ...data, proposals });
});
