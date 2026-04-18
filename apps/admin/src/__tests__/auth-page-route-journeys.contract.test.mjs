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


test("login/signup pages expose expected branch affordances for account creation vs sign-in", () => {
  assert.match(loginSource, /\{ auth, turnstile, hideSignupAffordances, nextPath, accessError \} =/);
  assert.match(loginSource, /Sign in or create your account to continue\./);
  assert.match(loginSource, /Create account with Google/);
  assert.match(loginSource, /<Link href="\/signup">Create account<\/Link>/);

  assert.match(signupSource, /Already have an account\?/);
  assert.match(signupSource, /<Link href="\/login" className="underline">/);
});

test("superadmin mode keeps create-account affordances hidden and signup route fail-closed", () => {
  assert.match(loginSource, /\{!hideSignupAffordances \? \(/);
  assert.match(loginSource, /Create account with Google/);
  assert.match(loginSource, /<Link href="\/signup">Create account<\/Link>/);

  assert.match(signupSource, /if \(!metadataResolved \|\| !signupAllowed\) \{\s*return null;/s);
  assert.match(signupSource, /useSignupRoutePolicy\(/);
  assert.match(signupSource, /signupPath:\s*"\/signup"/);
});

test("auth route table explicitly wires login/signup/onboarding/invitation paths through guarded routing", () => {
  assert.match(appSource, /<Route path="\/login" component=\{Login\} \/>/);
  assert.match(appSource, /<Route path="\/signup" component=\{Signup\} \/>/);
  assert.match(appSource, /<Route path="\/onboarding\/organization">\{\(\) => <ConfigDrivenAuthRoute routeKind="onboarding"><Onboarding \/><\/ConfigDrivenAuthRoute>}<\/Route>/);
  assert.match(appSource, /<Route path="\/onboarding\/user">\{\(\) => <ConfigDrivenAuthRoute routeKind="onboarding"><Onboarding \/><\/ConfigDrivenAuthRoute>}<\/Route>/);
  assert.match(appSource, /<Route path="\/invitations\/:token\/accept">\{\(\) => <ConfigDrivenAuthRoute routeKind="invitation"><InvitationAccept \/><\/ConfigDrivenAuthRoute>}<\/Route>/);
});

test("auth page routing handles unauthenticated, authenticated, and MFA-pending transitions coherently", () => {
  assert.match(appSource, /if \(auth\.status === "unauthenticated"\)\s*\{\s*return <AuthRedirect to="\/login" \/>;\s*\}/s);
  assert.match(appSource, /if \(isMfaPendingStatus\(auth\.status\)\)\s*\{\s*return <AuthRedirect to=\{getMfaPendingRoute\(auth\.status\) \?\? "\/login"\} \/>;\s*\}/s);
  assert.match(appSource, /if \(auth\.status === "authenticated_mfa_pending_enrolled"\)\s*return <AuthRedirect to="\/mfa\/challenge" \/>;/);
  assert.match(appSource, /if \(auth\.status === "authenticated_mfa_pending_unenrolled"\)\s*return <AuthRedirect to="\/mfa\/enroll" \/>;/);
  assert.match(appSource, /if \(auth\.status === "authenticated_fully"\) \{[\s\S]*resolveAuthenticatedNextStep\([\s\S]*return <AuthRedirect to=\{nextStep\.destination\} \/>;/);
});

test("post-auth guarded app routes prevent bypass of onboarding, access-denied, and MFA gates", () => {
  assert.match(appSource, /if \(appAccess\?\.requiredOnboarding === "organization" && !appAccess\.canAccess\)\s*\{\s*return <AuthRedirect to="\/onboarding\/organization" \/>;\s*\}/s);
  assert.match(appSource, /if \(appAccess\?\.requiredOnboarding === "user"\)\s*\{\s*return <AuthRedirect to="\/onboarding\/user" \/>;\s*\}/s);
  assert.match(appSource, /if \(appAccess\?\.normalizedAccessProfile === "superadmin" && !auth\.user\?\.isSuperAdmin\)\s*\{\s*return <AuthRedirect to=\{adminAccessDeniedLoginPath\(\)\} \/>;\s*\}/s);
  assert.match(appSource, /if \(appAccess && !appAccess\.canAccess\)\s*\{\s*return <AuthRedirect to=\{adminAccessDeniedLoginPath\(\)\} \/>;\s*\}/s);
});

test("invitation page runtime covers create-password, existing-account sign-in, google, and continuation handling", () => {
  assert.match(invitationSource, /shouldShowPasswordFields/);
  assert.match(invitationSource, /Set password and join/);
  assert.match(invitationSource, /shouldShowEmailSignInOption/);
  assert.match(invitationSource, /Sign in with email\/password/);
  assert.match(invitationSource, /startGoogleContinuation/);
  assert.match(invitationSource, /Continue with Google/);
  assert.match(invitationSource, /loginContinuationPath/);
});

test("route-guard aliases keep post-auth navigation coherent for dashboard and app-directory routes", () => {
  assert.match(appSource, /<Route path="\/dashboard">\{\(\) => <ProtectedAppAccess><DashboardRoute \/><\/ProtectedAppAccess>}<\/Route>/);
  assert.match(appSource, /<Route path="\/dashboard\/:section">\{\(\) => <ProtectedAppAccess><DashboardRoute \/><\/ProtectedAppAccess>}<\/Route>/);
  assert.match(appSource, /<Route path="\/apps\/:slug">\{\(\) => <ProtectedAppAccess><AuthRedirect to="\/dashboard\/apps" \/><\/ProtectedAppAccess>}<\/Route>/);
});
