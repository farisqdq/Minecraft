import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_APPEARANCE, appearanceFrom, htmlAttributes, parseAppearancePatch } from "../lib/appearance.ts";

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
