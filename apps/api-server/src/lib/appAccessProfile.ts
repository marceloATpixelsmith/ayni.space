import type { App } from "@workspace/db";

export type NormalizedAccessProfile = "superadmin" | "solo" | "organization";

function isOnboardingEnabled(mode: App["onboardingMode"]): boolean {
  return mode === "required" || mode === "light";
}

export function resolveNormalizedAccessProfile(app: Pick<App, "accessMode">): NormalizedAccessProfile | null {
  if (app.accessMode === "superadmin") return "superadmin";
  if (app.accessMode === "solo") return "solo";
  if (app.accessMode === "organization") return "organization";
  return null;
}

export function getAuthRoutePolicyForProfile(
  profile: NormalizedAccessProfile,
  onboardingMode: App["onboardingMode"],
): { allowOnboarding: boolean; allowInvitations: boolean } {
  if (profile === "organization") return { allowOnboarding: true, allowInvitations: true };
  if (profile === "solo") return { allowOnboarding: isOnboardingEnabled(onboardingMode), allowInvitations: false };
  return { allowOnboarding: false, allowInvitations: false };
}
