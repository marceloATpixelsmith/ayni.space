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
  assert.equal(parseAuthErrorCode("unknown_code"), null);
});

test("shared auth contract resolves access denied message", () => {
  assert.equal(
    getAuthErrorMessage(AUTH_ERROR_CODES.ACCESS_DENIED),
    "You are not authorized to access this application.",
  );
  assert.equal(getAuthErrorMessage("invalid"), null);
});
