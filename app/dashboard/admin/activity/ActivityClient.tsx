"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import AppShell from "../../../components/AppShell";
import styles from "../../dashboard.module.css";
import s from "./activity.module.css";
import { KIND_LABEL, type ActorKind } from "@/lib/activity";
import type { ActivityRow, Person } from "@/lib/activity-db";

type Props = {
  openRepairs: number;
  people: Person[];
  selected: string | null;
  history: { rows: ActivityRow[]; more: boolean } | null;
  changesOnly: boolean;
  paged: boolean;
};

const KINDS: (ActorKind | "all")[] = ["all", "user", "tenant", "owner"];

function ago(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}
const dayOf = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const whoHref = (key: string, changesOnly: boolean, before?: string) =>
  `/dashboard/admin/activity?who=${encodeURIComponent(key)}${changesOnly ? "&changes=1" : ""}${before ? `&before=${encodeURIComponent(before)}` : ""}`;

/** Page loads repeat when a page refreshes itself after a change; show a run of the same one once, with a count. */
function collapse(rows: ActivityRow[]) {
  const out: (ActivityRow & { times: number })[] = [];
  for (const r of rows) {
    const prev = out[out.length - 1];
    if (prev && !r.change && !prev.change && prev.text === r.text &&
        new Date(prev.at).getTime() - new Date(r.at).getTime() < 10 * 60000) { prev.times++; continue }
    out.push({ ...r, times: 1 });
  }
  return out;
}

export default function ActivityClient({ openRepairs, people, selected, history, changesOnly, paged }: Props) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<ActorKind | "all">("all");
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return people.filter((p) => (kind === "all" || p.kind === kind) && (!n || `${p.name} ${p.email}`.toLowerCase().includes(n)));
  }, [people, q, kind]);
  const person = selected ? people.find((p) => `${p.kind}:${p.id}` === selected) : null;

  const days = useMemo(() => {
    const groups: { day: string; rows: (ActivityRow & { times: number })[] }[] = [];
    for (const r of collapse(history?.rows ?? [])) {
      const d = dayOf(r.at);
      if (groups[groups.length - 1]?.day !== d) groups.push({ day: d, rows: [] });
      groups[groups.length - 1].rows.push(r);
    }
    return groups;
  }, [history]);
  const oldest = history?.rows[history.rows.length - 1]?.at;

  return (
    <AppShell
      openRepairs={openRepairs}
      title="Activity log"
      tagline="Everyone who uses the site, and everything they've done on it."
      actions={<Link href="/dashboard/admin" className={`${styles.btn} ${styles.small}`}>Back to Admin</Link>}
    >
      <div className={s.layout}>
        <section className={`${styles.block} ${s.people} ${selected ? s.hideOnPhone : ""}`}>
          <div className={styles.blockHead}>
            <h2>People</h2>
            <span className={styles.count}>{shown.length}</span>
          </div>
          <div className={s.filters}>
            <input type="search" className={s.search} placeholder="Find by name or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a person" />
            <div className={s.kinds} role="group" aria-label="Kind of account">
              {KINDS.map((k) => (
                <button key={k} type="button" aria-pressed={kind === k} className={s.kindBtn} onClick={() => setKind(k)}>
                  {k === "all" ? "Everyone" : `${KIND_LABEL[k]}s`}
                </button>
              ))}
            </div>
          </div>
          {shown.length === 0 ? (
            <div className={s.empty}>{people.length ? "Nobody matches." : "No activity yet. It starts recording now."}</div>
          ) : (
            <ul className={s.list}>
              {shown.map((p) => {
                const key = `${p.kind}:${p.id}`;
                return (
                  <li key={key}>
                    <Link href={whoHref(key, changesOnly)} className={s.personRow} aria-current={key === selected ? "true" : undefined}>
                      <span className={s.personMain}>
                        <span className={s.name}>{p.name || p.email || "Unknown"}</span>
                        <span className={s.sub}>{p.name ? p.email : ""}</span>
                      </span>
                      <span className={s.personMeta}>
                        <span className={`${s.badge} ${s[p.kind]}`}>{KIND_LABEL[p.kind]}</span>
                        <span className={s.sub}>{ago(p.last)} · {p.week} this week</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className={`${styles.block} ${s.history} ${selected ? "" : s.hideOnPhone}`}>
          {!selected ? (
            <div className={s.empty}>Pick a person to see everything they've done.</div>
          ) : (
            <>
              <div className={s.histHead}>
                <Link href="/dashboard/admin/activity" className={s.backLink}>← Everyone</Link>
                <h2 className={s.histName}>{person?.name || person?.email || "This person"}</h2>
                {person && (
                  <div className={s.sub}>
                    {KIND_LABEL[person.kind]}{person.name && person.email ? ` · ${person.email}` : ""} · {person.total.toLocaleString()} actions recorded
                  </div>
                )}
                <div className={s.kinds} role="group" aria-label="What to show">
                  <Link href={whoHref(selected, false)} className={s.kindBtn} aria-pressed={!changesOnly}>Everything</Link>
                  <Link href={whoHref(selected, true)} className={s.kindBtn} aria-pressed={changesOnly}>Changes only</Link>
                </div>
              </div>
              {paged && <Link href={whoHref(selected, changesOnly)} className={s.backLink}>↑ Back to newest</Link>}
              {days.length === 0 ? (
                <div className={s.empty}>{changesOnly ? "No changes recorded." : "Nothing recorded."}</div>
              ) : (
                days.map((g) => (
                  <div key={g.day} className={s.day}>
                    <h3 className={s.dayHead}>{g.day}</h3>
                    <ol className={s.rows}>
                      {g.rows.map((r) => (
                        <li key={r.id} className={`${s.row} ${r.change ? s.change : ""}`}>
                          <time className={s.time} dateTime={r.at}>{timeOf(r.at)}</time>
                          <span className={s.what}>
                            {r.text}
                            {r.times > 1 && <span className={s.sub}> ×{r.times}</span>}
                          </span>
                          <span className={s.where} title={r.path}>{[r.device, r.ip].filter(Boolean).join(" · ")}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))
              )}
              {history?.more && oldest && (
                <Link href={whoHref(selected, changesOnly, oldest)} className={`${styles.btn} ${styles.small} ${s.older}`}>Show older</Link>
              )}
            </>
          )}
        </section>
      </div>
    </AppShell>
  );
}
