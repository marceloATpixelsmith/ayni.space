import type { App } from "@workspace/db";

export type NormalizedAccessProfile = "superadmin" | "solo_no_onboarding" | "solo_with_onboarding" | "organization";

function asBooleanish(value: unknown): boolean | null {
  if (value === "required" || value === "light") return true;
  if (value === "disabled") return false;
  return null;
}

export function resolveNormalizedAccessProfile(app: Pick<App, "slug" | "accessMode" | "onboardingMode">): NormalizedAccessProfile | null {
  const accessMode = String(app.accessMode);

  if (accessMode === "superadmin") {
    return "superadmin";
  }

  if (accessMode === "organization") {
    return "organization";
  }

  if (accessMode === "solo") {
    const onboardingEnabled = asBooleanish(app.onboardingMode);
    if (onboardingEnabled === null) return null;
    return onboardingEnabled ? "solo_with_onboarding" : "solo_no_onboarding";
  }

  return null;
}

export function getAuthRoutePolicyForProfile(profile: NormalizedAccessProfile): { allowOnboarding: boolean; allowInvitations: boolean } {
  if (profile === "organization") return { allowOnboarding: true, allowInvitations: true };
  if (profile === "solo_with_onboarding") return { allowOnboarding: true, allowInvitations: false };
  return { allowOnboarding: false, allowInvitations: false };
}
