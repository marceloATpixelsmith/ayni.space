export type PostAuthContinuationType =
  | "invitation_acceptance"
  | "event_registration"
  | "client_registration"
  | "default_app_entry";

export type PostAuthContinuation = {
  type: PostAuthContinuationType;
  appSlug: string;
  returnPath: string;
  orgId?: string;
  resourceId?: string;
};

function normalizeReturnPath(path: unknown): string | null {
  if (typeof path !== "string") return null;
  const trimmed = path.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  return trimmed;
}

const INVITATION_PATH_REGEX = /^\/invitations\/([^/]+)\/accept$/i;
const EVENT_REGISTRATION_PATH_REGEX =
  /^\/(events|event-registration)\/([^/]+)\/register(?:\/)?$/i;
const CLIENT_REGISTRATION_PATH_REGEX =
  /^\/(register|registration)\/(client|public)(?:\/)?$/i;
const DEFAULT_APP_ENTRY_ALLOWED_PATHS = new Set([
  "/",
  "/dashboard",
  "/dashboard/apps",
  "/apps",
]);

function isDefaultAppEntryPath(path: string): boolean {
  const normalizedPath = path.endsWith("/") && path.length > 1
    ? path.slice(0, -1)
    : path;
  return DEFAULT_APP_ENTRY_ALLOWED_PATHS.has(normalizedPath);
}

export function isRouteValidPostAuthContinuationPath(path: string): boolean {
  return (
    INVITATION_PATH_REGEX.test(path) ||
    EVENT_REGISTRATION_PATH_REGEX.test(path) ||
    CLIENT_REGISTRATION_PATH_REGEX.test(path) ||
    isDefaultAppEntryPath(path)
  );
}

export function resolvePostAuthContinuation(params: {
  appSlug: string;
  returnPath?: string | null;
  continuationType?: string | null;
  orgId?: string | null;
  resourceId?: string | null;
}): PostAuthContinuation | null {
  const appSlug = params.appSlug.trim();
  if (!appSlug) return null;
  const returnPath = normalizeReturnPath(params.returnPath);
  if (!returnPath) return null;

  const requestedType =
    typeof params.continuationType === "string"
      ? params.continuationType.trim()
      : "";

  const orgId =
    typeof params.orgId === "string" && params.orgId.trim().length > 0
      ? params.orgId.trim()
      : undefined;
  const explicitResourceId =
    typeof params.resourceId === "string" && params.resourceId.trim().length > 0
      ? params.resourceId.trim()
      : undefined;

  const invitationMatch = returnPath.match(INVITATION_PATH_REGEX);
  if (invitationMatch) {
    return {
      type: "invitation_acceptance",
      appSlug,
      returnPath,
      resourceId: explicitResourceId ?? invitationMatch?.[1],
      orgId,
    };
  }
  if (requestedType === "invitation_acceptance") {
    return null;
  }

  const eventRegistrationMatch = returnPath.match(EVENT_REGISTRATION_PATH_REGEX);
  if (eventRegistrationMatch) {
    return {
      type: "event_registration",
      appSlug,
      returnPath,
      resourceId: explicitResourceId ?? eventRegistrationMatch?.[2],
      orgId,
    };
  }
  if (requestedType === "event_registration") {
    return null;
  }

  if (CLIENT_REGISTRATION_PATH_REGEX.test(returnPath)) {
    return {
      type: "client_registration",
      appSlug,
      returnPath,
      resourceId: explicitResourceId,
      orgId,
    };
  }
  if (requestedType === "client_registration") {
    return null;
  }

  if (!isDefaultAppEntryPath(returnPath)) {
    return null;
  }

  return {
    type: "default_app_entry",
    appSlug,
    returnPath,
    resourceId: explicitResourceId,
    orgId,
  };
}

export function normalizeContinuationPath(
  continuation: PostAuthContinuation | null | undefined,
): string | null {
  if (!continuation) return null;
  const normalizedPath = normalizeReturnPath(continuation.returnPath);
  if (!normalizedPath || !isRouteValidPostAuthContinuationPath(normalizedPath)) {
    return null;
  }
  return normalizedPath;
}
