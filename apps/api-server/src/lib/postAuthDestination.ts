import type { PostAuthFlowDecision } from "./postAuthFlow.js";
import {
  normalizeContinuationPath,
  type PostAuthContinuation,
} from "./postAuthContinuation.js";

export type PostAuthResolutionStage = "post_auth" | "post_onboarding";

export function resolveAuthenticatedPostAuthDestination(options: {
  continuation?: PostAuthContinuation | null;
  flowDecision: PostAuthFlowDecision | null;
  fallbackPath?: string;
  stage?: PostAuthResolutionStage;
}): string {
  const stage = options.stage ?? "post_auth";
  const continuationPath = normalizeContinuationPath(options.continuation);

  if (stage === "post_auth" && options.flowDecision?.destination) {
    return options.flowDecision.destination;
  }

  if (continuationPath) {
    return continuationPath;
  }

  if (stage === "post_onboarding" && options.flowDecision?.destination) {
    return options.flowDecision.destination;
  }

  return options.fallbackPath ?? "/dashboard";
}
