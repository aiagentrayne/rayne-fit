import { z } from "zod";
import { db } from "@/server/db";
import { authed, body, json } from "@/server/http";
import { commitmentStatusSchema, setCommitmentStatus } from "@/server/coach/sessions";

export const dynamic = "force-dynamic";

export const PATCH = authed<{ id: string }>(async (userId, req, p) => {
  const { status } = await body(req, commitmentStatusSchema);
  await setCommitmentStatus(db(), userId, z.string().uuid().parse(p.id), status);
  return json({ ok: true });
});
