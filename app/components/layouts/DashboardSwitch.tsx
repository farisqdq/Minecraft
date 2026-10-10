"use client";

import { useMemo } from "react";
import DashboardClient from "@/app/dashboard/DashboardClient";
import { fileLink } from "@/lib/file-links";
import { unpackLedger, type PackedLedger } from "@/lib/ledger-pack";
import { useAppearance } from "../appearance/AppearanceContext";
import type { DashboardProps } from "./dashboard-props";
import CommandDashboard from "./command/Dashboard";
import LedgerDashboard from "./ledger/Dashboard";
import BoardDashboard from "./board/Dashboard";

/**
 * The Overview page in the person's chosen layout; Classic is the original.
 *
 * The ledger arrives packed (lib/ledger-pack) and is unpacked here, once,
 * into exactly the entries every layout has always been given.
 */
export default function DashboardSwitch({
  packedTransactions,
  ...rest
}: Omit<DashboardProps, "initialTransactions"> & { packedTransactions: PackedLedger }) {
  const { layout } = useAppearance().appearance;
  const initialTransactions = useMemo(
    () => unpackLedger(packedTransactions, (id) => fileLink("attachment", id)),
    [packedTransactions]
  );
  const props: DashboardProps = { ...rest, initialTransactions };
  if (layout === "command") return <CommandDashboard {...props} />;
  if (layout === "ledger") return <LedgerDashboard {...props} />;
  if (layout === "board") return <BoardDashboard {...props} />;
  return <DashboardClient {...props} />;
}
