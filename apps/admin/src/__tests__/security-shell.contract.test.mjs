import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appPath = path.resolve(__dirname, "../App.tsx");
const loginPath = path.resolve(__dirname, "../pages/auth/Login.tsx");
const signupPath = path.resolve(__dirname, "../pages/auth/Signup.tsx");
const resetPasswordPath = path.resolve(__dirname, "../pages/auth/ResetPassword.tsx");
const accessDeniedPath = path.resolve(__dirname, "../pages/auth/accessDenied.ts");
const authProviderPath = path.resolve(__dirname, "../../../../lib/frontend-security/src/index.tsx");
const turnstilePath = path.resolve(__dirname, "../../../../lib/frontend-security/src/turnstile.tsx");
const adminDashboardPath = path.resolve(__dirname, "../pages/admin/AdminDashboard.tsx");
const onboardingPath = path.resolve(__dirname, "../pages/auth/Onboarding.tsx");
const invitationsDashboardPath = path.resolve(__dirname, "../pages/dashboard/Invitations.tsx");
const invitationAcceptPath = path.resolve(__dirname, "../pages/auth/InvitationAccept.tsx");
const mfaEnrollPath = path.resolve(__dirname, "../pages/auth/MfaEnroll.tsx");
const mfaChallengePath = path.resolve(__dirname, "../pages/auth/MfaChallenge.tsx");
const verifyEmailPath = path.resolve(__dirname, "../pages/auth/VerifyEmail.tsx");

const appSource = fs.readFileSync(appPath, "utf8");
const loginSource = fs.readFileSync(loginPath, "utf8");
const signupSource = fs.readFileSync(signupPath, "utf8");
const resetPasswordSource = fs.readFileSync(resetPasswordPath, "utf8");
const accessDeniedSource = fs.readFileSync(accessDeniedPath, "utf8");
const authProviderSource = fs.readFileSync(authProviderPath, "utf8");
const turnstileSource = fs.readFileSync(turnstilePath, "utf8");
const appLayoutPath = path.resolve(__dirname, "../components/layout/AppLayout.tsx");
const appLayoutSource = fs.readFileSync(appLayoutPath, "utf8");
const adminDashboardSource = fs.readFileSync(adminDashboardPath, "utf8");
const onboardingSource = fs.readFileSync(onboardingPath, "utf8");
const invitationsDashboardSource = fs.readFileSync(invitationsDashboardPath, "utf8");
const invitationAcceptSource = fs.readFileSync(invitationAcceptPath, "utf8");
const mfaEnrollSource = fs.readFileSync(mfaEnrollPath, "utf8");
const mfaChallengeSource = fs.readFileSync(mfaChallengePath, "utf8");
const verifyEmailSource = fs.readFileSync(verifyEmailPath, "utf8");

function expectIncludes(source, needle, message) {
  assert.ok(source.includes(needle), `${message}\nExpected snippet: ${needle}`);
}

function expectNotIncludes(source, needle, message) {
  assert.ok(!source.includes(needle), `${message}\nUnexpected snippet: ${needle}`);
}

test("logged-out users are redirected to /login", () => {
  expectIncludes(
    appSource,
    'if (auth.status === "unauthenticated") {\n        setLocation("/login");',
    "Home should route logged-out users to /login.",
  );

  expectIncludes(
    appSource,
    'if (auth.status === "unauthenticated") {\n    return <AuthRedirect to="/login" />;',
    "Protected routes should route logged-out users to /login.",
  );
});

test("onboarding and invitation auth routes are centrally gated by app metadata", () => {
  expectIncludes(
    appSource,
    '<Route path="/onboarding/organization">{() => <ConfigDrivenAuthRoute routeKind="onboarding"><Onboarding /></ConfigDrivenAuthRoute>}</Route>',
    "Onboarding route should be wrapped by config-driven gating.",
  );

  expectIncludes(
    appSource,
    '<Route path="/invitations/:token/accept">{() => <ConfigDrivenAuthRoute routeKind="invitation"><InvitationAccept /></ConfigDrivenAuthRoute>}</Route>',
    "Invitation route should be wrapped by config-driven gating.",
  );

  expectIncludes(
    appSource,
    "if (!isAuthRouteAllowed(metadata, routeKind)) {",
    "Config-driven auth route wrapper should deny disallowed routes.",
  );

  expectIncludes(
    appSource,
    "if (auth.status === \"unauthenticated\" && routeKind === \"invitation\") {\n    console.info(\"[INVITATION-FLOW] allowing unauthenticated invitation route render\"",
    "Invitation route should render pre-auth so invitation page controls the next step.",
  );

  expectIncludes(
    appSource,
    "return <AuthRedirect to=\"/login\" />;",
    "Allowed onboarding route should still route logged-out users to /login.",
  );
});

test("invitation accept route remains reachable pre-auth and controls login continuation itself", () => {
  expectIncludes(
    invitationAcceptSource,
    "if (auth.status === \"unauthenticated\") {\n      inFlightRef.current = false;\n      setStatus(\"idle\");\n      setMessage(\"Continue to accept this invitation.\");",
    "Invitation page should own the unauthenticated pre-auth state instead of auto-redirecting.",
  );

  expectIncludes(
    invitationAcceptSource,
    "auth.loginWithGoogle(turnstile.token, \"sign_in\", continuationPath).catch((error) => {",
    "Invitation page Google CTA should initiate OAuth start directly instead of plain login navigation.",
  );

  expectNotIncludes(
    invitationAcceptSource,
    "`/login?next=",
    "Invitation page first-time password setup should stay on invitation flow and not route users through generic /login continuation.",
  );

  const invitationAllowBranch = appSource.indexOf(
    "if (auth.status === \"unauthenticated\" && routeKind === \"invitation\") {",
  );
  const disallowedRouteBranch = appSource.indexOf(
    "if (!isAuthRouteAllowed(metadata, routeKind)) {",
  );
  assert.ok(
    invitationAllowBranch !== -1 && disallowedRouteBranch !== -1 && invitationAllowBranch < disallowedRouteBranch,
    "Invitation pre-auth allow branch must run before disallowed-route redirects to prevent plain /login bounce regressions.",
  );
});

test("post-onboarding flow waits for auth refresh before navigating to /dashboard", () => {
  expectIncludes(
    onboardingSource,
    "await auth.refreshSession();",
    "Onboarding completion must await auth refresh to avoid stale auth redirects.",
  );

  expectIncludes(
    onboardingSource,
    "setLocation(\"/dashboard\");",
    "Onboarding completion should route users directly to /dashboard after auth refresh.",
  );
});

test("invitation accept flow prevents duplicate submissions and only resets turnstile for turnstile-specific errors", () => {
  expectIncludes(
    invitationAcceptSource,
    "if (inFlightRef.current || lastSubmittedRef.current === submissionKey) {",
    "Invitation accept page should block duplicate submissions for the same token/challenge pair.",
  );
  expectIncludes(
    invitationAcceptSource,
    "if (typedError.code?.startsWith(\"TURNSTILE_\")) {",
    "Invitation accept page should only reset Turnstile on Turnstile-specific backend errors.",
  );
});

test("invitation accept resolution uses configured API base and avoids shell-only dead-end rendering", () => {
  expectIncludes(
    invitationAcceptSource,
    "const apiBase = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_API_BASE_URL?.trim() ?? \"\";",
    "Invitation resolve lookup should honor configured API base URL instead of assuming same-origin /api routing.",
  );
  expectIncludes(
    invitationAcceptSource,
    "if (!isInvitationResolveResponse(payload)) {",
    "Invitation resolve response should be shape-validated so missing auth state does not silently degrade into a blank action area.",
  );
  expectIncludes(
    invitationAcceptSource,
    "return value === \"valid\" || value === \"pending\" || value === \"invalid\" || value === \"expired\" || value === \"accepted\" || value === \"revoked\";",
    "Invitation resolve parsing should accept backend 'pending' state for valid invites.",
  );
  expectIncludes(
    invitationAcceptSource,
    "return value === \"create_password\" || value === \"sign_in\" || value === \"none\";",
    "Invitation resolve parsing should accept backend 'create_password' email mode.",
  );
  expectIncludes(
    invitationAcceptSource,
    "return value === \"pending\" ? \"valid\" : value;",
    "Invitation resolve parsing should normalize backend 'pending' to UI-valid invitation state.",
  );
  expectIncludes(
    invitationAcceptSource,
    "return `/api${invitationResolvePath}`;",
    "Invitation resolve lookup should keep same-origin /api routing when VITE_API_BASE_URL is not configured.",
  );
  expectIncludes(
    invitationAcceptSource,
    'auth.status === "unauthenticated" ? "Back to sign in" : "Back to dashboard"',
    "Invitation resolve error fallback should send logged-out users back to sign in instead of dashboard.",
  );
  expectIncludes(
    invitationAcceptSource,
    "auth.status === \"unauthenticated\" && params.token && isValidPendingInvitation && resolutionStatus === \"ready\"",
    "Invitation auth actions should render only after a resolved valid invite state so users are not stuck on shell-only UI.",
  );
  expectIncludes(
    invitationAcceptSource,
    "We couldn't load this invitation right now. Please retry.",
    "Invitation page should show explicit resolve failure state instead of silently rendering shell + turnstile only.",
  );
});

test("invitation dashboard submits first and last name and refreshes pending invitations after create/cancel/resend", () => {
  expectIncludes(
    invitationsDashboardSource,
    "firstName: firstName.trim() || undefined,",
    "Invitation create payload should include invitee first name.",
  );
  expectIncludes(
    invitationsDashboardSource,
    "lastName: lastName.trim() || undefined,",
    "Invitation create payload should include invitee last name.",
  );
  expectIncludes(
    invitationsDashboardSource,
    "await queryClient.invalidateQueries({ queryKey: getGetOrgInvitationsQueryKey(orgId) });",
    "Invitation dashboard should invalidate pending invitation query immediately after mutation success.",
  );
  expectIncludes(
    invitationsDashboardSource,
    "const resendInvitation = useResendInvitation();",
    "Invitation dashboard should expose resend action through the generated resend mutation hook.",
  );
});

test("shared route policy enforces normalized access-profile onboarding and invitation rules", () => {

  expectIncludes(
    authProviderSource,
    'authRoutePolicy?: AppAuthRoutePolicy;',
    "Platform app metadata should carry backend auth-route policy for onboarding/invitation gating.",
  );
  expectIncludes(
    authProviderSource,
    "if (app.normalizedAccessProfile === \"organization\") {\n    return { allowOnboarding: true, allowInvitations: true, allowCustomerRegistration: false };",
    "Organization profile should allow onboarding and invitation routes.",
  );

  expectIncludes(
    authProviderSource,
    "if (app.normalizedAccessProfile === \"solo\") {\n    return { allowOnboarding: false, allowInvitations: false, allowCustomerRegistration: false };",
    "Solo profile should deny onboarding, invitation, and customer-registration auth routes.",
  );

  expectIncludes(
    authProviderSource,
    "if (!app) {\n    return { allowOnboarding: false, allowInvitations: false, allowCustomerRegistration: false };",
    "Missing app metadata should fail closed and deny onboarding/invitations.",
  );
});

test("disallowed route redirects are explicit and avoid blank fallthrough states", () => {
  expectIncludes(
    authProviderSource,
    "if (app?.normalizedAccessProfile === \"superadmin\") {",
    "Disallowed-route redirect helper should branch explicitly for superadmin-only apps.",
  );

  expectIncludes(
    authProviderSource,
    "return isSuperAdmin ? \"/dashboard\" : (deniedLoginPath ?? \"/login\");",
    "Superadmin-profile authenticated route denials should redirect super admins to /dashboard and others to login-denied behavior.",
  );

  expectIncludes(
    authProviderSource,
    "return \"/login\";",
    "Disallowed unauthenticated routes should redirect to /login.",
  );

  expectIncludes(
    authProviderSource,
    "if (isFullyAuthenticatedStatus(authStatus)) {\n    return \"/dashboard\";",
    "Non-superadmin-profile disallowed routes should redirect fully-authenticated users to /dashboard.",
  );
});

test("dashboard routes are app-access gated (not blanket superadmin-only)", () => {
  expectIncludes(
    appSource,
    '<Route path="/dashboard">{() => <ProtectedAppAccess><DashboardRoute /></ProtectedAppAccess>}</Route>',
    "Dashboard root should be guarded by app-access gate.",
  );

  expectIncludes(
    appSource,
    '<Route path="/dashboard/:section">{() => <ProtectedAppAccess><DashboardRoute /></ProtectedAppAccess>}</Route>',
    "Dashboard sections should be guarded by app-access gate.",
  );

  expectIncludes(
    appSource,
    "if (appAccess?.normalizedAccessProfile === \"superadmin\") {\n    return <AdminDashboard section={section} />;",
    "Superadmin app profile should still render the superadmin dashboard component.",
  );

  expectIncludes(
    appSource,
    "case \"overview\":\n      return <DashboardHome />;",
    "Organization-access users should render organization dashboard routes under /dashboard.",
  );
});

test("legacy /apps/:slug alias remains root-relative and redirects to org dashboard apps route", () => {
  expectIncludes(
    appSource,
    '<Route path="/apps/:slug">{() => <ProtectedAppAccess><AuthRedirect to="/dashboard/apps" /></ProtectedAppAccess>}</Route>',
    "Legacy app alias should redirect to root-relative /dashboard/apps with app-access guard.",
  );
});

test("auth debug overlay supports collapse/expand, persistence, and keyboard accessibility", () => {
  expectIncludes(
    appSource,
    'const storageKey = "auth-debug-overlay-collapsed";',
    "Auth debug overlay should persist collapsed state with a dedicated localStorage key.",
  );

  expectIncludes(
    appSource,
    "window.localStorage.getItem(storageKey) === \"true\"",
    "Auth debug overlay should restore collapsed state from localStorage on load.",
  );

  expectIncludes(
    appSource,
    "window.localStorage.setItem(storageKey, String(isCollapsed));",
    "Auth debug overlay should write collapsed state changes to localStorage.",
  );

  expectIncludes(
    appSource,
    "if (event.key === \" \" || event.key === \"Enter\") {",
    "Auth debug overlay toggle should support keyboard activation with Enter and Space.",
  );

  expectIncludes(
    appSource,
    "aria-expanded=\"false\"",
    "Collapsed auth debug toggle should expose collapsed accessibility state.",
  );

  expectIncludes(
    appSource,
    "aria-expanded=\"true\"",
    "Expanded auth debug toggle should expose expanded accessibility state.",
  );

  expectIncludes(
    appSource,
    "fixed bottom-3 right-3 z-[10000]",
    "Collapsed auth debug affordance should remain a small fixed corner control to avoid blocking core UI.",
  );

  expectIncludes(
    appSource,
    "fixed right-3 top-3 z-[10000] max-h-[80vh]",
    "Expanded auth debug panel should preserve existing full-panel rendering and scroll behavior.",
  );
});

test("super-admin users are sent to /dashboard after login", () => {
  expectIncludes(
    loginSource,
    "const nextStep = resolveAuthenticatedNextStep({",
    "Login should use the shared post-auth resolver for authenticated redirects.",
  );

  expectIncludes(
    loginSource,
    "continuationPath: nextPath",
    "Login resolver call should pass the continuation path so invitation/event continuations are honored.",
  );

  expectIncludes(
    loginSource,
    "deniedLoginPath: adminAccessDeniedLoginPath()",
    "Login resolver call should preserve explicit superadmin denied-login behavior.",
  );

  expectIncludes(
    loginSource,
    "setLocation(nextStep.destination);",
    "Login must always navigate using the shared resolver output.",
  );

  expectIncludes(
    loginSource,
    "const accessError = accessErrorCode === ADMIN_ACCESS_DENIED_ERROR ? ADMIN_ACCESS_DENIED_MESSAGE : null;",
    "Login page should render stable access-denied feedback from redirect state.",
  );

  expectIncludes(
    accessDeniedSource,
    '"You are not authorized to access this application."',
    "Login-page access error copy should explain the authorization failure.",
  );
});

test("protected authenticated non-super-admin users are routed to login with access error", () => {
  expectIncludes(
    appSource,
    "if (appAccess?.normalizedAccessProfile === \"superadmin\" && !auth.user?.isSuperAdmin) {\n    return <AuthRedirect to={adminAccessDeniedLoginPath()} />;",
    "Protected routes must route authenticated non-super-admin users to /login with access error for superadmin apps.",
  );

  expectIncludes(
    appSource,
    'setLocation(auth.user?.isSuperAdmin ? "/dashboard" : adminAccessDeniedLoginPath());',
    "Root route should route authenticated non-super-admin users to /login with access error.",
  );
});

test("superadmin-only dashboard component remains fail-closed", () => {
  expectIncludes(
    adminDashboardSource,
    "if (!userLoading && user && !user.isSuperAdmin) setLocation(adminAccessDeniedLoginPath());",
    "Superadmin dashboard component must still deny non-superadmin users.",
  );

  expectIncludes(
    accessDeniedSource,
    'return `/login?error=${encodeURIComponent(ADMIN_ACCESS_DENIED_ERROR)}`;',
    "Access denied helper should remain shared and stable.",
  );
});


test("direct protected-route access fail-closes to login with access error", () => {
  expectIncludes(
    appSource,
    "return <AuthRedirect to={adminAccessDeniedLoginPath()} />;",
    "Protected routes must redirect unauthorized users to /login with the shared auth error.",
  );

  expectNotIncludes(
    appSource,
    "<Route path=\"/unauthorized\"",
    "Admin router must not define a standalone /unauthorized page.",
  );
});

test("login screen has stable inline access-denied message state", () => {
  expectIncludes(
    accessDeniedSource,
    'export const ADMIN_ACCESS_DENIED_ERROR = "access_denied";',
    "Login access-denied error code should be stable.",
  );

  expectIncludes(
    loginSource,
    "role=\"alert\"",
    "Login page should render inline alert text for access errors.",
  );

  expectIncludes(
    loginSource,
    "const search = useSearch();",
    "Login should read URL query params from router search state so access_denied is visible.",
  );

  expectIncludes(
    loginSource,
    "const query = React.useMemo(() => new URLSearchParams(search), [search]);",
    "Login should parse query params from current search string.",
  );
});

test("superadmin access_denied login performs fail-closed local cleanup and allows immediate retry", () => {
  expectIncludes(
    loginSource,
    "if (!isFullyAuthenticatedStatus(auth.status)) return;",
    "Denied-login cleanup should only run when stale authenticated state is detected.",
  );

  expectIncludes(
    loginSource,
    "void auth.logout();",
    "Denied-login cleanup should force logout to reset stale auth/session bootstrap state.",
  );

  expectIncludes(
    authProviderSource,
    "loginRequestRef.current = null;\n      setLoginInFlight(false);",
    "Auth provider should clear pending login state when the browser page is restored.",
  );

  expectIncludes(
    authProviderSource,
    "if (sessionRevoked) {\n        setSessionRevoked(false);\n      }",
    "Auth provider should recover from fail-closed revoked state on page restore so login can be retried.",
  );
});


test("logout fail-closed behavior clears UI auth immediately", () => {
  expectIncludes(
    authProviderSource,
    'setSessionRevoked(true);',
    "Logout should immediately revoke client auth state.",
  );

  expectIncludes(
    authProviderSource,
    "await logoutMutation.mutateAsync();",
    "Logout should execute the backend logout mutation.",
  );

  expectIncludes(
    authProviderSource,
    "setCsrfToken(null);",
    "Logout should clear CSRF/session bootstrap state after logout cleanup.",
  );

  expectIncludes(
    authProviderSource,
    "await logoutMutation.mutateAsync();\n    } catch {\n      // Fail closed: if backend logout is partially successful, keep privileged UI revoked.\n    } finally {\n      setCsrfToken(null);\n      setCsrfReady(false);",
    "Logout must not clear CSRF token before sending the logout API request.",
  );

  expectIncludes(
    authProviderSource,
    "await queryClient.cancelQueries({ queryKey: meQueryKey });",
    "Logout should cancel in-flight current-user requests before cache cleanup.",
  );

  expectIncludes(
    authProviderSource,
    "queryClient.setQueryData(meQueryKey, null);",
    "Logout should force-clear current-user data before any redirect logic runs.",
  );

  expectIncludes(
    authProviderSource,
    "queryClient.removeQueries({ queryKey: meQueryKey });",
    "Logout should remove current-user query cache inside auth provider.",
  );

  expectIncludes(
    authProviderSource,
    "queryClient.invalidateQueries({",
    "Logout should invalidate auth-scoped queries to prevent stale session reuse.",
  );

  expectIncludes(
    authProviderSource,
    "queryClient.clear();",
    "Logout should clear all cached query state.",
  );

  expectIncludes(
    authProviderSource,
    "await refreshCsrfState();",
    "Logout should immediately bootstrap a fresh anonymous CSRF token for the login screen.",
  );

  expectIncludes(
    appLayoutSource,
    "setLogoutInFlight(true);",
    "Logout flow should lock UI controls while logout is in flight.",
  );

  expectIncludes(
    appLayoutSource,
    "await auth.logout();\n      setLocation(\"/login\");",
    "Logout flow must navigate to /login only after logout resolves.",
  );

  expectIncludes(
    appLayoutSource,
    "setLogoutInFlight(false);",
    "Logout flow should release the button state after completion.",
  );

  expectIncludes(
    adminDashboardSource,
    "await auth.logout();\n    setLocation(\"/login\");",
    "Super-admin dashboard logout should also navigate to /login after logout completes.",
  );

  expectIncludes(
    authProviderSource,
    "catch {\n      // Fail closed: if backend logout is partially successful, keep privileged UI revoked.\n    }",
    "Logout flow should stay fail-closed when logout response handling throws.",
  );

  expectIncludes(
    authProviderSource,
    "const status: AuthStatus = React.useMemo(() => {",
    "Auth status should fail closed after logout.",
  );

  expectIncludes(
    authProviderSource,
    "if (meQuery.isError || !meQuery.data) return \"unauthenticated\";",
    "Bootstrap/query errors must fail closed to unauthenticated.",
  );
});

test("google oauth url is requested only on explicit login intent", () => {
  expectIncludes(
    authProviderSource,
    "if (loginRequestRef.current) {\n      return loginRequestRef.current;",
    "Auth provider must dedupe pending Google URL requests.",
  );

  expectIncludes(
    authProviderSource,
    "mapGoogleSignInError(response, payload)",
    "Auth provider should map backend oauth-url failures to specific UI messages.",
  );

  expectIncludes(
    authProviderSource,
    "loginRequestRef.current = request;",
    "Auth provider must track in-flight login requests.",
  );

});


test("login includes turnstile token when requesting oauth url", () => {
  expectIncludes(
    loginSource,
    "token: turnstileToken",
    "Login should source Turnstile token from shared security hook.",
  );

  expectIncludes(
    loginSource,
    "auth.loginWithGoogle(turnstileToken, intent, nextPath)",
    "Login should pass turnstile token and continuation path into OAuth URL request.",
  );

  expectIncludes(
    authProviderSource,
    "method: \"POST\"",
    "OAuth URL request should be a POST enforced through central public route policy.",
  );

  expectIncludes(
    loginSource,
    "if (!input.csrfReady) reasons.push(\"!auth.csrfReady\");",
    "Login button should stay disabled until CSRF bootstrap is complete.",
  );

  expectIncludes(
    loginSource,
    "if (!input.csrfTokenPresent) reasons.push(\"!auth.csrfToken\");",
    "Login button should stay disabled until a CSRF token is available.",
  );

  expectIncludes(
    loginSource,
    "if (input.turnstileEnabled && !input.turnstileTokenPresent) reasons.push(\"turnstileEnabled&&!turnstileToken\");",
    "Login button should stay disabled until required turnstile token is present.",
  );

  const signInButtonPosition = loginSource.indexOf("{auth.loginInFlight ? \"Starting Google sign-in...\" : \"Sign in with Google\"}");
  const turnstileWidgetPosition = loginSource.indexOf("<AuthTurnstileSection");
  assert.ok(signInButtonPosition >= 0 && turnstileWidgetPosition >= 0, "Login source should render both sign-in button and Turnstile widget.");
  assert.ok(
    signInButtonPosition < turnstileWidgetPosition,
    "Login page should render the sign-in button before the Turnstile widget.",
  );

  expectIncludes(
    authProviderSource,
    "\"cf-turnstile-response\": normalizedTurnstileToken",
    "OAuth URL request should include Turnstile token in request body for backend verification.",
  );

  expectIncludes(
    authProviderSource,
    "returnToPath: normalizedReturnToPath",
    "OAuth URL request should include sanitized continuation path for post-auth handoff.",
  );
});

test("frontend maps known google sign-in failure categories to specific user guidance", () => {
  expectIncludes(
    authProviderSource,
    "if (payload?.code === \"TURNSTILE_MISSING_TOKEN\") return \"Verification required. Please complete the challenge.\";",
    "Frontend should map missing turnstile token to verification required message.",
  );

  expectIncludes(
    authProviderSource,
    "if (payload?.code === \"ORIGIN_NOT_ALLOWED\") return \"Access origin is not allowed for sign-in.\";",
    "Frontend should map disallowed origin responses to explicit origin guidance.",
  );

  expectIncludes(
    authProviderSource,
    "if (payload?.code === \"OAUTH_CONFIG_MISSING\" || payload?.code === \"OAUTH_URL_INVALID\")",
    "Frontend should map oauth configuration failures to configuration-specific guidance.",
  );
});

test("admin layout no longer enforces org onboarding as an access prerequisite", () => {
  expectNotIncludes(
    appLayoutSource,
    "setLocation(\"/onboarding\")",
    "Super-admin layout should not redirect to onboarding based on org state.",
  );

  expectNotIncludes(
    appLayoutSource,
    "!user.activeOrgId",
    "Super-admin layout should not require activeOrgId for rendering access.",
  );
});

test("session revalidates on browser restore/navigation visibility", () => {
  expectIncludes(
    authProviderSource,
    "window.addEventListener(\"pageshow\", handlePageShow);",
    "Auth provider should revalidate session when a page is restored via back/forward cache.",
  );

  expectIncludes(
    authProviderSource,
    "document.addEventListener(\"visibilitychange\", handleVisibilityChange);",
    "Auth provider should revalidate session when the tab becomes visible again.",
  );

  expectIncludes(
    authProviderSource,
    "void meQuery.refetch();",
    "Session revalidation must refetch server-auth state before allowing protected content.",
  );
});

test("login button disables while google oauth url request is pending", () => {
  expectIncludes(
    loginSource,
    "if (auth.loginInFlight) {\n      return;\n    }",
    "Login click handler should ignore duplicate clicks while request is pending.",
  );

  expectIncludes(
    loginSource,
    "if (!input.csrfReady) reasons.push(\"!auth.csrfReady\");",
    "Login disabled-state reasons must include CSRF bootstrap readiness.",
  );

  expectIncludes(
    loginSource,
    "if (!input.csrfTokenPresent) reasons.push(\"!auth.csrfToken\");",
    "Login disabled-state reasons must include CSRF token presence.",
  );

  expectIncludes(
    loginSource,
    "if (input.turnstileEnabled && !input.turnstileReady) reasons.push(\"turnstileEnabled&&!turnstileReady\");",
    "Login disabled-state reasons must include turnstile readiness after refresh.",
  );

  expectIncludes(
    loginSource,
    "if (input.turnstileEnabled && !input.turnstileTokenPresent) reasons.push(\"turnstileEnabled&&!turnstileToken\");",
    "Login disabled-state reasons must include missing turnstile token.",
  );

  expectIncludes(
    loginSource,
    "disabled={disabledReasons.length > 0}",
    "Login button disabled state must be driven by explicit computed blocking reasons.",
  );

  expectIncludes(
    loginSource,
    "console.info(\"[login] render state\", {",
    "Login should emit runtime state logs to prove exact stuck refresh conditions.",
  );

  expectIncludes(
    loginSource,
    "{auth.loginInFlight ? \"Starting Google sign-in...\" : \"Sign in with Google\"}",
    "Login button copy should reflect pending OAuth URL request state.",
  );
});

test("turnstile script loader is idempotent and recovers widget mount after refresh", () => {
  expectIncludes(
    turnstileSource,
    "let turnstileScriptPromise: Promise<void> | null = null;",
    "Turnstile loader should keep a shared script-loading promise to avoid unresolved parallel loads.",
  );

  expectIncludes(
    turnstileSource,
    "if (turnstileScriptPromise) {\n    return turnstileScriptPromise;\n  }",
    "Turnstile loader should dedupe concurrent script-load attempts.",
  );

  expectIncludes(
    turnstileSource,
    "if (existing.getAttribute(SCRIPT_LOADED_ATTR) === \"true\") {\n      return Promise.resolve();\n    }",
    "Turnstile loader should resolve immediately when script tag already finished loading.",
  );

  expectIncludes(
    turnstileSource,
    "if (window.turnstile) {\n        complete();\n      }",
    "Turnstile loader should recover if script loaded before load-listener registration.",
  );

  expectIncludes(
    turnstileSource,
    "setReady(false);\n    setError(null);\n    setToken(null);",
    "Turnstile mount should clear stale state before rendering a fresh widget instance.",
  );

  expectIncludes(
    turnstileSource,
    "if (!siteKey || !containerNode) {",
    "Turnstile init should wait for a real container node before attempting widget render.",
  );

  expectIncludes(
    turnstileSource,
    "}, [siteKey, containerNode]);",
    "Turnstile render effect must rerun when widget container appears after loading state resolves.",
  );

  expectIncludes(
    turnstileSource,
    "() => <div ref={setContainerNode} className=\"min-h-16 w-full\" />",
    "Turnstile widget should use callback ref state so container mount triggers render flow.",
  );

  expectIncludes(
    turnstileSource,
    "console.info(\"[turnstile] state\", {",
    "Turnstile hook should log runtime readiness and callback transitions for refresh diagnostics.",
  );
});

test("app-access snapshot allows organization users into dashboard after onboarding", () => {
  expectIncludes(
    appSource,
    'if (appAccess?.requiredOnboarding === "organization" && !appAccess.canAccess) {\n    return <AuthRedirect to="/onboarding/organization" />;',
    "Protected routes should send users with incomplete organization onboarding to onboarding route.",
  );

  expectIncludes(
    appSource,
    "if (appAccess && !appAccess.canAccess) {\n    return <AuthRedirect to={adminAccessDeniedLoginPath()} />;",
    "Protected routes should deny users explicitly marked as app-inaccessible.",
  );

  expectIncludes(
    onboardingSource,
    "await auth.refreshSession();",
    "Onboarding success should refresh shared auth state so dashboard authorization is immediate.",
  );
});

test("mfa enrollment bootstraps csrf before enrollment start and verify", () => {
  expectIncludes(
    authProviderSource,
    "const csrfToken = await requireCsrfToken(",
    "MFA enrollment mutations should require CSRF bootstrap before POST requests.",
  );

  expectIncludes(
    authProviderSource,
    "\"Security token is not ready. Please refresh and try two-step verification setup again.\"",
    "Two-step setup should surface explicit bootstrap retry guidance.",
  );

  expectIncludes(
    authProviderSource,
    "\"Security token is not ready. Please refresh and try two-step verification again.\"",
    "Two-step verification should surface explicit bootstrap retry guidance.",
  );

  expectIncludes(
    authProviderSource,
    "if (response.status === 409 && payload?.nextStep === \"mfa_challenge\") {",
    "MFA enrollment bootstrap should fail closed back to challenge when backend indicates the account is already enrolled.",
  );

  expectIncludes(
    mfaEnrollSource,
    "const startMfaEnrollment = auth.startMfaEnrollment;",
    "MFA enrollment page should bind the start callback explicitly so setup bootstrap does not rerun from unrelated auth object changes.",
  );

  expectIncludes(
    mfaEnrollSource,
    "}, [startMfaEnrollment]);",
    "MFA enrollment startup effect must depend on the stable start callback instead of the full auth object.",
  );
});

test("mfa enrollment page renders qr code primary with manual fallback key", () => {
  expectIncludes(
    mfaEnrollSource,
    "https://api.qrserver.com/v1/create-qr-code/",
    "Two-step enrollment should generate a QR code source for authenticator scanning.",
  );

  expectIncludes(
    mfaEnrollSource,
    "alt=\"Two-step verification QR code\"",
    "Two-step enrollment should render a QR image as the primary setup UI.",
  );

  expectIncludes(
    mfaEnrollSource,
    "Manual setup option: Enter this setup key manually in your",
    "Two-step enrollment should preserve manual setup key fallback.",
  );

  expectIncludes(
    mfaEnrollSource,
    "Preparing your authenticator setup…",
    "Two-step enrollment should show initialization state instead of immediate error.",
  );
});


test("auth password forms use shared password visibility toggle component", () => {
  expectIncludes(
    loginSource,
    "<PasswordInput",
    "Login should use shared PasswordInput so users can reveal/hide passwords accessibly.",
  );

  expectIncludes(
    signupSource,
    "<PasswordInput",
    "Signup should use shared PasswordInput so users can reveal/hide passwords accessibly.",
  );

  expectIncludes(
    resetPasswordSource,
    "<PasswordInput",
    "Reset password should use shared PasswordInput so users can reveal/hide passwords accessibly.",
  );
});

test("login keeps stay-logged-in on MFA challenge and signup enforces turnstile readiness", () => {
  expectNotIncludes(
    loginSource,
    "Stay logged in for 2 weeks",
    "Login should not offer stay-logged-in control on the primary credential step.",
  );

  expectIncludes(
    mfaChallengeSource,
    "Keep this session signed in for up to 2 weeks.",
    "MFA challenge should own the stay-logged-in control.",
  );

  expectIncludes(
    loginSource,
    "auth.loginWithGoogle(turnstileToken, intent, nextPath)",
    "Google auth initiation should not collect stay-logged-in on login screen.",
  );

  expectIncludes(
    loginSource,
    "auth.loginWithPassword(emailInput, passwordInput, turnstileToken, nextPath)",
    "Password login should carry turnstile token and continuation path without stay-logged-in preference on login screen.",
  );

  expectIncludes(
    signupSource,
    "const turnstile = useTurnstileToken();",
    "Signup should render through shared turnstile hook.",
  );

  expectIncludes(
    signupSource,
    "<AuthTurnstileSection",
    "Signup should render Turnstile widget when enabled.",
  );

  expectIncludes(
    signupSource,
    "!email || !password || Boolean(validateEmailInput(email)) || Boolean(validatePasswordInput(password))",
    "Signup should disable email submit only when email/password inputs are missing or invalid.",
  );

  expectIncludes(
    turnstileSource,
    'size: "flexible"',
    "Turnstile should use flexible sizing for full-width auth form alignment.",
  );

  expectIncludes(
    turnstileSource,
    'theme: "light"',
    "Turnstile should be configured to use light theme across auth flows.",
  );
});

test("signup form only includes email + password and omits legacy fields", () => {
  expectIncludes(
    signupSource,
    "placeholder=\"Email\"",
    "Signup should include the email field.",
  );
  expectIncludes(
    signupSource,
    "placeholder=\"Password\"",
    "Signup should include the password field.",
  );
  expectNotIncludes(
    signupSource,
    "Full Name",
    "Signup should not include a full-name field.",
  );
  expectNotIncludes(
    signupSource,
    "Create account with Google",
    "Signup should not include Google create-account affordances in the dedicated email/password flow.",
  );
  expectNotIncludes(
    signupSource,
    "Confirm Password",
    "Signup should not include a confirm-password field.",
  );
});

test("invitation acceptance keeps first-time password creation and omits confirm-password", () => {
  expectIncludes(
    invitationAcceptSource,
    "idleLabel=\"Continue with Google\"",
    "Invitation page should keep a direct Google continuation action.",
  );
  expectIncludes(
    invitationAcceptSource,
    "<AuthMethodDivider />",
    "Invitation page should keep an OR-style divider between auth methods.",
  );
  expectIncludes(
    invitationAcceptSource,
    "<PasswordInput",
    "Invitation page should provide direct password entry on the invitation screen.",
  );
  expectIncludes(
    invitationAcceptSource,
    "placeholder=\"Password\"",
    "Invitation page should keep password-first setup without adding a second confirmation input.",
  );
  expectIncludes(
    invitationAcceptSource,
    "\"Set password and join\"",
    "Invitation page should support direct password creation without redirecting through generic login.",
  );
  expectNotIncludes(
    invitationAcceptSource,
    "Continue with email and password",
    "Invitation acceptance should not render a generic email/password detour CTA.",
  );
  expectNotIncludes(
    invitationAcceptSource,
    "/login?next=",
    "Invitation acceptance should not route first-time password setup through login?next.",
  );
  expectNotIncludes(
    invitationAcceptSource,
    "setLocation(\"/login\")",
    "Invitation acceptance should not force a generic login redirect during first-time password setup.",
  );
  expectNotIncludes(
    invitationAcceptSource,
    "Confirm Password",
    "Invitation page should not include a confirm-password field.",
  );
});

test("superadmin login hides signup affordances and blocks create-account intent", () => {
  expectIncludes(
    loginSource,
    "metadata?.normalizedAccessProfile === \"superadmin\"",
    "Login should detect superadmin app mode from platform metadata.",
  );
  expectIncludes(
    loginSource,
    "React.useState(true)",
    "Login should default to hidden signup affordances to avoid superadmin-mode create-account flashes before metadata resolves.",
  );
  expectIncludes(
    loginSource,
    "setHideSignupAffordances(true)",
    "Login should fail closed and keep signup affordances hidden when metadata lookup fails.",
  );
  expectIncludes(
    loginSource,
    "if (hideSignupAffordances && intent === \"create_account\") {",
    "Login should block create-account OAuth intent in superadmin mode.",
  );
  expectIncludes(
    loginSource,
    "{!hideSignupAffordances ? (",
    "Signup affordances should be conditionally hidden in superadmin mode.",
  );
});

test("verify-email flow auto-continues and avoids manual sign-in-again UX", () => {
  expectIncludes(
    verifyEmailSource,
    "auth\n      .verifyEmail(token, appSlug || undefined)",
    "Verify-email page should call backend verification immediately when token is present.",
  );
  expectIncludes(
    verifyEmailSource,
    "setMessage(\"Email verified. Redirecting...\");",
    "Verify-email should transition directly to continuation when backend returns next-step routing.",
  );
  expectNotIncludes(
    verifyEmailSource,
    "After verification, sign in to continue onboarding.",
    "Verify-email should not render stale sign-in-again onboarding copy.",
  );
  expectNotIncludes(
    verifyEmailSource,
    "sign in again",
    "Verify-email should not instruct users to sign in again after successful verification.",
  );
  expectNotIncludes(
    verifyEmailSource,
    "Back to sign in",
    "Verify-email should not offer a manual back-to-login detour during verify-and-continue flow.",
  );
});

test("mfa enrollment includes first-code instruction and consistent recovery-code surfacing", () => {
  expectIncludes(
    mfaEnrollSource,
    "Enter the <strong>first code</strong> generated by your",
    "MFA enrollment instructions must explicitly ask for the first authenticator code.",
  );
  expectIncludes(
    authProviderSource,
    "if (\n        !Array.isArray(payload?.recoveryCodes) ||\n        payload.recoveryCodes.length === 0\n      ) {",
    "Auth provider should fail closed if MFA enrollment verify does not return recovery codes.",
  );
  expectIncludes(
    mfaEnrollSource,
    "{recovery.length > 0 ? (",
    "MFA enrollment UI should display recovery codes only when they are actually returned.",
  );
});


test("auth provider forwards stay-logged-in and turnstile payloads for password auth endpoints", () => {
  expectIncludes(
    authProviderSource,
    'returnToPath: normalizedReturnToPath',
    "Password login request should include sanitized continuation path handoff.",
  );

  expectIncludes(
    authProviderSource,
    'body: JSON.stringify({\n            email: normalizedEmail,\n            password,\n            "cf-turnstile-response": turnstileToken ?? undefined,\n          })',
    "Signup request should include turnstile token payload for central enforcement.",
  );

  expectIncludes(
    authProviderSource,
    'body: JSON.stringify({ code, rememberDevice, stayLoggedIn })',
    "MFA challenge request should include stay-logged-in intent.",
  );

  expectIncludes(
    authProviderSource,
    'body: JSON.stringify({ recoveryCode, rememberDevice, stayLoggedIn })',
    "MFA recovery request should include stay-logged-in intent.",
  );

  expectIncludes(
    authProviderSource,
    "const csrfToken = await requireCsrfToken(",
    "Auth provider should gate unsafe auth submissions on CSRF readiness.",
  );

  expectIncludes(
    authProviderSource,
    '"Security token is not ready. Please refresh and try creating your account again."',
    "Signup should emit explicit CSRF readiness guidance when bootstrap has not completed.",
  );
});


test("login and signup pages compose shared auth-ui runtime primitives", () => {
  expectIncludes(
    loginSource,
    'from "@workspace/auth-ui"',
    "Login should import auth shell/form primitives from shared auth-ui runtime layer.",
  );
  expectIncludes(
    signupSource,
    'from "@workspace/auth-ui"',
    "Signup should import auth shell/form primitives from shared auth-ui runtime layer.",
  );
  expectNotIncludes(
    loginSource,
    'from "./components/AuthShell"',
    "Login must not own auth shell implementation directly under apps/admin.",
  );
  expectNotIncludes(
    signupSource,
    'from "./components/AuthShell"',
    "Signup must not own auth shell implementation directly under apps/admin.",
  );
  expectIncludes(
    loginSource,
    "const CURRENT_APP_SLUG = resolveCurrentAppSlug();",
    "Login should resolve app slug via shared frontend-security helper instead of hardcoded defaults.",
  );
  expectIncludes(
    appSource,
    "const CURRENT_APP_SLUG = resolveCurrentAppSlug();",
    "App shell should resolve app slug via shared frontend-security helper instead of hardcoded defaults.",
  );
});
