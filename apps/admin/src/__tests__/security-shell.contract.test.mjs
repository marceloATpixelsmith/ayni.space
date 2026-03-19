import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appPath = path.resolve(__dirname, "../App.tsx");
const layoutPath = path.resolve(__dirname, "../components/layout/AppLayout.tsx");

const appSource = fs.readFileSync(appPath, "utf8");
const layoutSource = fs.readFileSync(layoutPath, "utf8");

function expectIncludes(source, needle, message) {
  assert.ok(source.includes(needle), message + `\nExpected snippet: ${needle}`);
}

test("Home route redirects authenticated users to /dashboard", () => {
  expectIncludes(
    appSource,
    'if (auth.status === "authenticated") {\n        setLocation("/dashboard");',
    "Home should navigate authenticated users to /dashboard.",
  );
});

test("Home route redirects non-authenticated users to /login", () => {
  expectIncludes(
    appSource,
    '} else {\n        setLocation("/login");',
    "Home should navigate non-authenticated users to /login.",
  );
});

test("Protected shell routes unauthenticated fallback to login redirect", () => {
  expectIncludes(
    appSource,
    'unauthenticatedFallback={\n        <AuthRedirect onRedirect={() => setLocation("/login")} />',
    "Protected routes must redirect unauthenticated users to /login.",
  );
});

test("All dashboard and admin paths are wrapped in Protected", () => {
  const protectedPaths = [
    "/dashboard",
    "/dashboard/apps",
    "/dashboard/members",
    "/dashboard/invitations",
    "/dashboard/billing",
    "/dashboard/settings",
    "/apps/shipibo",
    "/apps/ayni",
    "/admin",
    "/admin/:section",
  ];

  for (const routePath of protectedPaths) {
    expectIncludes(
      appSource,
      `<Route path="${routePath}">{() => <Protected>`,
      `Route ${routePath} should be wrapped in the Protected shell.`,
    );
  }
});

test("AppLayout sends unauthenticated users to /login", () => {
  expectIncludes(
    layoutSource,
    'if (isError) {\n      setLocation("/login");',
    "AppLayout should redirect unauthenticated users to /login.",
  );
});

test("AppLayout sends users without an active org to /onboarding", () => {
  expectIncludes(
    layoutSource,
    '} else if (user && !user.activeOrgId && location !== "/onboarding") {\n      setLocation("/onboarding");',
    "AppLayout should redirect users without activeOrgId to /onboarding.",
  );
});

test("AppLayout avoids rendering protected shell content while redirecting", () => {
  expectIncludes(
    layoutSource,
    'if (!user || (!user.activeOrgId && location !== "/onboarding")) {\n    return null; // Will redirect in useEffect\n  }',
    "AppLayout should withhold shell rendering while redirect logic runs.",
  );
});
