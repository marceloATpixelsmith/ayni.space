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
  assert.match(signupSource, /at least 8 characters/);
  assert.match(signupSource, /uppercase/);
  assert.match(signupSource, /lowercase/);
  assert.match(signupSource, /number/);
});
