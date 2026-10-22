import webpush from "web-push";

export interface PushTarget {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushResult {
  ok: boolean;
  statusCode?: number;
  error?: string;
  /** The subscription is gone (404/410) and should be disabled. */
  gone?: boolean;
  /** Worth retrying later (network error, 429, 5xx). */
  transient?: boolean;
}

export interface PushSender {
  readonly configured: boolean;
  send(target: PushTarget, payload: string, ttlSeconds: number): Promise<PushResult>;
}

export function classifyStatus(statusCode: number | undefined): Pick<PushResult, "gone" | "transient"> {
  if (statusCode === 404 || statusCode === 410) return { gone: true, transient: false };
  if (statusCode === undefined || statusCode === 429 || statusCode >= 500) return { gone: false, transient: true };
  return { gone: false, transient: false };
}

/** Web Push (VAPID) sender used in production. */
export class WebPushSender implements PushSender {
  readonly configured: boolean;

  constructor(
    publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    privateKey = process.env.VAPID_PRIVATE_KEY,
    subject = process.env.VAPID_SUBJECT ?? "mailto:admin@example.com",
  ) {
    this.configured = Boolean(publicKey && privateKey);
    if (this.configured) webpush.setVapidDetails(subject, publicKey!, privateKey!);
  }

  async send(target: PushTarget, payload: string, ttlSeconds: number): Promise<PushResult> {
    if (!this.configured) return { ok: false, error: "push_not_configured", transient: false };
    try {
      const res = await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        payload,
        { TTL: ttlSeconds, urgency: "high", timeout: 10_000 },
      );
      return { ok: true, statusCode: res.statusCode };
    } catch (e) {
      const err = e as { statusCode?: number; body?: string; message?: string };
      return { ok: false, statusCode: err.statusCode, error: (err.body || err.message || "send_failed").slice(0, 500), ...classifyStatus(err.statusCode) };
    }
  }
}

let sender: PushSender | null = null;
export function defaultSender(): PushSender {
  return (sender ??= new WebPushSender());
}
