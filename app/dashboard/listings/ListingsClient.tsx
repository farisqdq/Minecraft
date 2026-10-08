"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "../../components/AppShell";
import Modal from "../../components/Modal";
import ConfirmDialog, { type ConfirmRequest } from "../../components/ConfirmDialog";
import { useViewOnly } from "../../components/ViewOnly";
import ListingForm, { type ListingPhoto } from "../../components/ListingForm";
import { Toasts, useToasts } from "../../components/Toasts";
import styles from "../dashboard.module.css";
import { money } from "@/lib/money";
import { formatDay, formatPhone, telHref } from "@/lib/lease";
import { ago } from "@/lib/maintenance";
import { STATUS_LABEL, approvalDefaults, bathsLabel, bedsLabel, incomeMultiple } from "@/lib/listings";
import type { ApplicationDTO, ListingDTO } from "@/lib/listings-db";

type Entry = { listing: ListingDTO; place: string; applications: ApplicationDTO[] };

export default function ListingsClient({
  openRepairs,
  serverToday,
  ownerOf,
  initial,
  photos,
}: {
  openRepairs?: number;
  serverToday: string;
  ownerOf: string[];
  initial: Entry[];
  photos: Record<string, ListingPhoto[]>;
}) {
  const router = useRouter();
  const viewOnly = useViewOnly();
  const [entries, setEntries] = useState<Entry[]>(initial);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [approving, setApproving] = useState<{ entry: Entry; app: ApplicationDTO } | null>(null);
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState("");
  const [origin, setOrigin] = useState("");
  const { toasts, push, dismiss } = useToasts();

  useEffect(() => setOrigin(window.location.origin), []);
  // Arriving from a notification lands on the application.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView({ block: "center" });
  }, []);

  const waiting = useMemo(
    () => entries.reduce((n, e) => n + e.applications.filter((a) => a.status === "new" || a.status === "reviewing").length, 0),
    [entries]
  );

  function patchEntry(listingId: string, f: (e: Entry) => Entry) {
    setEntries((prev) => prev.map((e) => (e.listing.id === listingId ? f(e) : e)));
  }

  function withCounts(e: Entry): Entry {
    return {
      ...e,
      listing: {
        ...e.listing,
        waiting: e.applications.filter((a) => a.status === "new" || a.status === "reviewing").length,
        total: e.applications.length,
      },
    };
  }

  async function setOpen(e: Entry, open: boolean) {
    setBusy(e.listing.id);
    const res = await fetch(`/api/listings/${e.listing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ open }),
    });
    setBusy("");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return push(data.error || "Couldn't change the listing.");
    patchEntry(e.listing.id, (x) => ({ ...x, listing: data }));
    push(open ? "Listing reopened — the link works again." : "Listing closed — the link now says it's taken.");
  }

  function remove(e: Entry) {
    setConfirming({
      title: "Delete this listing?",
      body: `The link stops working and ${e.applications.length === 1 ? "its application is" : `all ${e.applications.length} applications are`} deleted for good — people's personal details nobody needs to keep. A tenant approved from it stays.`,
      confirmLabel: "Delete listing",
      danger: true,
      onConfirm: async () => {
        setConfirming(null);
        const res = await fetch(`/api/listings/${e.listing.id}`, { method: "DELETE" });
        if (!res.ok) return push("Couldn't delete it.");
        setEntries((prev) => prev.filter((x) => x.listing.id !== e.listing.id));
        push("Listing deleted.");
      },
    });
  }

  async function setStatus(e: Entry, a: ApplicationDTO, status: "new" | "reviewing" | "declined") {
    setBusy(a.id);
    const res = await fetch(`/api/applications/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setBusy("");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return push(data.error || "Couldn't change that.");
    patchEntry(e.listing.id, (x) => withCounts({ ...x, applications: x.applications.map((y) => (y.id === a.id ? data : y)) }));
  }

  function deleteApp(e: Entry, a: ApplicationDTO) {
    setConfirming({
      title: `Delete ${a.name}'s application?`,
      body: "Their details are removed for good.",
      confirmLabel: "Delete",
      danger: true,
      onConfirm: async () => {
        setConfirming(null);
        const res = await fetch(`/api/applications/${a.id}`, { method: "DELETE" });
        if (!res.ok) return push("Couldn't delete it.");
        patchEntry(e.listing.id, (x) => withCounts({ ...x, applications: x.applications.filter((y) => y.id !== a.id) }));
      },
    });
  }

  async function copyLink(e: Entry) {
    const url = `${origin}/rent/${e.listing.code}`;
    try {
      await navigator.clipboard.writeText(url);
      push("Link copied.");
    } catch {
      push(url);
    }
  }

  return (
    <AppShell
      openRepairs={openRepairs}
      title="Listings"
      tagline="Empty places up for rent, and the people who've applied."
      back={{ href: "/dashboard", label: "Overview" }}
    >
      {entries.length === 0 ? (
        <div className={styles.firstRun}>
          <h2>Nothing listed</h2>
          {viewOnly ? (
            <p>Places listed for rent, and the people who&apos;ve applied, show up here.</p>
          ) : (
            <p>
              When a place is empty, open its property and choose <b>List for rent</b>. You get a link to share — on
              Facebook, Zillow, a sign in the window — and everyone who applies lands here.
            </p>
          )}
        </div>
      ) : (
        <>
          {waiting > 0 && (
            <p className={styles.helpText}>
              {waiting} {waiting === 1 ? "application is" : "applications are"} waiting{viewOnly ? "" : " on you"}.
            </p>
          )}
          {entries.map((e) => {
            const l = e.listing;
            const owner = ownerOf.includes(l.companyId);
            const facts = [bedsLabel(l.beds), bathsLabel(l.baths), l.availableOn ? `from ${formatDay(l.availableOn)}` : ""].filter(Boolean);
            return (
              <section key={l.id} id={`listing-${l.id}`} className={styles.block}>
                <div className={`${styles.formCard} ${styles.listingCard}`}>
                  <div className={styles.listingHead}>
                    <div>
                      <div className={styles.listingPlace}>
                        {e.place}{" "}
                        <span className={`${styles.pill} ${l.open ? styles.paid : styles.vacant}`}>{l.open ? "Open" : "Closed"}</span>
                      </div>
                      <h2 className={styles.listingTitle}>{l.headline}</h2>
                      <div className={styles.note}>
                        {money(l.rent)} a month{facts.length ? ` · ${facts.join(" · ")}` : ""} · listed {formatDay(l.createdAt.slice(0, 10))}
                      </div>
                    </div>
                    <div className={styles.listingActions}>
                      {l.open && (
                        <>
                          <button type="button" className={`${styles.btn} ${styles.small} ${styles.primary}`} onClick={() => copyLink(e)}>
                            Copy link
                          </button>
                          <a className={`${styles.btn} ${styles.small}`} href={`/rent/${l.code}`} target="_blank" rel="noreferrer">
                            View
                          </a>
                        </>
                      )}
                      {!viewOnly && (
                        <>
                          <button type="button" className={`${styles.btn} ${styles.small} ${styles.quiet}`} onClick={() => setEditing(e)}>
                            Edit
                          </button>
                          <button
                            type="button"
                            className={`${styles.btn} ${styles.small} ${styles.quiet}`}
                            disabled={busy === l.id}
                            onClick={() => setOpen(e, !l.open)}
                          >
                            {l.open ? "Close" : "Reopen"}
                          </button>
                        </>
                      )}
                      {owner && !viewOnly && (
                        <button type="button" className={`${styles.btn} ${styles.small} ${styles.quiet} ${styles.danger}`} onClick={() => remove(e)}>
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                  {l.open && origin && <div className={styles.listingLink}>{`${origin}/rent/${l.code}`}</div>}

                  {e.applications.length === 0 ? (
                    <p className={styles.helpText} style={{ marginBottom: 0 }}>
                      No applications yet{l.open && !viewOnly ? " — share the link and they'll arrive here, with an email and a notification for each." : "."}
                    </p>
                  ) : (
                    <ul className={styles.appList}>
                      {e.applications.map((a) => {
                        const multiple = incomeMultiple(a.income, l.rent);
                        const tone = multiple === null ? "" : multiple >= 3 ? styles.paid : multiple >= 2.5 ? styles.owed : styles.bill;
                        return (
                          <li key={a.id} id={`application-${a.id}`} className={a.status === "declined" ? styles.appDeclined : ""}>
                            <div className={styles.appHead}>
                              <span className={styles.appName}>{a.name}</span>
                              <span className={`${styles.pill} ${a.status === "approved" ? styles.paid : a.status === "declined" ? styles.vacant : a.status === "new" ? styles.owed : ""}`}>
                                {STATUS_LABEL[a.status]}
                              </span>
                              {multiple !== null && <span className={`${styles.pill} ${tone}`}>{multiple}× rent</span>}
                              <span className={styles.appWhen}>{ago(a.createdAt)}</span>
                            </div>
                            <dl className={styles.appFacts}>
                              {a.income !== null && (
                                <div>
                                  <dt>Income</dt>
                                  <dd>
                                    {money(a.income)}/mo{a.employer ? ` · ${a.employer}` : ""}
                                  </dd>
                                </div>
                              )}
                              <div>
                                <dt>Move-in</dt>
                                <dd>{a.moveIn ? formatDay(a.moveIn) : "Not given"}</dd>
                              </div>
                              <div>
                                <dt>People</dt>
                                <dd>{a.occupants}</dd>
                              </div>
                              {a.pets && (
                                <div>
                                  <dt>Pets</dt>
                                  <dd>{a.pets}</dd>
                                </div>
                              )}
                              {a.currentAddress && (
                                <div>
                                  <dt>Lives at</dt>
                                  <dd>{a.currentAddress}</dd>
                                </div>
                              )}
                              {(a.landlordName || a.landlordPhone) && (
                                <div>
                                  <dt>Landlord</dt>
                                  <dd>
                                    {a.landlordName}
                                    {a.landlordPhone && (
                                      <>
                                        {a.landlordName ? " · " : ""}
                                        <a href={telHref(a.landlordPhone)}>{formatPhone(a.landlordPhone)}</a>
                                      </>
                                    )}
                                  </dd>
                                </div>
                              )}
                            </dl>
                            {a.message && <p className={styles.appMessage}>{a.message}</p>}
                            <div className={styles.contactRow}>
                              <a className={styles.contactBtn} href={telHref(a.phone)}>
                                Call {formatPhone(a.phone)}
                              </a>
                              <a className={styles.contactBtn} href={`mailto:${a.email}`}>
                                Email
                              </a>
                            </div>
                            {(!viewOnly || a.status === "approved") && <div className={styles.propActions}>
                              {a.status === "approved" ? (
                                <Link className={`${styles.btn} ${styles.small}`} href={`/dashboard/properties/${l.propertyId}${a.tenantId ? `#tenant-${a.tenantId}` : ""}`}>
                                  Open their tenant card
                                </Link>
                              ) : viewOnly ? null : (
                                <>
                                  <button
                                    type="button"
                                    className={`${styles.btn} ${styles.small} ${styles.primary}`}
                                    onClick={() => setApproving({ entry: e, app: a })}
                                  >
                                    Approve…
                                  </button>
                                  {a.status === "new" && (
                                    <button type="button" className={`${styles.btn} ${styles.small} ${styles.quiet}`} disabled={busy === a.id} onClick={() => setStatus(e, a, "reviewing")}>
                                      Reviewing
                                    </button>
                                  )}
                                  {a.status !== "declined" ? (
                                    <button type="button" className={`${styles.btn} ${styles.small} ${styles.quiet}`} disabled={busy === a.id} onClick={() => setStatus(e, a, "declined")}>
                                      Decline
                                    </button>
                                  ) : (
                                    <button type="button" className={`${styles.btn} ${styles.small} ${styles.quiet}`} disabled={busy === a.id} onClick={() => setStatus(e, a, "reviewing")}>
                                      Reconsider
                                    </button>
                                  )}
                                </>
                              )}
                              {owner && !viewOnly && (
                                <button type="button" className={`${styles.btn} ${styles.small} ${styles.quiet} ${styles.danger}`} onClick={() => deleteApp(e, a)}>
                                  Delete
                                </button>
                              )}
                            </div>}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </section>
            );
          })}
        </>
      )}

      <ListingForm
        open={Boolean(editing)}
        propertyId={editing?.listing.propertyId ?? ""}
        listing={editing?.listing ?? null}
        places={[]}
        photos={editing ? (photos[editing.listing.propertyId] ?? []) : []}
        onClose={() => setEditing(null)}
        onSaved={(l) => {
          if (editing) patchEntry(editing.listing.id, (x) => ({ ...x, listing: l }));
          setEditing(null);
          push("Listing saved.");
        }}
      />

      <ApproveDialog
        target={approving}
        today={serverToday}
        onClose={() => setApproving(null)}
        onDone={(entry, app, tenantId) => {
          setApproving(null);
          patchEntry(entry.listing.id, (x) =>
            withCounts({
              ...x,
              listing: { ...x.listing, open: false },
              applications: x.applications.map((y) => (y.id === app.id ? { ...y, status: "approved", tenantId } : y)),
            })
          );
          push(`${app.name} is now the tenant of ${entry.place}. The listing is closed.`);
          router.refresh();
        }}
      />

      <ConfirmDialog request={confirming} onCancel={() => setConfirming(null)} />
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </AppShell>
  );
}

function ApproveDialog({
  target,
  today,
  onClose,
  onDone,
}: {
  target: { entry: Entry; app: ApplicationDTO } | null;
  today: string;
  onClose: () => void;
  onDone: (entry: Entry, app: ApplicationDTO, tenantId: string) => void;
}) {
  const [leaseStart, setLeaseStart] = useState("");
  const [leaseEnd, setLeaseEnd] = useState("");
  const [deposit, setDeposit] = useState("");
  const [dueDay, setDueDay] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!target) return;
    const d = approvalDefaults({ moveIn: target.app.moveIn || null, availableOn: target.entry.listing.availableOn || null, today });
    setLeaseStart(d.leaseStart);
    setLeaseEnd(d.leaseEnd);
    setDeposit(target.entry.listing.deposit ? String(target.entry.listing.deposit) : "0");
    setDueDay("1");
    setError("");
  }, [target, today]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!target) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/applications/${target.app.id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leaseStart, leaseEnd, deposit: Number(deposit) || 0, dueDay: Number(dueDay) }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error || "Couldn't approve them.");
    onDone(target.entry, target.app, data.tenantId);
  }

  return (
    <Modal
      open={Boolean(target)}
      title={target ? `Approve ${target.app.name}` : "Approve"}
      subtitle={
        target
          ? `They become the tenant of ${target.entry.place} at ${money(target.entry.listing.rent)} a month, and the listing closes.`
          : undefined
      }
      narrow
      onClose={onClose}
    >
      {target && (
        <form onSubmit={submit}>
          {error && <div className={styles.errorBar} style={{ marginTop: 0, marginBottom: 14 }}>{error}</div>}
          <div className={`${styles.fieldGrid} ${styles.modalGrid}`}>
            <div className={styles.field}>
              <label htmlFor="ap-start">Lease starts</label>
              <input id="ap-start" type="date" required value={leaseStart} onChange={(e) => setLeaseStart(e.target.value)} />
            </div>
            <div className={styles.field}>
              <label htmlFor="ap-end">Lease ends</label>
              <input id="ap-end" type="date" required min={leaseStart} value={leaseEnd} onChange={(e) => setLeaseEnd(e.target.value)} />
            </div>
            <div className={styles.field}>
              <label htmlFor="ap-deposit">Security deposit</label>
              <input id="ap-deposit" type="number" min="0" step="0.01" inputMode="decimal" className="num" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
            </div>
            <div className={styles.field}>
              <label htmlFor="ap-due">Rent due on day</label>
              <input id="ap-due" type="number" min="1" max="31" inputMode="numeric" value={dueDay} onChange={(e) => setDueDay(e.target.value)} />
            </div>
          </div>
          <p className={styles.helpText}>
            Their name, email and phone go on the tenant card. The other applications stay as they are — let those people
            know yourself.
          </p>
          <div className={styles.formFoot}>
            <button type="button" className={styles.btn} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={busy}>
              {busy ? "Approving…" : "Approve and add as tenant"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
