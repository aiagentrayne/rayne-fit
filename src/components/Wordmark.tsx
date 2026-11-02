/** RAYNE wordmark with the hardhat over the A, and FIT between lime rules. */
import type { CSSProperties } from "react";

/**
 * Hardhat drawn so its brim sits flat along the bottom edge of the viewBox (68 x 44),
 * letting it rest directly on top of a letter, as in the Rayne brand logo.
 */
export function Hardhat({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 68 44" className={className} style={style} aria-hidden="true">
      <path d="M8 37 C8 16 20 3 34 3 C48 3 60 16 60 37 Z" fill="#FFC300" />
      <rect x="1" y="34" width="66" height="10" rx="3" fill="#FFC300" />
      <rect x="1" y="34" width="66" height="2.5" rx="1.25" fill="#D69600" opacity="0.55" />
      <path d="M25 9 V29 M34 6 V29 M43 9 V29" stroke="#D69600" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/*
 * Hat placement on the "A", in em so it scales with the wordmark at every size.
 * Measured from Archivo Black at line-height 1: the A's flat top runs 0.261em-0.518em
 * across and sits 0.146em below the top of the line. The brim is a little wider than that
 * flat top and overlaps it slightly, so the hat rests on the A with no gap.
 */
const HAT_WIDTH = 0.34; // em
const HAT_HEIGHT = (HAT_WIDTH * 44) / 68; // em, from the viewBox ratio
const A_CENTER = 0.3895; // em from the A's left edge
const A_TOP = 0.146; // em from the top of the line box
const OVERLAP = 0.012; // em the brim covers the A's top edge
const hatStyle: CSSProperties = {
  width: `${HAT_WIDTH}em`,
  height: `${HAT_HEIGHT}em`,
  left: `${A_CENTER - HAT_WIDTH / 2}em`,
  top: `${A_TOP + OVERLAP - HAT_HEIGHT}em`,
};

export function Wordmark({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const text = size === "lg" ? "text-6xl" : size === "md" ? "text-3xl" : "text-xl";
  const fit = size === "lg" ? "text-2xl" : size === "md" ? "text-sm" : "text-[0.6rem]";
  return (
    <div className="inline-flex flex-col items-center leading-none select-none" role="img" aria-label="Rayne Fit">
      <span className={`font-display ${text} text-white`}>
        R<span className="relative inline-block">
          <Hardhat className="absolute" style={hatStyle} />A
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
