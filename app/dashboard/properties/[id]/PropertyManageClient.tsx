"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AppShell, { TitleEditButton } from "../../../components/AppShell";
import CashFlowChart from "../../../components/CashFlowChart";
import ConfirmDialog, { type ConfirmRequest } from "../../../components/ConfirmDialog";
import Modal from "../../../components/Modal";
import StatementPanel from "../../../components/StatementPanel";
import WaiveLateFeeField from "../../../components/WaiveLateFeeField"; // late fee waivers (a21)
import DocumentsPanel from "../../../components/DocumentsPanel";
import LoansPanel from "../../../components/LoansPanel";
import DepreciationPanel from "../../../components/DepreciationPanel";
import type { AssetDTO } from "@/lib/assets-db";
import { MarkReturnedDialog, MoveOutDialog, MoveOutSummary } from "../../../components/MoveOut";
import { RenewDialog } from "../../../components/RenewLease"; // lease renewals (a25)
import type { RenewalDTO } from "@/lib/renewals-db";
import { monthShort } from "@/lib/renewal";
import type { MoveOutDTO } from "@/lib/move-outs-db";
import { vacancyCost, vacantDays, vacantFor } from "@/lib/vacancy";
import type { LoanDTO } from "@/lib/loans-db";
import type { DocumentDTO } from "@/lib/documents";
import { Toasts, useToasts } from "../../../components/Toasts";
import styles from "../../dashboard.module.css";
import { useNow } from "../../../components/useNow";
import { EXPENSE_CATEGORIES } from "@/lib/categories";
import { money, signedMoney } from "@/lib/money";
import { historyFor, rentForMonth, type RentChangeDTO } from "@/lib/rent";
import type { TenantDTO } from "@/lib/tenants";
import { formatJoinCode } from "@/lib/codes";
import { NO_ACCESS, type PortalAccess } from "@/lib/portal";
import { STATUS_LABEL, ago, isOpen, type RequestDTO } from "@/lib/maintenance";
import { monthName } from "@/lib/notices";
import { messagesLabel } from "@/lib/messages";
import { dateFromISO, formatDay, isoDay, leaseRange, leaseStatus, ordinal, smsHref, telHref } from "@/lib/lease";
// Attach proof (photos/PDFs) to rent and expense entries on this page.
import ProofPicker, {
  PaperclipIcon,
  ProofStrip,
  releasePending,
  uploadProof,
  type PendingProof,
  type ProofDTO,
} from "../../../components/ProofPicker";
import proofStyles from "../../../components/proof.module.css";
import { MAX_PROOFS, proofCountLabel, proofScanTitle } from "@/lib/attachments-ui";

type Property = {
  id: string;
  name: string;
  address: string;
  monthlyRent: number;
  vacant: boolean;
  /** YYYY-MM-DD rent stopped coming in, when known. */
  vacantSince: string | null;
};
type LedgerEntry = {
  id: string;
  unitId: string | null;
  type: "rent" | "expense";
  date: string;
  amount: number;
  detail: string;
  note: string;
  category: string;
  /** Proof on this entry, served through /api/files/attachment/<id>. */
  attachments: ProofDTO[];
  /** Set when a mortgage payment wrote this entry; see LoansPanel. */
  loanPaymentId: string | null;
};
type Unit = {
  id: string;
  propertyId: string;
  name: string;
  monthlyRent: number;
  vacant: boolean;
  vacantSince: string | null;
};
type RecurringExpense = {
  id: string;
  propertyId: string;
  unitId: string | null;
  category: string;
  detail: string;
  note: string;
  amount: number;
  frequency: "monthly" | "yearly";
  day: number;
  month: number | null;
  active: boolean;
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** An amount box starts empty rather than at "0", which you'd have to clear. */
/** Entries written elsewhere (loan payments, move-outs) arrive with no proof yet. */
function withNoProof(e: Omit<LedgerEntry, "attachments">): LedgerEntry {
  return { ...e, attachments: [] };
}

function amountField(n: number) {
  return n > 0 ? String(n) : "";
}

const EMPTY_TENANT = {
  id: "",
  name: "",
  unitId: "",
  phone: "",
  email: "",
  leaseStart: "",
  leaseEnd: "",
  deposit: "",
  dueDay: "1",
  note: "",
  emailReminders: true,
};

export default function PropertyManageClient({
  openRepairs,
  companyName,
  canManage,
  serverToday,
  serverNow,
  property: initialProperty,
  initialUnits,
  initialRecurring,
  initialTenants,
  initialBalances,
  initialDocuments,
  initialLoans,
  initialMoveOuts,
  initialAssets,
  storageReady,
  rentChanges: initialRentChanges,
  transactions: initialTransactions,
  initialPortal,
  initialRequests,
  unreadMessages = {},
  initialRenewals = {},
}: {
  /** Repairs waiting on you, for the nav badge. */
  openRepairs?: number;
  companyName: string;
  /** Owners can remove units; members record against them. */
  canManage: boolean;
  serverToday: string;
  /** When the server rendered, so the first client render agrees. */
  serverNow: string;
  property: Property;
  initialUnits: Unit[];
  initialRecurring: RecurringExpense[];
  initialTenants: TenantDTO[];
  /** What each tenant owes, worked out on the server so the cards render with it. */
  initialBalances: Record<string, { balance: number; behindSince: string; problem: string }>;
  /** Leases, certificates and the like for this property and its tenants. */
  initialDocuments: DocumentDTO[];
  /** Mortgages on this property, with their payments. */
  initialLoans: LoanDTO[];
  /** Recorded move-outs, by tenant id. */
  initialMoveOuts: Record<string, MoveOutDTO>;
  /** The building and improvements being depreciated. */
  initialAssets: AssetDTO[];
  storageReady: boolean;
  rentChanges: RentChangeDTO[];
  transactions: LedgerEntry[];
  /** Portal access per tenant id, so the cards render it without a round trip. */
  initialPortal: Record<string, PortalAccess>;
  /** What's been reported on this property, urgent first. */
  initialRequests: RequestDTO[];
  /** Messages from each tenant the team hasn't read, by tenant id. */
  unreadMessages?: Record<string, number>;
  /** Each tenant's latest lease renewal (a25), by tenant id. */
  initialRenewals?: Record<string, RenewalDTO>;
}) {
  const router = useRouter();

  // Same reconciliation as the dashboard: start on the server's date so the
  // first client render matches, then switch to the browser's own.
  const [todayKey, setTodayKey] = useState(serverToday);
  useEffect(() => {
    const local = isoDay(new Date());
    if (local !== serverToday) setTodayKey(local);
  }, [serverToday]);
  const now = useMemo(() => dateFromISO(todayKey), [todayKey]);
  // Same split as the dashboard: `now` is a day, this is a moment.
  const clock = useNow(serverNow);

  const [property, setProperty] = useState<Property>(initialProperty);
  const [rentChanges, setRentChanges] = useState<RentChangeDTO[]>(initialRentChanges);
  const [propertyOpen, setPropertyOpen] = useState(false);
  const [propertySaving, setPropertySaving] = useState(false);
  const [propertyForm, setPropertyForm] = useState({
    name: "",
    address: "",
    monthlyRent: "",
    vacant: false,
    vacantSince: "",
  });
  const [transactions, setTransactions] = useState<LedgerEntry[]>(initialTransactions);
  const [units, setUnits] = useState<Unit[]>(initialUnits);
  const [recurring, setRecurring] = useState<RecurringExpense[]>(initialRecurring);
  const [tenants, setTenants] = useState<TenantDTO[]>(initialTenants);
  const [tenantForm, setTenantForm] = useState(EMPTY_TENANT);
  const [tenantOpen, setTenantOpen] = useState(false);
  const [tenantSaving, setTenantSaving] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  // Late fee waivers (a21): null until the "Waive late fee" box is touched.
  const [waiveLateFee, setWaiveLateFee] = useState<boolean | null>(null);
  // "Record rent" opens with the lease's rent filled in; landing in it with
  // the figure selected makes Enter record it and typing replace it.
  const entryAmount = useRef<HTMLInputElement>(null);
  const [entrySaving, setEntrySaving] = useState(false);
  const [entry, setEntry] = useState({
    id: "",
    type: "rent" as "rent" | "expense",
    unitId: "",
    date: "",
    amount: "",
    detail: "",
    note: "",
    category: "",
  });
  const [error, setError] = useState("");
  // ---- Attach proof: files queued in the entry form, the row whose
  // paperclip is open, and the "+ Attach proof" dialog for a saved entry.
  const [pendingProof, setPendingProof] = useState<PendingProof[]>([]);
  const [proofError, setProofError] = useState("");
  const [proofUploading, setProofUploading] = useState(false);
  const [openClip, setOpenClip] = useState("");
  const [attachFor, setAttachFor] = useState("");
  const [attachPending, setAttachPending] = useState<PendingProof[]>([]);
  const [removingProof, setRemovingProof] = useState("");
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null);
  const { toasts, push, dismiss } = useToasts();

  const [addingUnit, setAddingUnit] = useState(false);
  const [unitName, setUnitName] = useState("");
  const [unitRent, setUnitRent] = useState("");

  const [editingUnitId, setEditingUnitId] = useState("");
  const [editUnitName, setEditUnitName] = useState("");
  const [editUnitRent, setEditUnitRent] = useState("");
  const [editUnitVacant, setEditUnitVacant] = useState(false);
  const [editUnitSince, setEditUnitSince] = useState("");

  const [addingRecurring, setAddingRecurring] = useState(false);
  const [rCategory, setRCategory] = useState("");
  const [rUnitId, setRUnitId] = useState("");
  const [rAmount, setRAmount] = useState("");
  const [rDetail, setRDetail] = useState("");
  const [rFrequency, setRFrequency] = useState<"monthly" | "yearly">("monthly");
  const [rDay, setRDay] = useState("1");
  const [rMonth, setRMonth] = useState("1");

  async function addUnit(e: React.FormEvent) {
    e.preventDefault();
    const name = unitName.trim();
    if (!name) return;
    setError("");

    const res = await fetch(`/api/properties/${property.id}/units`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, monthlyRent: parseFloat(unitRent) || 0 }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.error || "Couldn't add that unit.");
      return;
    }
    setUnits((prev) => [...prev, data]);
    setUnitName("");
    setUnitRent("");
    setAddingUnit(false);
  }

  function startEditUnit(u: Unit) {
    setEditingUnitId(u.id);
    setEditUnitName(u.name);
    setEditUnitRent(u.monthlyRent ? String(u.monthlyRent) : "");
    setEditUnitVacant(u.vacant);
    setEditUnitSince(u.vacantSince ?? "");
  }

  async function saveUnit(e: React.FormEvent) {
    e.preventDefault();
    const name = editUnitName.trim();
    if (!name) return;
    setError("");

    const res = await fetch(`/api/units/${editingUnitId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        monthlyRent: parseFloat(editUnitRent) || 0,
        vacant: editUnitVacant,
        ...(editUnitVacant && editUnitSince ? { vacantSince: editUnitSince } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.error || "Couldn't save that unit.");
      return;
    }
    setUnits((prev) => prev.map((u) => (u.id === editingUnitId ? data : u)));
    setEditingUnitId("");
  }

  function removeUnit(unit: Unit) {
    setConfirming({
      title: `Remove ${unit.name}?`,
      body: "Past ledger entries stay in the books — they just stop being tied to a unit. Rent tracking for this unit stops.",
      confirmLabel: "Remove unit",
      danger: true,
      onConfirm: async () => {
        const res = await fetch(`/api/units/${unit.id}`, { method: "DELETE" });
        if (!res.ok) {
          push("Couldn't remove that unit.", "bad");
          return;
        }
        setUnits((prev) => prev.filter((u) => u.id !== unit.id));
        push(`${unit.name} removed.`);
        router.refresh();
      },
    });
  }

  async function addRecurring(e: React.FormEvent) {
    e.preventDefault();
    if (!rCategory || !(parseFloat(rAmount) > 0)) return;
    setError("");

    const res = await fetch(`/api/properties/${property.id}/recurring`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: rCategory,
        unitId: rUnitId || undefined,
        amount: parseFloat(rAmount),
        detail: rDetail,
        frequency: rFrequency,
        day: parseInt(rDay, 10) || 1,
        month: rFrequency === "yearly" ? parseInt(rMonth, 10) || 1 : undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.error || "Couldn't add that recurring expense.");
      return;
    }
    setRecurring((prev) => [...prev, data]);
    setRCategory("");
    setRUnitId("");
    setRAmount("");
    setRDetail("");
    setRFrequency("monthly");
    setRDay("1");
    setRMonth("1");
    setAddingRecurring(false);
  }

  function openPropertyEdit() {
    setPropertyForm({
      name: property.name,
      address: property.address,
      monthlyRent: property.monthlyRent ? String(property.monthlyRent) : "",
      vacant: property.vacant,
      vacantSince: property.vacantSince ?? "",
    });
    setError("");
    setPropertyOpen(true);
  }

  async function saveProperty(e: FormEvent) {
    e.preventDefault();
    const name = propertyForm.name.trim();
    if (!name) return;
    setError("");
    setPropertySaving(true);
    const res = await fetch(`/api/properties/${property.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        address: propertyForm.address.trim(),
        monthlyRent: parseFloat(propertyForm.monthlyRent) || 0,
        vacant: propertyForm.vacant,
        ...(propertyForm.vacant && propertyForm.vacantSince ? { vacantSince: propertyForm.vacantSince } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    setPropertySaving(false);
    if (!res.ok) {
      setError(data?.error || "Couldn't save those changes.");
      return;
    }
    // A rent change comes back with the history it started, so the rent
    // trail and what's expected this month update without a reload.
    const { rentChanges: history, ...fields } = data as Property & { rentChanges?: RentChangeDTO[] };
    setProperty((prev) => ({ ...prev, ...fields, address: fields.address ?? "" }));
    if (history) {
      setRentChanges((prev) => [
        ...prev.filter((c) => !(c.propertyId === property.id && c.unitId === null)),
        ...history,
      ]);
    }
    setPropertyOpen(false);
    push("Property updated.");
    router.refresh();
  }

  async function toggleRecurringActive(r: RecurringExpense) {
    const res = await fetch(`/api/recurring/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !r.active }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      push(data?.error || "Couldn't change that bill.", "bad");
      return;
    }
    setRecurring((prev) => prev.map((x) => (x.id === r.id ? data : x)));
    push(r.active ? `${r.category} bill paused.` : `${r.category} bill resumed.`);
  }

  function removeRecurring(r: RecurringExpense) {
    setConfirming({
      title: `Delete this ${r.category.toLowerCase()} bill?`,
      body: "Entries already logged from it stay in the ledger. It just stops showing up as due each period.",
      confirmLabel: "Delete bill",
      danger: true,
      onConfirm: async () => {
        const res = await fetch(`/api/recurring/${r.id}`, { method: "DELETE" });
        if (!res.ok) {
          push("Couldn't delete that recurring expense.", "bad");
          return;
        }
        setRecurring((prev) => prev.filter((x) => x.id !== r.id));
        push("Recurring expense deleted.");
      },
    });
  }

  // ---------- Tenants ----------

  function openTenant(t?: TenantDTO) {
    setError("");
    setTenantForm(
      t
        ? {
            id: t.id,
            name: t.name,
            unitId: t.unitId ?? "",
            phone: t.phone,
            email: t.email,
            leaseStart: t.leaseStart,
            leaseEnd: t.leaseEnd,
            deposit: t.deposit ? String(t.deposit) : "",
            dueDay: String(t.dueDay),
            note: t.note,
            emailReminders: t.emailReminders,
          }
        : { ...EMPTY_TENANT, unitId: units[0]?.id ?? "" }
    );
    setTenantOpen(true);
  }

  async function saveTenant(e: React.FormEvent) {
    e.preventDefault();
    const name = tenantForm.name.trim();
    if (!name) return;
    setTenantSaving(true);
    setError("");

    const payload = {
      name,
      unitId: units.length > 0 ? tenantForm.unitId || null : null,
      phone: tenantForm.phone,
      email: tenantForm.email,
      leaseStart: tenantForm.leaseStart,
      leaseEnd: tenantForm.leaseEnd,
      deposit: parseFloat(tenantForm.deposit) || 0,
      dueDay: parseInt(tenantForm.dueDay, 10) || 1,
      note: tenantForm.note,
      emailReminders: tenantForm.emailReminders,
    };

    const editing = Boolean(tenantForm.id);
    const res = await fetch(
      editing ? `/api/tenants/${tenantForm.id}` : `/api/properties/${property.id}/tenants`,
      {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const data = await res.json().catch(() => ({}));
    setTenantSaving(false);
    if (!res.ok) {
      setError(data?.error || "Couldn't save that tenant.");
      return;
    }

    setTenants((prev) => (editing ? prev.map((t) => (t.id === data.id ? data : t)) : [...prev, data]));
    // A new tenant ends a vacancy; the server has already cleared it.
    if (!editing) setVacancy(data.unitId ?? null, null);
    setTenantOpen(false);
    push(editing ? "Tenant updated." : `${data.name} added.`);
    router.refresh();
  }

  /**
   * Kept in state rather than read straight from the prop: adding a late fee
   * inside the statement changes the number, and the card behind it should
   * say the new one without a round trip to the server.
   */
  const [balances, setBalances] = useState(initialBalances);
  const [moveOuts, setMoveOuts] = useState(initialMoveOuts);

  // Arriving by a link to one tenant (a name on the overview): bring their
  // card into view and light it up for a moment, so on a phone with six
  // cards it's obvious which one was meant.
  const [spotlightId, setSpotlightId] = useState("");
  useEffect(() => {
    const id = window.location.hash.startsWith("#tenant-") ? window.location.hash.slice("#tenant-".length) : "";
    if (!id) return;
    const card = document.getElementById(`tenant-${id}`);
    if (!card) return;
    card.scrollIntoView({ block: "center" });
    setSpotlightId(id);
    const timer = window.setTimeout(() => setSpotlightId(""), 2400);
    return () => window.clearTimeout(timer);
  }, []);
  const [movingOut, setMovingOut] = useState<TenantDTO | null>(null);
  // Lease renewals (a25): the tenant whose renewal form is open, and each
  // tenant's latest renewal.
  const [renewing, setRenewing] = useState<TenantDTO | null>(null);
  const [renewals, setRenewals] = useState<Record<string, RenewalDTO>>(initialRenewals);
  const [renewalBusy, setRenewalBusy] = useState("");
  // "Renew" on the overview's lease alert lands here with ?renew=<tenant>.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("renew");
    const t = id ? initialTenants.find((x) => x.id === id && x.active) : null;
    if (t) setRenewing(t);
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [returningFor, setReturningFor] = useState("");
  const [statementFor, setStatementFor] = useState<TenantDTO | null>(null);

  const [portal, setPortal] = useState<Record<string, PortalAccess>>(initialPortal);
  const [portalBusy, setPortalBusy] = useState("");
  const accessFor = (tenantId: string) => portal[tenantId] ?? NO_ACCESS;

  /**
   * Hand a tenant a code for the portal. The code is theirs alone — redeeming
   * it can only ever produce a login for this one tenant's unit.
   */
  async function invitePortal(t: TenantDTO) {
    setPortalBusy(t.id);
    const res = await fetch(`/api/tenants/${t.id}/portal`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setPortalBusy("");
    if (!res.ok) {
      push(data?.error || "Couldn't create that code.", "bad");
      return;
    }
    setPortal((prev) => ({ ...prev, [t.id]: data }));
    push(`Code ready for ${t.name}. Send it over.`);
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(formatJoinCode(code));
      push("Code copied.");
    } catch {
      // Clipboard access is blocked outside a secure context and on some
      // in-app browsers; the code is on screen either way.
      push("Couldn't copy — read it off the card instead.", "bad");
    }
  }

  /** Forgotten password: kill the login, hand out a fresh code, keep history. */
  function resetPortal(t: TenantDTO) {
    setConfirming({
      title: "Send a new code?",
      body: `${t.name} won't be able to sign in with their old password. You'll get a fresh code to give them, and everything they've reported stays exactly where it is.`,
      confirmLabel: "Make a new code",
      onConfirm: async () => {
        const res = await fetch(`/api/tenants/${t.id}/portal`, { method: "PUT" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          push(data?.error || "Couldn't do that.", "bad");
          return;
        }
        setPortal((prev) => ({ ...prev, [t.id]: data }));
        push(`New code ready for ${t.name}.`);
      },
    });
  }

  function revokePortal(t: TenantDTO) {
    const has = accessFor(t.id);
    setConfirming({
      title: has.accountEmail ? "Remove portal access?" : "Cancel this code?",
      body: has.accountEmail
        ? `${t.name} won't be able to sign in with ${has.accountEmail} any more. Their lease, deposit and every payment on the books stay exactly as they are — this is only the login.`
        : `The code you gave ${t.name} stops working. You can issue a new one any time.`,
      confirmLabel: has.accountEmail ? "Remove access" : "Cancel code",
      danger: true,
      onConfirm: async () => {
        const res = await fetch(`/api/tenants/${t.id}/portal`, { method: "DELETE" });
        if (!res.ok) {
          push("Couldn't do that.", "bad");
          return;
        }
        setPortal((prev) => ({ ...prev, [t.id]: NO_ACCESS }));
        push(has.accountEmail ? "Portal access removed." : "Code cancelled.");
      },
    });
  }

  async function setTenantActive(t: TenantDTO, active: boolean) {
    const res = await fetch(`/api/tenants/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      push(data?.error || "Couldn't update that tenant.", "bad");
      return;
    }
    setTenants((prev) => prev.map((x) => (x.id === t.id ? data : x)));
    // Back in means the place isn't empty; the server has cleared it.
    if (active) setVacancy(t.unitId ?? null, null);
    push(active ? `${t.name} is current again.` : `${t.name} moved to past tenants.`);
    router.refresh();
  }

  /** Mirrors a vacancy the server just set or cleared, so the page needn't reload. */
  function setVacancy(unitId: string | null, since: string | null) {
    if (unitId) {
      setUnits((prev) => prev.map((u) => (u.id === unitId ? { ...u, vacant: Boolean(since), vacantSince: since } : u)));
    } else {
      setProperty((prev) => ({ ...prev, vacant: Boolean(since), vacantSince: since }));
    }
  }

  /** Re-reads one tenant's balance after something on the server moved it. */
  async function refreshBalance(tenantId: string) {
    const res = await fetch(`/api/tenants/${tenantId}/statement`);
    if (!res.ok) return;
    const d = await res.json().catch(() => null);
    if (!d?.statement) return;
    setBalances((prev) => ({
      ...prev,
      [tenantId]: { balance: d.statement.balance, behindSince: d.statement.behindSince, problem: d.problem ?? "" },
    }));
  }

  function undoMoveOut(t: TenantDTO) {
    const m = moveOuts[t.id];
    if (!m) return;
    const kept = Math.round((m.deposit - m.refund) * 100) / 100;
    setConfirming({
      title: `Undo ${t.name}\u2019s move-out?`,
      body: `${t.name} becomes the current tenant again and rent is charged as before.${
        kept > 0 ? ` The ${money(kept)} kept from the deposit comes out of the ledger, and so do the charges it paid.` : ""
      }`,
      confirmLabel: "Undo move-out",
      danger: true,
      onConfirm: async () => {
        const res = await fetch(`/api/tenants/${t.id}/move-out`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        setConfirming(null);
        if (!res.ok) {
          push(data?.error || "Couldn't undo that.", "bad");
          return;
        }
        setTenants((prev) => prev.map((x) => (x.id === t.id ? data.tenant : x)));
        setMoveOuts((prev) => {
          const next = { ...prev };
          delete next[t.id];
          return next;
        });
        if (data.vacancyCleared) setVacancy(t.unitId ?? null, null);
        const gone: string[] = data.transactionIds ?? [];
        setTransactions((prev) => prev.filter((x) => !gone.includes(x.id)));
        await refreshBalance(t.id);
        push(`${t.name} is current again.`);
        router.refresh();
      },
    });
  }

  function removeTenant(t: TenantDTO) {
    setConfirming({
      title: `Delete ${t.name}?`,
      body: "This erases their contact details and lease dates. Rent they paid stays in the ledger. If they've just moved out, ending the tenancy keeps the record instead.",
      confirmLabel: "Delete tenant",
      danger: true,
      onConfirm: async () => {
        const res = await fetch(`/api/tenants/${t.id}`, { method: "DELETE" });
        if (!res.ok) {
          push("Couldn't delete that tenant.", "bad");
          return;
        }
        setTenants((prev) => prev.filter((x) => x.id !== t.id));
        push(`${t.name} deleted.`);
        router.refresh();
      },
    });
  }

  // ---------- Correcting an entry ----------

  function openEntry(t: LedgerEntry) {
    setError("");
    setWaiveLateFee(null); // a21
    setEntry({
      id: t.id,
      type: t.type,
      unitId: t.unitId ?? "",
      date: t.date,
      amount: String(t.amount),
      detail: t.detail,
      note: t.note,
      category: t.category,
    });
    resetProofQueue();
    setEntryOpen(true);
  }

  /** What this month's rent should be for a unit, or for the whole house. */
  function expectedRent(unitId: string) {
    const unit = unitId ? units.find((u) => u.id === unitId) : null;
    if (unitId && !unit) return 0;
    if (unit ? unit.vacant : property.vacant) return 0;
    return rentForMonth(
      rentChanges,
      property.id,
      unitId || null,
      todayKey.slice(0, 7),
      unit ? unit.monthlyRent : property.monthlyRent
    );
  }

  /** Who is renting that unit right now, for the "Paid by" line. */
  /** What a place was asking in a given month — the rent a vacancy is going without. */
  function expectedRentFor(unitId: string | null, month: string) {
    const unit = unitId ? units.find((u) => u.id === unitId) : null;
    return rentForMonth(rentChanges, property.id, unitId, month, unit ? unit.monthlyRent : property.monthlyRent);
  }

  function tenantFor(unitId: string) {
    const match = tenants.find((t) => t.active && (t.unitId ?? "") === unitId);
    return match?.name ?? "";
  }

  /**
   * A blank entry, opened straight from this page so recording rent doesn't
   * mean going back to the dashboard and finding the property again. Rent
   * almost always arrives at the figure on the lease, so it starts there and
   * a short payment is typed over it.
   */
  function openNewEntry(prefill?: { type?: "rent" | "expense"; unitId?: string; detail?: string }) {
    const type = prefill?.type ?? "rent";
    const unitId = prefill?.unitId ?? "";
    setError("");
    setWaiveLateFee(null); // a21
    setEntry({
      id: "",
      type,
      unitId,
      date: todayKey,
      amount: type === "rent" ? amountField(expectedRent(unitId)) : "",
      detail: type === "rent" ? (prefill?.detail ?? tenantFor(unitId)) : "",
      note: "",
      category: "",
    });
    resetProofQueue();
    setEntryOpen(true);
  }

  /** Switching the toggle on a blank entry re-guesses; an edit is left alone. */
  function setEntryType(type: "rent" | "expense") {
    setEntry((f) =>
      f.id
        ? { ...f, type }
        : {
            ...f,
            type,
            amount: type === "rent" ? amountField(expectedRent(f.unitId)) : "",
            detail: type === "rent" ? tenantFor(f.unitId) : "",
          }
    );
  }

  /** Changing the unit on a blank rent entry re-guesses too. */
  function setEntryUnit(unitId: string) {
    setEntry((f) =>
      f.id || f.type !== "rent"
        ? { ...f, unitId }
        : { ...f, unitId, amount: amountField(expectedRent(unitId)), detail: tenantFor(unitId) }
    );
  }

  async function saveEntry(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseFloat(entry.amount);
    if (!(amount > 0) || !entry.date) return;
    if (entry.type === "expense" && !entry.category) {
      setError("Pick a category for this expense.");
      return;
    }
    setEntrySaving(true);
    setError("");

    const isNew = !entry.id;
    const res = await fetch(isNew ? "/api/transactions" : `/api/transactions/${entry.id}`, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propertyId: property.id,
        unitId: entry.unitId || null,
        type: entry.type,
        date: entry.date,
        amount,
        detail: entry.detail,
        note: entry.note,
        category: entry.type === "expense" ? entry.category : undefined,
        // a21: only sent once the box was touched, so an edit can't un-waive by accident.
        waiveLateFee: entry.type === "rent" && waiveLateFee !== null ? waiveLateFee : undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setEntrySaving(false);
      setError(data?.error || (isNew ? "Couldn't record that." : "Couldn't save that entry."));
      return;
    }
    // Late fee waivers (a21): applied with the save; say so in the toast.
    const waiverNote =
      entry.type !== "rent" || waiveLateFee === null
        ? ""
        : waiveLateFee
          ? " Late fee waived for the month."
          : " Late fees apply again from today.";
    setWaiveLateFee(null);

    if (isNew) {
      setTransactions((prev) =>
        [{ ...data, attachments: [] } as LedgerEntry, ...prev].sort((a, b) => b.date.localeCompare(a.date))
      );
    } else {
      // Proof already on the entry is untouched by an edit, so keep it.
      setTransactions((prev) =>
        prev
          .map((t) => (t.id === entry.id ? { ...t, ...data, attachments: t.attachments } : t))
          .sort((a, b) => b.date.localeCompare(a.date))
      );
    }

    // Proof picked in the form goes up once the entry exists. If a file
    // fails, the entry is still saved: the dialog stays open as an edit of
    // it, holding the files that didn't make it so they can be retried.
    const txnId: string = isNew ? data.id : entry.id;
    const sent = await uploadQueued(txnId, pendingProof, setPendingProof, setProofError);
    setEntrySaving(false);
    if (!sent.ok) {
      if (isNew) setEntry((f) => ({ ...f, id: txnId }));
      router.refresh();
      return;
    }

    setEntryOpen(false);
    const withProof = sent.count > 0 ? ` with ${proofCountLabel(sent.count)}` : "";
    push(
      isNew
        ? `${entry.type === "rent" ? "Rent" : "Expense"} of ${money(amount)} recorded${withProof}.${waiverNote}`
        : `Entry updated${withProof}.${waiverNote}`
    );
    router.refresh();
  }

  // ---------- Attach proof ----------

  function resetProofQueue() {
    releasePending(pendingProof);
    setPendingProof([]);
    setProofError("");
  }

  /**
   * Uploads queued files one at a time (phones on a weak signal do better
   * than with four at once), filing each onto its row as it lands. Stops at
   * the first failure and leaves that file and the rest in the queue.
   */
  async function uploadQueued(
    txnId: string,
    queue: PendingProof[],
    setQueue: (q: PendingProof[]) => void,
    setErr: (m: string) => void
  ): Promise<{ ok: boolean; count: number }> {
    setErr("");
    if (queue.length === 0) return { ok: true, count: 0 };
    setProofUploading(true);
    let count = 0;
    for (let i = 0; i < queue.length; i++) {
      const result = await uploadProof(txnId, queue[i].file);
      if (!result.ok) {
        setQueue(queue.slice(i));
        setErr(`${count > 0 ? `${proofCountLabel(count)} attached, but ` : ""}${result.error}`);
        setProofUploading(false);
        return { ok: false, count };
      }
      count += 1;
      releasePending([queue[i]]);
      setTransactions((prev) =>
        prev.map((t) => (t.id === txnId ? { ...t, attachments: [...t.attachments, result.attachment] } : t))
      );
    }
    setQueue([]);
    setProofUploading(false);
    return { ok: true, count };
  }

  function openAttach(t: LedgerEntry) {
    releasePending(attachPending);
    setAttachPending([]);
    setProofError("");
    setAttachFor(t.id);
  }

  function closeAttach() {
    releasePending(attachPending);
    setAttachPending([]);
    setProofError("");
    setAttachFor("");
  }

  async function sendAttach(e: React.FormEvent) {
    e.preventDefault();
    const id = attachFor;
    const sent = await uploadQueued(id, attachPending, setAttachPending, setProofError);
    if (!sent.ok) return;
    setAttachFor("");
    setOpenClip(id);
    if (sent.count > 0) push(`${proofCountLabel(sent.count)} attached.`);
    router.refresh();
  }

  function removeProof(a: ProofDTO) {
    setConfirming({
      title: "Remove this proof?",
      body: `${a.filename} is deleted from this entry. The entry itself stays.`,
      confirmLabel: "Remove",
      danger: true,
      onConfirm: async () => {
        setRemovingProof(a.id);
        const res = await fetch(`/api/attachments/${a.id}`, { method: "DELETE" });
        setRemovingProof("");
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          push(data?.error || "Couldn't remove that file.", "bad");
          return;
        }
        setTransactions((prev) =>
          prev.map((t) =>
            t.id === a.transactionId ? { ...t, attachments: t.attachments.filter((x) => x.id !== a.id) } : t
          )
        );
        push("Proof removed.");
      },
    });
  }

  function removeEntry(t: LedgerEntry) {
    setConfirming({
      title: "Delete this entry?",
      body: `${t.type === "rent" ? "Rent" : "Expense"} of ${money(t.amount)} on ${formatDay(t.date)}${
        t.attachments.length > 0
          ? `. Its ${t.attachments.length === 1 ? "proof file goes" : "proof files go"} too`
          : ""
      }. To fix a wrong figure, edit it instead — that keeps the proof.`,
      confirmLabel: "Delete entry",
      danger: true,
      onConfirm: async () => {
        const res = await fetch(`/api/transactions/${t.id}`, { method: "DELETE" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          push(data?.error || "Couldn't delete that entry.", "bad");
          return;
        }
        setTransactions((prev) => prev.filter((x) => x.id !== t.id));
        push("Entry deleted.");
        router.refresh();
      },
    });
  }

  /** What a place rents for this month — the figure a renewal starts from. */
  function currentRentAt(unitId: string | null) {
    const unit = unitId ? units.find((u) => u.id === unitId) : null;
    return rentForMonth(rentChanges, property.id, unitId, todayKey.slice(0, 7), unit ? unit.monthlyRent : property.monthlyRent);
  }

  async function sendRenewal(t: TenantDTO, r: RenewalDTO) {
    setRenewalBusy(r.id);
    try {
      const res = await fetch(`/api/renewals/${r.id}/send`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        push(data.error || "Couldn't send the notice. Try again.");
        return;
      }
      setRenewals((prev) => ({ ...prev, [t.id]: { ...r, sentAt: data.sentAt } }));
      push(`Renewal notice sent to ${t.name}’s messages.`);
    } finally {
      setRenewalBusy("");
    }
  }

  function undoRenewal(t: TenantDTO, r: RenewalDTO) {
    setConfirming({
      title: `Undo ${t.name}’s renewal?`,
      body:
        r.newRent !== r.previousRent
          ? `The lease goes back to ending ${r.previousEnd ? formatDay(r.previousEnd) : "with no date"}, and the ${money(r.newRent)} rent from ${monthShort(r.rentFrom)} is taken off.`
          : `The lease goes back to ending ${r.previousEnd ? formatDay(r.previousEnd) : "with no date"}.`,
      confirmLabel: "Undo renewal",
      danger: true,
      onConfirm: async () => {
        setRenewalBusy(r.id);
        try {
          const res = await fetch(`/api/renewals/${r.id}`, { method: "DELETE" });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            push(data.error || "Couldn't undo the renewal.");
            return;
          }
          if (data.tenant) setTenants((prev) => prev.map((x) => (x.id === t.id ? data.tenant : x)));
          setRentChanges((prev) => [
            ...prev.filter((c) => !(c.propertyId === property.id && (c.unitId ?? null) === (t.unitId ?? null))),
            ...(data.rentChanges as RentChangeDTO[]),
          ]);
          setRenewals((prev) => {
            const next = { ...prev };
            delete next[t.id];
            return next;
          });
          push(`${t.name}’s renewal undone.`);
          router.refresh();
        } finally {
          setRenewalBusy("");
        }
      },
    });
  }

  /** A renewal on a tenant card: what changed, the letter, sending it, undo. */
  function renewalLine(t: TenantDTO, r: RenewalDTO) {
    const first = t.name.trim().split(/\s+/)[0] || t.name;
    const busy = renewalBusy === r.id;
    return (
      <div className={styles.renewalLine}>
        <span>
          Renewed to <strong>{formatDay(r.newEnd)}</strong>
          {r.newRent !== r.previousRent && (
            <>
              {" · "}
              <strong className="num">{money(r.newRent)}</strong> from {monthShort(r.rentFrom)}
            </>
          )}
          {r.sentAt && <> · notice sent {formatDay(r.sentAt.slice(0, 10))}</>}
        </span>
        <span className={styles.renewalLinks}>
          <Link href={`/dashboard/renewals/${r.id}`}>Letter</Link>
          <button type="button" disabled={busy} onClick={() => sendRenewal(t, r)}>
            {r.sentAt ? "Send again" : `Send to ${first}`}
          </button>
          {r.undoable && (
            <button type="button" disabled={busy} onClick={() => undoRenewal(t, r)}>
              Undo
            </button>
          )}
        </span>
      </div>
    );
  }

  /**
   * The rent trail for a place, newest first. Only rendered when there is
   * one — most properties have never had a change, and an empty history is
   * not worth a line of chrome.
   */
  function RentTrail({ unitId }: { unitId: string | null }) {
    const all = historyFor(rentChanges, property.id, unitId);
    // A raise renewed ahead of time (a25) isn't today's rent yet: it's said
    // as what's coming, and the trail of what has been starts after it.
    const thisMonth = todayKey.slice(0, 7);
    const coming = all.filter((c) => c.effectiveFrom > thisMonth).reverse();
    const history = all.filter((c) => c.effectiveFrom <= thisMonth);
    if (history.length === 0 && coming.length === 0) return null;

    const asMonth = (key: string) => {
      const [y, m] = key.split("-").map(Number);
      // The backfilled row stands for "since before any of this was recorded".
      if (y <= 1970) return "at first";
      return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
    };

    // The current figure is already on screen beside this, so the trail
    // starts at "since when" and only names the older amounts.
    return (
      <div className={styles.note}>
        {coming.map((c) => (
          <span key={c.id} className={styles.rentScheduled}>
            {money(c.amount)} from {asMonth(c.effectiveFrom)}
            {history.length > 0 ? " · " : ""}
          </span>
        ))}
        {history.length > 0 && <>since {asMonth(history[0].effectiveFrom)}</>}
        {history.slice(1).map((c) => (
          <span key={c.id}>
            {" · "}
            {money(c.amount)} {asMonth(c.effectiveFrom)}
          </span>
        ))}
      </div>
    );
  }

  function unitLabel(unitId: string | null) {
    if (!unitId) return "Whole property";
    return units.find((u) => u.id === unitId)?.name ?? "—";
  }

  function scheduleLabel(r: RecurringExpense) {
    if (r.frequency === "yearly") return `Yearly, ${MONTHS[(r.month ?? 1) - 1]} ${r.day}`;
    return `Monthly, day ${r.day}`;
  }

  // Twelve months ending this month, for this property alone.
  const series = useMemo(() => {
    const keys = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    });
    const buckets = new Map(keys.map((k) => [k, { month: k, rent: 0, expense: 0 }]));
    for (const t of transactions) {
      const bucket = buckets.get(t.date.slice(0, 7));
      if (!bucket) continue;
      if (t.type === "rent") bucket.rent += t.amount;
      else bucket.expense += t.amount;
    }
    return keys.map((k) => buckets.get(k)!);
  }, [transactions, now]);

  // Loans as the Mortgages panel last reported them, for the one figure the
  // net above can't show: principal is rightly not an expense, so "net"
  // overstates the cash left once the mortgage is paid.
  const [loanState, setLoanState] = useState<LoanDTO[]>(initialLoans);
  const principalLastTwelve = useMemo(() => {
    const from = series[0]?.month ?? "";
    let cents = 0;
    for (const l of loanState) {
      for (const p of l.payments) if (p.date.slice(0, 7) >= from) cents += Math.round(p.principal * 100);
    }
    return cents / 100;
  }, [loanState, series]);

  const lastTwelve = useMemo(() => {
    const rent = series.reduce((sum, m) => sum + m.rent, 0);
    const expense = series.reduce((sum, m) => sum + m.expense, 0);
    return { rent, expense, net: rent - expense };
  }, [series]);

  const lifetime = useMemo(() => {
    let rent = 0;
    let expense = 0;
    for (const t of transactions) {
      if (t.type === "rent") rent += t.amount;
      else expense += t.amount;
    }
    return { rent, expense, net: rent - expense };
  }, [transactions]);

  const currentTenants = tenants.filter((t) => t.active);
  const pastTenants = tenants.filter((t) => !t.active);
  const depositsHeld = currentTenants.reduce((sum, t) => sum + t.deposit, 0);
  const recentEntries = transactions.slice(0, 12);

  return (
    <AppShell
      openRepairs={openRepairs}
      title={property.name}
      tagline={[property.address, companyName].filter(Boolean).join(" · ") || "Units, tenants and bills"}
      back={{ href: "/dashboard", label: "All properties" }}
      titleAction={<TitleEditButton label="Edit property" onClick={openPropertyEdit} />}
      actions={
        <>
          <button type="button" className={styles.btn} onClick={() => openTenant()}>
            + Add a tenant
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.accent}`}
            onClick={() => openNewEntry()}
          >
            + Record a payment
          </button>
        </>
      }
    >

      {error && <div className={styles.errorBar}>{error}</div>}

      {units.length === 0 && property.monthlyRent > 0 && (
        <div className={styles.rentTrailRow}>
          <span>Monthly rent</span>
          <span className="num">{money(property.monthlyRent)}</span>
          <RentTrail unitId={null} />
        </div>
      )}

      {units.length === 0 && property.vacant && property.vacantSince && (
        <div className={styles.vacancyBar}>
          <span className={`${styles.pill} ${styles.vacant}`}>
            Vacant {vacantFor(vacantDays(property.vacantSince, todayKey))}
          </span>
          <span>
            Empty since {formatDay(property.vacantSince)}
            {vacantDays(property.vacantSince, todayKey) > 0 &&
              ` · ${money(
                Math.round(vacancyCost(property.vacantSince, todayKey, (m) => expectedRentFor(null, m)))
              )} of rent gone so far`}
          </span>
          <button type="button" className={styles.portalLink} onClick={() => openTenant()}>
            Add the next tenant
          </button>
        </div>
      )}

      <section className={styles.kpis} aria-label="This property">
        <div className={`${styles.kpi} ${styles.rentKpi}`}>
          <div className={styles.kpiLabel}>Rent, last 12 months</div>
          <div className={`${styles.kpiValue} num`}>{money(lastTwelve.rent)}</div>
          <div className={styles.kpiFoot}>
            <span className={styles.delta}>
              <span className={styles.deltaNote}>{money(lifetime.rent)} all time</span>
            </span>
          </div>
        </div>
        <div className={`${styles.kpi} ${styles.expenseKpi}`}>
          <div className={styles.kpiLabel}>Spent, last 12 months</div>
          <div className={`${styles.kpiValue} num`}>{money(lastTwelve.expense)}</div>
          <div className={styles.kpiFoot}>
            <span className={styles.delta}>
              <span className={styles.deltaNote}>{money(lifetime.expense)} all time</span>
            </span>
          </div>
        </div>
        <div className={`${styles.kpi} ${styles.netKpi}`}>
          <div className={styles.kpiLabel}>Net, last 12 months</div>
          <div className={`${styles.kpiValue} num ${lastTwelve.net >= 0 ? styles.pos : styles.neg}`}>
            {lastTwelve.net < 0 ? "\u2212" : ""}
            {money(Math.abs(lastTwelve.net))}
          </div>
          <div className={styles.kpiFoot}>
            <span className={styles.delta}>
              <span className={styles.deltaNote}>
                {principalLastTwelve > 0
                  ? `${signedMoney(lastTwelve.net - principalLastTwelve)} after ${money(principalLastTwelve)} of principal`
                  : `${lifetime.net < 0 ? "\u2212" : ""}${money(Math.abs(lifetime.net))} all time`}
              </span>
            </span>
          </div>
        </div>
      </section>

      {transactions.length > 0 && (
        <section className={styles.card} style={{ marginTop: 12 }} aria-label="Cash flow">
          <CashFlowChart data={series} />
        </section>
      )}

      <section className={styles.block}>
        <div className={styles.blockHead}>
          <h2>Tenants</h2>
          <span className={styles.count}>
            {depositsHeld > 0 ? `${money(depositsHeld)} in deposits held` : ""}
          </span>
        </div>
        <p className={styles.helpText} style={{ marginTop: 0 }}>
          Who&apos;s renting, how to reach them, and when their lease runs out. The due day here is what makes
          unpaid rent show as late on the dashboard.
        </p>

        {tenants.length === 0 ? (
          <div className={styles.ledgerWrap}>
            <div className={styles.emptyState}>
              No tenants on file yet — add one and unpaid rent starts telling you who to call.
            </div>
          </div>
        ) : (
          <div className={styles.tenantGrid}>
            {[...currentTenants, ...pastTenants].map((t) => {
              const status = leaseStatus(t, now);
              const tone =
                status.kind === "past"
                  ? styles.vacant
                  : status.kind === "ok"
                    ? styles.paid
                    : status.kind === "ending"
                      ? styles.owed
                      : styles.bill;
              return (
                <div
                  key={t.id}
                  id={`tenant-${t.id}`}
                  className={`${styles.tenantCard} ${t.active ? "" : styles.pastTenant} ${
                    spotlightId === t.id ? styles.spotlight : ""
                  }`}
                >
                  <div className={styles.tenantHead}>
                    <div className={styles.tenantName}>
                      <span className={styles.name}>{t.name}</span>
                      <span className={`${styles.pill} ${tone}`}>{status.label}</span>
                    </div>
                    <div className={styles.addr}>
                      {t.unitId ? unitLabel(t.unitId) : "Whole property"} · rent due on the{" "}
                      {ordinal(t.dueDay)}
                    </div>
                  </div>

                  <div className={styles.contactRow}>
                      {/* The written record with them, always here: a
                          conversation can start before they have a phone
                          number on file, or a portal login. */}
                      <Link className={styles.contactBtn} href={`/dashboard/messages/${t.id}`}>
                        {messagesLabel(unreadMessages[t.id] ?? 0)}
                      </Link>
                      {t.phone && (
                        <>
                          <a className={styles.contactBtn} href={telHref(t.phone)}>
                            Call
                          </a>
                          <a className={styles.contactBtn} href={smsHref(t.phone)}>
                            Text
                          </a>
                        </>
                      )}
                      {t.email && (
                        <a className={styles.contactBtn} href={`mailto:${t.email}`}>
                          Email
                        </a>
                      )}
                  </div>

                  <div className={styles.tenantFacts}>
                    <div className={styles.figure}>
                      <span className={styles.figureLabel}>Lease</span>
                      <span className={styles.figureValue}>{leaseRange(t.leaseStart, t.leaseEnd)}</span>
                    </div>
                    <div className={styles.figure}>
                      <span className={styles.figureLabel}>Deposit</span>
                      <span className={styles.figureValue}>
                        {money(t.deposit)}
                        {!t.active && moveOuts[t.id] && t.deposit > 0 ? " settled" : ""}
                      </span>
                    </div>
                  </div>

                  {(() => {
                    const bal = balances[t.id];
                    if (!bal) return null;
                    const owed = bal.balance;
                    // A hair either side of zero is zero: a cent of float drift
                    // must not put someone "behind".
                    const state = owed > 0.005 ? "behind" : owed < -0.005 ? "credit" : "square";
                    return (
                      <div className={styles.balanceRow}>
                        <span
                          className={`${styles.balanceFigure} num ${
                            state === "behind" ? styles.neg : state === "credit" ? styles.pos : ""
                          }`}
                        >
                          {state === "square" ? "Paid up" : money(Math.abs(owed))}
                        </span>
                        <span className={styles.balanceWord}>
                          {bal.problem
                            ? "books can't be split here"
                            : state === "behind"
                              ? bal.behindSince
                                ? `behind since ${monthName(bal.behindSince)}`
                                : "owing"
                              : state === "credit"
                                ? "in credit"
                                : "nothing owing"}
                        </span>
                        <button
                          type="button"
                          className={styles.portalLink}
                          onClick={() => setStatementFor(t)}
                        >
                          Statement
                        </button>
                      </div>
                    );
                  })()}

                  {t.note && <div className={styles.note}>{t.note}</div>}

                  {!t.active && moveOuts[t.id] && (
                    <MoveOutSummary
                      moveOut={moveOuts[t.id]}
                      today={todayKey}
                      onMarkReturned={() => setReturningFor(t.id)}
                      onUndo={() => undoMoveOut(t)}
                    />
                  )}

                  {t.active && (() => {
                    const access = accessFor(t.id);
                    if (access.accountEmail) {
                      return (
                        <div className={styles.portalRow}>
                          <span className={styles.portalOn}>Portal access</span>
                          <span className={styles.portalWho}>
                            {access.accountEmail}
                            {access.lastLoginAt
                              ? ` · last in ${formatDay(access.lastLoginAt.slice(0, 10))}`
                              : " · not signed in yet"}
                          </span>
                          <button
                            type="button"
                            className={styles.portalLink}
                            onClick={() => resetPortal(t)}
                          >
                            Forgot password
                          </button>
                          <button
                            type="button"
                            className={styles.portalLink}
                            onClick={() => revokePortal(t)}
                          >
                            Remove
                          </button>
                        </div>
                      );
                    }
                    if (access.inviteCode) {
                      return (
                        <div className={styles.portalRow}>
                          <span className={styles.portalCode}>{formatJoinCode(access.inviteCode)}</span>
                          <span className={styles.portalWho}>
                            Send this to {t.name}. Good until{" "}
                            {formatDay(access.inviteExpires.slice(0, 10))}.
                          </span>
                          <button
                            type="button"
                            className={styles.portalLink}
                            onClick={() => copyCode(access.inviteCode)}
                          >
                            Copy
                          </button>
                          <button
                            type="button"
                            className={styles.portalLink}
                            onClick={() => revokePortal(t)}
                          >
                            Cancel
                          </button>
                        </div>
                      );
                    }
                    return (
                      <div className={styles.portalRow}>
                        <span className={styles.portalWho}>
                          No portal login yet — they can&apos;t report a problem online.
                        </span>
                        <button
                          type="button"
                          className={styles.portalLink}
                          disabled={portalBusy === t.id}
                          onClick={() => invitePortal(t)}
                        >
                          {portalBusy === t.id ? "Making a code\u2026" : "Invite to the portal"}
                        </button>
                      </div>
                    );
                  })()}

                  {t.active && renewals[t.id] && renewalLine(t, renewals[t.id])}

                  <div className={styles.propActions}>
                    {/* The commonest reason to be looking at a tenant: they
                        paid. Their unit and name fill themselves in. */}
                    {t.active && (
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.small} ${styles.primary}`}
                        onClick={() => openNewEntry({ unitId: t.unitId ?? "", detail: t.name })}
                      >
                        Record rent
                      </button>
                    )}
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.small} ${styles.quiet}`}
                      onClick={() => openTenant(t)}
                    >
                      Edit
                    </button>
                    {t.active && (
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.small} ${styles.quiet}`}
                        onClick={() => setRenewing(t)}
                      >
                        Renew lease
                      </button>
                    )}
                    {t.active ? (
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.small} ${styles.quiet}`}
                        onClick={() => setMovingOut(t)}
                      >
                        Move out
                      </button>
                    ) : (
                      !moveOuts[t.id] && (
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.small} ${styles.quiet}`}
                          onClick={() => setTenantActive(t, true)}
                        >
                          Moved back in
                        </button>
                      )
                    )}
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.small} ${styles.quiet} ${styles.danger}`}
                      onClick={() => removeTenant(t)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          <button type="button" className={`${styles.btn} ${styles.small}`} onClick={() => openTenant()}>
            + Add a tenant
          </button>
        </div>
      </section>

      <section className={styles.block}>
        <div className={styles.blockHead}>
          <h2>Documents</h2>
          <Link href={`/dashboard/properties/${property.id}/files`} className={styles.portalLink}>
            Open the filing cabinet →
          </Link>
        </div>
        <p className={styles.helpText} style={{ marginTop: -6 }}>
          Leases, insurance certificates, licences and inspections — with the date each runs
          out. Anything expiring in the next 30 days shows on the overview. Scan document
          photographs paper with your phone and saves it here as a PDF.
        </p>
        <DocumentsPanel
          initial={initialDocuments}
          targets={[
            { key: `property:${property.id}`, label: `${property.name} (the property)` },
            ...currentTenants.map((t) => ({
              key: `tenant:${t.id}`,
              label: `${t.name}${t.unitId ? ` — ${unitLabel(t.unitId)}` : ""}`,
            })),
          ]}
          today={todayKey}
          canDelete={canManage}
          storageReady={storageReady}
          onToast={(m, tone) => push(m, tone)}
          emptyText="Nothing filed for this property yet."
          scan={{
            properties: [{ id: property.id, name: property.name }],
            tenants: currentTenants.map((t) => ({ id: t.id, name: t.name, propertyId: property.id })),
            defaultPropertyId: property.id,
          }}
        />
      </section>

      {initialRequests.length > 0 && (
        <section className={styles.block}>
          <div className={styles.blockHead}>
            <h2>Reported problems</h2>
            <div className={styles.headTools}>
              <span className={styles.count}>
                {(() => {
                  const open = initialRequests.filter((r) => isOpen(r.status)).length;
                  return open > 0 ? `${open} still open` : "all closed out";
                })()}
              </span>
              <Link href="/dashboard/repairs" className={`${styles.btn} ${styles.small}`}>
                Open the queue
              </Link>
            </div>
          </div>
          <div className={styles.ledgerWrap}>
            <table className={`${styles.ledger} ${styles.txnTable}`}>
              {/* Column order matters: below 640px these rows become cards and
                  the second column is what gets the headline, so the problem
                  sits there rather than the address it's at. */}
              <thead>
                <tr>
                  <th>Reported</th>
                  <th>Problem</th>
                  <th>Status</th>
                  <th>Where &amp; who</th>
                  <th></th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {initialRequests.map((r) => (
                  <tr key={r.id}>
                    <td>{ago(r.createdAt, clock)}</td>
                    <td>
                      {r.title}
                      {r.urgency === "urgent" && isOpen(r.status) && (
                        <span className={styles.urgentTag}>Urgent</span>
                      )}
                    </td>
                    <td>
                      <span
                        className={`${styles.tag} ${
                          isOpen(r.status) ? styles.expense : styles.rent
                        }`}
                      >
                        {STATUS_LABEL[r.status].landlord}
                      </span>
                    </td>
                    <td>
                      {[r.unitName || "Whole property", r.category, r.place]
                        .filter(Boolean)
                        .join(" · ")}
                      <div className={styles.note}>
                        {r.tenantName || "a tenant"}
                        {r.photos.length > 0
                          ? ` · ${r.photos.length} ${r.photos.length === 1 ? "photo" : "photos"}`
                          : ""}
                      </div>
                    </td>
                    <td></td>
                    <td>
                      <div className={styles.rowActions}>
                        <Link
                          href="/dashboard/repairs"
                          className={`${styles.btn} ${styles.small} ${styles.quiet}`}
                        >
                          Work it
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className={styles.block}>
        <div className={styles.blockHead}>
          <h2>Units</h2>
          <span className={styles.count}>
            {units.length ? `${units.length} ${units.length === 1 ? "unit" : "units"}` : ""}
          </span>
        </div>
        <p className={styles.helpText} style={{ marginTop: 0 }}>
          Split this property into units when it&apos;s a duplex, triplex, or building with more than one tenant —
          each unit gets its own rent target and tenant. Leave it with no units for a single-tenant house.
        </p>

        {units.length === 0 ? (
          <div className={styles.ledgerWrap}>
            <div className={styles.emptyState}>No units yet — this property is tracked as a whole.</div>
          </div>
        ) : (
        <div className={styles.ledgerWrap}>
          <table className={`${styles.ledger} ${styles.unitTable}`}>
            <thead>
              <tr>
                <th>Unit</th>
                <th style={{ textAlign: "right" }}>Monthly rent</th>
                <th></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {units.map((u) =>
                editingUnitId === u.id ? (
                  <tr key={u.id}>
                    <td colSpan={4}>
                      <form className={styles.inlineForm} onSubmit={saveUnit} style={{ flexWrap: "wrap" }}>
                        <input
                          type="text"
                          required
                          autoFocus
                          value={editUnitName}
                          onChange={(e) => setEditUnitName(e.target.value)}
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="Monthly rent"
                          value={editUnitRent}
                          onChange={(e) => setEditUnitRent(e.target.value)}
                        />
                        <label className={styles.checkboxField}>
                          <input
                            type="checkbox"
                            checked={editUnitVacant}
                            onChange={(e) => setEditUnitVacant(e.target.checked)}
                          />
                          Vacant
                        </label>
                        {editUnitVacant && (
                          <input
                            type="date"
                            aria-label="Vacant since"
                            title="Vacant since"
                            max={todayKey}
                            value={editUnitSince || todayKey}
                            onChange={(e) => setEditUnitSince(e.target.value)}
                          />
                        )}
                        <button type="submit" className={`${styles.btn} ${styles.small} ${styles.primary}`}>
                          Save
                        </button>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.small}`}
                          onClick={() => setEditingUnitId("")}
                        >
                          Cancel
                        </button>
                      </form>
                    </td>
                  </tr>
                ) : (
                  <tr key={u.id}>
                    <td>
                      {u.name}
                      {u.vacant && (
                        <span className={styles.vacantTag}>
                          {u.vacantSince ? `Vacant ${vacantFor(vacantDays(u.vacantSince, todayKey))}` : "Vacant"}
                        </span>
                      )}
                      {u.vacant && u.vacantSince && vacantDays(u.vacantSince, todayKey) > 0 && (
                        <div className={styles.note}>
                          since {formatDay(u.vacantSince)} ·{" "}
                          {money(Math.round(vacancyCost(u.vacantSince, todayKey, (m) => expectedRentFor(u.id, m))))} of
                          rent gone
                        </div>
                      )}
                    </td>
                    <td className="num" style={{ textAlign: "right" }}>
                      {money(u.monthlyRent)}
                      <RentTrail unitId={u.id} />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div className={styles.rowActions}>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.small} ${styles.primary}`}
                          onClick={() => openNewEntry({ unitId: u.id })}
                        >
                          Record rent
                        </button>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.small}`}
                          onClick={() => startEditUnit(u)}
                        >
                          Edit
                        </button>
                      </div>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {canManage && (
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.small} ${styles.ghost}`}
                          onClick={() => removeUnit(u)}
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
        )}

        {addingUnit ? (
          <form className={styles.inlineForm} onSubmit={addUnit} style={{ marginTop: 14, flexWrap: "wrap" }}>
            <input
              type="text"
              required
              autoFocus
              placeholder="Unit name, e.g. Apt 2"
              value={unitName}
              onChange={(e) => setUnitName(e.target.value)}
            />
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="Monthly rent"
              value={unitRent}
              onChange={(e) => setUnitRent(e.target.value)}
            />
            <button type="submit" className={`${styles.btn} ${styles.small} ${styles.primary}`}>
              Add unit
            </button>
            <button type="button" className={`${styles.btn} ${styles.small}`} onClick={() => setAddingUnit(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <div style={{ marginTop: 14 }}>
            <button type="button" className={`${styles.btn} ${styles.small}`} onClick={() => setAddingUnit(true)}>
              + Add a unit
            </button>
          </div>
        )}
      </section>

      <section className={styles.block}>
        <div className={styles.blockHead}>
          <h2>Mortgages</h2>
        </div>
        <p className={styles.helpText} style={{ marginTop: 0 }}>
          A mortgage payment is three kinds of money. Interest and escrow go into the ledger as expenses, each under its
          own tax category; principal pays down the loan and isn&apos;t an expense, so it stays out of the profit above.
        </p>
        <LoansPanel
          propertyId={property.id}
          initial={initialLoans}
          today={todayKey}
          canDelete={canManage}
          mortgageBills={recurring
            .filter((r) => r.category === "Mortgage Interest")
            .map((r) => ({ id: r.id, amount: r.amount, detail: r.detail, active: r.active }))}
          onPauseBill={async (id) => {
            const r = recurring.find((x) => x.id === id);
            if (r && r.active) await toggleRecurringActive(r);
          }}
          onEntriesAdded={(entries) => {
            setTransactions((prev) => [...entries.map(withNoProof), ...prev].sort((a, b) => b.date.localeCompare(a.date)));
            router.refresh();
          }}
          onEntriesRemoved={(ids) => {
            setTransactions((prev) => prev.filter((t) => !ids.includes(t.id)));
            router.refresh();
          }}
          onToast={push}
          onLoansChange={setLoanState}
        />
      </section>

      <section className={styles.block}>
        <div className={styles.blockHead}>
          <h2>Depreciation</h2>
        </div>
        <p className={styles.helpText} style={{ marginTop: 0 }}>
          The tax code lets you deduct a rental building&apos;s cost over 27.5 years — 39 for commercial — and the
          same for improvements to it. It&apos;s usually the largest deduction a landlord has, and it never shows up as
          money leaving the bank, so it isn&apos;t in the figures above. It is on the tax export, on the line
          Schedule E calls depreciation.
        </p>
        <DepreciationPanel
          propertyId={property.id}
          initial={initialAssets}
          year={Number(todayKey.slice(0, 4))}
          canDelete={canManage}
          onToast={push}
        />
      </section>

      <section className={styles.block}>
        <div className={styles.blockHead}>
          <h2>Recurring expenses</h2>
        </div>
        <p className={styles.helpText} style={{ marginTop: 0 }}>
          Insurance, HOA dues, a management fee — set the amount and schedule once. Mortgages go under Mortgages
          above, so each payment is split. Nothing posts on its own: when it&apos;s
          due, it shows up on the dashboard for that month with a one-click &ldquo;Log it&rdquo; button.
        </p>

        {recurring.length === 0 ? (
          <div className={styles.ledgerWrap}>
            <div className={styles.emptyState}>No recurring expenses set up yet.</div>
          </div>
        ) : (
        <div className={styles.ledgerWrap}>
          <table className={styles.ledger}>
            <thead>
              <tr>
                <th>Category</th>
                <th>Applies to</th>
                <th>Schedule</th>
                <th style={{ textAlign: "right" }}>Amount</th>
                <th></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {recurring.map((r) => (
                <tr key={r.id} style={{ opacity: r.active ? 1 : 0.5 }}>
                  <td>
                    {r.category}
                    {r.detail && <div className={styles.note}>{r.detail}</div>}
                  </td>
                  <td>{unitLabel(r.unitId)}</td>
                  <td>{scheduleLabel(r)}</td>
                  <td className={`${styles.amt} num ${styles.neg}`}>{money(r.amount)}</td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.small}`}
                      onClick={() => toggleRecurringActive(r)}
                    >
                      {r.active ? "Pause" : "Resume"}
                    </button>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.small} ${styles.ghost}`}
                      onClick={() => removeRecurring(r)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}

        {addingRecurring ? (
          <form className={styles.formCard} onSubmit={addRecurring} style={{ marginTop: 14 }}>
            <div className={styles.fieldGrid}>
              <div className={styles.field}>
                <label htmlFor="r-category">Category</label>
                <select id="r-category" required value={rCategory} onChange={(e) => setRCategory(e.target.value)}>
                  <option value="">Choose one</option>
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              {units.length > 0 && (
                <div className={styles.field}>
                  <label htmlFor="r-unit">Applies to</label>
                  <select id="r-unit" value={rUnitId} onChange={(e) => setRUnitId(e.target.value)}>
                    <option value="">Whole property</option>
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className={styles.field}>
                <label htmlFor="r-amount">Amount ($)</label>
                <input
                  id="r-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={rAmount}
                  onChange={(e) => setRAmount(e.target.value)}
                />
              </div>
              <div className={`${styles.field} ${styles.wide}`}>
                <label htmlFor="r-detail">Description (optional)</label>
                <input
                  id="r-detail"
                  type="text"
                  placeholder="e.g. State Farm landlord policy"
                  value={rDetail}
                  onChange={(e) => setRDetail(e.target.value)}
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="r-frequency">Frequency</label>
                <select
                  id="r-frequency"
                  value={rFrequency}
                  onChange={(e) => setRFrequency(e.target.value as "monthly" | "yearly")}
                >
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
              {rFrequency === "yearly" && (
                <div className={styles.field}>
                  <label htmlFor="r-month">Month</label>
                  <select id="r-month" value={rMonth} onChange={(e) => setRMonth(e.target.value)}>
                    {MONTHS.map((m, i) => (
                      <option key={m} value={i + 1}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className={styles.field}>
                <label htmlFor="r-day">Day of month</label>
                <input
                  id="r-day"
                  type="number"
                  min="1"
                  max="31"
                  value={rDay}
                  onChange={(e) => setRDay(e.target.value)}
                />
              </div>
            </div>
            <div className={styles.formFoot}>
              <button type="submit" className={`${styles.btn} ${styles.primary}`}>
                Add recurring expense
              </button>
              <button
                type="button"
                className={styles.btn}
                onClick={() => setAddingRecurring(false)}
                style={{ marginLeft: 8 }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div style={{ marginTop: 14 }}>
            <button
              type="button"
              className={`${styles.btn} ${styles.small}`}
              onClick={() => setAddingRecurring(true)}
            >
              + Add a recurring expense
            </button>
          </div>
        )}
      </section>
      <section className={styles.block}>
        <div className={styles.blockHead}>
          <h2>Recent activity</h2>
          <div className={styles.headTools}>
            <span className={styles.count}>
              {transactions.length
                ? `${transactions.length} ${transactions.length === 1 ? "entry" : "entries"} all time`
                : ""}
            </span>
            <button
              type="button"
              className={`${styles.btn} ${styles.small}`}
              onClick={() => openNewEntry({ type: "expense" })}
            >
              + Expense
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.small} ${styles.primary}`}
              onClick={() => openNewEntry()}
            >
              + Rent
            </button>
          </div>
        </div>
        {recentEntries.length === 0 ? (
          <div className={styles.ledgerWrap}>
            <div className={styles.emptyState}>
              Nothing recorded against this property yet — record the first payment and the
              numbers above start filling in.
            </div>
          </div>
        ) : (
          <div className={styles.ledgerWrap}>
            <table className={`${styles.ledger} ${styles.txnTable}`}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Applies to</th>
                  <th>Type</th>
                  <th>Details</th>
                  <th style={{ textAlign: "right" }}>Amount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {recentEntries.map((t) => (
                  <tr key={t.id}>
                    <td>{formatDay(t.date)}</td>
                    <td>{unitLabel(t.unitId)}</td>
                    <td>
                      <span className={`${styles.tag} ${t.type === "rent" ? styles.rent : styles.expense}`}>
                        {t.type === "rent" ? "Rent" : "Expense"}
                      </span>
                    </td>
                    <td>
                      {t.category && <div className={styles.categoryTag}>{t.category}</div>}
                      {t.detail}
                      {t.note && <div className={styles.note}>{t.note}</div>}
                      {/* Paperclip with the count; tap to show the thumbnails. */}
                      {t.attachments.length > 0 && (
                        <div>
                          <button
                            type="button"
                            className={proofStyles.clip}
                            aria-expanded={openClip === t.id}
                            aria-label={`${proofCountLabel(t.attachments.length)} attached — ${
                              openClip === t.id ? "hide" : "show"
                            }`}
                            data-proof-clip={t.id}
                            onClick={() => setOpenClip((c) => (c === t.id ? "" : t.id))}
                          >
                            <PaperclipIcon />
                            {t.attachments.length}
                          </button>
                          {openClip === t.id && (
                            <ProofStrip items={t.attachments} onRemove={removeProof} busyId={removingProof} />
                          )}
                        </div>
                      )}
                    </td>
                    <td className={`${styles.amt} num ${t.type === "rent" ? styles.pos : styles.neg}`}>
                      {t.type === "rent" ? "+" : "\u2212"}
                      {money(t.amount)}
                    </td>
                    <td>
                      <div className={styles.rowActions}>
                        {storageReady && t.attachments.length < MAX_PROOFS && (
                          <button
                            type="button"
                            className={`${styles.btn} ${styles.small} ${styles.quiet}`}
                            onClick={() => openAttach(t)}
                          >
                            + Attach proof
                          </button>
                        )}
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.small} ${styles.quiet}`}
                          onClick={() => openEntry(t)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.small} ${styles.quiet} ${styles.danger}`}
                          onClick={() => removeEntry(t)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {transactions.length > recentEntries.length && (
          <p className={styles.helpText}>
            Showing the {recentEntries.length} most recent. The full ledger, with filters, is on the
            dashboard.
          </p>
        )}
      </section>

      <Modal
        open={entryOpen}
        title={entry.id ? "Edit this entry" : "Record a payment"}
        subtitle={
          entry.id
            ? "Correct any of it. Proof already attached to this entry stays put."
            : `Goes straight onto ${property.name}. Rent or a repair — the toggle decides which.`
        }
        onClose={() => setEntryOpen(false)}
        initialFocus={!entry.id && entry.type === "rent" && entry.amount ? entryAmount : undefined}
      >
        <form onSubmit={saveEntry}>
          <div className={styles.typeToggle}>
            <button
              type="button"
              className={entry.type === "rent" ? `${styles.active} ${styles.rent}` : ""}
              onClick={() => setEntryType("rent")}
            >
              Rent payment
            </button>
            <button
              type="button"
              className={entry.type === "expense" ? `${styles.active} ${styles.expense}` : ""}
              onClick={() => setEntryType("expense")}
            >
              Repair / expense
            </button>
          </div>
          <div className={`${styles.fieldGrid} ${styles.modalGrid}`}>
            {units.length > 0 && (
              <div className={`${styles.field} ${styles.wide}`}>
                <label htmlFor="e-unit">Applies to</label>
                <select
                  id="e-unit"
                  value={entry.unitId}
                  onChange={(e) => setEntryUnit(e.target.value)}
                >
                  <option value="">Whole property</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className={styles.field}>
              <label htmlFor="e-date">Date</label>
              <input
                id="e-date"
                type="date"
                required
                value={entry.date}
                onChange={(e) => setEntry((f) => ({ ...f, date: e.target.value }))}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="e-amount">Amount ($)</label>
              <input
                id="e-amount"
                ref={entryAmount}
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                required
                value={entry.amount}
                onChange={(e) => setEntry((f) => ({ ...f, amount: e.target.value }))}
              />
            </div>
            {entry.type === "expense" && (
              <div className={`${styles.field} ${styles.wide}`}>
                <label htmlFor="e-category">Category</label>
                <select
                  id="e-category"
                  required
                  value={entry.category}
                  onChange={(e) => setEntry((f) => ({ ...f, category: e.target.value }))}
                >
                  <option value="">Choose one</option>
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="e-detail">
                {entry.type === "rent" ? "Paid by (tenant)" : "Description"}
              </label>
              <input
                id="e-detail"
                type="text"
                value={entry.detail}
                onChange={(e) => setEntry((f) => ({ ...f, detail: e.target.value }))}
              />
            </div>
            <div className={`${styles.field} ${styles.span4}`}>
              <label htmlFor="e-note">Note</label>
              <input
                id="e-note"
                type="text"
                value={entry.note}
                onChange={(e) => setEntry((f) => ({ ...f, note: e.target.value }))}
              />
            </div>
            {/* Late fee waivers (a21) */}
            {entry.type === "rent" && (
              <WaiveLateFeeField
                className={styles.span4}
                propertyId={property.id}
                unitId={entry.unitId || null}
                date={entry.date}
                value={waiveLateFee}
                onChange={setWaiveLateFee}
              />
            )}
          </div>
          {/* Attach proof: queued here, uploaded once the entry is saved. */}
          <div className={styles.field} style={{ marginTop: 14 }}>
            {storageReady ? (
              <>
                {entry.id && (
                  <ProofStrip
                    heading="Already attached"
                    items={transactions.find((t) => t.id === entry.id)?.attachments ?? []}
                    onRemove={removeProof}
                    busyId={removingProof}
                  />
                )}
                <ProofPicker
                  value={pendingProof}
                  onChange={setPendingProof}
                  existing={entry.id ? (transactions.find((t) => t.id === entry.id)?.attachments.length ?? 0) : 0}
                  disabled={entrySaving}
                  label={entry.type === "rent" ? "Attach proof of payment (optional)" : "Attach receipt or photo (optional)"}
                  scanTitle={proofScanTitle(entry.type, formatDay(entry.date || todayKey))}
                />
              </>
            ) : (
              <span className={styles.proofWarn}>
                File storage isn&apos;t set up yet, so proof can&apos;t be attached.
              </span>
            )}
            {proofError && <div className={styles.errorBar}>{proofError}</div>}
          </div>
          {error && <div className={styles.errorBar}>{error}</div>}
          <div className={`${styles.formFoot} ${styles.stickyFoot}`}>
            <button type="button" className={styles.btn} onClick={() => setEntryOpen(false)}>
              Cancel
            </button>
            <button type="submit" className={`${styles.btn} ${styles.accent}`} disabled={entrySaving}>
              {entrySaving
                ? proofUploading
                  ? "Uploading proof\u2026"
                  : "Saving\u2026"
                : entry.id
                  ? "Save changes"
                  : entry.type === "rent"
                    ? "Record payment"
                    : "Record expense"}
            </button>
          </div>
        </form>
      </Modal>

      {/* "+ Attach proof" on a saved entry. */}
      {(() => {
        const t = transactions.find((x) => x.id === attachFor);
        return (
          <Modal
            open={Boolean(t)}
            title="Attach proof"
            subtitle={
              t
                ? `${t.type === "rent" ? "Rent" : "Expense"} of ${money(t.amount)} on ${formatDay(t.date)}${
                    t.detail ? ` — ${t.detail}` : ""
                  }`
                : ""
            }
            onClose={closeAttach}
          >
            {t && (
              <form onSubmit={sendAttach}>
                <ProofStrip heading="Already attached" items={t.attachments} onRemove={removeProof} busyId={removingProof} />
                <div style={{ marginTop: t.attachments.length ? 14 : 0 }}>
                  <ProofPicker
                    value={attachPending}
                    onChange={setAttachPending}
                    existing={t.attachments.length}
                    disabled={proofUploading}
                    scanTitle={proofScanTitle(t.type, formatDay(t.date))}
                  />
                </div>
                {proofError && <div className={styles.errorBar}>{proofError}</div>}
                <div className={styles.formFoot}>
                  <button type="button" className={styles.btn} onClick={closeAttach}>
                    {attachPending.length ? "Cancel" : "Close"}
                  </button>
                  <button
                    type="submit"
                    className={`${styles.btn} ${styles.accent}`}
                    disabled={proofUploading || attachPending.length === 0}
                  >
                    {proofUploading
                      ? "Uploading…"
                      : attachPending.length
                        ? `Attach ${proofCountLabel(attachPending.length)}`
                        : "Attach"}
                  </button>
                </div>
              </form>
            )}
          </Modal>
        );
      })()}

      <Modal
        open={tenantOpen}
        title={tenantForm.id ? "Edit tenant" : "Add a tenant"}
        subtitle="Contact details and lease terms. Everything except the name is optional."
        onClose={() => setTenantOpen(false)}
      >
        <form onSubmit={saveTenant}>
          <div className={`${styles.fieldGrid} ${styles.modalGrid}`}>
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="t-name">Name</label>
              <input
                id="t-name"
                type="text"
                required
                placeholder="e.g. J. Alvarez"
                value={tenantForm.name}
                onChange={(e) => setTenantForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            {units.length > 0 && (
              <div className={`${styles.field} ${styles.wide}`}>
                <label htmlFor="t-unit">Unit</label>
                <select
                  id="t-unit"
                  value={tenantForm.unitId}
                  onChange={(e) => setTenantForm((f) => ({ ...f, unitId: e.target.value }))}
                >
                  <option value="">Whole property</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className={styles.field}>
              <label htmlFor="t-phone">Phone</label>
              <input
                id="t-phone"
                type="tel"
                inputMode="tel"
                placeholder="(555) 010-4477"
                value={tenantForm.phone}
                onChange={(e) => setTenantForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="t-email">Email</label>
              <input
                id="t-email"
                type="email"
                placeholder="name@example.com"
                value={tenantForm.email}
                onChange={(e) => setTenantForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <label className={`${styles.checkboxField} ${styles.wide}`}>
              <input
                type="checkbox"
                checked={tenantForm.emailReminders}
                onChange={(e) => setTenantForm((f) => ({ ...f, emailReminders: e.target.checked }))}
              />
              Email them automatic reminders (rent due, lease ending) — set up under Reminders
            </label>
            <div className={styles.field}>
              <label htmlFor="t-start">Lease starts</label>
              <input
                id="t-start"
                type="date"
                value={tenantForm.leaseStart}
                onChange={(e) => setTenantForm((f) => ({ ...f, leaseStart: e.target.value }))}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="t-end">Lease ends</label>
              <input
                id="t-end"
                type="date"
                value={tenantForm.leaseEnd}
                onChange={(e) => setTenantForm((f) => ({ ...f, leaseEnd: e.target.value }))}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="t-deposit">Security deposit ($)</label>
              <input
                id="t-deposit"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={tenantForm.deposit}
                onChange={(e) => setTenantForm((f) => ({ ...f, deposit: e.target.value }))}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="t-due">Rent due on day</label>
              <input
                id="t-due"
                type="number"
                min="1"
                max="31"
                value={tenantForm.dueDay}
                onChange={(e) => setTenantForm((f) => ({ ...f, dueDay: e.target.value }))}
              />
            </div>
            <div className={`${styles.field} ${styles.span4}`}>
              <label htmlFor="t-note">Note (optional)</label>
              <input
                id="t-note"
                type="text"
                placeholder="e.g. Pays by Zelle, has a dog"
                value={tenantForm.note}
                onChange={(e) => setTenantForm((f) => ({ ...f, note: e.target.value }))}
              />
            </div>
          </div>
          {error && <div className={styles.errorBar}>{error}</div>}
          <div className={styles.formFoot}>
            <button type="button" className={styles.btn} onClick={() => setTenantOpen(false)}>
              Cancel
            </button>
            <button type="submit" className={`${styles.btn} ${styles.accent}`} disabled={tenantSaving}>
              {tenantSaving ? "Saving\u2026" : tenantForm.id ? "Save tenant" : "Add tenant"}
            </button>
          </div>
        </form>
      </Modal>

      <RenewDialog
        tenant={renewing}
        currentRent={renewing ? currentRentAt(renewing.unitId) : 0}
        place={renewing ? (renewing.unitId ? `${property.name} — ${unitLabel(renewing.unitId)}` : property.name) : ""}
        today={todayKey}
        onClose={() => setRenewing(null)}
        onDone={(r) => {
          const t = renewing;
          setRenewing(null);
          if (!t) return;
          setRenewals((prev) => ({ ...prev, [t.id]: r.renewal }));
          setTenants((prev) => prev.map((x) => (x.id === t.id ? { ...x, leaseEnd: r.renewal.newEnd } : x)));
          // The place's whole rent history comes back; swap it in.
          setRentChanges((prev) => [
            ...prev.filter((c) => !(c.propertyId === property.id && (c.unitId ?? null) === (t.unitId ?? null))),
            ...r.rentChanges,
          ]);
          if (t.unitId) setUnits((prev) => prev.map((u) => (u.id === t.unitId ? { ...u, monthlyRent: r.monthlyRent } : u)));
          else setProperty((prev) => ({ ...prev, monthlyRent: r.monthlyRent }));
          const { renewal } = r;
          push(
            renewal.newRent !== renewal.previousRent
              ? `${t.name}’s lease renewed to ${formatDay(renewal.newEnd)}. Rent goes to ${money(renewal.newRent)} from ${monthShort(renewal.rentFrom)}.`
              : `${t.name}’s lease renewed to ${formatDay(renewal.newEnd)}.`
          );
          router.refresh();
        }}
      />

      <MoveOutDialog
        tenant={movingOut}
        today={todayKey}
        onClose={() => setMovingOut(null)}
        onDone={async (r) => {
          setMovingOut(null);
          setTenants((prev) => prev.map((x) => (x.id === r.tenant.id ? r.tenant : x)));
          setMoveOuts((prev) => ({ ...prev, [r.tenant.id]: r.moveOut }));
          if (r.vacantSince) setVacancy(r.tenant.unitId ?? null, r.vacantSince);
          if (r.transactions.length) {
            setTransactions((prev) => [...r.transactions.map(withNoProof), ...prev].sort((a, b) => b.date.localeCompare(a.date)));
          }
          await refreshBalance(r.tenant.id);
          push(
            r.moveOut.deposit > 0
              ? `${r.tenant.name} moved out. ${money(r.moveOut.refund)} of the deposit to return.`
              : `${r.tenant.name} moved out.`
          );
          router.refresh();
        }}
      />

      <MarkReturnedDialog
        moveOut={returningFor ? (moveOuts[returningFor] ?? null) : null}
        tenantName={tenants.find((t) => t.id === returningFor)?.name ?? ""}
        today={todayKey}
        onClose={() => setReturningFor("")}
        onDone={(m) => {
          setMoveOuts((prev) => ({ ...prev, [m.tenantId]: m }));
          setReturningFor("");
          push(m.returnedOn ? "Deposit marked returned." : "Marked as not returned yet.");
        }}
      />

      <Modal
        open={Boolean(statementFor)}
        title={statementFor ? `${statementFor.name}\u2019s account` : "Account"}
        subtitle="Every month since the books start here: charged, paid, and what’s left."
        onClose={() => setStatementFor(null)}
      >
        {statementFor && (
          <StatementPanel
            tenantId={statementFor.id}
            tenantName={statementFor.name}
            currentMonth={todayKey.slice(0, 7)}
            onBalance={(balance, behindSince) =>
              setBalances((prev) => ({
                ...prev,
                [statementFor.id]: {
                  balance,
                  behindSince,
                  problem: prev[statementFor.id]?.problem ?? "",
                },
              }))
            }
          />
        )}
      </Modal>

      <Modal
        open={propertyOpen}
        title="Edit property"
        subtitle="The name and address show on this page, the overview, and to tenants in the portal."
        onClose={() => setPropertyOpen(false)}
      >
        <form onSubmit={saveProperty}>
          <div className={`${styles.fieldGrid} ${styles.modalGrid}`}>
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="p-name">Property name</label>
              <input
                id="p-name"
                type="text"
                required
                maxLength={120}
                value={propertyForm.name}
                onChange={(e) => setPropertyForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="p-address">Address</label>
              <input
                id="p-address"
                type="text"
                maxLength={200}
                placeholder="Street, city"
                value={propertyForm.address}
                onChange={(e) => setPropertyForm((f) => ({ ...f, address: e.target.value }))}
              />
            </div>
            {units.length === 0 && (
              <div className={`${styles.field} ${styles.wide}`}>
                <label htmlFor="p-rent">Monthly rent ($)</label>
                <input
                  id="p-rent"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={propertyForm.monthlyRent}
                  onChange={(e) => setPropertyForm((f) => ({ ...f, monthlyRent: e.target.value }))}
                />
                <span className={styles.helpText}>
                  A new amount applies from this month on; past months keep what they were.
                </span>
              </div>
            )}
            {units.length === 0 && (
              <label className={styles.checkboxField} style={{ gridColumn: "1 / -1" }}>
                <input
                  type="checkbox"
                  checked={propertyForm.vacant}
                  onChange={(e) => setPropertyForm((f) => ({ ...f, vacant: e.target.checked }))}
                />
                Vacant — no rent expected until it&apos;s let again
              </label>
            )}
            {units.length === 0 && propertyForm.vacant && (
              <div className={`${styles.field} ${styles.wide}`}>
                <label htmlFor="p-vacant-since">Empty since</label>
                <input
                  id="p-vacant-since"
                  type="date"
                  max={todayKey}
                  value={propertyForm.vacantSince || todayKey}
                  onChange={(e) => setPropertyForm((f) => ({ ...f, vacantSince: e.target.value }))}
                />
              </div>
            )}
          </div>
          {error && <div className={styles.errorBar}>{error}</div>}
          <div className={styles.formFoot}>
            <button type="button" className={styles.btn} onClick={() => setPropertyOpen(false)}>
              Cancel
            </button>
            <button type="submit" className={`${styles.btn} ${styles.accent}`} disabled={propertySaving}>
              {propertySaving ? "Saving\u2026" : "Save changes"}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog request={confirming} onCancel={() => setConfirming(null)} />
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </AppShell>
  );
}
