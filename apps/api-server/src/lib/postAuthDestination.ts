import type { PostAuthFlowDecision } from "./postAuthFlow.js";
import {
  normalizeContinuationPath,
  type PostAuthContinuation,
} from "./postAuthContinuation.js";
import { DEFAULT_POST_AUTH_PATH as DEFAULT_POST_AUTH_PATH_COMPAT } from "./postAuthRedirect.js";

// Compatibility export consumed by auth routes/tests that import from this module.
export const DEFAULT_POST_AUTH_PATH = DEFAULT_POST_AUTH_PATH_COMPAT;

export type PostAuthResolutionStage = "post_auth" | "post_onboarding";

function isContinuationBypassAllowed(
  continuation: PostAuthContinuation | null | undefined,
): boolean {
  if (!continuation) return false;

  return (
    continuation.type === "event_registration" ||
    continuation.type === "client_registration" ||
    (continuation.type === "invitation_acceptance" &&
      typeof continuation.orgId === "string" &&
      continuation.orgId.trim().length > 0)
  );
}

export function resolveAuthenticatedPostAuthDestination(options: {
  continuation?: PostAuthContinuation | null;
  flowDecision: PostAuthFlowDecision | null;
  stage?: PostAuthResolutionStage;
  currentAppSlug?: string | null;
}): string | null {
  const stage = options.stage ?? "post_auth";
  const expectedAppSlug =
    (options.currentAppSlug ?? options.flowDecision?.appSlug ?? "")
      .trim()
      .toLowerCase() || null;
  const continuationAppSlug =
    options.continuation?.appSlug.trim().toLowerCase() ?? null;
  const continuationEligible =
    options.continuation != null &&
    continuationAppSlug != null &&
    expectedAppSlug != null &&
    continuationAppSlug === expectedAppSlug;
  const continuationPath = continuationEligible
    ? normalizeContinuationPath(options.continuation)
    : null;
  const flowDestination = options.flowDecision?.destination;
  const canAccess = options.flowDecision?.canAccess ?? false;
  const requiredOnboarding = options.flowDecision?.requiredOnboarding ?? "none";
  const requiresOnboarding = requiredOnboarding !== "none";
  const continuationCanBypassOnboarding =
    continuationEligible && isContinuationBypassAllowed(options.continuation);

  if (!canAccess) {
    return flowDestination ?? null;
  }

  if (
    stage === "post_auth" &&
    requiresOnboarding &&
    flowDestination &&
    !continuationCanBypassOnboarding
  ) {
    return flowDestination;
  }

  if (
    stage === "post_auth" &&
    requiredOnboarding === "user" &&
    flowDestination
  ) {
    return flowDestination;
  }

  if (continuationPath) {
    return continuationPath;
  }

  if (flowDestination) {
    return flowDestination;
  }

  return null;
}
