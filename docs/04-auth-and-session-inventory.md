# 04 — Authentication and Session Inventory (DRAFT)

## Confirmed from code

### Authentication model
- Primary auth path is **Google OAuth**:
  - `/api/auth/google/url` generates OAuth URL with state.
  - `/api/auth/google/callback` exchanges code, verifies ID token, and upserts user.
- `requireAuth` middleware gates authenticated endpoints by checking `req.session.userId` and user status in DB.

### Session model
- `express-session` with `connect-pg-simple` store against `sessions` table.
- Cookie configuration:
  - name: `saas.sid`
  - `httpOnly: true`
  - `secure` in production only
  - `sameSite: lax`
  - 1-hour maxAge
  - `rolling: true`
- Session fields include `userId`, `activeOrgId`, OAuth state/return URL, and CSRF token (runtime-attached).
- Session rotation occurs on org switch (`rotateSession`) to mitigate fixation during context changes.

### Frontend auth/session integration
- `AuthProvider` in `lib/frontend-security` uses generated `useGetMe`, `useLogout`, `useSwitchOrganization`, and invitation acceptance hooks.
- `RequireAuth` wrapper gates frontend routes.
- Login flow redirects browser to Google OAuth URL returned by backend.

### CSRF/session coupling
- Frontend fetches `/api/csrf-token` and sets token provider for API client.
- API client injects `x-csrf-token` on unsafe methods if token provider returns a value.

## Strong inference from code structure
- Session cookie + backend CSRF + origin/referer checks is intended as the core browser security posture (rather than JWT bearer tokens).
- Active organization is designed as a **session-scoped context**, not only a query parameter.

## Unclear / requires confirmation
- No explicit refresh token/session extension beyond rolling cookie; expected idle/absolute timeout policy should be confirmed.
- OAuth callback currently redirects to `${oauthReturnTo}/app`; alignment with `apps/admin` route strategy should be confirmed.
