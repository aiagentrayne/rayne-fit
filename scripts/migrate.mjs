// Applies SQL files in supabase/migrations in order, once each.
// Usage: DATABASE_URL=postgres://... node scripts/migrate.mjs
// (With the Supabase CLI you can instead run `supabase db push`.)
import postgres from "postgres";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export async function migrate(url, { log = console.log } = {}) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
    const dir = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "supabase", "migrations");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    const done = new Set((await sql`select name from public.schema_migrations`).map((r) => r.name));
    for (const f of files) {
      if (done.has(f)) continue;
      const body = await readFile(path.join(dir, f), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into public.schema_migrations (name) values (${f})`;
      });
      log(`applied ${f}`);
    }
  } finally {
    await sql.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  migrate(url).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
