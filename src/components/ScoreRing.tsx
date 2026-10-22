import { formatPct } from "@/lib/core/grading";

export function scoreColor(pct: number | null): string {
  if (pct === null) return "#5A5A5A";
  if (pct >= 90) return "#D9FF00";
  if (pct >= 70) return "#FFC300";
  if (pct >= 60) return "#FF6A00";
  return "#FF5C5C";
}

/** Daily score ring. The percentage and grade are always printed, not just drawn. */
export function ScoreRing({ pct, grade, label, sub, size = 200 }: { pct: number | null; grade: string | null; label: string; sub?: string; size?: number }) {
  const stroke = size * 0.09;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = pct === null ? 0 : Math.max(0, Math.min(100, pct)) / 100;
  return (
    <figure className="relative mx-auto" style={{ width: size, height: size }} aria-label={`${label}: ${pct === null ? "not available" : `${formatPct(pct)}, grade ${grade}`}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#2E2E2E" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={scoreColor(pct)}
          strokeWidth={stroke}
          strokeLinecap={filled > 0 && filled < 1 ? "round" : "butt"}
          strokeDasharray={`${c * filled} ${c}`}
          style={{ transition: "stroke-dasharray 400ms ease" }}
        />
      </svg>
      <figcaption className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="font-display text-5xl leading-none">{pct === null ? "N/A" : formatPct(pct)}</span>
        {grade && <span className="font-display mt-1 text-2xl" style={{ color: scoreColor(pct) }}>{grade}</span>}
        <span className="mt-1 text-xs uppercase tracking-widest text-muted">{label}</span>
        {sub && <span className="text-[0.7rem] text-muted">{sub}</span>}
      </figcaption>
    </figure>
  );
}
