"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { downloadHref, isPlainClick, pdfPageScale, viewKindFromContentType, viewKindOf, type ViewKind } from "@/lib/file-view";
import styles from "./file-viewer.module.css";

/**
 * Every receipt, repair photo, lease and message attachment opens here, on
 * top of the page, instead of in a new tab.
 *
 * Why: installed to a phone's home screen, the app runs with no browser
 * chrome — no tabs, no back button, no address bar. A file link that opened
 * a new tab left people looking at a PDF with no way back to the app short
 * of killing it. This viewer always has a close button, closes on Escape and
 * on the phone's own Back (it adds a history entry while open), and keeps
 * Download and "Open in new tab" one tap away.
 *
 * PDFs are drawn with pdf.js onto canvases rather than framed: Android
 * Chrome has no built-in PDF viewer to frame, and this site refuses all
 * framing anyway (frame-src 'none', X-Frame-Options: DENY). pdf.js is loaded
 * only when a PDF is opened; its worker comes from /pdfjs on this site
 * (copied there by scripts/copy-pdfjs.js).
 */

export type OpenFileRequest = {
  /** An /api/files link (or any same-origin file URL). */
  url: string;
  /** Shown in the header; also used to tell the type when `mime` isn't known. */
  name?: string;
  mime?: string | null;
};

const OpenFileContext = createContext<((file: OpenFileRequest) => void) | null>(null);

/** Opens a file in the viewer. Null outside a FileViewerProvider. */
export function useOpenFile() {
  return useContext(OpenFileContext);
}

export function FileViewerProvider({ children }: { children: ReactNode }) {
  const [file, setFile] = useState<OpenFileRequest | null>(null);
  // Whether the history entry added on open is still there to go back over.
  const pushed = useRef(false);

  const open = useCallback((next: OpenFileRequest) => {
    setFile(next);
    try {
      // No URL: the page underneath stays where it is. Next's router copies
      // its own state into this entry, so going back to the page is a no-op
      // navigation to the same place.
      window.history.pushState({ ...(window.history.state ?? {}), fileViewer: true }, "");
      pushed.current = true;
    } catch {
      pushed.current = false;
    }
  }, []);

  const close = useCallback(() => {
    setFile(null);
    if (pushed.current) {
      // Take our entry back off, so a later Back leaves the page as usual
      // instead of first "closing" a viewer that isn't there.
      pushed.current = false;
      window.history.back();
    }
  }, []);

  useEffect(() => {
    if (!file) return;
    // The phone's Back button (or the browser's) closes the viewer.
    function onPop() {
      if (!pushed.current) return;
      pushed.current = false;
      setFile(null);
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [file]);

  return (
    <OpenFileContext.Provider value={open}>
      {children}
      {file && <FileViewer file={file} onClose={close} />}
    </OpenFileContext.Provider>
  );
}

/**
 * A link to a stored file. A plain click or tap opens it in the viewer; the
 * href is real, so long-press, middle-click and ⌘/Ctrl-click still offer a
 * new tab, and it works as an ordinary link before the page's script loads.
 */
export function FileLink({
  url,
  name,
  mime,
  className,
  title,
  children,
  "aria-label": ariaLabel,
}: OpenFileRequest & {
  className?: string;
  title?: string;
  children: ReactNode;
  "aria-label"?: string;
}) {
  const open = useOpenFile();
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      title={title}
      aria-label={ariaLabel}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        if (!open || !isPlainClick(e)) return;
        e.preventDefault();
        open({ url, name, mime });
      }}
    >
      {children}
    </a>
  );
}

/**
 * View and Download, side by side, for a file row or a thumbnail. View opens
 * the in-app viewer (a real link underneath, like FileLink); Download fetches
 * the same file with ?download=1, so it is saved rather than shown. Both are
 * at least 44px tall so they can be hit with a thumb.
 */
export function FileActions({ url, name, mime, className }: OpenFileRequest & { className?: string }) {
  const label = name || "file";
  return (
    <span className={`${styles.fileActions}${className ? ` ${className}` : ""}`}>
      <FileLink url={url} name={name} mime={mime} className={styles.fileBtn} aria-label={`View ${label}`}>
        View
      </FileLink>
      <a className={styles.fileBtn} href={downloadHref(url)} download={name || true} aria-label={`Download ${label}`}>
        Download
      </a>
    </span>
  );
}

/** A thumbnail (or any preview) with View / Download underneath it. */
export function ThumbWithActions({ url, name, mime, children }: OpenFileRequest & { children: ReactNode }) {
  return (
    <span className={styles.thumbWithActions}>
      {children}
      <FileActions url={url} name={name} mime={mime} />
    </span>
  );
}

/* ------------------------------------------------------------------ */

type Loaded =
  | { state: "loading" }
  | { state: "ready"; kind: ViewKind; bytes?: Uint8Array }
  | { state: "error"; message: string };

function FileViewer({ file, onClose }: { file: OpenFileRequest; onClose: () => void }) {
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const known = useMemo(() => viewKindOf(file), [file]);
  const [loaded, setLoaded] = useState<Loaded>(
    known === "image" || known === "other" ? { state: "ready", kind: known } : { state: "loading" }
  );
  const name = file.name || "File";

  // A PDF, or a file nothing gave the type of: fetch it (with this site's
  // cookies — /api/files checks the session) and let the bytes decide.
  useEffect(() => {
    if (known === "image" || known === "other") return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(file.url, { credentials: "same-origin", signal: ctrl.signal });
        if (!res.ok) {
          const message =
            res.status === 404
              ? "This file couldn't be found. It may have been removed."
              : res.status === 401 || res.status === 403
                ? "You need to be signed in to see this file."
                : "This file couldn't be loaded.";
          setLoaded({ state: "error", message });
          return;
        }
        // The server's word wins over the name: /api/files sends what the
        // bytes are, not what the upload claimed (and anything it can't
        // vouch for goes out as application/octet-stream — "other").
        const type = res.headers.get("content-type");
        const actual = type ? viewKindFromContentType(type) : (known ?? "other");
        if (actual === "pdf") {
          setLoaded({ state: "ready", kind: "pdf", bytes: new Uint8Array(await res.arrayBuffer()) });
        } else {
          ctrl.abort();
          setLoaded({ state: "ready", kind: actual });
        }
      } catch (err) {
        if (ctrl.signal.aborted) return;
        console.error(err);
        setLoaded({ state: "error", message: "This file couldn't be loaded. Check your connection and try again." });
      }
    })();
    return () => ctrl.abort();
  }, [file.url, known]);

  // Escape, focus, and the page behind holding still.
  useEffect(() => {
    const restoreTo = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus({ preventScroll: true });

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // Captured on window, ahead of any dialog underneath listening on
        // the document — Escape closes the file, not the form it was on.
        e.stopPropagation();
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !dialog.current) return;
      const focusable = Array.from(
        dialog.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const inside = dialog.current.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = previousOverflow;
      if (restoreTo && document.contains(restoreTo)) restoreTo.focus?.({ preventScroll: true });
    };
  }, []);

  const actions = (
    <>
      <a className={styles.action} href={downloadHref(file.url)} download={file.name || true}>
        <DownloadIcon />
        <span>Download</span>
      </a>
      <a className={styles.action} href={file.url} target="_blank" rel="noopener noreferrer">
        <ExternalIcon />
        <span>Open in new tab</span>
      </a>
    </>
  );

  const fallback = (title: string, detail?: string) => (
    <div className={styles.center}>
      <div className={styles.card}>
        <FileIcon />
        <p className={styles.cardTitle}>{title}</p>
        {detail && <p className={styles.cardDetail}>{detail}</p>}
        <div className={styles.cardActions}>{actions}</div>
      </div>
    </div>
  );

  let body: ReactNode;
  if (loaded.state === "loading") {
    body = (
      <div className={styles.center} role="status">
        <span className={styles.spinner} aria-hidden="true" />
        <span className={styles.loadingText}>Opening {name}…</span>
      </div>
    );
  } else if (loaded.state === "error") {
    body = fallback(name, loaded.message);
  } else if (loaded.kind === "image") {
    body = <ImageView url={file.url} name={name} fallback={fallback} />;
  } else if (loaded.kind === "pdf" && loaded.bytes) {
    body = <PdfView bytes={loaded.bytes} name={name} fallback={fallback} />;
  } else {
    body = fallback(name, "This kind of file can't be shown here.");
  }

  return createPortal(
    <div ref={dialog} className={styles.viewer} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className={styles.bar}>
        <h2 id={titleId} className={styles.name} title={name}>
          {name}
        </h2>
        <div className={styles.barActions}>{actions}</div>
        <button ref={closeButton} type="button" className={styles.close} onClick={onClose} aria-label="Close">
          <CloseIcon />
        </button>
      </header>
      <div className={styles.body}>{body}</div>
    </div>,
    document.body
  );
}

/* ------------------------------------------------------------------ */

function ImageView({
  url,
  name,
  fallback,
}: {
  url: string;
  name: string;
  fallback: (title: string, detail?: string) => ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  if (failed) {
    return fallback(name, "This picture can't be shown in this browser. Download it to open it in another app.");
  }
  return (
    <div className={styles.zoom} data-testid="file-viewer-image">
      {!ready && <span className={`${styles.spinner} ${styles.floating}`} aria-hidden="true" />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={name}
        className={styles.image}
        onLoad={() => setReady(true)}
        onError={() => setFailed(true)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

type PdfDoc = import("pdfjs-dist/legacy/build/pdf.mjs").PDFDocumentProxy;

let pdfjsPromise: Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> | null = null;

/** pdf.js, fetched the first time a PDF is opened and not before. */
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
      return pdfjs;
    });
    pdfjsPromise.catch(() => {
      pdfjsPromise = null;
    });
  }
  return pdfjsPromise;
}

function PdfView({
  bytes,
  name,
  fallback,
}: {
  bytes: Uint8Array;
  name: string;
  fallback: (title: string, detail?: string) => ReactNode;
}) {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [failed, setFailed] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // Destroying the loading task also destroys the document and its worker.
    let task: { destroy: () => Promise<void> } | null = null;
    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        if (cancelled) return;
        const params = {
          // pdf.js takes the buffer over; hand it a copy so a re-render
          // with the same bytes still has them.
          data: bytes.slice(),
          // Never compile code out of a PDF's fonts. pdf.js 6 dropped that
          // path entirely (and the option with it); it's kept here so the
          // intent survives a downgrade.
          isEvalSupported: false,
          standardFontDataUrl: "/pdfjs/standard_fonts/",
          wasmUrl: "/pdfjs/wasm/",
        };
        const loading = pdfjs.getDocument(params);
        task = loading;
        const opened = await loading.promise;
        if (!cancelled) setDoc(opened);
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (task) void task.destroy();
    };
  }, [bytes]);

  // Pages are drawn to the width available, and again if that changes
  // (a phone turned sideways).
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setWidth(Math.floor(el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc]);

  if (failed) return fallback(name, "This PDF couldn't be shown here. Download it or open it in a new tab.");
  if (!doc) {
    return (
      <div className={styles.center} role="status">
        <span className={styles.spinner} aria-hidden="true" />
        <span className={styles.loadingText}>Opening {name}…</span>
      </div>
    );
  }

  const pageWidth = Math.max(0, Math.min(width - 24, 1000));
  return (
    <div ref={scroller} className={`${styles.zoom} ${styles.pages}`} data-testid="file-viewer-pdf" data-pages={doc.numPages}>
      {pageWidth > 0 &&
        Array.from({ length: doc.numPages }, (_, i) => (
          <PdfPage key={i} doc={doc} number={i + 1} width={pageWidth} root={scroller} />
        ))}
    </div>
  );
}

function PdfPage({
  doc,
  number,
  width,
  root,
}: {
  doc: PdfDoc;
  number: number;
  width: number;
  root: React.RefObject<HTMLDivElement | null>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [near, setNear] = useState(number <= 2);

  // The page's shape, so the space it takes is right before it's drawn.
  useEffect(() => {
    let cancelled = false;
    doc.getPage(number).then(
      (page) => {
        if (cancelled) return;
        const vp = page.getViewport({ scale: 1 });
        setSize({ width: vp.width, height: vp.height });
      },
      (err) => console.error(err)
    );
    return () => {
      cancelled = true;
    };
  }, [doc, number]);

  // Drawn when within a couple of screens of view; let go when far away,
  // so a long PDF doesn't hold every page's pixels at once on a phone.
  useEffect(() => {
    const el = canvas.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), {
      root: root.current,
      rootMargin: "150% 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  const shown = size ? pdfPageScale(size, width, typeof window === "undefined" ? 1 : window.devicePixelRatio) : null;

  useEffect(() => {
    const el = canvas.current;
    if (!el || !shown) return;
    if (!near) {
      // Release the pixels; the element keeps its size on screen.
      el.width = 0;
      el.height = 0;
      delete el.dataset.rendered;
      return;
    }
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    doc.getPage(number).then(async (page) => {
      if (cancelled) return;
      const viewport = page.getViewport({ scale: shown.scale });
      el.width = Math.floor(viewport.width);
      el.height = Math.floor(viewport.height);
      task = page.render({ canvas: el, viewport });
      try {
        await task.promise;
        if (!cancelled) el.dataset.rendered = "1";
      } catch (err) {
        if ((err as { name?: string })?.name !== "RenderingCancelledException") console.error(err);
      }
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
    // shown is derived from size and width.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, number, near, size, width]);

  return (
    <canvas
      ref={canvas}
      className={styles.page}
      aria-label={`Page ${number} of ${doc.numPages}`}
      role="img"
      style={{
        width: shown ? `${shown.cssWidth}px` : `${width}px`,
        height: shown ? `${shown.cssHeight}px` : `${Math.round(width * 1.294)}px`,
      }}
    />
  );
}

/* ------------------------------------------------------------------ */

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}
