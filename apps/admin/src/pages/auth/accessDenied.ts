import {
  ADMIN_ACCESS_DENIED_ERROR,
  buildAdminAccessDeniedLoginPath,
  getAuthErrorMessage,
} from "@workspace/frontend-security";

export { ADMIN_ACCESS_DENIED_ERROR };

export const ADMIN_ACCESS_DENIED_MESSAGE = getAuthErrorMessage(
  ADMIN_ACCESS_DENIED_ERROR,
) ?? "You are not authorized to access this application.";

export function adminAccessDeniedLoginPath() {
  return buildAdminAccessDeniedLoginPath();
}
