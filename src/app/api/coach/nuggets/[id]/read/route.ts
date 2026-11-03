import { z } from "zod";
import { db } from "@/server/db";
import { authed, json } from "@/server/http";
import { markNuggetRead } from "@/server/coach/nuggets";

export const dynamic = "force-dynamic";

export const POST = authed<{ id: string }>(async (userId, _req, p) => {
  await markNuggetRead(db(), userId, z.string().uuid().parse(p.id));
  return json({ ok: true });
});
