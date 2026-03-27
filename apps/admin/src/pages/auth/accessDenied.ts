export const ADMIN_ACCESS_DENIED_ERROR = "access_denied";

export const ADMIN_ACCESS_DENIED_MESSAGE =
  "You are not authorized to access this application.";

export function adminAccessDeniedLoginPath() {
  return `/login?error=${encodeURIComponent(ADMIN_ACCESS_DENIED_ERROR)}`;
}
