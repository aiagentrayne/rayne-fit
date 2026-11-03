import Link from "next/link";

export const metadata = { title: "Privacy · Rayne Fit" };

/** Plain-language privacy notice for Rayne Fit and ROSS. */
export default function PrivacyPage() {
  return (
    <article className="space-y-4 pt-2 text-sm leading-relaxed">
      <Link href="/settings" className="text-muted underline">‹ Settings</Link>
      <h1 className="font-display text-3xl">Privacy</h1>
      <p className="text-muted">Last updated November 3, 2026.</p>

      <h2 className="font-display text-lg">What Rayne Fit stores</h2>
      <p>Your email address (for sign-in), the measurables you create and your YES/NO answers, weekly and monthly logs, your energy, mood and stress ratings, journal notes, settings, and the devices you allow notifications on. If you turn on ROSS, it also stores your vision, milestones, interview conversations and summaries, commitments, daily nuggets, and ROSS&apos;s coaching notes about you.</p>

      <h2 className="font-display text-lg">ROSS and OpenAI</h2>
      <p>ROSS is off until you turn it on. When it&apos;s on, Rayne Fit&apos;s server sends OpenAI the information ROSS needs to coach you: your vision and milestones, measurables and results, interview messages, coaching notes and, only if you allow it, your check-in ratings and journal entries. Voice answers are sent to OpenAI for transcription; Rayne Fit doesn&apos;t keep the audio. Rayne Fit asks OpenAI not to store these requests, and OpenAI&apos;s API terms say API data isn&apos;t used to train its models by default. OpenAI may keep request data for a limited time to prevent abuse, under its own policies.</p>
      <p>Your phone never talks to OpenAI directly, and the API key is never sent to your device.</p>

      <h2 className="font-display text-lg">What ROSS is not</h2>
      <p>ROSS is an AI coach. It can be wrong, it isn&apos;t a therapist or doctor, and it doesn&apos;t diagnose anything. Patterns it points out are observations, not proof of cause. If you&apos;re struggling or thinking about harming yourself, contact the 988 Suicide &amp; Crisis Lifeline (call or text 988 in the US) or your local emergency number.</p>

      <h2 className="font-display text-lg">How long data is kept</h2>
      <p>Interview transcripts are deleted after 12 months (their short summaries stay). Logs of AI usage (counts and costs, never message text) are deleted after 90 days. Everything else stays until you delete it.</p>

      <h2 className="font-display text-lg">Your controls</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>Turn ROSS off, or choose whether it sees check-ins and journal entries, in Settings.</li>
        <li>See and correct what ROSS remembers on the &ldquo;What ROSS knows&rdquo; screen.</li>
        <li>Download all your data as a file from Settings.</li>
        <li>Delete all coaching data, or every Rayne Fit record, from Settings.</li>
        <li>To remove your sign-in account entirely, email <a href="mailto:aiagent@rayneservices.com" className="text-lime underline">aiagent@rayneservices.com</a>.</li>
      </ul>

      <h2 className="font-display text-lg">Sharing</h2>
      <p>Rayne Fit doesn&apos;t sell your data, show ads, or use third-party tracking. Data is shared only with the services that run the app: Supabase (database and sign-in), Vercel (hosting), your browser&apos;s push service (notifications) and, if ROSS is on, OpenAI.</p>
      <p>Rayne Fit is intended for adults 18 and over.</p>
    </article>
  );
}
