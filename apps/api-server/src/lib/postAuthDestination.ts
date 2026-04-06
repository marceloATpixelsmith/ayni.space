import type { PostAuthFlowDecision } from "./postAuthFlow.js";

export function resolveAuthenticatedPostAuthDestination(options: {
  continuationPath?: string | null;
  flowDecision: PostAuthFlowDecision | null;
  fallbackPath?: string;
}): string {
  const continuationPath =
    typeof options.continuationPath === "string" &&
    options.continuationPath.startsWith("/")
      ? options.continuationPath
      : null;
  if (continuationPath) {
    return continuationPath;
  }
  if (options.flowDecision?.destination) {
    return options.flowDecision.destination;
  }
  return options.fallbackPath ?? "/dashboard";
}
