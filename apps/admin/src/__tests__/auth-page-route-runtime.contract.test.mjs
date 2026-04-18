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
const verifyEmailSource = fs.readFileSync(path.resolve(__dirname, "../pages/auth/VerifyEmail.tsx"), "utf8");
const mfaEnrollSource = fs.readFileSync(path.resolve(__dirname, "../pages/auth/MfaEnroll.tsx"), "utf8");
const mfaChallengeSource = fs.readFileSync(path.resolve(__dirname, "../pages/auth/MfaChallenge.tsx"), "utf8");

// Login / signup UI branching.
test("login and signup pages implement real auth branching affordances", () => {
  assert.match(loginSource, /hideSignupAffordances/);
  assert.match(loginSource, /hideSignupAffordances\s*\?\s*"Sign in to continue\."/);
  assert.match(loginSource, /:\s*"Sign in or create your account to continue\."/);
  assert.match(loginSource, /\{!hideSignupAffordances\s*\?\s*\(/);
  assert.match(loginSource, /Create account with Google/);
  assert.match(loginSource, /<Link href="\/signup">Create account<\/Link>/);

  assert.match(signupSource, /Already have an account\?/);
  assert.match(signupSource, /<Link href="\/login" className="underline">/);
  assert.match(signupSource, /if \(!metadataResolved \|\| !signupAllowed\) \{\s*return null;/s);
});

// Route table and auth-page routing behavior.
test("router mounts auth pages and resolves auth-state redirects for login/signup/mfa", () => {
  assert.match(appSource, /<Route path="\/login" component=\{Login\} \/>/);
  assert.match(appSource, /<Route path="\/signup" component=\{Signup\} \/>/);

  assert.match(appSource, /if \(auth\.status === "unauthenticated"\)\s*\{\s*return <AuthRedirect to="\/login" \/>;\s*\}/s);
  assert.match(appSource, /if \(auth\.status === "authenticated_fully"\) \{[\s\S]*return <AuthRedirect to=\{nextStep\.destination\} \/>;\s*\}/);
  assert.match(appSource, /if \(auth\.status === "authenticated_mfa_pending_enrolled"\)\s*return <AuthRedirect to="\/mfa\/challenge" \/>;/);
  assert.match(appSource, /if \(auth\.status === "authenticated_mfa_pending_unenrolled"\)\s*return <AuthRedirect to="\/mfa\/enroll" \/>;/);
});

// Route guards after transitions.
test("route guards enforce post-auth transitions without stale destination fallbacks", () => {
  assert.match(appSource, /resolveAuthenticatedNextStep\(\{[\s\S]*defaultPath: "\/dashboard"/);
  assert.match(appSource, /if \(appAccess\?\.requiredOnboarding === "organization" && !appAccess\.canAccess\)\s*\{\s*return <AuthRedirect to="\/onboarding\/organization" \/>;\s*\}/s);
  assert.match(appSource, /if \(appAccess\?\.requiredOnboarding === "user"\)\s*\{\s*return <AuthRedirect to="\/onboarding\/user" \/>;\s*\}/s);
  assert.match(appSource, /if \(appAccess\?\.normalizedAccessProfile === "superadmin" && !auth\.user\?\.isSuperAdmin\)\s*\{\s*return <AuthRedirect to=\{adminAccessDeniedLoginPath\(\)\} \/>;\s*\}/s);
  assert.match(appSource, /if \(appAccess && !appAccess\.canAccess\)\s*\{\s*return <AuthRedirect to=\{adminAccessDeniedLoginPath\(\)\} \/>;\s*\}/s);

  assert.match(verifyEmailSource, /await auth\.refreshAuthState\(/);
  assert.match(verifyEmailSource, /auth\.refreshCsrfToken\(/);
  assert.match(verifyEmailSource, /setLocation\(targetPath\)/);

  assert.match(mfaEnrollSource, /await auth\.refreshAuthState\(/);
  assert.match(mfaChallengeSource, /await auth\.refreshAuthState\(/);
});

// Onboarding and destination continuation rules.
test("onboarding route wiring and continuation destinations are explicit", () => {
  assert.match(appSource, /<Route path="\/onboarding\/organization">\{\(\) => <ConfigDrivenAuthRoute routeKind="onboarding"><Onboarding \/><\/ConfigDrivenAuthRoute>}<\/Route>/);
  assert.match(appSource, /<Route path="\/onboarding\/user">\{\(\) => <ConfigDrivenAuthRoute routeKind="onboarding"><Onboarding \/><\/ConfigDrivenAuthRoute>}<\/Route>/);
  assert.match(appSource, /<Route path="\/onboarding">\s*\{\(\) => <AuthRedirect to="\/onboarding\/organization" \/>}\s*<\/Route>/s);
  assert.match(appSource, /<Route path="\/dashboard">\{\(\) => <ProtectedAppAccess><DashboardRoute \/><\/ProtectedAppAccess>}<\/Route>/);
  assert.match(appSource, /<Route path="\/dashboard\/:section">\{\(\) => <ProtectedAppAccess><DashboardRoute \/><\/ProtectedAppAccess>}<\/Route>/);
});

// Invitation page behavior.
test("invitation page real UI paths include create-password, existing-account, google, and continuation", () => {
  assert.match(invitationSource, /shouldShowInvitationChoices/);
  assert.match(invitationSource, /shouldShowPasswordFields/);
  assert.match(invitationSource, /Create a password to log in/);
  assert.match(invitationSource, /Set password and join/);

  assert.match(invitationSource, /shouldShowEmailSignInOption/);
  assert.match(invitationSource, /Sign in with email\/password/);

  assert.match(invitationSource, /startGoogleContinuation/);
  assert.match(invitationSource, /Continue with Google/);

  assert.match(invitationSource, /loginContinuationPath/);
  assert.match(invitationSource, /<Link href=\{invitation\.loginContinuationPath\}>/);

  assert.match(invitationSource, /invitation\.auth\.status === "unauthenticated" \? "\/login" : "\/dashboard"/);
});
