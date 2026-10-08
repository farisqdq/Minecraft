import { test } from "node:test";
import assert from "node:assert/strict";
import { shownOthersRole, shownOwnRole } from "../lib/roles.ts";

test("a viewer's own role is shown as member; owners and members as they are", () => {
  assert.equal(shownOwnRole("owner"), "owner");
  assert.equal(shownOwnRole("member"), "member");
  assert.equal(shownOwnRole("viewer"), "member");
  assert.equal(shownOwnRole(""), "member");
  assert.equal(shownOwnRole(null), "member");
});

test("other people's roles are hidden from a viewer and shown to everyone else", () => {
  for (const theirs of ["owner", "member", "viewer"]) {
    assert.equal(shownOthersRole(theirs, "owner"), theirs);
    assert.equal(shownOthersRole(theirs, "member"), theirs);
    assert.equal(shownOthersRole(theirs, "viewer"), "");
    assert.equal(shownOthersRole(theirs, undefined), "");
    assert.equal(shownOthersRole(theirs, "bogus"), "");
  }
});
