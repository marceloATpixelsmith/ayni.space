import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTH_ERROR_CODES,
  buildAccessDeniedLoginPath,
  buildAuthErrorLoginPath,
  getAuthErrorMessage,
  parseAuthErrorCode,
} from "@workspace/auth";

test("shared auth contract builds stable denied login path", () => {
  assert.equal(buildAccessDeniedLoginPath(), "/login?error=access_denied");
  assert.equal(
    buildAuthErrorLoginPath(AUTH_ERROR_CODES.ACCESS_DENIED),
    "/login?error=access_denied",
  );
});

test("shared auth contract parses only supported auth error codes", () => {
  assert.equal(parseAuthErrorCode("access_denied"), AUTH_ERROR_CODES.ACCESS_DENIED);
  assert.equal(parseAuthErrorCode(" access_denied "), AUTH_ERROR_CODES.ACCESS_DENIED);
  assert.equal(parseAuthErrorCode("app_slug_invalid"), AUTH_ERROR_CODES.APP_SLUG_INVALID);
  assert.equal(parseAuthErrorCode("app_slug_missing"), AUTH_ERROR_CODES.APP_SLUG_MISSING);
  assert.equal(parseAuthErrorCode("app_not_found"), AUTH_ERROR_CODES.APP_NOT_FOUND);
  assert.equal(
    parseAuthErrorCode("app_context_unavailable"),
    AUTH_ERROR_CODES.APP_CONTEXT_UNAVAILABLE,
  );
  assert.equal(parseAuthErrorCode("unknown_code"), null);
});

test("shared auth contract resolves access denied message", () => {
  assert.equal(
    getAuthErrorMessage(AUTH_ERROR_CODES.ACCESS_DENIED),
    "You are not authorized to access this application.",
  );
  assert.equal(
    getAuthErrorMessage(AUTH_ERROR_CODES.APP_SLUG_INVALID),
    "Sign-in context was invalid. Please start sign-in again.",
  );
  assert.equal(
    getAuthErrorMessage(AUTH_ERROR_CODES.APP_SLUG_MISSING),
    "Sign-in context is missing required application information.",
  );
  assert.equal(
    getAuthErrorMessage(AUTH_ERROR_CODES.APP_NOT_FOUND),
    "The requested application could not be found.",
  );
  assert.equal(
    getAuthErrorMessage(AUTH_ERROR_CODES.APP_CONTEXT_UNAVAILABLE),
    "Application access context is unavailable. Please try again.",
  );
  assert.equal(getAuthErrorMessage("invalid"), null);
});
