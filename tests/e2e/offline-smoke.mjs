/**
 * End-to-end smoke test in an emulated iPhone viewport (Chromium engine):
 * sign in (dev auth), add items, check in, go offline, check in again, reload while
 * offline (service worker serves the app shell + cached data), reconnect and verify sync.
 *
 * Needs a production build running locally with DEV_AUTH=1 and no Supabase URL:
 *   npm run build && DEV_AUTH=1 npm start
 *   npm run test:e2e            (BASE_URL defaults to http://localhost:3000)
 * The script sets PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 so that blocking the
 * network also applies to the service worker. Requires the `playwright` package.
 */
import assert from "node:assert/strict";

const { chromium, devices } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["iPhone 14 Pro"], timezoneId: "America/New_York" });
const page = await ctx.newPage();
const step = (s) => console.log("✓", s);

await page.goto(`${BASE}/login`);
await page.getByText("Continue as local test user").click();
await page.waitForURL(`${BASE}/`);
step("signed in");

await page.goto(`${BASE}/items/new`);
await page.fill("#name", "E2E Stretch");
await page.getByRole("button", { name: "Add item" }).click();
await page.waitForURL(`${BASE}/items`);
await page.goto(`${BASE}/items/new`);
await page.fill("#name", "E2E Journal");
await page.getByRole("button", { name: "Add item" }).click();
await page.waitForURL(`${BASE}/items`);
step("added two items");

await page.goto(`${BASE}/`);
await page.getByRole("button", { name: "Mark E2E Stretch YES" }).click();
await page.getByText("Synced").waitFor();
await page.getByText("50%").first().waitFor();
step("online YES → 50% F, synced");

await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload(); // make sure the service worker controls the page and caches the shell
await page.getByText("Synced").waitFor();
// setOffline doesn't cut off service-worker fetches in Chromium, so also block the network
// at the context level (which does cover the service worker).
const cut = (route) => route.abort("internetdisconnected");
await ctx.setOffline(true);
await ctx.route("**/*", cut);
await page.getByRole("button", { name: "Mark E2E Journal YES" }).click();
await page.getByText(/Offline · 1 saved on device/).waitFor();
await page.getByText("100%").first().waitFor();
step("offline YES kept on device, live score 100%");

await page.reload().catch((e) => console.log("reload error", e.message));
await page.getByText("E2E Journal").waitFor();
if (process.env.DEBUG) console.log(await page.evaluate(async () => {
  const r = await fetch("/api/dashboard?tz=x").then((r) => ({ ok: r.ok, c: r.headers.get("X-From-Cache") }), (e) => String(e));
  return { controlled: Boolean(navigator.serviceWorker.controller), r, onLine: navigator.onLine };
}));
await page.getByText(/Showing the last saved copy/).waitFor();
assert.equal(await page.getByRole("button", { name: "Mark E2E Journal YES" }).getAttribute("aria-pressed"), "true");
step("reload while offline: app shell + cached data + pending answer restored");

await ctx.unroute("**/*", cut);
await ctx.setOffline(false);
await page.evaluate(() => window.dispatchEvent(new Event("online")));
await page.getByText("Synced").waitFor({ timeout: 15000 });
const res = await page.evaluate(() => fetch("/api/dashboard").then((r) => r.json()));
assert.equal(res.today.yes, 2);
assert.equal(res.today.pct, 100);
step("reconnected: server has 2/2 YES = 100%");

await browser.close();
console.log("offline smoke test passed");
