import { NextResponse } from "next/server";
import { supabaseServer } from "@/server/auth";

export const dynamic = "force-dynamic";

/** Handles email confirmation / magic-link redirects from Supabase Auth. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (code) {
    const supabase = await supabaseServer();
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL("/", url.origin));
}
