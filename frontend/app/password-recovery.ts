import type { SupabaseClient } from "@supabase/supabase-js";

export async function verifyPasswordRecoveryCode(
  auth: Pick<SupabaseClient["auth"], "verifyOtp">,
  email: string,
  code: string,
) {
  const token = code.trim();
  if (!email.trim() || !token) throw new Error("Enter the code from your password reset email.");
  const { data, error } = await auth.verifyOtp({ email: email.trim(), token, type: "recovery" });
  if (error) throw error;
  if (!data.session) throw new Error("The code was verified, but a recovery session was not created. Please request a new code.");
  return data.session;
}
