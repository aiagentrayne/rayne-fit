import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Local-only sign-in for development and end-to-end tests. Refused whenever Supabase Auth is
 * configured or the app runs on Vercel, so a real deployment can never enable it.
 */
export function devAuthEnabled(): boolean {
  return process.env.DEV_AUTH === "1" && !process.env.NEXT_PUBLIC_SUPABASE_URL && !process.env.VERCEL;
}

export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a context that cannot set cookies; the session is refreshed on the next API call.
        }
      },
    },
  });
}

/**
 * Returns the verified user id for this request or throws 401. Uses Supabase Auth's
 * getUser(), which validates the JWT with the auth server (not just the cookie contents).
 */
export async function requireUserId(): Promise<string> {
  if (devAuthEnabled()) {
    const id = (await cookies()).get("dev_user")?.value;
    if (id && /^[0-9a-f-]{36}$/.test(id)) return id;
    throw new HttpError(401, "Not signed in");
  }
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new HttpError(401, "Not signed in");
  return data.user.id;
}
