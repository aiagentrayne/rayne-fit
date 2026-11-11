"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/client/api";
import type { PeriodMeasurable } from "@/client/types";
import { METRIC_INFO, type Metric } from "@/lib/core/coach";

interface ProgressData {
  today: string;
  daily: { date: string; pct: number | null; energy: number | null; mood: number | null; stress: number | null; complete: boolean }[];
  averages: Record<Metric, { last7: number | null; last30: number | null }>;
  reviewCompletion: { complete: number; of: number };
  observations: { metric: Metric; text: string }[];
  periods: PeriodMeasurable[];
  participation: { completed: number; missed: number; late: number; rescheduled: number; days: number };
  rossEnabled: boolean;
}

const COLORS: Record<Metric, string> = { energy: "#FFC300", mood: "#D9FF00", stress: "#7CC8FF" };

export default function ProgressPage() {
  const [data, setData] = useState<ProgressData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<ProgressData>("/api/progress").then(setData, (e) => setError(e.message));
  }, []);

  if (!data) return <p className="pt-6 text-muted">{error ?? "Loading…"}</p>;
  const scored = data.daily.filter((d) => d.pct !== null);
  return (
    <div className="space-y-6 pt-2">
      <header className="flex items-center justify-between">
        <h1 className="font-display text-3xl">Progress</h1>
        <Link href="/history" className="text-sm font-semibold text-lime underline">Calendar &amp; grades</Link>
      </header>

      <section className="space-y-2 rounded-2xl bg-panel p-4">
        <h2 className="font-display text-lg">Daily score, last 30 days</h2>
        {scored.length ? <ScoreBars days={data.daily} /> : <p className="text-sm text-muted">No finished days yet.</p>}
        <p className="text-xs text-muted">Each bar is a finished day&apos;s score. Gaps are days with nothing scheduled (N/A) or not finished yet.</p>
      </section>

      <section className="space-y-4 rounded-2xl bg-panel p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg">Check-ins</h2>
          <span className="text-xs text-muted">Daily review complete {data.reviewCompletion.complete} of {data.reviewCompletion.of} days</span>
        </div>
        {(["energy", "mood", "stress"] as Metric[]).map((m) => (
          <div key={m}>
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-semibold">{METRIC_INFO[m].title}</span>
              <span className="text-xs text-muted">
                7-day avg {fmt(data.averages[m].last7)} · 30-day {fmt(data.averages[m].last30)}
              </span>
            </div>
            <Sparkline values={data.daily.map((d) => d[m])} color={COLORS[m]} label={`${METRIC_INFO[m].title}, last 30 days`} />
          </div>
        ))}
        <p className="text-xs text-muted">1 = {METRIC_INFO.energy.labels[0].toLowerCase()} / {METRIC_INFO.mood.labels[0].toLowerCase()} / {METRIC_INFO.stress.labels[0].toLowerCase()}, 5 = the most favourable. Gaps are days not recorded, which never count as low.</p>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-lg">Patterns</h2>
        {data.observations.length ? (
          <ul className="space-y-2">
            {data.observations.map((o) => <li key={o.metric} className="rounded-xl bg-panel p-3 text-sm">{o.text}</li>)}
          </ul>
        ) : (
          <p className="text-sm text-muted">Not enough data yet. Patterns appear once you have at least 5 finished days rated 4–5 and 5 rated 1–2 for a measure (last 90 days).</p>
        )}
      </section>

      {data.periods.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-display text-lg">Weekly &amp; monthly targets</h2>
          <ul className="space-y-2">
            {data.periods.map((p) => (
              <li key={p.itemId} className="flex items-center justify-between rounded-xl bg-panel p-3 text-sm">
                <span className="font-semibold">{p.name}</span>
                <span className="text-right text-xs text-muted">
                  This {p.cadence === "weekly" ? "week" : "month"} <strong className={p.met ? "text-lime" : "text-white"}>{p.count}/{p.target}</strong>
                  {p.previous && <span className="block">Last: {p.previous.count}/{p.previous.target}{p.previous.met ? " ✓" : ""}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.rossEnabled && (
        <section className="space-y-1 rounded-2xl bg-panel p-4 text-sm">
          <h2 className="font-display text-lg">Interviews</h2>
          <p>Last {data.participation.days} days: <strong>{data.participation.completed}</strong> completed, <strong>{data.participation.missed}</strong> missed{data.participation.late ? `, ${data.participation.late} done late` : ""}.</p>
          <p className="text-xs text-muted">Tracked separately from your habit scores.</p>
        </section>
      )}
    </div>
  );
}

function fmt(n: number | null) {
  return n === null ? "–" : n.toFixed(1);
}

function ScoreBars({ days }: { days: ProgressData["daily"] }) {
  const w = 300;
  const h = 70;
  const bw = w / days.length;
  return (
    <svg viewBox={`0 0 ${w} ${h + 14}`} className="w-full" role="img" aria-label="Daily scores for the last 30 days">
      <line x1={0} x2={w} y1={h} y2={h} stroke="#5a5a5a" strokeWidth={0.5} />
      <line x1={0} x2={w} y1={h * 0.1} y2={h * 0.1} stroke="#2e2e2e" strokeWidth={0.5} strokeDasharray="2 2" />
      {days.map((d, i) =>
        d.pct === null ? null : (
          <rect key={d.date} x={i * bw + 1} y={h - (d.pct / 100) * h * 0.9} width={Math.max(1, bw - 2)} height={(d.pct / 100) * h * 0.9} rx={1} fill={d.pct >= 90 ? "#D9FF00" : d.pct >= 70 ? "#b3b3b3" : "#FF5C5C"}>
            <title>{`${d.date}: ${Math.round(d.pct)}%`}</title>
          </rect>
        ),
      )}
      <text x={0} y={h + 12} fontSize={8} fill="#b3b3b3">{days[0]?.date.slice(5)}</text>
      <text x={w} y={h + 12} fontSize={8} fill="#b3b3b3" textAnchor="end">today</text>
    </svg>
  );
}

function Sparkline({ values, color, label }: { values: (number | null)[]; color: string; label: string }) {
  const w = 300;
  const h = 44;
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * (w - 8) + 4;
  const y = (v: number) => h - 4 - ((v - 1) / 4) * (h - 8);
  const segments: string[] = [];
  let cur = "";
  values.forEach((v, i) => {
    if (v === null) {
      if (cur) segments.push(cur);
      cur = "";
    } else cur += `${cur ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
  });
  if (cur) segments.push(cur);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-1 w-full" role="img" aria-label={label}>
      {[1, 3, 5].map((v) => <line key={v} x1={0} x2={w} y1={y(v)} y2={y(v)} stroke="#2e2e2e" strokeWidth={0.5} />)}
      {segments.map((d, i) => <path key={i} d={d} fill="none" stroke={color} strokeWidth={1.5} />)}
      {values.map((v, i) => (v === null ? null : <circle key={i} cx={x(i)} cy={y(v)} r={2} fill={color} />))}
    </svg>
  );
}
