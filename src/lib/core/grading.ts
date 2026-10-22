export interface GradeThreshold {
  grade: string;
  /** Minimum percentage (inclusive), compared against the UNROUNDED score. */
  min: number;
}

export const DEFAULT_GRADE_THRESHOLDS: GradeThreshold[] = [
  { grade: "A+", min: 97 },
  { grade: "A", min: 93 },
  { grade: "A-", min: 90 },
  { grade: "B+", min: 87 },
  { grade: "B", min: 83 },
  { grade: "B-", min: 80 },
  { grade: "C+", min: 77 },
  { grade: "C", min: 73 },
  { grade: "C-", min: 70 },
  { grade: "D+", min: 67 },
  { grade: "D", min: 63 },
  { grade: "D-", min: 60 },
  { grade: "F", min: 0 },
];

/**
 * Validates a user-supplied grading scale. Returns an error message, or null if valid.
 * Rules: 2+ grades, unique non-empty names, strictly descending minimums within 0..100,
 * and the lowest grade starts at 0 so every score maps to a grade.
 */
export function validateThresholds(thresholds: GradeThreshold[]): string | null {
  if (!Array.isArray(thresholds) || thresholds.length < 2) return "Add at least two grades.";
  const names = new Set<string>();
  for (let i = 0; i < thresholds.length; i++) {
    const t = thresholds[i];
    const name = typeof t?.grade === "string" ? t.grade.trim() : "";
    if (!name || name.length > 4) return "Each grade needs a short label (1–4 characters).";
    if (names.has(name)) return `Grade "${name}" is listed twice.`;
    names.add(name);
    if (typeof t.min !== "number" || !Number.isFinite(t.min) || t.min < 0 || t.min > 100) {
      return `Minimum for ${name} must be between 0 and 100.`;
    }
    if (i > 0 && !(t.min < thresholds[i - 1].min)) {
      return "Minimums must go strictly down from the top grade to the bottom grade.";
    }
  }
  if (thresholds[thresholds.length - 1].min !== 0) return "The lowest grade must start at 0%.";
  return null;
}

/** Letter grade for an unrounded percentage. */
export function gradeFor(pct: number, thresholds: GradeThreshold[] = DEFAULT_GRADE_THRESHOLDS): string {
  for (const t of thresholds) {
    if (pct >= t.min) return t.grade;
  }
  return thresholds[thresholds.length - 1].grade;
}

/** Display-only rounding. Never feed the result back into grading or averaging. */
export function formatPct(pct: number | null, digits = 0): string {
  if (pct === null) return "N/A";
  const factor = 10 ** digits;
  let shown = Math.round(pct * factor) / factor;
  // Never display a perfect score that wasn't earned (e.g. 99.7% must not read "100%").
  if (shown >= 100 && pct < 100) shown = (Math.ceil(100 * factor) - 1) / factor;
  return `${shown.toFixed(digits)}%`;
}
