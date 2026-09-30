"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";
import { FileViewerProvider } from "./components/FileViewer";

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <FileViewerProvider>{children}</FileViewerProvider>
    </SessionProvider>
  );
}
