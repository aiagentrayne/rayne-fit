import { db } from "@/server/db";
import { authed, json } from "@/server/http";
import { getProgress } from "@/server/coach/hub";

export const dynamic = "force-dynamic";

export const GET = authed(async (userId) => json(await getProgress(db(), userId, new Date())));
