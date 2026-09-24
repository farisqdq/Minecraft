import { test } from "node:test";
import assert from "node:assert/strict";
import { acceptBackupFile, backupFileKey } from "../lib/backup-files.ts";
import { fileLink, storageAccessOf } from "../lib/file-links.ts";

const secret = "x".repeat(40);
const priv = "https://abc123.private.blob.vercel-storage.com/documents/c1/lease-Xy7.pdf";
const pub = "https://abc123.public.blob.vercel-storage.com/transactions/t1/receipt.jpg";

test("a private link comes back only for the account that exported it", () => {
  const key = backupFileKey(secret, "owner@example.com", priv);
  assert.equal(acceptBackupFile({ secret, email: "owner@example.com", url: priv, key }), true);
  // Email case and spacing don't matter; the account does.
  assert.equal(acceptBackupFile({ secret, email: " Owner@Example.com ", url: priv, key }), true);
  assert.equal(acceptBackupFile({ secret, email: "someone@else.com", url: priv, key }), false);
});

test("a private link with no key, a wrong key, or another file's key is dropped", () => {
  const key = backupFileKey(secret, "owner@example.com", priv);
  const other = priv.replace("lease", "id-scan");
  assert.equal(acceptBackupFile({ secret, email: "owner@example.com", url: priv, key: "" }), false);
  assert.equal(acceptBackupFile({ secret, email: "owner@example.com", url: priv, key: key.slice(0, -1) + "A" }), false);
  assert.equal(acceptBackupFile({ secret, email: "owner@example.com", url: other, key }), false);
  // Signed on another deployment.
  assert.equal(acceptBackupFile({ secret: "y".repeat(40), email: "owner@example.com", url: priv, key }), false);
});

test("public links need no key; anything outside Blob storage never comes back", () => {
  assert.equal(acceptBackupFile({ secret, email: "a@b.c", url: pub, key: "" }), true);
  for (const url of [
    "https://evil.example.com/x.jpg",
    "http://abc123.public.blob.vercel-storage.com/x.jpg",
    "https://abc123.public.blob.vercel-storage.com.evil.com/x.jpg",
    "javascript:alert(1)",
    "not a url",
  ]) {
    assert.equal(acceptBackupFile({ secret, email: "a@b.c", url, key: "k" }), false, url);
  }
});

test("storage links are told apart by host, and file links stay on this site", () => {
  assert.equal(storageAccessOf(priv), "private");
  assert.equal(storageAccessOf(pub), "public");
  assert.equal(storageAccessOf("https://blob.vercel-storage.com.evil.com/x"), null);
  assert.equal(fileLink("document", "abc"), "/api/files/document/abc");
  assert.equal(fileLink("photo", "../../x"), "/api/files/photo/..%2F..%2Fx");
});
