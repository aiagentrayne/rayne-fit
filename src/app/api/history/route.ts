import { db } from "@/server/db";
import { authed, json } from "@/server/http";
import { getHistory } from "@/server/summary";

export const dynamic = "force-dynamic";

export const GET = authed(async (userId) => json(await getHistory(db(), userId, new Date())));
