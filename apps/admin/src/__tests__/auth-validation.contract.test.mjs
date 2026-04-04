import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const validationSource = fs.readFileSync(path.resolve(__dirname, "../pages/auth/authValidation.ts"), "utf8");
const loginSource = fs.readFileSync(path.resolve(__dirname, "../pages/auth/Login.tsx"), "utf8");
const signupSource = fs.readFileSync(path.resolve(__dirname, "../pages/auth/Signup.tsx"), "utf8");
const forgotSource = fs.readFileSync(path.resolve(__dirname, "../pages/auth/ForgotPassword.tsx"), "utf8");

test("auth email validation trims/normalizes and blocks invalid input", () => {
  assert.match(validationSource, /trim\(\)\.toLowerCase\(\)/);
  assert.match(validationSource, /\^\[\^\\s@\]\+@\[\^\\s@\]\+\\\.\[\^\\s@\]\+\$/);
  assert.match(loginSource, /validateEmailInput/);
  assert.match(signupSource, /validateEmailInput/);
  assert.match(forgotSource, /validateEmailInput/);
});

test("auth password policy is visible in signup UI", () => {
  assert.match(validationSource, /password\.length < 8/);
  assert.match(validationSource, /\/\[A-Z\]\//);
  assert.match(validationSource, /\/\[a-z\]\//);
  assert.match(validationSource, /\/\\d\//);
});

test("login and signup gate email errors behind touch/submit interaction", () => {
  assert.match(loginSource, /const \[emailTouched, setEmailTouched\] = React\.useState\(false\);/);
  assert.match(loginSource, /const \[submitted, setSubmitted\] = React\.useState\(false\);/);
  assert.match(loginSource, /\(emailTouched \|\| submitted\) && validateEmailInput\(emailInput\)/);

  assert.match(signupSource, /const \[emailTouched, setEmailTouched\] = React\.useState\(false\);/);
  assert.match(signupSource, /const \[submitted, setSubmitted\] = React\.useState\(false\);/);
  assert.match(signupSource, /shouldShowEmailError && validateEmailInput\(email\)/);
});

test("signup password feedback is progressive and hidden before interaction", () => {
  assert.match(signupSource, /const shouldShowPasswordFeedback = password\.length > 0;/);
  assert.match(signupSource, /const missingPasswordRequirements = getMissingPasswordRequirements\(password\);/);
  assert.match(signupSource, /shouldShowPasswordFeedback && missingPasswordRequirements\.length > 0/);
  assert.doesNotMatch(signupSource, /Password meets requirements\./);
  assert.doesNotMatch(signupSource, /Password must be at least 8 characters and include uppercase, lowercase, and a number\./);
});
