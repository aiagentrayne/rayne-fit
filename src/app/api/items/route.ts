import { db } from "@/server/db";
import { authed, bestEffort, body, json } from "@/server/http";
import { createItem, itemInputSchema, listItems } from "@/server/items";
import { planForUser } from "@/server/notifications";

export const dynamic = "force-dynamic";

export const GET = authed(async (userId, req) => {
  const all = new URL(req.url).searchParams.get("all") === "1";
  return json({ items: await listItems(db(), userId, { includeDeleted: false }).then((l) => (all ? l : l.filter((i) => i.status !== "archived"))) });
});

export const POST = authed(async (userId, req) => {
  const input = await body(req, itemInputSchema);
  const sql = db();
  const id = await createItem(sql, userId, input);
  await bestEffort("replan", () => planForUser(sql, userId, new Date()));
  return json({ id }, 201);
});
