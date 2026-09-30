"use client";

import DashboardClient from "@/app/dashboard/DashboardClient";
import type { DashboardProps } from "../dashboard-props";

/** Placeholder until this layout's own dashboard is built: the Classic one. */
export default function BoardDashboard(props: DashboardProps) {
  return <DashboardClient {...props} />;
}
