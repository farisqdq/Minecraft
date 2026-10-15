"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { knownVerdict, scan, isRevealed, reveal, onRevealChange, type Verdict } from "@/lib/sensitive";

/**
 * A backed-up photo that stays blurred until it's been checked and found
 * fine — and if it looks sensitive, it stays blurred behind a
 * "Sensitive content · Tap to view" cover (like Twitter/X) until tapped.
 *
 * `fill` makes it cover its box (grid tiles); otherwise it sizes like a normal
 * image (the full-screen viewer).
 */
export default function SensitiveImg({
  src, thumb, alt = "", imgStyle, fill = false, compact = false,
}: {
  /** The full photo. Also the key its sensitive/safe verdict is remembered under. */
  src: string;
  /** A small preview to show (and check) instead; falls back to `src` if it fails. */
  thumb?: string;
  alt?: string;
  imgStyle?: CSSProperties;
  fill?: boolean;
  compact?: boolean;
}) {
  const [verdict, setVerdict] = useState<Verdict>("pending");
  // Server didn't serve a readable preview → show the original without crossOrigin.
  const [plain, setPlain] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    setVerdict(knownVerdict(src));
    setPlain(false);
    setShown(isRevealed(src));
    return onRevealChange(() => setShown(isRevealed(src)));
  }, [src]);

  const hidden = !shown && verdict !== "safe";

  const onLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    if (plain) { if (verdict === "pending") setVerdict("unknown"); return; }
    if (verdict !== "pending") return;
    const img = e.currentTarget;
    scan(src, img).then(setVerdict);
  };

  const onError = () => {
    if (!plain) setPlain(true);
  };

  const wrap: CSSProperties = fill
    ? { position: "relative", width: "100%", height: "100%", overflow: "hidden" }
    : { position: "relative", display: "inline-block", overflow: "hidden", borderRadius: imgStyle?.borderRadius };

  return (
    <span style={wrap}>
      <img
        key={plain ? "plain" : "cors"}
        src={plain ? src : (thumb || src)}
        alt={alt}
        loading={fill ? "lazy" : undefined}
        crossOrigin={plain ? undefined : "anonymous"}
        onLoad={onLoad}
        onError={onError}
        style={{
          display: "block",
          ...(fill ? { width: "100%", height: "100%", objectFit: "cover" } : {}),
          ...imgStyle,
          filter: hidden ? "blur(26px)" : undefined,
          transform: hidden ? "scale(1.15)" : undefined,
          transition: "filter .25s",
        }}
      />
      {hidden && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); reveal(src); }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); reveal(src); } }}
          style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: compact ? 2 : 8, textAlign: "center",
            background: verdict === "sensitive" ? "rgba(0,0,0,.45)" : "rgba(0,0,0,.2)",
            color: "#fff", cursor: "pointer", padding: 6,
          }}
        >
          {verdict === "sensitive" ? (
            <>
              <span style={{ fontSize: compact ? 18 : 30 }} aria-hidden>⚠</span>
              <span style={{ fontWeight: 700, fontSize: compact ? 11 : 16 }}>Sensitive content</span>
              <span style={{
                fontSize: compact ? 10 : 13, border: "1px solid rgba(255,255,255,.6)", borderRadius: 20,
                padding: compact ? "1px 8px" : "4px 14px",
              }}>Tap to view</span>
            </>
          ) : verdict === "pending" ? (
            <span style={{ fontSize: compact ? 10 : 13, opacity: .85 }}>Checking…</span>
          ) : (
            <span style={{ fontSize: compact ? 10 : 13, opacity: .9 }}>Tap to view</span>
          )}
        </span>
      )}
    </span>
  );
}
