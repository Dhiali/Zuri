type PasswordSetupUser = {
  app_metadata: { providers?: unknown; provider?: unknown };
  user_metadata: { password_created?: unknown };
};

export function needsPasswordSetup(user: PasswordSetupUser): boolean {
  const { providers, provider } = user.app_metadata;
  const linkedProviders = Array.isArray(providers) && providers.length > 0
    ? providers
    : [provider];
  return linkedProviders.includes("google")
    && !linkedProviders.includes("email")
    && user.user_metadata.password_created !== true;
}
