/* Rayne Fit service worker: app-shell caching, offline check-in sync, Web Push. */
const VERSION = "rf-v2";
const SHELL_CACHE = `${VERSION}-shell`;
const STATIC_CACHE = `${VERSION}-static`;
const API_CACHE = `${VERSION}-api`;
const SHELL = ["/", "/history", "/items", "/settings", "/login", "/install", "/coach", "/progress", "/checkin", "/privacy", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/badge-96.png"];
const CACHEABLE_API = ["/api/dashboard", "/api/history", "/api/items", "/api/settings", "/api/progress", "/api/coach"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(new Request(u, { cache: "reload", credentials: "same-origin" })))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
  if (event.data === "CLEAR_USER_CACHE") event.waitUntil(caches.delete(API_CACHE));
  if (event.data === "FLUSH_OUTBOX") event.waitUntil(flushOutbox());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || req.method !== "GET") return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }
  if (CACHEABLE_API.includes(url.pathname)) {
    event.respondWith(networkFirst(req, API_CACHE));
    return;
  }
  if (url.pathname.startsWith("/api/")) return;
  if (req.mode === "navigate") {
    event.respondWith(
      networkFirst(req, SHELL_CACHE, url.pathname).catch(async () => (await caches.match("/", { ignoreSearch: true })) || Response.error()),
    );
  }
});

async function cacheFirst(req, cacheName) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(cacheName)).put(req, res.clone());
  return res;
}

async function networkFirst(req, cacheName, key) {
  const cacheKey = key || req;
  try {
    const res = await fetch(req);
    if (res.ok && !res.redirected) (await caches.open(cacheName)).put(cacheKey, res.clone());
    return res;
  } catch (e) {
    const hit = await caches.match(cacheKey, { ignoreSearch: true });
    if (hit) {
      const headers = new Headers(hit.headers);
      headers.set("X-From-Cache", "1");
      return new Response(await hit.clone().blob(), { status: hit.status, headers });
    }
    throw e;
  }
}

/* ---------- Offline outbox (shared with the page via idb-keyval's default store) ---------- */

function idb() {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("keyval-store");
    open.onupgradeneeded = () => open.result.createObjectStore("keyval");
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

async function idbGet(key) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const r = db.transaction("keyval", "readonly").objectStore("keyval").get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function idbSet(key, value) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("keyval", "readwrite");
    tx.objectStore("keyval").put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function flushOutbox() {
  const outbox = (await idbGet("outbox")) || [];
  if (!outbox.length) return;
  const res = await fetch("/api/responses", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mutations: outbox }),
  });
  if (!res.ok) throw new Error(`sync failed: ${res.status}`);
  const sent = new Set(outbox.map((m) => m.mutationId));
  const current = (await idbGet("outbox")) || [];
  await idbSet("outbox", current.filter((m) => !sent.has(m.mutationId)));
  const clients = await self.clients.matchAll({ type: "window" });
  const { results } = await res.json();
  clients.forEach((c) => c.postMessage({ type: "OUTBOX_SYNCED", results }));
}

self.addEventListener("sync", (event) => {
  if (event.tag === "flush-outbox") event.waitUntil(flushOutbox());
});

/* ---------- Web Push ---------- */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Rayne Fit", body: event.data ? event.data.text() : "" };
  }
  const max = (self.Notification && self.Notification.maxActions) || 2;
  // Priority order when the platform shows fewer buttons. (iOS shows none; tapping opens the item.)
  const actions = data.itemActions
    ? [
        { action: "yes", title: "✓ Mark YES" },
        { action: "snooze", title: "Snooze" },
        { action: "no", title: "✕ Mark NO" },
      ].slice(0, max)
    : [];
  event.waitUntil(
    self.registration.showNotification(data.title || "Rayne Fit", {
      body: data.body || "",
      tag: data.tag,
      renotify: Boolean(data.tag),
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      data: { url: data.url || "/", token: data.token, kind: data.kind },
      actions,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  const n = event.notification;
  const { url, token } = n.data || {};
  const action = event.action;
  n.close();
  event.waitUntil(
    (async () => {
      if (token && (action === "yes" || action === "no" || action === "snooze")) {
        try {
          const res = await fetch("/api/notifications/action", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token, action }),
          });
          if (res.ok) {
            const clients = await self.clients.matchAll({ type: "window" });
            clients.forEach((c) => c.postMessage({ type: "REFRESH" }));
            return;
          }
        } catch {
          /* offline: fall through and open the item so the user can answer in-app */
        }
      }
      const target = new URL(url || "/", self.location.origin);
      if (action === "yes" || action === "no") target.searchParams.set("answer", action);
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of clients) {
        if ("focus" in c) {
          await c.navigate(target.href).catch(() => {});
          return c.focus();
        }
      }
      return self.clients.openWindow(target.href);
    })(),
  );
});
