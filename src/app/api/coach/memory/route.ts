import { z } from "zod";
import { db } from "@/server/db";
import { authed, body, json } from "@/server/http";
import { addMemory, listMemory } from "@/server/coach/hub";

export const dynamic = "force-dynamic";

export const GET = authed(async (userId) => json({ memory: await listMemory(db(), userId) }));

export const POST = authed(async (userId, req) => {
  const m = await body(req, z.object({ kind: z.enum(["obstacle", "strategy", "preference", "fact"]), text: z.string().trim().min(1).max(500) }));
  await addMemory(db(), userId, m.kind, m.text);
  return json({ ok: true }, 201);
});
