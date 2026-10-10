"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "../../../components/AppShell";
import ConfirmDialog, { type ConfirmRequest } from "../../../components/ConfirmDialog";
import { Toasts, useToasts } from "../../../components/Toasts";
import { FileLink } from "../../../components/FileViewer";
import { useViewOnly } from "../../../components/ViewOnly";
import styles from "../../dashboard.module.css";
import s from "./inspection.module.css";
import { shrinkImage } from "@/lib/shrinkImage";
import {
  CONDITIONS,
  CONDITION_LABEL,
  KIND_LABEL,
  compareItems,
  groupByRoom,
  progress,
  statusOf,
  type Condition,
} from "@/lib/inspections";
import type { InspectionDTO, InspectionItemDTO, InspectionPhotoDTO } from "@/lib/inspections-db";

const CHOICES: Condition[] = [...CONDITIONS, "na"];

function dayLabel(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function momentLabel(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const anchor = (id: string) => `item-${id}`;

export function ConditionBadge({ condition }: { condition: Condition }) {
  return <span className={`${s.badge} ${condition ? s[condition] ?? "" : ""}`}>{CONDITION_LABEL[condition]}</span>;
}

function Thumbs({
  photos,
  small,
  onRemove,
}: {
  photos: InspectionPhotoDTO[];
  small?: boolean;
  onRemove?: (p: InspectionPhotoDTO) => void;
}) {
  if (photos.length === 0) return null;
  return (
    <div className={`${s.photos} ${small ? s.small : ""}`}>
      {photos.map((p) => (
        <span key={p.id} className={s.thumb}>
          <FileLink url={p.url} name={p.filename} mime={p.contentType} aria-label={`View ${p.filename}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt="" loading="lazy" />
          </FileLink>
          {onRemove && (
            <button type="button" className={s.thumbDel} aria-label="Remove photo" onClick={() => onRemove(p)}>
              ×
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

/**
 * One inspection, room by room. Every change saves as it's made — a
 * walk-through happens on a phone, one room at a time, and losing a
 * half-done one to a dropped connection or a closed tab would be worse than
 * a few small requests. Once the tenant acknowledges it, it's read-only.
 */
export default function InspectionClient({
  initial,
  moveIn,
  tenantName,
  placeLabel,
  propertyHref,
  hasPortal,
  canManage,
  storageReady,
  userLabel,
  openRepairs,
  today,
}: {
  initial: InspectionDTO;
  /** For a move-out: the move-in it's compared with. */
  moveIn: InspectionDTO | null;
  tenantName: string;
  placeLabel: string;
  propertyHref: string;
  /** Whether the tenant has a portal login to acknowledge it with. */
  hasPortal: boolean;
  canManage: boolean;
  storageReady: boolean;
  userLabel: string;
  openRepairs: number;
  today: string;
}) {
  const router = useRouter();
  const viewOnly = useViewOnly();
  const { toasts, push, dismiss } = useToasts();
  const [insp, setInsp] = useState(initial);
  const [busy, setBusy] = useState("");
  const [uploading, setUploading] = useState("");
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null);
  const [newItem, setNewItem] = useState<Record<string, string>>({});
  const [newRoom, setNewRoom] = useState({ room: "", name: "" });
  const notes = useRef<Record<string, string>>({});
  // Saves to one line run one after another, and only the newest answer is
  // shown: tapping Good then Poor must end on Poor, on the server and on
  // screen, however the two requests happen to race.
  const chains = useRef<Record<string, Promise<unknown>>>({});
  const latest = useRef<Record<string, number>>({});

  const status = statusOf(insp);
  const locked = status === "acknowledged";
  const editable = !viewOnly && !locked;
  const prog = progress(insp.items);
  const compared = useMemo(
    () => (moveIn ? compareItems(insp.items, moveIn.items) : insp.items.map((i) => ({ ...i, change: "same" as const, before: null }))),
    [insp.items, moveIn]
  );
  const rooms = useMemo(() => groupByRoom(compared), [compared]);
  const worse = compared.filter((c) => c.change === "worse");
  const fresh = moveIn ? compared.filter((c) => c.change === "new" && c.condition !== "" && c.condition !== "good") : [];
  const moveInPhotos = useMemo(
    () => new Map((moveIn?.items ?? []).map((i) => [i.id, i.photos])),
    [moveIn]
  );

  async function call(url: string, init: RequestInit, key: string) {
    setBusy(key);
    try {
      const res = await fetch(url, init);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        push(data?.error || "Couldn't save that.", "bad");
        return null;
      }
      return data;
    } catch {
      push("Couldn't reach the server — check the connection and try again.", "bad");
      return null;
    } finally {
      setBusy("");
    }
  }

  const json = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  function patchLocal(itemId: string, patch: Partial<InspectionItemDTO>) {
    setInsp((prev) => ({ ...prev, items: prev.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)) }));
  }

  function editPhotos(itemId: string, change: (photos: InspectionPhotoDTO[]) => InspectionPhotoDTO[]) {
    setInsp((prev) => ({ ...prev, items: prev.items.map((i) => (i.id === itemId ? { ...i, photos: change(i.photos) } : i)) }));
  }

  /** PATCH one line, in order with its other saves; the newest reply wins. */
  function patchItem(item: InspectionItemDTO, patch: { condition?: Condition; note?: string }) {
    const seq = (latest.current[item.id] ?? 0) + 1;
    latest.current[item.id] = seq;
    const run = (chains.current[item.id] ?? Promise.resolve()).then(async () => {
      const saved = await call(`/api/inspections/${insp.id}/items/${item.id}`, json("PATCH", patch), item.id);
      if (latest.current[item.id] !== seq) return;
      // On failure, put back what the server last had.
      if (saved) setInsp((prev) => ({ ...prev, items: prev.items.map((i) => (i.id === item.id ? { ...saved, photos: i.photos } : i)) }));
      else setInsp((prev) => ({ ...prev, items: prev.items.map((i) => (i.id === item.id ? { ...i, ...revert(item, patch) } : i)) }));
    });
    chains.current[item.id] = run.catch(() => undefined);
  }

  const revert = (item: InspectionItemDTO, patch: { condition?: Condition; note?: string }) => ({
    ...(patch.condition !== undefined ? { condition: item.condition } : {}),
    ...(patch.note !== undefined ? { note: item.note } : {}),
  });

  function setCondition(item: InspectionItemDTO, condition: Condition) {
    const next = item.condition === condition ? "" : condition;
    patchLocal(item.id, { condition: next });
    patchItem(item, { condition: next });
  }

  function saveNote(item: InspectionItemDTO) {
    const note = (notes.current[item.id] ?? item.note).trim();
    if (note === item.note) return;
    patchLocal(item.id, { note });
    patchItem(item, { note });
  }

  async function addPhotos(item: InspectionItemDTO, files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(item.id);
    for (const raw of Array.from(files)) {
      const form = new FormData();
      form.append("file", await shrinkImage(raw));
      const photo = await call(`/api/inspections/${insp.id}/items/${item.id}/photos`, { method: "POST", body: form }, item.id);
      if (!photo) break;
      // Only the photos change: a condition tapped during the upload stays.
      editPhotos(item.id, (photos) => [...photos, photo]);
    }
    setUploading("");
  }

  function removePhoto(item: InspectionItemDTO, photo: InspectionPhotoDTO) {
    setConfirming({
      title: "Remove this photo?",
      body: "It's deleted from storage too.",
      confirmLabel: "Remove",
      danger: true,
      onConfirm: async () => {
        setConfirming(null);
        const ok = await call(`/api/inspections/${insp.id}/photos/${photo.id}`, { method: "DELETE" }, item.id);
        if (ok) editPhotos(item.id, (photos) => photos.filter((p) => p.id !== photo.id));
      },
    });
  }

  async function addItem(room: string) {
    const name = (newItem[room] ?? "").trim();
    if (!name) return;
    const item = await call(`/api/inspections/${insp.id}/items`, json("POST", { room, name }), `add-${room}`);
    if (!item) return;
    setNewItem((prev) => ({ ...prev, [room]: "" }));
    // The server put it at the end of its room; mirror that.
    setInsp((prev) => {
      const items = prev.items.map((i) => (i.position >= item.position ? { ...i, position: i.position + 1 } : i));
      return { ...prev, items: [...items, item].sort((a, b) => a.position - b.position) };
    });
  }

  async function addRoom(e: React.FormEvent) {
    e.preventDefault();
    const room = newRoom.room.trim();
    const name = newRoom.name.trim() || "Walls & ceiling";
    if (!room) return;
    const item = await call(`/api/inspections/${insp.id}/items`, json("POST", { room, name }), "add-room");
    if (!item) return;
    setNewRoom({ room: "", name: "" });
    setInsp((prev) => ({ ...prev, items: [...prev.items, item].sort((a, b) => a.position - b.position) }));
  }

  function removeItem(item: InspectionItemDTO) {
    setConfirming({
      title: `Remove “${item.name}” from ${item.room}?`,
      body: item.photos.length > 0 ? `Its ${item.photos.length} photo${item.photos.length === 1 ? "" : "s"} go too.` : "",
      confirmLabel: "Remove",
      danger: true,
      onConfirm: async () => {
        setConfirming(null);
        const ok = await call(`/api/inspections/${insp.id}/items/${item.id}`, { method: "DELETE" }, item.id);
        if (ok) setInsp((prev) => ({ ...prev, items: prev.items.filter((i) => i.id !== item.id) }));
      },
    });
  }

  async function renameRoom(room: string) {
    const to = window.prompt("Rename this room", room)?.trim();
    if (!to || to === room) return;
    const ok = await call(`/api/inspections/${insp.id}/rooms`, json("PATCH", { from: room, to }), `room-${room}`);
    if (ok) {
      const key = room.trim().toLowerCase();
      setInsp((prev) => ({
        ...prev,
        items: prev.items.map((i) => (i.room.trim().toLowerCase() === key ? { ...i, room: ok.room } : i)),
      }));
    }
  }

  function removeRoom(room: string, count: number) {
    setConfirming({
      title: `Remove ${room}?`,
      body: `Its ${count} line${count === 1 ? "" : "s"} and their photos go with it.`,
      confirmLabel: "Remove room",
      danger: true,
      onConfirm: async () => {
        setConfirming(null);
        const ok = await call(`/api/inspections/${insp.id}/rooms?room=${encodeURIComponent(room)}`, { method: "DELETE" }, `room-${room}`);
        if (ok) {
          const key = room.trim().toLowerCase();
          setInsp((prev) => ({ ...prev, items: prev.items.filter((i) => i.room.trim().toLowerCase() !== key) }));
        }
      },
    });
  }

  async function saveHeader(patch: { inspectedOn?: string; note?: string }) {
    const saved = await call(`/api/inspections/${insp.id}`, json("PATCH", patch), "header");
    if (saved) setInsp((prev) => ({ ...prev, ...saved }));
  }

  async function share(shared: boolean) {
    const saved = await call(`/api/inspections/${insp.id}/share`, json("POST", { shared }), "share");
    if (!saved) return;
    setInsp((prev) => ({ ...prev, sharedAt: saved.sharedAt }));
    push(shared ? `Shared — ${tenantName} has a message saying it's ready to review.` : "No longer shared.");
  }

  function remove() {
    setConfirming({
      title: `Delete this ${KIND_LABEL[insp.kind].toLowerCase()}?`,
      body: locked
        ? `${tenantName} acknowledged it. It's the record of the place's condition — once it's gone, so is that.`
        : "Every line, note and photo goes with it.",
      confirmLabel: "Delete",
      danger: true,
      onConfirm: async () => {
        setConfirming(null);
        const ok = await call(`/api/inspections/${insp.id}`, { method: "DELETE" }, "delete");
        if (ok) router.push(propertyHref);
      },
    });
  }

  const unchecked = prog.total - prog.checked;

  return (
    <AppShell
      title={KIND_LABEL[insp.kind]}
      tagline={`${tenantName} · ${placeLabel}`}
      back={{ href: propertyHref, label: "Property" }}
      userLabel={userLabel}
      openRepairs={openRepairs}
      actions={
        <Link className={`${styles.btn} ${styles.small}`} href={`/dashboard/inspections/${insp.id}/report`}>
          Printable report
        </Link>
      }
    >
      <section className={`${s.status} ${locked ? s.locked : ""}`} aria-label="Status">
        <div className={s.statusMain}>
          {status === "acknowledged" ? (
            <>
              <span className={s.statusLine}>
                Acknowledged by {insp.acknowledgedName} · {momentLabel(insp.acknowledgedAt!)}
              </span>
              <span className={s.statusSub}>Signed in the portal, so it can no longer be changed.</span>
              {insp.tenantComment && <blockquote className={s.quote}>{insp.tenantComment}</blockquote>}
            </>
          ) : status === "shared" ? (
            <>
              <span className={s.statusLine}>Shared with {tenantName} — waiting for them to acknowledge it</span>
              <span className={s.statusSub}>
                Shared {momentLabel(insp.sharedAt!)}. They see it as it is now; changes you make show up for them.
              </span>
            </>
          ) : (
            <>
              <span className={s.statusLine}>
                {prog.checked} of {prog.total} checked
                {prog.flagged > 0 ? ` · ${prog.flagged} poor or damaged` : ""}
              </span>
              <span className={s.statusSub}>
                {unchecked > 0
                  ? "Walk through each room, pick a condition for every line, and photograph anything that isn't good."
                  : hasPortal
                    ? `All checked. Share it and ${tenantName} can review and acknowledge it in the portal.`
                    : `All checked. ${tenantName} has no portal login — print the report for them to sign, or invite them first.`}
              </span>
              <div className={s.meter} aria-hidden="true">
                <span style={{ width: `${prog.total ? (prog.checked / prog.total) * 100 : 0}%` }} />
              </div>
            </>
          )}
        </div>
        {!viewOnly && (
          <div className={s.statusActions}>
            {status === "draft" && (
              <button
                type="button"
                className={`${styles.btn} ${styles.small} ${unchecked === 0 ? styles.primary : ""}`}
                disabled={busy === "share"}
                onClick={() => share(true)}
              >
                Share with tenant
              </button>
            )}
            {status === "shared" && (
              <button type="button" className={`${styles.btn} ${styles.small}`} disabled={busy === "share"} onClick={() => share(false)}>
                Stop sharing
              </button>
            )}
            {(!locked || canManage) && (
              <button type="button" className={`${styles.btn} ${styles.small} ${styles.quiet} ${styles.danger}`} onClick={remove}>
                Delete
              </button>
            )}
          </div>
        )}
      </section>

      {editable ? (
        <div className={s.header}>
          <div className={styles.field}>
            <label htmlFor="insp-day">Walk-through</label>
            <input
              id="insp-day"
              type="date"
              max={today}
              defaultValue={insp.inspectedOn}
              onBlur={(e) => e.target.value && e.target.value !== insp.inspectedOn && saveHeader({ inspectedOn: e.target.value })}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="insp-note">Overall note</label>
            <input
              id="insp-note"
              type="text"
              maxLength={2000}
              placeholder="Who was there, keys and remotes handed over, meter readings…"
              defaultValue={insp.note}
              onBlur={(e) => e.target.value.trim() !== insp.note && saveHeader({ note: e.target.value })}
            />
          </div>
        </div>
      ) : (
        <p className={styles.helpText}>
          Walk-through on {dayLabel(insp.inspectedOn)}
          {insp.note ? ` · ${insp.note}` : ""}
        </p>
      )}

      {moveIn && (
        <div className={s.compare}>
          Compared with the move-in on <strong>{dayLabel(moveIn.inspectedOn)}</strong>
          {moveIn.acknowledgedAt ? `, acknowledged by ${moveIn.acknowledgedName}` : " (never acknowledged)"}:{" "}
          {worse.length === 0 && fresh.length === 0 ? (
            prog.checked === 0 ? (
              "nothing checked yet."
            ) : (
              "nothing is worse so far."
            )
          ) : (
            <>
              <strong>
                {worse.length} worse
                {fresh.length > 0 ? `, ${fresh.length} not on the move-in` : ""}
              </strong>
              . These are what a deduction from the deposit would rest on.
              <div className={s.compareList}>
                {[...worse, ...fresh].map((c) => (
                  <a key={c.id} href={`#${anchor(c.id)}`}>
                    {c.room} · {c.name}
                  </a>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {!moveIn && insp.kind === "move_out" && (
        <div className={s.compare}>
          There&apos;s no move-in inspection for {tenantName} to compare with, so nothing here can show what got worse.
        </div>
      )}

      {rooms.map(({ room, items }) => (
        <section key={room} className={s.room} aria-label={room}>
          <div className={s.roomHead}>
            <h2>{room}</h2>
            <small>
              {progress(items).checked}/{items.length}
            </small>
            {editable && (
              <>
                <button type="button" className={s.linkBtn} onClick={() => renameRoom(room)}>
                  Rename
                </button>
                <button type="button" className={`${s.linkBtn} ${s.danger}`} onClick={() => removeRoom(room, items.length)}>
                  Remove
                </button>
              </>
            )}
          </div>

          {items.map((item) => {
            const before = item.before;
            return (
              <div key={item.id} id={anchor(item.id)} className={`${s.item} ${item.change === "worse" ? s.worse : ""}`}>
                <div className={s.itemName}>
                  <span>{item.name}</span>
                  {editable && (
                    <button type="button" className={`${s.linkBtn} ${s.danger}`} aria-label={`Remove ${item.name}`} onClick={() => removeItem(item)}>
                      ×
                    </button>
                  )}
                </div>
                {editable ? (
                  <div className={s.conditions} role="group" aria-label={`${item.name} condition`}>
                    {CHOICES.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={`${s.cond} ${s[c] ?? ""}`}
                        aria-pressed={item.condition === c}
                        onClick={() => setCondition(item, c)}
                      >
                        {CONDITION_LABEL[c]}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div>
                    <ConditionBadge condition={item.condition} />
                  </div>
                )}
                <div className={s.itemBody}>
                  {before && (
                    <div className={s.before}>
                      At move-in: <ConditionBadge condition={before.condition} />
                      {before.note && <span>“{before.note}”</span>}
                      <Thumbs photos={moveInPhotos.get(before.id) ?? []} small />
                    </div>
                  )}
                  {editable ? (
                    <div className={s.detailRow}>
                      <input
                        className={s.note}
                        type="text"
                        maxLength={1000}
                        aria-label={`${item.name} note`}
                        placeholder={item.condition && item.condition !== "good" && item.condition !== "na" ? "What's wrong with it?" : "Note"}
                        defaultValue={item.note}
                        onChange={(e) => (notes.current[item.id] = e.target.value)}
                        onBlur={() => saveNote(item)}
                      />
                      {storageReady && (
                        <label className={s.addPhoto}>
                          {uploading === item.id ? "Saving…" : "+ Photo"}
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            aria-label={`Add a photo of ${item.name}`}
                            onChange={(e) => {
                              addPhotos(item, e.target.files);
                              e.target.value = "";
                            }}
                          />
                        </label>
                      )}
                    </div>
                  ) : (
                    item.note && <div className={s.readNote}>{item.note}</div>
                  )}
                  <Thumbs photos={item.photos} onRemove={editable ? (p) => removePhoto(item, p) : undefined} />
                </div>
              </div>
            );
          })}

          {editable && (
            <div className={s.addRow}>
              <input
                className={s.note}
                type="text"
                maxLength={80}
                placeholder={`Add to ${room}, e.g. “Ceiling fan”`}
                aria-label={`New item in ${room}`}
                value={newItem[room] ?? ""}
                onChange={(e) => setNewItem((prev) => ({ ...prev, [room]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addItem(room);
                  }
                }}
              />
              <button type="button" className={`${styles.btn} ${styles.small}`} disabled={busy === `add-${room}`} onClick={() => addItem(room)}>
                Add
              </button>
            </div>
          )}
        </section>
      ))}

      {editable && (
        <form className={s.room} onSubmit={addRoom}>
          <div className={s.roomHead}>
            <h2>Add a room</h2>
          </div>
          <div className={s.addRow}>
            <input
              className={s.note}
              type="text"
              maxLength={60}
              placeholder="Room, e.g. “Bedroom 2”"
              aria-label="Room name"
              value={newRoom.room}
              onChange={(e) => setNewRoom((r) => ({ ...r, room: e.target.value }))}
            />
            <input
              className={s.note}
              type="text"
              maxLength={80}
              placeholder="First thing to check (Walls & ceiling)"
              aria-label="First item"
              value={newRoom.name}
              onChange={(e) => setNewRoom((r) => ({ ...r, name: e.target.value }))}
            />
            <button type="submit" className={`${styles.btn} ${styles.small}`} disabled={busy === "add-room" || !newRoom.room.trim()}>
              Add room
            </button>
          </div>
        </form>
      )}

      <ConfirmDialog request={confirming} onCancel={() => setConfirming(null)} />
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </AppShell>
  );
}
