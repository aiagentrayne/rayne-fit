import { z } from "zod";
import { db } from "@/server/db";
import { authed, bestEffort, body, json } from "@/server/http";
import { getItem, itemInputSchema, setItemStatus, updateItem, NotFoundError } from "@/server/items";
import { planForUser } from "@/server/notifications";

export const dynamic = "force-dynamic";

const id = z.string().uuid();

export const GET = authed<{ id: string }>(async (userId, _req, p) => {
  const item = await getItem(db(), userId, id.parse(p.id));
  if (!item || item.status === "deleted") throw new NotFoundError("Item not found.");
  return json({ item });
});

export const PUT = authed<{ id: string }>(async (userId, req, p) => {
  const input = await body(req, itemInputSchema);
  const sql = db();
  await updateItem(sql, userId, id.parse(p.id), input);
  await bestEffort("replan", () => planForUser(sql, userId, new Date()));
  return json({ ok: true });
});

/** Soft delete: history keeps the item's name and answers. */
export const DELETE = authed<{ id: string }>(async (userId, _req, p) => {
  const sql = db();
  await setItemStatus(sql, userId, id.parse(p.id), "deleted");
  await bestEffort("replan", () => planForUser(sql, userId, new Date()));
  return json({ ok: true });
});

const statusSchema = z.object({ status: z.enum(["active", "inactive", "archived"]) });

export const PATCH = authed<{ id: string }>(async (userId, req, p) => {
  const { status } = await body(req, statusSchema);
  const sql = db();
  await setItemStatus(sql, userId, id.parse(p.id), status);
  await bestEffort("replan", () => planForUser(sql, userId, new Date()));
  return json({ ok: true });
});
