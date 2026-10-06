"use client";

import DashboardClient from "@/app/dashboard/DashboardClient";
import { useAppearance } from "../appearance/AppearanceContext";
import type { DashboardProps } from "./dashboard-props";
import CommandDashboard from "./command/Dashboard";
import LedgerDashboard from "./ledger/Dashboard";
import BoardDashboard from "./board/Dashboard";

/** The Overview page in the person's chosen layout; Classic is the original. */
export default function DashboardSwitch(props: DashboardProps) {
  const { layout } = useAppearance().appearance;
  if (layout === "command") return <CommandDashboard {...props} />;
  if (layout === "ledger") return <LedgerDashboard {...props} />;
  if (layout === "board") return <BoardDashboard {...props} />;
  return <DashboardClient {...props} />;
}
