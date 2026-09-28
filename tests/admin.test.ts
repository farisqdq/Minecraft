import { test } from "node:test";
import assert from "node:assert/strict";
import { adminEmails, describeAction, isAdminAccount, planAccountDeletion } from "../lib/admin.ts";

test("the site owner is an admin with nothing configured", () => {
  assert.deepEqual([...adminEmails({})], ["fariseqal3@gmail.com"]);
  assert.equal(isAdminAccount({ email: "FarisEqal3@gmail.com ", isAdmin: false }, {}), true);
  assert.equal(isAdminAccount({ email: "someone@example.com", isAdmin: false }, {}), false);
  assert.equal(isAdminAccount({ email: "someone@example.com", isAdmin: true }, {}), true, "the flag counts too");
});

test("ADMIN_EMAILS replaces the built-in list", () => {
  const env = { ADMIN_EMAILS: " A@x.com, b@y.com ,, " };
  assert.deepEqual([...adminEmails(env)], ["a@x.com", "b@y.com"]);
  assert.equal(isAdminAccount({ email: "fariseqal3@gmail.com", isAdmin: false }, env), false);
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
