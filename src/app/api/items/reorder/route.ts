import { z } from "zod";
import { db } from "@/server/db";
import { authed, body, json } from "@/server/http";
import { reorderItems } from "@/server/items";

export const dynamic = "force-dynamic";

export const POST = authed(async (userId, req) => {
  const { ids } = await body(req, z.object({ ids: z.array(z.string().uuid()).max(1000) }));
  await reorderItems(db(), userId, ids);
  return json({ ok: true });
});
