/**
 * Appearance choices, per person (Settings > Appearance). Pure: shared by the
 * server (reading the account's saved choice), the API (checking what's
 * posted) and the client (applying it to <html> without a reload).
 *
 * The defaults are today's app exactly — Classic layout, following the
 * device's light/dark setting, with Classic's own green — so nobody's view
 * changes until they pick something.
 */

export const LAYOUTS = ["classic", "command", "ledger", "board"] as const;
export type UiLayout = (typeof LAYOUTS)[number];

export const THEMES = ["system", "light", "dark"] as const;
export type UiTheme = (typeof THEMES)[number];

/** Accent swatches. `null` (no choice) means the layout's own default accent. */
export const ACCENTS = ["indigo", "blue", "green", "violet", "orange", "rose"] as const;
export type UiAccent = (typeof ACCENTS)[number];

export type Appearance = { layout: UiLayout; theme: UiTheme; accent: UiAccent | null };

export const DEFAULT_APPEARANCE: Appearance = { layout: "classic", theme: "system", accent: null };

export const LAYOUT_LABELS: Record<UiLayout, { name: string; blurb: string }> = {
  classic: { name: "Classic", blurb: "The original Rent Roll." },
  command: { name: "Command Center", blurb: "Sidebar, KPI tiles, a dense properties table and a right rail." },
  ledger: { name: "Ledger", blurb: "Slim top bar, one big collected number, one grouped table." },
  board: { name: "Status Board", blurb: "Icon rail and a kanban of Late, Vacant, Lease ended and Paid." },
};

export const THEME_LABELS: Record<UiTheme, string> = {
  system: "Match my device",
  light: "Light",
  dark: "Dark",
};

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === "string" && (list as readonly string[]).includes(v);

export const isLayout = (v: unknown): v is UiLayout => isOneOf(LAYOUTS, v);
export const isTheme = (v: unknown): v is UiTheme => isOneOf(THEMES, v);
export const isAccent = (v: unknown): v is UiAccent => isOneOf(ACCENTS, v);

/** Whatever the database holds (old rows, typos) as a valid appearance. */
export function appearanceFrom(row: { uiLayout?: string | null; uiTheme?: string | null; uiAccent?: string | null } | null | undefined): Appearance {
  return {
    layout: isLayout(row?.uiLayout) ? row!.uiLayout : DEFAULT_APPEARANCE.layout,
    theme: isTheme(row?.uiTheme) ? row!.uiTheme : DEFAULT_APPEARANCE.theme,
    accent: isAccent(row?.uiAccent) ? row!.uiAccent : null,
  };
}

/**
 * A posted change: only the fields present, each checked. `accent: null`
 * resets to the layout's default. Returns null when anything is invalid.
 */
export function parseAppearancePatch(body: unknown): Partial<Appearance> | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const out: Partial<Appearance> = {};
  if ("layout" in b) {
    if (!isLayout(b.layout)) return null;
    out.layout = b.layout;
  }
  if ("theme" in b) {
    if (!isTheme(b.theme)) return null;
    out.theme = b.theme;
  }
  if ("accent" in b) {
    if (b.accent !== null && !isAccent(b.accent)) return null;
    out.accent = b.accent as UiAccent | null;
  }
  return Object.keys(out).length ? out : null;
}

/** The attributes set on <html>; CSS keys every layout, mode and accent off these. */
export function htmlAttributes(a: Appearance): Record<string, string> {
  return {
    "data-layout": a.layout,
    "data-theme": a.theme,
    ...(a.accent ? { "data-accent": a.accent } : {}),
  };
}

/** Each new layout's accent when the person hasn't picked one (Classic keeps its green). */
export const LAYOUT_DEFAULT_ACCENT: Record<Exclude<UiLayout, "classic">, UiAccent> = {
  command: "indigo",
  ledger: "blue",
  board: "violet",
};

/** Page backgrounds, for the browser/OS chrome (viewport theme-color). */
const PAGE_BG = {
  classic: { light: "#f4f1e9", dark: "#131109" },
  neutral: { light: "#f7f7f8", dark: "#0a0a0b" },
} as const;

/**
 * The viewport theme-color entries for a person's choice: the page's own
 * background, so the status bar blends in. "Match my device" gives one per
 * scheme (Classic's is exactly what the app always sent); a forced mode gives
 * that mode's colour whatever the device says.
 */
export function themeColors(a: Appearance): { media?: string; color: string }[] {
  const bg = a.layout === "classic" ? PAGE_BG.classic : PAGE_BG.neutral;
  if (a.theme === "light") return [{ color: bg.light }];
  if (a.theme === "dark") return [{ color: bg.dark }];
  return [
    { media: "(prefers-color-scheme: light)", color: bg.light },
    { media: "(prefers-color-scheme: dark)", color: bg.dark },
  ];
}

/** Tenants and owners choose only a mode; their portals always have the Classic look. */
export function portalAppearance(row: { uiTheme?: string | null } | null | undefined): Appearance {
  return { layout: "classic", theme: isTheme(row?.uiTheme) ? row!.uiTheme : "system", accent: null };
}

/** A posted portal change: just { theme }, checked. Null when invalid. */
export function parsePortalThemePatch(body: unknown): UiTheme | null {
  if (!body || typeof body !== "object") return null;
  const t = (body as Record<string, unknown>).theme;
  return isTheme(t) ? t : null;
}
