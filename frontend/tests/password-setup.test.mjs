import assert from "node:assert/strict";
import { test } from "node:test";
import { needsPasswordSetup } from "../app/password-setup.ts";

test("Google-only accounts without a password need setup", () => {
  assert.equal(needsPasswordSetup({ app_metadata: { providers: ["google"] }, user_metadata: {} }), true);
  assert.equal(needsPasswordSetup({ app_metadata: { provider: "google" }, user_metadata: {} }), true);
});

test("Google accounts linked to email do not need another password", () => {
  assert.equal(needsPasswordSetup({ app_metadata: { providers: ["google", "email"] }, user_metadata: {} }), false);
  assert.equal(needsPasswordSetup({ app_metadata: { providers: ["email", "google"] }, user_metadata: {} }), false);
});

test("existing password metadata and email-only accounts skip setup", () => {
  assert.equal(needsPasswordSetup({ app_metadata: { providers: ["google"] }, user_metadata: { password_created: true } }), false);
  assert.equal(needsPasswordSetup({ app_metadata: { providers: ["email"] }, user_metadata: {} }), false);
});
