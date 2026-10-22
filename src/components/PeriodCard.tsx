import { formatPct } from "@/lib/core/grading";
import { scoreColor } from "./ScoreRing";

export interface Period {
  start: string;
  end: string;
  pct: number | null;
  grade: string | null;
  countedDays: number;
  provisional: boolean;
}

export function PeriodCard({ title, period }: { title: string; period: Period }) {
  const pct = period.pct;
  return (
    <section className="rounded-2xl bg-panel p-4" aria-label={`${title} grade`}>
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">{title}</h2>
        {period.provisional && <span className="rounded-full border border-hardhat px-2 py-0.5 text-[0.65rem] font-semibold uppercase text-hardhat">Provisional</span>}
      </div>
      {pct === null ? (
        <p className="mt-2 text-sm text-muted">
          <span className="font-display block text-3xl text-white">N/A</span>
          Awaiting finalized days
        </p>
      ) : (
        <>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="font-display text-3xl">{formatPct(pct)}</span>
            <span className="font-display text-xl" style={{ color: scoreColor(pct) }}>{period.grade}</span>
          </p>
          <div className="mt-2 h-2 rounded-full bg-panel-2" aria-hidden="true">
            <div className="h-2 rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: scoreColor(pct) }} />
          </div>
          <p className="mt-2 text-xs text-muted">
            {period.countedDays} finalized day{period.countedDays === 1 ? "" : "s"}
          </p>
        </>
      )}
    </section>
  );
}
