import { z } from "zod";
import { db } from "@/server/db";
import { authed, body, json } from "@/server/http";
import { messageSchema, sendMessage } from "@/server/coach/sessions";
import { listProposals } from "@/server/proposals";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = authed<{ id: string }>(async (userId, req, p) => {
  const m = await body(req, messageSchema);
  const sql = db();
  const data = await sendMessage(sql, userId, z.string().uuid().parse(p.id), m.text, m.viaVoice ?? false);
  const proposals = (await listProposals(sql, userId, "all")).filter((x) => data.proposalIds.includes(x.id));
  return json({ ...data, proposals });
});
