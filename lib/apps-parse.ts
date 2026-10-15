/** Pulls the installed-app rows out of the app-list HTML the phone backs up. */
export type AppRow = { label: string; pkg: string; version: string; source: string; installed: string };

function unescape(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

export function parseAppsHtml(html: string): AppRow[] {
  const rows: AppRow[] = [];
  const re = /<tr>\s*<td>\s*<a[^>]*id=([^"&]+)[^>]*>([\s\S]*?)<\/a>\s*<br>\s*<small>([\s\S]*?)<\/small>\s*<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    rows.push({
      pkg: unescape(m[1].trim()),
      label: unescape(m[2].trim()),
      version: unescape(m[4].trim()),
      source: unescape(m[5].trim()),
      installed: unescape(m[6].trim()),
    });
  }
  return rows;
}
