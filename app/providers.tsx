"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";
import { FileViewerProvider } from "./components/FileViewer";
import { ViewOnlyProvider } from "./components/ViewOnly";

export default function Providers({ children, viewOnly = false }: { children: ReactNode; viewOnly?: boolean }) {
  return (
    <SessionProvider>
      <ViewOnlyProvider value={viewOnly}>
        <FileViewerProvider>{children}</FileViewerProvider>
      </ViewOnlyProvider>
    </SessionProvider>
  );
}
