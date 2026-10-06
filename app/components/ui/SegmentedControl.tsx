"use client";

import { useRef, type ComponentType, type KeyboardEvent } from "react";
import type { IconProps } from "../icons";
import styles from "./SegmentedControl.module.css";

/**
 * Two to five mutually exclusive views of the same thing (Cards | Table,
 * Month | Year | All). A radiogroup: arrow keys move the choice.
 */
export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  size = "md",
}: {
  options: { value: T; label: string; icon?: ComponentType<IconProps>; hideLabel?: boolean }[];
  value: T;
  onChange: (value: T) => void;
  /** Names the group for screen readers: "View", "Period". */
  label: string;
  size?: "sm" | "md";
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const at = options.findIndex((o) => o.value === value);
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (at + 1) % options.length;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (at - 1 + options.length) % options.length;
    if (next < 0) return;
    e.preventDefault();
    onChange(options[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div role="radiogroup" aria-label={label} className={`${styles.group} ${size === "sm" ? styles.sm : ""}`} onKeyDown={onKey}>
      {options.map((o, i) => {
        const on = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.hideLabel ? o.label : undefined}
            title={o.hideLabel ? o.label : undefined}
            tabIndex={on ? 0 : -1}
            className={`${styles.option} ${on ? styles.on : ""}`}
            onClick={() => onChange(o.value)}
          >
            {Icon && <Icon size={16} />}
            {!o.hideLabel && <span>{o.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
