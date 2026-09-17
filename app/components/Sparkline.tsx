"use client";

/**
 * A 12-point trend line for a stat tile. Deliberately unlabelled — the tile's
 * value and delta carry the numbers; this only shows the shape.
 *
 * The scale spans the data's own range rather than starting at zero: a tile
 * this small has no axis to read against, so the point is the shape of the
 * movement, and anchoring at zero would flatten a real swing into a straight
 * line. A series that crosses zero gets a hairline where zero falls, so a
 * dip below it is still visible as a dip below it.
 */
export default function Sparkline({
  points,
  tone = "neutral",
}: {
  points: number[];
  tone?: "accent" | "expense" | "neutral";
}) {
  if (points.length < 2) return null;

  const w = 120;
  const h = 28;
  const pad = 5;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;

  const x = (i: number) => (i / (points.length - 1)) * (w - pad * 2) + pad;
  const y = (v: number) => h - pad - ((v - min) / span) * (h - pad * 2);

  const d = points.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const lastX = x(points.length - 1);
  const lastY = y(points[points.length - 1]);
  const crossesZero = min < 0 && max > 0;

  const stroke =
    tone === "accent" ? "var(--accent)" : tone === "expense" ? "var(--expense)" : "var(--ink-2)";

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      aria-hidden="true"
      focusable="false"
      style={{ display: "block", maxWidth: "100%" }}
    >
      {crossesZero && (
        <line x1="0" x2={w} y1={y(0)} y2={y(0)} stroke="var(--chart-grid)" strokeWidth="1" />
      )}
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r="2.75" fill={stroke} stroke="var(--surface)" strokeWidth="1.75" />
    </svg>
  );
}
