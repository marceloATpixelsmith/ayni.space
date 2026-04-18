import type { PostAuthFlowDecision } from "./postAuthFlow.js";
import {
  normalizeContinuationPath,
  type PostAuthContinuation,
} from "./postAuthContinuation.js";
import { DEFAULT_POST_AUTH_PATH as DEFAULT_POST_AUTH_PATH_COMPAT } from "./postAuthRedirect.js";

// Compatibility export consumed by auth routes/tests that import from this module.
export const DEFAULT_POST_AUTH_PATH = DEFAULT_POST_AUTH_PATH_COMPAT;

export type PostAuthResolutionStage = "post_auth" | "post_onboarding";

export function resolveAuthenticatedPostAuthDestination(options: {
  continuation?: PostAuthContinuation | null;
  flowDecision: PostAuthFlowDecision | null;
  fallbackPath?: string;
  stage?: PostAuthResolutionStage;
  currentAppSlug?: string | null;
}): string {
  const stage = options.stage ?? "post_auth";
  const expectedAppSlug =
    (options.currentAppSlug ?? options.flowDecision?.appSlug ?? "").trim()
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
  const requiresOnboarding =
    options.flowDecision?.requiredOnboarding !== undefined &&
    options.flowDecision.requiredOnboarding !== "none";

  if (!canAccess) {
    return flowDestination ?? options.fallbackPath ?? DEFAULT_POST_AUTH_PATH;
  }

  if (requiresOnboarding && flowDestination) {
    if (stage === "post_auth") {
      return flowDestination;
    }
    if (options.flowDecision?.requiredOnboarding === "user") {
      return flowDestination;
    }
  }

  if (continuationPath) {
    return continuationPath;
  }

  if (flowDestination) {
    return flowDestination;
  }

  return options.fallbackPath ?? DEFAULT_POST_AUTH_PATH;
}
