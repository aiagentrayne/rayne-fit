import { setupTestDatabase } from "./integration/db";

/** Prepares a disposable Postgres database for integration tests when TEST_DATABASE_URL is set. */
export default async function setup() {
  if (process.env.TEST_DATABASE_URL) await setupTestDatabase(process.env.TEST_DATABASE_URL);
}
