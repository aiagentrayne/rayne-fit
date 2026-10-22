import { db } from "@/server/db";
import { authed, json } from "@/server/http";
import { sendTestNotification } from "@/server/notifications";
import { defaultSender } from "@/server/push";

export const dynamic = "force-dynamic";

export const POST = authed(async (userId) => json(await sendTestNotification(db(), defaultSender(), userId)));
