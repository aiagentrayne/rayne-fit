"use client";

import { METRIC_INFO, type Metric } from "@/lib/core/coach";

/** Five tappable faces; 1 = difficult state, 5 = favourable, for every metric. */
export function CheckinScale({ metric, value, onPick, disabled, compact }: { metric: Metric; value: number | null; onPick: (rating: number) => void; disabled?: boolean; compact?: boolean }) {
  const info = METRIC_INFO[metric];
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <p className="font-semibold">{info.title}</p>
        <p className="text-xs text-muted" aria-live="polite">{value ? `${value} · ${info.labels[value - 1]}` : "Not recorded"}</p>
      </div>
      <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label={info.title}>
        {info.labels.map((label, i) => {
          const rating = i + 1;
          const selected = value === rating;
          return (
            <button
              key={rating}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${rating} of 5: ${label}`}
              disabled={disabled}
              onClick={() => onPick(rating)}
              className={`flex flex-col items-center rounded-xl border-2 px-0.5 ${compact ? "py-1.5" : "py-2"} transition disabled:opacity-50 ${selected ? "border-lime bg-lime/15" : "border-panel-2 bg-ink"}`}
            >
              <span className={compact ? "text-xl" : "text-2xl"} aria-hidden="true">{info.faces[i]}</span>
              {!compact && <span className={`mt-1 text-center text-[0.6rem] leading-tight ${selected ? "text-lime" : "text-muted"}`}>{label}</span>}
            </button>
          );
        })}
      </div>
      {compact && (
        <div className="mt-1 flex justify-between text-[0.6rem] text-muted" aria-hidden="true">
          <span>{info.labels[0]}</span>
          <span>{info.labels[4]}</span>
        </div>
      )}
    </div>
  );
}
