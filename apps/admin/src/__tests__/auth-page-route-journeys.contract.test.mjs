import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const appSource = fs.readFileSync(path.resolve(__dirname, "../App.tsx"), "utf8");
const loginSource = fs.readFileSync(path.resolve(__dirname, "../pages/auth/Login.tsx"), "utf8");
const signupSource = fs.readFileSync(path.resolve(__dirname, "../pages/auth/Signup.tsx"), "utf8");
const invitationSource = fs.readFileSync(path.resolve(__dirname, "../pages/auth/InvitationAccept.tsx"), "utf8");


test("login and signup pages preserve explicit account-creation vs sign-in branching", () => {
  assert.match(loginSource, /hideSignupAffordances\s*\?/);
  assert.match(loginSource, /Create account with Google/);
  assert.match(loginSource, /<Link href="\/signup">Create account<\/Link>/);
  assert.match(signupSource, /Already have an account\?/);
  assert.match(signupSource, /<Link href="\/login" className="underline">/);
});

test("superadmin affordance hiding is enforced at login and route-guard levels", () => {
  assert.match(loginSource, /hideSignupAffordances/);
  assert.match(appSource, /normalizedAccessProfile === "superadmin"/);
  assert.match(appSource, /adminAccessDeniedLoginPath\(\)/);
});

test("route guards fail closed across unauthenticated, MFA pending, onboarding, and denied states", () => {
  assert.match(appSource, /if \(auth\.status === "unauthenticated"\)\s*\{\s*return <AuthRedirect to="\/login" \/>;/s);
  assert.match(appSource, /if \(isMfaPendingStatus\(auth\.status\)\)\s*\{\s*return <AuthRedirect to=\{getMfaPendingRoute\(auth\.status\) \?\? "\/login"\} \/>;/s);
  assert.match(appSource, /requiredOnboarding === "organization"[\s\S]*AuthRedirect to="\/onboarding\/organization"/);
  assert.match(appSource, /requiredOnboarding === "user"[\s\S]*AuthRedirect to="\/onboarding\/user"/);
  assert.match(appSource, /if \(appAccess && !appAccess\.canAccess\) \{\s*return <AuthRedirect to=\{adminAccessDeniedLoginPath\(\)\} \/>;/s);
});

test("invitation auth page keeps explicit existing-account continuation branches", () => {
  assert.match(invitationSource, /shouldShowEmailSignInOption/);
  assert.match(invitationSource, /\/login\?next=\$\{encodeURIComponent\(loginContinuationPath\)\}/);
  assert.match(invitationSource, /Google/);
});
