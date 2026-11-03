/** Shown when someone writes something that suggests they may be in crisis. Non-clinical, always available. */
export function CrisisCard() {
  return (
    <div role="alert" className="rounded-2xl border-2 border-hardhat bg-hardhat/10 p-4 text-sm">
      <p className="font-bold">You matter more than any score.</p>
      <p className="mt-1">
        If you&apos;re thinking about harming yourself or feel unsafe, please reach out now. In the US, call or text <a href="tel:988" className="font-bold text-lime underline">988</a> (Suicide &amp; Crisis Lifeline, free, 24/7).
        Elsewhere, <a href="https://findahelpline.com" target="_blank" rel="noreferrer" className="font-bold text-lime underline">findahelpline.com</a> lists local lines. If you&apos;re in immediate danger, call your local emergency number.
      </p>
      <p className="mt-1 text-muted">Telling someone you trust how you&apos;re doing can help too.</p>
    </div>
  );
}
