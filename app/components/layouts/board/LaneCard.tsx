"use client";

import Link from "next/link";
import { money } from "@/lib/money";
import { formatDay, smsHref, telHref } from "@/lib/lease";
import { vacantFor } from "@/lib/vacancy";
import type { BoardCard } from "@/lib/layouts/board-lanes";
import type { TenantDTO } from "@/lib/tenants";
import StatusBadge from "../../ui/StatusBadge";
import OverflowMenu, { type MenuItem } from "../../ui/OverflowMenu";
import { IconMessage, IconPhone, IconPlus, IconBell, IconExternal, IconCheck } from "../../icons";
import styles from "./Dashboard.module.css";

export type CardExtras = {
  /** The late-fee line under the bar ("Late fees $70 (5%, cap $…) · 40% of cap"), or "". */
  feeLine: string;
  waived: boolean;
  /** Rent a vacant place has gone without since it emptied. */
  lost: number;
  /** "Reminded 2 days ago", when this month's chase is recent. */
  reminded: string;
  chasing: boolean;
};

type Props = {
  card: BoardCard<TenantDTO>;
  extras: CardExtras;
  onRecord: () => void;
  onRemind: () => void;
};

function badgeFor(card: BoardCard<TenantDTO>) {
  switch (card.lane) {
    case "late":
      return card.partial ? (
        <StatusBadge status="partial">Partial · {card.lateDays}d late</StatusBadge>
      ) : (
        <StatusBadge status="late">{card.lateDays === 1 ? "1 day late" : `${card.lateDays} days late`}</StatusBadge>
      );
    case "due":
      return <StatusBadge status={card.partial ? "partial" : "info"}>{card.partial ? "Partial" : "Due"}</StatusBadge>;
    case "vacant":
      return (
        <StatusBadge status="vacant">
          {card.vacantDays !== null ? `Vacant ${vacantFor(card.vacantDays)}` : "Vacant"}
        </StatusBadge>
      );
    case "ended":
      return <StatusBadge status="ended">{card.tenant ? "Lease ended" : "No tenant"}</StatusBadge>;
    default:
      return <StatusBadge status="paid" />;
  }
}

/** The place, as a heading: "Unit A" over "Maple Court Duplex", or a house's own name. */
function Place({ card }: { card: BoardCard<TenantDTO> }) {
  const { property, unitName, target } = card;
  return (
    <div className={styles.place}>
      <Link href={`/dashboard/properties/${property.id}`} className={styles.placeName}>
        {target.whole ? `${property.name} (whole building)` : unitName ? `${property.name} · ${unitName}` : property.name}
      </Link>
      {property.address && <div className={styles.placeAddr}>{property.address}</div>}
    </div>
  );
}

function menuFor(card: BoardCard<TenantDTO>, extras: CardExtras, onRecord: () => void, onRemind: () => void): MenuItem[] {
  const t = card.tenant;
  const owes = card.lane === "late" || card.lane === "due";
  const items: MenuItem[] = [];
  if (owes && t) {
    items.push({
      label: extras.chasing ? "Sending…" : extras.reminded ? `Remind again (${extras.reminded})` : "Send a reminder",
      icon: IconBell,
      onSelect: onRemind,
      disabled: extras.chasing,
    });
  }
  if (!owes && card.lane !== "vacant") items.push({ label: "Record a payment", icon: IconPlus, onSelect: onRecord });
  if (t?.phone) {
    items.push({ label: `Call ${t.name}`, icon: IconPhone, href: telHref(t.phone) });
    items.push({ label: `Text ${t.name}`, icon: IconMessage, href: smsHref(t.phone) });
  }
  if (t && card.lane === "paid") items.push({ label: "Message", icon: IconMessage, href: `/dashboard/messages/${t.id}` });
  items.push({
    label: "Open property",
    icon: IconExternal,
    href: t ? `/dashboard/properties/${card.property.id}#tenant-${t.id}` : `/dashboard/properties/${card.property.id}`,
  });
  return items;
}

/** One place on the board: who, how much, and the one or two things to do about it. */
export default function LaneCard({ card, extras, onRecord, onRemind }: Props) {
  const t = card.tenant;
  const menu = menuFor(card, extras, onRecord, onRemind);
  const label = card.unitName ? `${card.property.name} ${card.unitName}` : card.property.name;

  if (card.lane === "paid") {
    return (
      <article className={`${styles.card} ${styles.compact}`}>
        <span className={styles.paidTick} aria-hidden="true">
          <IconCheck size={14} strokeWidth={2.5} />
        </span>
        <div className={styles.compactMain}>
          <Place card={card} />
          {t && <div className={styles.who}>{t.name}</div>}
        </div>
        <div className={styles.compactAmt}>
          <span className="num">{money(card.paid)}</span>
          {card.lease?.kind === "ending" && <span className={styles.leaseHint}>{card.lease.label}</span>}
        </div>
        <OverflowMenu items={menu} label={`Actions for ${label}`} />
      </article>
    );
  }

  const owes = card.lane === "late" || card.lane === "due";
  const total = card.expected + card.fees;

  return (
    <article className={`${styles.card} ${styles[`lane_${card.lane}`] ?? ""}`}>
      <div className={styles.cardHead}>
        <Place card={card} />
        {badgeFor(card)}
      </div>

      <div className={styles.cardBody}>
        {card.lane === "vacant" ? (
          <>
            <div className={styles.amountRow}>
              <span className={`${styles.amount} num`}>{money(card.expected)}</span>
              <span className={styles.amountNote}>/ month asking</span>
            </div>
            {card.target.vacantSince && (
              <div className={styles.sub}>
                Empty since {formatDay(card.target.vacantSince.slice(0, 10))}
                {extras.lost > 0 ? ` · ${money(Math.round(extras.lost))} of rent gone` : ""}
              </div>
            )}
          </>
        ) : owes ? (
          <>
            <div className={styles.who}>{t ? t.name : "No tenant on file"}</div>
            <div className={styles.amountRow}>
              <span className={`${styles.amount} num`}>{money(card.owed)}</span>
              <span className={styles.amountNote}>owed</span>
            </div>
            {card.paid > 0.005 && (
              <div className={styles.progress}>
                <div
                  className={styles.bar}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={card.progress}
                  aria-label={`${card.progress}% received`}
                >
                  <span style={{ width: `${card.progress}%` }} />
                </div>
                <div className={styles.barCaption}>
                  <span className="num">
                    {money(card.paid)} of {money(total)}
                  </span>
                  <span className="num">{card.progress}%</span>
                </div>
              </div>
            )}
            {card.paid <= 0.005 && <div className={styles.sub}>Nothing received of {money(total)}</div>}
            {extras.feeLine && <div className={styles.feeLine}>{extras.feeLine}</div>}
            {extras.waived && <div className={styles.sub}>Late fee waived</div>}
            {extras.reminded && <div className={styles.sub}>Reminded {extras.reminded}</div>}
          </>
        ) : (
          <>
            <div className={styles.who}>{t ? t.name : "No tenant on file"}</div>
            <div className={styles.sub}>
              {t
                ? `Lease ended ${formatDay(t.leaseEnd)}${card.paid > 0.005 ? ` · ${money(card.paid)} in this month` : ""}`
                : card.expected > 0
                  ? `${money(card.paid)} of ${money(card.expected)} in this month`
                  : "No rent set"}
            </div>
          </>
        )}
        {card.lease?.kind === "ending" && <div className={styles.leaseHint}>Lease {card.lease.label.toLowerCase()}</div>}
        {card.lane !== "ended" && card.lease?.kind === "expired" && (
          <div className={styles.leaseHint}>Lease ended {t ? formatDay(t.leaseEnd) : ""}</div>
        )}
      </div>

      <div className={styles.cardActions}>
        {owes && (
          <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={onRecord}>
            Record
          </button>
        )}
        {card.lane === "vacant" && (
          <Link href={`/dashboard/properties/${card.property.id}`} className={`${styles.btn} ${styles.primary}`}>
            Add a tenant
          </Link>
        )}
        {card.lane === "ended" &&
          (t ? (
            <Link href={`/dashboard/properties/${card.property.id}#tenant-${t.id}`} className={`${styles.btn} ${styles.primary}`}>
              Open lease
            </Link>
          ) : (
            <Link href={`/dashboard/properties/${card.property.id}`} className={`${styles.btn} ${styles.primary}`}>
              Add a tenant
            </Link>
          ))}
        {t && card.lane !== "vacant" && (
          <Link href={`/dashboard/messages/${t.id}`} className={styles.btn}>
            Message
          </Link>
        )}
        <span className={styles.grow} />
        <OverflowMenu items={menu} label={`More for ${label}`} />
      </div>
    </article>
  );
}
