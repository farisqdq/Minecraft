import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACCENTS,
  DEFAULT_APPEARANCE,
  LAYOUTS,
  LAYOUT_DEFAULT_ACCENT,
  appearanceFrom,
  htmlAttributes,
  parseAppearancePatch,
  parsePortalThemePatch,
  portalAppearance,
  themeColors,
} from "../lib/appearance.ts";

test("theme-color: Classic on its device setting sends exactly what the app always sent", () => {
  assert.deepEqual(themeColors(DEFAULT_APPEARANCE), [
    { media: "(prefers-color-scheme: light)", color: "#f4f1e9" },
    { media: "(prefers-color-scheme: dark)", color: "#131109" },
  ]);
});

test("theme-color: a forced mode gives one colour whatever the device says, per layout family", () => {
  assert.deepEqual(themeColors({ layout: "classic", theme: "dark", accent: null }), [{ color: "#131109" }]);
  assert.deepEqual(themeColors({ layout: "command", theme: "light", accent: "rose" }), [{ color: "#f7f7f8" }]);
  assert.deepEqual(themeColors({ layout: "board", theme: "dark", accent: null }), [{ color: "#0a0a0b" }]);
  assert.equal(themeColors({ layout: "ledger", theme: "system", accent: null }).length, 2);
});

test("portals: only the mode is theirs; the look is always Classic with its own green", () => {
  assert.deepEqual(portalAppearance(null), DEFAULT_APPEARANCE);
  assert.deepEqual(portalAppearance({ uiTheme: "dark" }), { layout: "classic", theme: "dark", accent: null });
  assert.deepEqual(portalAppearance({ uiTheme: "neon" }), DEFAULT_APPEARANCE);
});

test("portal change: just a valid theme", () => {
  assert.equal(parsePortalThemePatch({ theme: "light" }), "light");
  assert.equal(parsePortalThemePatch({ theme: "sepia" }), null);
  assert.equal(parsePortalThemePatch({ layout: "command" }), null);
  assert.equal(parsePortalThemePatch(null), null);
});

test("every new layout has a default accent that is one of the swatches", () => {
  for (const l of LAYOUTS) {
    if (l === "classic") continue;
    assert.ok(ACCENTS.includes(LAYOUT_DEFAULT_ACCENT[l]));
  }
});

test("nobody's view changes until they choose: the default is Classic, device mode, no accent", () => {
  assert.deepEqual(appearanceFrom(null), DEFAULT_APPEARANCE);
  assert.deepEqual(appearanceFrom({ uiLayout: "classic", uiTheme: "system", uiAccent: null }), {
    layout: "classic",
    theme: "system",
    accent: null,
  });
});

test("a stored value that isn't a known choice falls back to the default", () => {
  assert.deepEqual(appearanceFrom({ uiLayout: "fancy", uiTheme: "sepia", uiAccent: "gold" }), DEFAULT_APPEARANCE);
  assert.deepEqual(appearanceFrom({ uiLayout: "board", uiTheme: "dark", uiAccent: "rose" }), {
    layout: "board",
    theme: "dark",
    accent: "rose",
  });
});

test("a posted change carries only valid fields, and null resets the accent", () => {
  assert.deepEqual(parseAppearancePatch({ layout: "command" }), { layout: "command" });
  assert.deepEqual(parseAppearancePatch({ theme: "light", accent: null }), { theme: "light", accent: null });
  assert.equal(parseAppearancePatch({ layout: "nope" }), null);
  assert.equal(parseAppearancePatch({}), null);
  assert.equal(parseAppearancePatch("command"), null);
});

test("the html attributes name the layout and mode, and the accent only when chosen", () => {
  assert.deepEqual(htmlAttributes(DEFAULT_APPEARANCE), { "data-layout": "classic", "data-theme": "system" });
  assert.deepEqual(htmlAttributes({ layout: "ledger", theme: "dark", accent: "blue" }), {
    "data-layout": "ledger",
    "data-theme": "dark",
    "data-accent": "blue",
  });
});
