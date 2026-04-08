import {
  AUTH_ERROR_CODES,
  buildAuthErrorLoginPath,
  getAuthErrorMessage,
} from "@workspace/frontend-security";

export const ADMIN_ACCESS_DENIED_ERROR = AUTH_ERROR_CODES.ACCESS_DENIED;

export const ADMIN_ACCESS_DENIED_MESSAGE = getAuthErrorMessage(
  ADMIN_ACCESS_DENIED_ERROR,
) ?? "You are not authorized to access this application.";

export function adminAccessDeniedLoginPath() {
  return buildAuthErrorLoginPath(ADMIN_ACCESS_DENIED_ERROR);
}
