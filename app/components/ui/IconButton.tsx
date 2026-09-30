import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentType } from "react";
import type { IconProps } from "../icons";
import styles from "./IconButton.module.css";

/**
 * A button that is only an icon. `label` is required: it's the accessible
 * name and the tooltip (shown on hover and keyboard focus, never on touch).
 */
export default function IconButton({
  icon: Icon,
  label,
  href,
  tone = "default",
  tooltip = "bottom",
  className = "",
  ...rest
}: {
  icon: ComponentType<IconProps>;
  label: string;
  href?: string;
  tone?: "default" | "danger" | "accent";
  tooltip?: "top" | "bottom" | "none";
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">) {
  const cls = `${styles.btn} ${styles[tone]} ${tooltip !== "none" ? styles.tip : ""} ${tooltip === "top" ? styles.tipTop : ""} ${className}`;
  if (href) {
    return (
      <Link href={href} className={cls} aria-label={label} data-tip={label}>
        <Icon size={18} />
      </Link>
    );
  }
  return (
    <button type="button" className={cls} aria-label={label} data-tip={label} {...rest}>
      <Icon size={18} />
    </button>
  );
}
