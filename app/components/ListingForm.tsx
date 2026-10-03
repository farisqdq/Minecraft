"use client";

import { useEffect, useState, type FormEvent } from "react";
import Modal from "./Modal";
import styles from "../dashboard/dashboard.module.css";
import { MAX_PHOTOS } from "@/lib/listings";
import type { ListingDTO } from "@/lib/listings-db";

export type ListingPlace = { unitId: string | null; label: string; rent: number };
export type ListingPhoto = { id: string; url: string; title: string };

/**
 * Puts a place up for rent, or edits a listing (a27): what's on offer, when
 * it's free, and photos chosen from the property's filing cabinet.
 */
export default function ListingForm({
  open,
  propertyId,
  listing,
  places,
  defaultUnitId,
  photos,
  onClose,
  onSaved,
}: {
  open: boolean;
  propertyId: string;
  /** The listing being edited, or null for a new one. */
  listing: ListingDTO | null;
  /** Where a new listing can be for: the house, or each unit. */
  places: ListingPlace[];
  defaultUnitId?: string | null;
  /** Documents filed as photos for this property. */
  photos: ListingPhoto[];
  onClose: () => void;
  onSaved: (l: ListingDTO) => void;
}) {
  const [unitId, setUnitId] = useState<string>("");
  const [headline, setHeadline] = useState("");
  const [rent, setRent] = useState("");
  const [deposit, setDeposit] = useState("");
  const [availableOn, setAvailableOn] = useState("");
  const [beds, setBeds] = useState("");
  const [baths, setBaths] = useState("");
  const [sqft, setSqft] = useState("");
  const [pets, setPets] = useState("");
  const [description, setDescription] = useState("");
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Each opening starts from the listing, or from the place it's for.
  useEffect(() => {
    if (!open) return;
    setError("");
    if (listing) {
      setUnitId(listing.unitId ?? "");
      setHeadline(listing.headline);
      setRent(String(listing.rent));
      setDeposit(listing.deposit ? String(listing.deposit) : "");
      setAvailableOn(listing.availableOn);
      setBeds(listing.beds === null ? "" : String(listing.beds));
      setBaths(listing.baths === null ? "" : String(listing.baths));
      setSqft(listing.sqft === null ? "" : String(listing.sqft));
      setPets(listing.pets);
      setDescription(listing.description);
      setPhotoIds(listing.photoIds.filter((id) => photos.some((p) => p.id === id)));
      return;
    }
    const place = places.find((p) => (p.unitId ?? "") === (defaultUnitId ?? "")) ?? places[0];
    setUnitId(place?.unitId ?? "");
    setHeadline("");
    setRent(place && place.rent > 0 ? String(place.rent) : "");
    setDeposit(place && place.rent > 0 ? String(place.rent) : "");
    setAvailableOn("");
    setBeds("");
    setBaths("");
    setSqft("");
    setPets("");
    setDescription("");
    setPhotoIds(photos.slice(0, MAX_PHOTOS).map((p) => p.id));
  }, [open, listing, places, defaultUnitId, photos]);

  function togglePhoto(id: string) {
    setPhotoIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= MAX_PHOTOS ? prev : [...prev, id]));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const body = { unitId: unitId || null, headline, rent, deposit, availableOn, beds, baths, sqft, pets, description, photoIds };
    try {
      const res = await fetch(listing ? `/api/listings/${listing.id}` : `/api/properties/${propertyId}/listings`, {
        method: listing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Couldn't save the listing.");
        return;
      }
      onSaved(data as ListingDTO);
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title={listing ? "Edit listing" : "List a place for rent"}
      subtitle="A page to send people to, with an application form. Only people with the link see it."
      onClose={onClose}
    >
      <form onSubmit={submit}>
        {error && <div className={styles.errorBar} style={{ marginTop: 0, marginBottom: 14 }}>{error}</div>}
        <div className={`${styles.fieldGrid} ${styles.modalGrid}`}>
          {!listing && places.length > 1 && (
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="ls-place">Which place</label>
              <select
                id="ls-place"
                value={unitId}
                onChange={(e) => {
                  setUnitId(e.target.value);
                  const p = places.find((x) => (x.unitId ?? "") === e.target.value);
                  if (p && p.rent > 0) setRent(String(p.rent));
                }}
              >
                {places.map((p) => (
                  <option key={p.unitId ?? ""} value={p.unitId ?? ""}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className={`${styles.field} ${styles.wide}`}>
            <label htmlFor="ls-headline">Headline</label>
            <input
              id="ls-headline"
              required
              maxLength={120}
              placeholder="e.g. Bright 2-bed with a yard, near UK"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="ls-rent">Rent a month</label>
            <input id="ls-rent" required type="number" min="1" step="0.01" inputMode="decimal" className="num" value={rent} onChange={(e) => setRent(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label htmlFor="ls-deposit">Deposit</label>
            <input id="ls-deposit" type="number" min="0" step="0.01" inputMode="decimal" className="num" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label htmlFor="ls-available">Available from</label>
            <input id="ls-available" type="date" value={availableOn} onChange={(e) => setAvailableOn(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label htmlFor="ls-pets">Pets</label>
            <input id="ls-pets" maxLength={120} placeholder="e.g. Cats OK, no dogs" value={pets} onChange={(e) => setPets(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label htmlFor="ls-beds">Bedrooms</label>
            <input id="ls-beds" type="number" min="0" max="20" step="0.5" inputMode="decimal" placeholder="0 = studio" value={beds} onChange={(e) => setBeds(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label htmlFor="ls-baths">Bathrooms</label>
            <input id="ls-baths" type="number" min="0" max="20" step="0.5" inputMode="decimal" value={baths} onChange={(e) => setBaths(e.target.value)} />
          </div>
          <div className={`${styles.field} ${styles.wide}`}>
            <label htmlFor="ls-sqft">Square feet</label>
            <input id="ls-sqft" type="number" min="0" step="1" inputMode="numeric" value={sqft} onChange={(e) => setSqft(e.target.value)} />
          </div>
          <div className={`${styles.field} ${styles.wide}`}>
            <label htmlFor="ls-desc">About the place</label>
            <textarea
              id="ls-desc"
              rows={5}
              maxLength={4000}
              className={styles.renewNote}
              placeholder="What it's like, what's included, the neighbourhood, parking, laundry…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        <div className={styles.field} style={{ marginTop: 14 }}>
          <label>
            Photos {photos.length > 0 && <span className={styles.note}>— {photoIds.length} of {photos.length} chosen, the first is the cover</span>}
          </label>
          {photos.length === 0 ? (
            <p className={styles.helpText} style={{ margin: 0 }}>
              No photos of this property yet. Add them under Documents on the property page — upload or scan, filed as
              Photo — and they can be picked here.
            </p>
          ) : (
            <div className={styles.listingPhotos}>
              {photos.map((p) => {
                const at = photoIds.indexOf(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`${styles.listingPhoto} ${at >= 0 ? styles.listingPhotoOn : ""}`}
                    aria-pressed={at >= 0}
                    title={p.title}
                    onClick={() => togglePhoto(p.id)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt={p.title} loading="lazy" />
                    {at >= 0 && <span>{at + 1}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className={styles.formFoot}>
          <button type="button" className={styles.btn} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={busy}>
            {busy ? "Saving…" : listing ? "Save" : "Create listing"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
