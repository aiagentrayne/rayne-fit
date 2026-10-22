import Link from "next/link";

export const metadata = { title: "Install Rayne Fit" };

export default function InstallPage() {
  return (
    <div className="space-y-6 pt-2">
      <h1 className="font-display text-3xl">Install on your phone</h1>
      <section className="space-y-3 rounded-2xl bg-panel p-4">
        <h2 className="font-display text-xl">iPhone / iPad (iOS 16.4+)</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>Open Rayne Fit in <strong>Safari</strong>.</li>
          <li>Tap the <strong>Share</strong> button, then <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
          <li>Open Rayne Fit from the new Home Screen icon and sign in.</li>
          <li>Go to <strong>Settings › Notifications</strong> in the app and tap <strong>Enable notifications</strong>, then allow.</li>
        </ol>
        <p className="text-xs text-muted">
          Apple only allows web notifications for Home Screen apps. They appear like other app notifications, but they are not alarms: they don&apos;t ring continuously, can be a little late, and respect Silent Mode and Focus. Notification buttons (Mark YES / NO / Snooze) aren&apos;t shown on iPhone; tapping a notification opens that item so you can answer in one tap.
        </p>
      </section>
      <section className="space-y-3 rounded-2xl bg-panel p-4">
        <h2 className="font-display text-xl">Android (Chrome)</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>Open Rayne Fit in Chrome and tap <strong>Install app</strong> (or menu › Add to Home screen).</li>
          <li>Enable notifications in the app&apos;s Settings. Notifications show Mark YES and Snooze buttons.</li>
        </ol>
      </section>
      <section className="space-y-3 rounded-2xl bg-panel p-4">
        <h2 className="font-display text-xl">Desktop</h2>
        <p className="text-sm">In Chrome or Edge, use the install icon in the address bar. Safari on macOS: File › Add to Dock.</p>
      </section>
      <Link href="/settings#notifications" className="block rounded-xl bg-lime py-4 text-center text-lg font-black text-ink">Back to notification settings</Link>
    </div>
  );
}
