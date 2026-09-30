"use client";

import ClassicShell, { TitleEditButton, type ShellProps } from "./ClassicShell";
import { useAppearance } from "./appearance/AppearanceContext";
import CommandShell from "./layouts/command/Shell";
import LedgerShell from "./layouts/ledger/Shell";
import BoardShell from "./layouts/board/Shell";

export { TitleEditButton };
export type { ShellProps };

/**
 * The frame around every signed-in landlord page. Which frame depends on the
 * person's chosen layout (Settings > Appearance); Classic is the original
 * app, untouched. Every layout's shell takes the same props, so pages don't
 * know or care which one they're in.
 */
export default function AppShell(props: ShellProps) {
  const { layout } = useAppearance().appearance;
  if (layout === "command") return <CommandShell {...props} />;
  if (layout === "ledger") return <LedgerShell {...props} />;
  if (layout === "board") return <BoardShell {...props} />;
  return <ClassicShell {...props} />;
}
