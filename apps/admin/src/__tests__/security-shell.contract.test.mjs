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
    "if (auth.status === \"unauthenticated\") {\n      inFlightRef.current = false;\n      setStatus(\"idle\");\n      setMessage(\"Sign in to continue accepting this invitation.\");",
    "Invitation page should own the unauthenticated pre-auth state instead of auto-redirecting.",
  );

  expectIncludes(
    invitationAcceptSource,
    "<Button onClick={() => setLocation(`/login?next=${encodeURIComponent(`/invitations/${params.token}/accept`)}`)} className=\"w-full\">",
    "Invitation page should provide explicit login continuation action after rendering.",
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
    "if (authStatus === \"authenticated\") {\n    return \"/dashboard\";",
    "Non-superadmin-profile disallowed routes should redirect authenticated users to /dashboard.",
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

test("super-admin users are sent to /dashboard after login", () => {
  expectIncludes(
    loginSource,
    "if (isInvitationContinuationPath(nextPath)) {",
    "Login should explicitly branch invitation continuations before generic access checks.",
  );

  expectIncludes(
    loginSource,
    "setLocation(nextPath);\n        return;",
    "Login should prioritize invitation continuation before generic access checks.",
  );

  expectIncludes(
    loginSource,
    'if (normalizedAccessProfile === "superadmin") {',
    "Login should preserve an explicit superadmin branch.",
  );

  expectIncludes(
    loginSource,
    'if (auth.user?.isSuperAdmin) {',
    "Login must branch superadmin success behavior.",
  );

  expectIncludes(
    loginSource,
    'setLocation(nextPath || "/dashboard");',
    "Login must redirect super admins to /dashboard.",
  );

  expectIncludes(
    loginSource,
    'setLocation(adminAccessDeniedLoginPath());',
    "Login must route non-super admins to /login with an access error.",
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
    "if (auth.status !== \"authenticated\") return;",
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
    'const status: AuthStatus = sessionRevoked',
    "Auth status should fail closed after logout.",
  );

  expectIncludes(
    authProviderSource,
    ': meQuery.isError\n        ? "unauthenticated"',
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
    "auth.loginWithGoogle(turnstileToken, intent, nextPath, stayLoggedIn)",
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
  const turnstileWidgetPosition = loginSource.indexOf("{turnstileEnabled ? <TurnstileWidget /> : null}");
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
    "() => <div ref={setContainerNode} className=\"min-h-16\" />",
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

test("login forwards stay-logged-in intent and signup enforces turnstile readiness", () => {
  expectIncludes(
    loginSource,
    "Stay logged in for 2 weeks",
    "Login should offer a 2-week stay-logged-in control.",
  );

  expectIncludes(
    loginSource,
    "auth.loginWithGoogle(turnstileToken, intent, nextPath, stayLoggedIn)",
    "Google auth initiation should carry stay-logged-in preference.",
  );

  expectIncludes(
    loginSource,
    "auth.loginWithPassword(emailInput, passwordInput, turnstileToken, stayLoggedIn)",
    "Password login should carry turnstile token and stay-logged-in preference.",
  );

  expectIncludes(
    signupSource,
    "const turnstile = useTurnstileToken();",
    "Signup should render through shared turnstile hook.",
  );

  expectIncludes(
    signupSource,
    "{turnstile.enabled ? <turnstile.TurnstileWidget /> : null}",
    "Signup should render Turnstile widget when enabled.",
  );

  expectIncludes(
    signupSource,
    "Boolean(validateEmailInput(email)) || Boolean(validatePasswordInput(password)) || (turnstile.enabled && (!turnstile.ready || !turnstile.token))",
    "Signup should block submission until Turnstile is ready and solved.",
  );

  expectIncludes(
    turnstileSource,
    'theme: "light"',
    "Turnstile should be configured to use light theme across auth flows.",
  );
});


test("auth provider forwards stay-logged-in and turnstile payloads for password auth endpoints", () => {
  expectIncludes(
    authProviderSource,
    'body: JSON.stringify({ email: normalizedEmail, password, "cf-turnstile-response": turnstileToken ?? undefined, stayLoggedIn })',
    "Password login request should include turnstile token and stay-logged-in flag.",
  );

  expectIncludes(
    authProviderSource,
    'body: JSON.stringify({ email: normalizedEmail, password, name, "cf-turnstile-response": turnstileToken ?? undefined })',
    "Signup request should include turnstile token payload for central enforcement.",
  );

  expectIncludes(
    authProviderSource,
    "stayLoggedIn,",
    "Google OAuth start payload should include stay-logged-in flag.",
  );
});
