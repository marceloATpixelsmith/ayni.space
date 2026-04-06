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

export function resolvePostAuthContinuation(params: {
  appSlug: string;
  returnPath?: string | null;
  continuationType?: string | null;
  orgId?: string | null;
  resourceId?: string | null;
}): PostAuthContinuation | null {
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
  if (requestedType === "invitation_acceptance" || invitationMatch) {
    return {
      type: "invitation_acceptance",
      appSlug: params.appSlug,
      returnPath,
      resourceId: explicitResourceId ?? invitationMatch?.[1],
      orgId,
    };
  }

  const eventRegistrationMatch = returnPath.match(EVENT_REGISTRATION_PATH_REGEX);
  if (requestedType === "event_registration" || eventRegistrationMatch) {
    return {
      type: "event_registration",
      appSlug: params.appSlug,
      returnPath,
      resourceId: explicitResourceId ?? eventRegistrationMatch?.[2],
      orgId,
    };
  }

  if (
    requestedType === "client_registration" ||
    CLIENT_REGISTRATION_PATH_REGEX.test(returnPath)
  ) {
    return {
      type: "client_registration",
      appSlug: params.appSlug,
      returnPath,
      resourceId: explicitResourceId,
      orgId,
    };
  }

  return {
    type: "default_app_entry",
    appSlug: params.appSlug,
    returnPath,
    resourceId: explicitResourceId,
    orgId,
  };
}

export function normalizeContinuationPath(
  continuation: PostAuthContinuation | null | undefined,
): string | null {
  if (!continuation) return null;
  return normalizeReturnPath(continuation.returnPath);
}
