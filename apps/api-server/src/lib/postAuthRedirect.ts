export const ADMIN_ACCESS_DENIED_ERROR = "access_denied";

export function getPostAuthRedirectPath(isSuperAdmin: boolean): string {
  if (isSuperAdmin) {
    return "/dashboard";
  }

  return `/login?error=${encodeURIComponent(ADMIN_ACCESS_DENIED_ERROR)}`;
}
