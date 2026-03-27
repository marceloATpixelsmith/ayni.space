export const ADMIN_ACCESS_DENIED_ERROR = "access_denied";

export const ADMIN_ACCESS_DENIED_MESSAGE =
  "You do not have access to the admin application. Please sign in with a super-admin account.";

export function adminAccessDeniedLoginPath() {
  return `/login?error=${encodeURIComponent(ADMIN_ACCESS_DENIED_ERROR)}`;
}
