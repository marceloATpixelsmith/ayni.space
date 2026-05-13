- Superadmin access-mode auth restrictions are now enforced consistently across frontend route policy, auth page rendering, and backend token/session restoration flows:
  - `/login` renders Google OAuth only.
  - Email/password login UI is hidden.
  - Forgot-password links are hidden.
  - Create-account/signup affordances are hidden.
  - `/signup` redirects to `/login`.
  - `/forgot-password` redirects to `/login`.
  - `/reset-password` rejects password-reset completion in superadmin mode before credential mutation.
  - `/verify-email` rejects non-superadmin session establishment in superadmin mode before authenticated session issuance.
  - Non-superadmin users attempting access through OAuth callback, verify-email continuation, or authenticated route guards are redirected through explicit access-denied routing (`apps/admin/src/App.tsx`, `apps/admin/src/pages/auth/Login.tsx`, `apps/admin/src/pages/auth/Signup.tsx`, `apps/admin/src/pages/auth/ForgotPassword.tsx`, `apps/admin/src/pages/auth/ResetPassword.tsx`, `apps/admin/src/pages/auth/VerifyEmail.tsx`, `lib/frontend-security/src/index.tsx`, `lib/frontend-security/src/auth-page-orchestration.ts`, `apps/api-server/src/routes/auth.ts`).

- Organization-mode auth behavior is now explicitly policy-driven from canonical app metadata (`normalizedAccessProfile`, `staffInvitesEnabled`, `customerRegistrationEnabled`) across frontend and backend orchestration:
  - Login renders both Google OAuth and email/password login.
  - Forgot-password is available.
  - Signup/create-account visibility is controlled by backend customer-registration policy.
  - Invitation acceptance remains reachable while unauthenticated at `/invitations/:token/accept`.
  - Invitation continuation survives login, MFA, onboarding, and verify-email continuation through typed continuation persistence (`pendingPostAuthContinuation` / `postAuthContinuation`).
  - Organization onboarding is only reachable for legitimate organization-registration flows and is no longer implied when customer registration is disabled (`apps/api-server/src/lib/appAccess.ts`, `apps/api-server/src/lib/postAuthFlow.ts`, `apps/api-server/src/lib/postAuthContinuation.ts`, `apps/api-server/src/routes/auth.ts`, `apps/admin/src/App.tsx`, `lib/frontend-security/src/index.tsx`, `lib/frontend-security/src/auth-page-orchestration.ts`).

- Solo-mode auth behavior is now explicitly separated from organization onboarding behavior:
  - Login renders both Google OAuth and email/password login.
  - Forgot-password is available.
  - Signup/create-account is available.
  - Solo-mode users resolve onboarding through `/onboarding/user` only.
  - Solo-mode authenticated routing no longer falls through organization onboarding redirects (`apps/api-server/src/lib/appAccess.ts`, `apps/api-server/src/lib/postAuthRedirect.ts`, `apps/admin/src/App.tsx`).

- Backend/frontend auth route policy derivation is now aligned:
  - `staffInvitesEnabled` controls invitation-route affordances and invitation policy visibility.
  - `customerRegistrationEnabled` controls signup/create-account affordances and customer-registration eligibility.
  - Frontend route policy no longer hardcodes organization invitations/customer-registration as universally enabled (`apps/api-server/src/lib/appAccessProfile.ts`, `lib/frontend-security/src/index.tsx`).

- Post-auth continuation validation remains fail-closed and allowlist-bound:
  - `/invitations/:token/accept`
  - `/events/:id/register`
  - `/event-registration/:id/register`
  - `/register/client`
  - `/registration/client`
  - `/register/public`
  - `/registration/public`
  - canonical app-entry routes (`/`, `/dashboard`, `/dashboard/apps`, `/apps`)
  Arbitrary continuation paths remain rejected (`apps/api-server/src/lib/postAuthContinuation.ts`, `apps/api-server/src/lib/postAuthDestination.ts`, `lib/frontend-security/src/index.tsx`).

- Client/public registration continuation paths are now explicitly allowlisted and backed by safe frontend placeholder routes:
  - /register/client
  - /registration/client
  - /register/public
  - /registration/public
  These routes are reserved for future client/public registration flows. Until a dedicated registration implementation exists, they render a safe “Client registration is not available yet” placeholder instead of acting as organization account creation, generic signup, or implicit onboarding flows.
