/**
 * The only link to a stored file the browser ever sees. It points at this
 * site, and /api/files checks the session before sending a byte — so a link
 * copied out of a page, a browser history or an email is useless to anyone
 * not signed in with access to that file.
 */
export type FileKind = "attachment" | "photo" | "document";

export const fileLink = (kind: FileKind, id: string) => `/api/files/${kind}/${encodeURIComponent(id)}`;

/** Where a raw storage URL lives: Vercel's private store, its public one, or neither. */
export function storageAccessOf(url: string): "private" | "public" | null {
  try {
    const host = new URL(url).hostname;
    if (/\.private\.blob\.vercel-storage\.com$/i.test(host)) return "private";
    if (/\.public\.blob\.vercel-storage\.com$/i.test(host)) return "public";
    return null;
  } catch {
    return null;
  }
}
