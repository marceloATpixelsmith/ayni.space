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
}): string {
  const stage = options.stage ?? "post_auth";
  const continuationPath = normalizeContinuationPath(options.continuation);
  const flowDestination = options.flowDecision?.destination;
  const requiresOnboarding =
    options.flowDecision?.requiredOnboarding !== undefined &&
    options.flowDecision.requiredOnboarding !== "none";

  if (stage === "post_auth" && requiresOnboarding && flowDestination) {
    return flowDestination;
  }

  if (continuationPath) {
    return continuationPath;
  }

  if (flowDestination) {
    return flowDestination;
  }

  return options.fallbackPath ?? DEFAULT_POST_AUTH_PATH;
}
