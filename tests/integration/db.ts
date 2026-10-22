import postgres from "postgres";
// @ts-expect-error plain JS module
import { migrate } from "../../scripts/migrate.mjs";

/**
 * Recreates the public schema and a minimal stand-in for Supabase's `auth` schema
 * (auth.users, auth.uid(), anon/authenticated roles), then applies all migrations.
 */
export async function setupTestDatabase(url: string) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql.unsafe(`
    drop schema if exists public cascade;
    create schema public;
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    end $$;
    grant usage on schema public to anon, authenticated;
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key, email text);
    create or replace function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    truncate auth.users cascade;
  `);
  await sql.end();
  await migrate(url, { log: () => {} });
  const sql2 = postgres(url, { max: 1, onnotice: () => {} });
  await sql2.unsafe(`grant select on all tables in schema public to authenticated`);
  await sql2.end();
}
