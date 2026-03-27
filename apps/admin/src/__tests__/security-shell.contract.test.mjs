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

const appSource = fs.readFileSync(appPath, "utf8");
const loginSource = fs.readFileSync(loginPath, "utf8");
const accessDeniedSource = fs.readFileSync(accessDeniedPath, "utf8");
const authProviderSource = fs.readFileSync(authProviderPath, "utf8");

function expectIncludes(source, needle, message) {
  assert.ok(source.includes(needle), `${message}\nExpected snippet: ${needle}`);
}

test("logged-out users are redirected to /login", () => {
  expectIncludes(
    appSource,
    'if (auth.status === "unauthenticated") {\n        setLocation("/login");',
    "Home should route logged-out users to /login.",
  );

  expectIncludes(
    appSource,
    "return <AuthRedirect to={adminAccessDeniedLoginPath()} />;",
    "Protected routes should fail closed to login with access-denied state.",
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
});

test("logout fail-closed behavior clears UI auth immediately", () => {
  expectIncludes(
    authProviderSource,
    'setSessionRevoked(true);',
    "Logout should immediately revoke client auth state.",
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
