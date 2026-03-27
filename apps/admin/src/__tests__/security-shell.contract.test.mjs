import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appPath = path.resolve(__dirname, "../App.tsx");
const loginPath = path.resolve(__dirname, "../pages/auth/Login.tsx");
const accessDeniedPath = path.resolve(__dirname, "../pages/auth/accessDenied.ts");
const authProviderPath = path.resolve(__dirname, "../../../../lib/frontend-security/src/index.tsx");
const adminDashboardPath = path.resolve(__dirname, "../pages/admin/AdminDashboard.tsx");

const appSource = fs.readFileSync(appPath, "utf8");
const loginSource = fs.readFileSync(loginPath, "utf8");
const accessDeniedSource = fs.readFileSync(accessDeniedPath, "utf8");
const authProviderSource = fs.readFileSync(authProviderPath, "utf8");
const appLayoutPath = path.resolve(__dirname, "../components/layout/AppLayout.tsx");
const appLayoutSource = fs.readFileSync(appLayoutPath, "utf8");
const adminDashboardSource = fs.readFileSync(adminDashboardPath, "utf8");

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

test("non-super-admin users are blocked from dashboard and deeper routes", () => {
  expectIncludes(
    appSource,
    'setLocation(auth.user?.isSuperAdmin ? "/dashboard" : adminAccessDeniedLoginPath());',
    "Root route must block non-super-admin users.",
  );

  expectIncludes(
    accessDeniedSource,
    'return `/login?error=${encodeURIComponent(ADMIN_ACCESS_DENIED_ERROR)}`;',
    "Non-super-admin redirects must target /login with the shared access error.",
  );

  expectNotIncludes(
    appSource,
    '/unauthorized',
    "Admin shell must not route to /unauthorized.",
  );

  expectNotIncludes(
    loginSource,
    'setLocation(next || "/app")',
    "Login flow must not redirect non-super-admin users to /app.",
  );

  const protectedPaths = [
    "/dashboard",
    "/dashboard/:section",
    "/admin",
    "/admin/:section",
    "/apps/:slug",
  ];

  for (const routePath of protectedPaths) {
    expectIncludes(
      appSource,
      `<Route path="${routePath}">{() => <ProtectedSuperAdmin>`,
      `Route ${routePath} should require super-admin access.`,
    );
  }
});

test("super-admin users are sent to /dashboard after login", () => {
  expectIncludes(
    loginSource,
    'if (auth.user?.isSuperAdmin) {\n        setLocation(next || "/dashboard");',
    "Login must redirect super admins to /dashboard.",
  );

  expectIncludes(
    loginSource,
    '} else {\n        setLocation(adminAccessDeniedLoginPath());',
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
    "if (!auth.user?.isSuperAdmin) {\n    return <AuthRedirect to={adminAccessDeniedLoginPath()} />;",
    "Protected routes must route authenticated non-super-admin users to /login with access error.",
  );

  expectIncludes(
    appSource,
    'setLocation(auth.user?.isSuperAdmin ? "/dashboard" : adminAccessDeniedLoginPath());',
    "Root route should route authenticated non-super-admin users to /login with access error.",
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
});


test("logout fail-closed behavior clears UI auth immediately", () => {
  expectIncludes(
    authProviderSource,
    'setSessionRevoked(true);',
    "Logout should immediately revoke client auth state.",
  );

  expectIncludes(
    appLayoutSource,
    "queryClient.clear();",
    "Logout should clear cached admin query data immediately.",
  );

  expectIncludes(
    authProviderSource,
    "setCsrfToken(null);",
    "Logout should clear CSRF/session bootstrap state immediately.",
  );

  expectIncludes(
    appLayoutSource,
    "await auth.logout();\n    } finally {\n      setLocation(\"/login\");",
    "Logout flow must navigate to /login immediately even if backend logout is partially failed.",
  );

  expectIncludes(
    adminDashboardSource,
    "await auth.logout();\n    } finally {\n      setLocation(\"/login\");",
    "Super-admin dashboard logout should also navigate to /login immediately.",
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
    "enabled: false,",
    "Google OAuth URL query must not auto-fetch on mount.",
  );

  expectIncludes(
    authProviderSource,
    "if (loginRequestRef.current) {\n      return loginRequestRef.current;",
    "Auth provider must dedupe pending Google URL requests.",
  );

  expectIncludes(
    authProviderSource,
    "loginRequestRef.current = request;",
    "Auth provider must track in-flight login requests.",
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
    "disabled={auth.status === \"authenticated\" || auth.loginInFlight}",
    "Login button must be disabled during pending Google OAuth URL request.",
  );

  expectIncludes(
    loginSource,
    "{auth.loginInFlight ? \"Starting Google sign-in...\" : \"Sign in with Google\"}",
    "Login button copy should reflect pending OAuth URL request state.",
  );
});
