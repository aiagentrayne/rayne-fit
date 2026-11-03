import { z } from "zod";
import { db } from "@/server/db";
import { authed, body, json } from "@/server/http";
import { deleteMemory, memoryPatchSchema, updateMemory } from "@/server/coach/hub";

export const dynamic = "force-dynamic";

const id = z.string().uuid();

export const PATCH = authed<{ id: string }>(async (userId, req, p) => {
  await updateMemory(db(), userId, id.parse(p.id), await body(req, memoryPatchSchema));
  return json({ ok: true });
});

export const DELETE = authed<{ id: string }>(async (userId, _req, p) => {
  await deleteMemory(db(), userId, id.parse(p.id));
  return json({ ok: true });
});
