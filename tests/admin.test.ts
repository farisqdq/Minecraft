import { test } from "node:test";
import assert from "node:assert/strict";
import { adminEmails, bootstrapsAdmin, describeAction, isAdminAccount, planAccountDeletion } from "../lib/admin.ts";

test("the owner's address becomes the first admin of a fresh site, and only the first", () => {
  assert.deepEqual([...adminEmails({})], ["fariseqal3@gmail.com"]);
  assert.equal(bootstrapsAdmin("FarisEqal3@gmail.com ", 0, {}), true);
  // Signups are open and addresses aren't verified: once the site has an
  // admin, registering the owner's address must grant nothing.
  assert.equal(bootstrapsAdmin("fariseqal3@gmail.com", 1, {}), false);
  assert.equal(bootstrapsAdmin("someone@example.com", 0, {}), false);
});

test("only the flag makes an admin; the address list never does on its own", () => {
  assert.equal(isAdminAccount({ isAdmin: false }), false);
  assert.equal(isAdminAccount({ isAdmin: true }), true);
});

test("ADMIN_EMAILS replaces the built-in list for that first admin", () => {
  const env = { ADMIN_EMAILS: " A@x.com, b@y.com ,, " };
  assert.deepEqual([...adminEmails(env)], ["a@x.com", "b@y.com"]);
  assert.equal(bootstrapsAdmin("fariseqal3@gmail.com", 0, env), false);
  assert.equal(bootstrapsAdmin("b@y.com", 0, env), true);
  assert.deepEqual([...adminEmails({ ADMIN_EMAILS: "   " })], ["fariseqal3@gmail.com"], "blank means unset");
});

const member = (userId: string, role: string, createdAt: string) => ({ userId, role, createdAt });

test("deleting an account takes its one-person LLCs with it", () => {
  const plan = planAccountDeletion("u1", [
    { id: "c1", name: "Solo LLC", members: [member("u1", "owner", "2024-01-01")] },
  ]);
  assert.deepEqual(plan, { deleteCompanies: [{ id: "c1", name: "Solo LLC" }], leaveCompanies: [] });
});

test("an LLC with teammates keeps them, and never loses its last owner", () => {
  const plan = planAccountDeletion("u1", [
    {
      id: "c1",
      name: "Shared LLC",
      members: [member("u1", "owner", "2024-01-01"), member("u2", "owner", "2024-02-01")],
    },
    {
      id: "c2",
      name: "Managed LLC",
      members: [member("u1", "owner", "2024-01-01"), member("u3", "member", "2024-03-01"), member("u2", "member", "2024-02-01")],
    },
    { id: "c3", name: "Not mine", members: [member("u9", "owner", "2024-01-01")] },
  ]);
  assert.deepEqual(plan.deleteCompanies, []);
  assert.deepEqual(plan.leaveCompanies, [
    { id: "c1", name: "Shared LLC", promote: null },
    // The longest-standing member steps up when the only owner goes.
    { id: "c2", name: "Managed LLC", promote: "u2" },
  ]);
});

test("the audit log reads as sentences", () => {
  assert.equal(describeAction({ action: "account.delete", target: "a@b.com", detail: "and 1 LLC" }), "Deleted the account a@b.com — and 1 LLC");
  assert.equal(describeAction({ action: "company.member.add", target: "Oak LLC", detail: "jo@b.com as member" }), "Added jo@b.com as member to Oak LLC");
  assert.equal(describeAction({ action: "something.new", target: "x", detail: null }), "something.new x");
});
