import type { ComponentProps } from "react";
import type DashboardClient from "@/app/dashboard/DashboardClient";

/** What every layout's dashboard is given: exactly what the Classic one gets. */
export type DashboardProps = ComponentProps<typeof DashboardClient>;
