import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { verifyPasswordRecoveryCode } from "../app/password-recovery.ts";

test("recovery verifies the entered code for the requested email", async () => {
  const session = { access_token: "test-session" };
  let request;
  const auth = { verifyOtp: async (params) => { request = params; return { data: { session }, error: null }; } };
  assert.equal(await verifyPasswordRecoveryCode(auth, " user@example.test ", " 123456 "), session);
  assert.deepEqual(request, { email: "user@example.test", token: "123456", type: "recovery" });
});

test("empty codes and failed verification do not create a recovery session", async () => {
  let called = false;
  const auth = { verifyOtp: async () => { called = true; return { data: { session: null }, error: new Error("Invalid code") }; } };
  await assert.rejects(verifyPasswordRecoveryCode(auth, "user@example.test", " "), /Enter the code/);
  assert.equal(called, false);
  await assert.rejects(verifyPasswordRecoveryCode(auth, "user@example.test", "bad"), /Invalid code/);
  assert.equal(called, true);
});

test("a successful response without a recovery session is an error", async () => {
  const auth = { verifyOtp: async () => ({ data: { session: null }, error: null }) };
  await assert.rejects(verifyPasswordRecoveryCode(auth, "user@example.test", "123456"), /recovery session was not created/);
});

test("Supabase client sends recovery verification and emits PASSWORD_RECOVERY", async () => {
  const requests = [];
  const auth = createClient("https://example.supabase.co", "test-public-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: "pkce" },
    global: {
      fetch: async (url, init) => {
        requests.push({ url: String(url), body: JSON.parse(init.body) });
        return new Response(JSON.stringify({
          access_token: "test-access-token",
          refresh_token: "test-refresh-token",
          token_type: "bearer",
          expires_in: 3600,
          user: { id: "test-user" },
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    },
  }).auth;
  const events = [];
  const { data: { subscription } } = auth.onAuthStateChange((event) => events.push(event));
  await auth.getSession();
  const session = await verifyPasswordRecoveryCode(auth, "user@example.test", "123456");
  assert.equal(session.user.id, "test-user");
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/auth\/v1\/verify/);
  assert.equal(requests[0].body.email, "user@example.test");
  assert.equal(requests[0].body.token, "123456");
  assert.equal(requests[0].body.type, "recovery");
  assert.ok(events.includes("PASSWORD_RECOVERY"));
  subscription.unsubscribe();
});
