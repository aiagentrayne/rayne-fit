import { cookies } from "next/headers";
import { devAuthEnabled, supabaseServer } from "@/server/auth";
import { json, open } from "@/server/http";

export const dynamic = "force-dynamic";

export const POST = open(async () => {
  if (devAuthEnabled()) (await cookies()).delete("dev_user");
  else await (await supabaseServer()).auth.signOut();
  return json({ ok: true });
});
