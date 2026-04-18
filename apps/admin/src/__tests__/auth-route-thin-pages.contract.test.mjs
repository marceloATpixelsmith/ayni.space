import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const loginSource = fs.readFileSync(
  path.resolve(__dirname, "../pages/auth/Login.tsx"),
  "utf8",
);
const signupSource = fs.readFileSync(
  path.resolve(__dirname, "../pages/auth/Signup.tsx"),
  "utf8",
);
const invitationSource = fs.readFileSync(
  path.resolve(__dirname, "../pages/auth/InvitationAccept.tsx"),
  "utf8",
);
const sharedOrchestrationSource = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../../../lib/frontend-security/src/auth-page-orchestration.ts",
  ),
  "utf8",
);

test("login route is thin and composes shared auth-page orchestration", () => {
  assert.match(loginSource, /useLoginRoutePolicy\(/);
  assert.match(loginSource, /useLoginRouteActions\(/);
  assert.match(loginSource, /from "@workspace\/frontend-security"/);
  assert.doesNotMatch(loginSource, /export function getLoginDisabledReasons/);
  assert.doesNotMatch(loginSource, /useCurrentPlatformAppMetadata\(\)/);
});

test("signup route is thin and composes shared route policy orchestration", () => {
  assert.match(signupSource, /useSignupRoutePolicy\(\{/);
  assert.match(signupSource, /from "@workspace\/frontend-security"/);
  assert.doesNotMatch(signupSource, /useCurrentPlatformAppMetadata\(\)/);
  assert.doesNotMatch(signupSource, /setSignupAllowed\(/);
});

test("shared orchestration layer owns reusable login/signup route behavior", () => {
  assert.match(sharedOrchestrationSource, /export function useLoginRouteComposition/);
  assert.match(sharedOrchestrationSource, /export function useLoginRoutePolicy/);
  assert.match(sharedOrchestrationSource, /export function useLoginRouteActions/);
  assert.match(sharedOrchestrationSource, /export function useSignupRoutePolicy/);
  assert.match(sharedOrchestrationSource, /export function useInvitationAcceptRouteRuntime/);
  assert.match(sharedOrchestrationSource, /export function getLoginDisabledReasons/);
});

test("signup route keeps an already-have-account branch", () => {
  assert.match(signupSource, /Already have an account\?/);
  assert.match(signupSource, /Link href="\/login"/);
});

test("invitation accept route exposes email sign-in continuation for sign-in mode", () => {
  assert.match(invitationSource, /shouldShowEmailSignInOption/);
  assert.match(invitationSource, /loginContinuationPath/);
});
