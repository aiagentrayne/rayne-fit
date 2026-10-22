import postgres from "postgres";

export type Sql = postgres.Sql | postgres.TransactionSql;

/** Postgres client. DATE columns stay as "YYYY-MM-DD" strings (no JS Date time-zone shifts). */
export function createSql(url: string, max = 5): postgres.Sql {
  return postgres(url, {
    max,
    prepare: false, // compatible with Supabase's transaction pooler (port 6543)
    idle_timeout: 20,
    onnotice: () => {},
    types: {
      localDate: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
    },
  });
}

let client: postgres.Sql | null = null;

export function db(): postgres.Sql {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    client = createSql(url);
  }
  return client;
}

/** Runs `fn` in a transaction, or inside the caller's transaction if already in one. */
export async function tx<T>(sql: Sql, fn: (t: postgres.TransactionSql) => Promise<T>): Promise<T> {
  if ("savepoint" in sql) return fn(sql as postgres.TransactionSql);
  return (sql as postgres.Sql).begin(fn) as Promise<T>;
}
