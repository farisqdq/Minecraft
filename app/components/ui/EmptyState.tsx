import type { ComponentType, ReactNode } from "react";
import type { IconProps } from "../icons";
import styles from "./EmptyState.module.css";

/**
 * What a list shows when it has nothing in it: an icon, one line saying so,
 * and (when there is one) the action that fills it. One line — not a
 * paragraph selling the feature.
 */
export default function EmptyState({
  icon: Icon,
  title,
  detail,
  action,
  compact = false,
}: {
  icon?: ComponentType<IconProps>;
  title: ReactNode;
  /** An optional second line of plain fact ("Files you upload appear here"). */
  detail?: ReactNode;
  action?: ReactNode;
  /** Less padding, for an empty section inside a card. */
  compact?: boolean;
}) {
  return (
    <div className={`${styles.empty} ${compact ? styles.compact : ""}`}>
      {Icon && (
        <span className={styles.icon}>
          <Icon size={20} />
        </span>
      )}
      <p className={styles.title}>{title}</p>
      {detail && <p className={styles.detail}>{detail}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
