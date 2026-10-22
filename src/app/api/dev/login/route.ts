import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { devAuthEnabled } from "@/server/auth";
import { json, open } from "@/server/http";

export const dynamic = "force-dynamic";

/** Local development only (DEV_AUTH=1, never in production): sign in as a local test user. */
export const POST = open(async () => {
  if (!devAuthEnabled()) return json({ error: "not found" }, 404);
  const store = await cookies();
  let id = store.get("dev_user")?.value;
  if (!id) {
    id = randomUUID();
    await db()`insert into auth.users (id, email) values (${id}, ${"dev@local"}) on conflict do nothing`;
  }
  store.set("dev_user", id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  return json({ ok: true, userId: id });
});
