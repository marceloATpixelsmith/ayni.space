export const AUTH_LOGIN_PATH = "/login";
export const DEFAULT_POST_AUTH_PATH = "/dashboard";

export const AUTH_ERROR_CODES = {
  ACCESS_DENIED: "access_denied",
} as const;

export type AuthErrorCode =
  (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];

export const ADMIN_ACCESS_DENIED_ERROR = AUTH_ERROR_CODES.ACCESS_DENIED;

export function buildAuthErrorLoginPath(code: AuthErrorCode): string {
  return `${AUTH_LOGIN_PATH}?error=${encodeURIComponent(code)}`;
}

export function buildAccessDeniedLoginPath(): string {
  return buildAuthErrorLoginPath(AUTH_ERROR_CODES.ACCESS_DENIED);
}

export function parseAuthErrorCode(raw: string | null | undefined): AuthErrorCode | null {
  if (!raw) return null;
  const candidate = raw.trim();
  const values = Object.values(AUTH_ERROR_CODES) as string[];
  if (values.includes(candidate)) {
    return candidate as AuthErrorCode;
  }
  return null;
}

export function getAuthErrorMessage(
  code: string | null | undefined,
): string | null {
  if (code === AUTH_ERROR_CODES.ACCESS_DENIED) {
    return "You are not authorized to access this application.";
  }
  return null;
}
