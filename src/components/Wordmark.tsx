/** RAYNE wordmark with the hardhat over the A, and FIT between lime rules. */
export function Hardhat({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 40" className={className} aria-hidden="true">
      <path d="M8 30 C8 12 20 2 32 2 C44 2 56 12 56 30 Z" fill="#FFC300" />
      <rect x="2" y="28" width="60" height="8" rx="4" fill="#FFC300" />
      <path d="M26 6 V27 M32 4 V27 M38 6 V27" stroke="#D69600" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const text = size === "lg" ? "text-6xl" : size === "md" ? "text-3xl" : "text-xl";
  const fit = size === "lg" ? "text-2xl" : size === "md" ? "text-sm" : "text-[0.6rem]";
  const hat = size === "lg" ? "w-12 -top-8" : size === "md" ? "w-6 -top-4" : "w-5 -top-3";
  return (
    <div className="inline-flex flex-col items-center leading-none select-none" role="img" aria-label="Rayne Fit">
      <span className={`font-display ${text} text-white`}>
        R<span className="relative inline-block">
          <Hardhat className={`absolute left-1/2 -translate-x-1/2 ${hat}`} />A
        </span>
        YNE
      </span>
      <span className={`mt-1 flex w-full items-center gap-2 ${fit}`}>
        <span className="h-[3px] flex-1 bg-lime" />
        <span className="font-display tracking-fit text-lime pl-[0.45em]">FIT</span>
        <span className="h-[3px] flex-1 bg-lime" />
      </span>
    </div>
  );
}
