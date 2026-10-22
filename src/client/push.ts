"use client";

import { api } from "./api";

export type PushSupport = "supported" | "needs-install" | "unsupported";

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * Web Push on iPhone/iPad only works for Home Screen web apps (iOS/iPadOS 16.4+).
 * In a regular Safari tab we tell the user to install first instead of failing silently.
 */
export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  const hasApis = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (isIOS() && !isStandalone()) return "needs-install";
  return hasApis ? "supported" : "unsupported";
}

export function permission(): NotificationPermission | "unsupported" {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return null;
  }
}

/** Must be called from a user gesture (required by iOS). */
export async function enablePush(): Promise<{ ok: boolean; message: string }> {
  const support = pushSupport();
  if (support === "needs-install") return { ok: false, message: "On iPhone, add Rayne Fit to your Home Screen first, then enable notifications from the installed app." };
  if (support === "unsupported") return { ok: false, message: "This browser doesn't support push notifications. In-app reminders will still show while the app is open." };
  const result = await Notification.requestPermission();
  if (result !== "granted") return { ok: false, message: "Notifications are blocked. You can allow them in your device or browser settings." };
  const { publicKey } = await api<{ publicKey: string | null }>("/api/push/subscription");
  if (!publicKey) return { ok: false, message: "Push isn't configured on the server yet (missing VAPID keys)." };
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await registerServiceWorker());
  if (!reg) return { ok: false, message: "Couldn't start the service worker." };
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
  await api("/api/push/subscription", { method: "POST", json: sub.toJSON() });
  return { ok: true, message: "Notifications are on for this device." };
}

export async function disablePushOnThisDevice() {
  const reg = await navigator.serviceWorker?.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api("/api/push/subscription", { method: "DELETE", json: { endpoint: sub.endpoint } }).catch(() => {});
    await sub.unsubscribe();
  }
}

export async function currentDeviceSubscribed(): Promise<boolean> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    return Boolean(await reg?.pushManager.getSubscription());
  } catch {
    return false;
  }
}
