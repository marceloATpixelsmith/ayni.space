import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const validationSource = fs.readFileSync(
  path.resolve(__dirname, "../pages/auth/authValidation.ts"),
  "utf8",
);
const loginSource = fs.readFileSync(
  path.resolve(__dirname, "../pages/auth/Login.tsx"),
  "utf8",
);
const signupSource = fs.readFileSync(
  path.resolve(__dirname, "../pages/auth/Signup.tsx"),
  "utf8",
);
const forgotSource = fs.readFileSync(
  path.resolve(__dirname, "../pages/auth/ForgotPassword.tsx"),
  "utf8",
);
const invitationSource = fs.readFileSync(
  path.resolve(__dirname, "../pages/auth/InvitationAccept.tsx"),
  "utf8",
);

test("auth email validation trims/normalizes and blocks invalid input", () => {
  assert.match(validationSource, /trim\(\)\.toLowerCase\(\)/);
  assert.match(
    validationSource,
    /\^\[\^\\s@\]\+@\[\^\\s@\]\+\\\.\[\^\\s@\]\+\$/,
  );
  assert.match(loginSource, /validateEmailInput/);
  assert.match(signupSource, /validateEmailInput/);
  assert.match(forgotSource, /validateEmailInput/);
});

test("auth password policy is visible in signup UI", () => {
  assert.match(validationSource, /password\.length < 8/);
  assert.match(validationSource, /\/\[A-Za-z\]\//);
  assert.match(validationSource, /\/\[A-Z\]\//);
  assert.match(validationSource, /\/\[a-z\]\//);
  assert.match(validationSource, /\/\\d\//);
  assert.match(validationSource, /\/\[\^A-Za-z0-9\]\//);
});

test("login and signup gate email errors behind touch/submit interaction", () => {
  assert.match(
    loginSource,
    /const \[emailTouched, setEmailTouched\] = React\.useState\(false\);/,
  );
  assert.match(
    loginSource,
    /const \[submitted, setSubmitted\] = React\.useState\(false\);/,
  );
  assert.match(
    loginSource,
    /const emailError =\s*emailTouched \|\| submitted \? validateEmailInput\(emailInput\) : null;/,
  );

  assert.match(
    signupSource,
    /const \[emailTouched, setEmailTouched\] = React\.useState\(false\);/,
  );
  assert.match(
    signupSource,
    /const \[submitted, setSubmitted\] = React\.useState\(false\);/,
  );
  assert.match(
    signupSource,
    /const emailError =\s*emailTouched \|\| submitted \? validateEmailInput\(email\) : null;/,
  );
});

test("signup password feedback is progressive and hidden before interaction", () => {
  assert.match(
    signupSource,
    /const shouldShowPasswordFeedback = password\.length > 0;/,
  );
  assert.match(
    signupSource,
    /const missingPasswordRequirements = getMissingPasswordRequirements\(password\);/,
  );
  assert.match(
    signupSource,
    /shouldShowPasswordFeedback\s*&&\s*missingPasswordRequirements\.length > 0/,
  );
  assert.doesNotMatch(signupSource, /Password meets requirements\./);
  assert.doesNotMatch(
    signupSource,
    /Password must be at least 8 characters and include uppercase, lowercase, and a number\./,
  );
});

test("signup and invitation flows avoid confirm-password fields", () => {
  assert.doesNotMatch(signupSource, /Confirm password/i);
  assert.doesNotMatch(signupSource, /confirmPassword/);
  assert.doesNotMatch(signupSource, /Full Name/i);
  assert.doesNotMatch(invitationSource, /Confirm password/i);
});

test("signup submit gating depends only on email and password validity", () => {
  assert.match(
    signupSource,
    /disabled=\{!email \|\| !password \|\| Boolean\(validateEmailInput\(email\)\) \|\| Boolean\(validatePasswordInput\(password\)\)\}/,
  );
  assert.doesNotMatch(signupSource, /Full Name/i);
  assert.doesNotMatch(signupSource, /confirmPassword/);
});

test("invitation flow performs password creation on invitation screen", () => {
  assert.match(invitationSource, /Create a password to log in/);
  assert.doesNotMatch(invitationSource, /Continue with email and password/);
  assert.doesNotMatch(invitationSource, /\/login\?next=/);
});

test("login superadmin mode can hide signup affordances", () => {
  assert.match(loginSource, /hideSignupAffordances/);
  assert.match(loginSource, /useLoginRouteComposition\(/);
});


test("auth pages avoid hardcoded app slug defaults", () => {
  assert.match(loginSource, /useLoginRouteComposition\(/);
  assert.match(signupSource, /useSignupRoutePolicy\(/);
  assert.doesNotMatch(loginSource, /VITE_APP_SLUG \?\? "admin"/);
  assert.doesNotMatch(signupSource, /VITE_APP_SLUG \?\? "admin"/);
});

test("auth pages consume shared auth-ui primitives from lib/auth-ui", () => {
  assert.match(loginSource, /from "@workspace\/auth-ui"/);
  assert.match(signupSource, /from "@workspace\/auth-ui"/);
  assert.match(forgotSource, /from "@workspace\/auth-ui"/);
  assert.match(invitationSource, /from "@workspace\/auth-ui"/);
  assert.doesNotMatch(loginSource, /from "\.\/components\//);
  assert.doesNotMatch(signupSource, /from "\.\/components\//);
  assert.doesNotMatch(forgotSource, /from "\.\/components\//);
  assert.doesNotMatch(invitationSource, /from "\.\/components\//);
});
