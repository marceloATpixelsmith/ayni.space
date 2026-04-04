import test from "node:test";
import assert from "node:assert/strict";

process.env["DATABASE_URL"] ??= "postgres://postgres:postgres@localhost:5432/ayni_test";

const { applySessionPersistence, getSessionPolicy, getStayLoggedInMaxAgeMs } = await import("../lib/session.js");

test("applySessionPersistence sets default idle timeout when stayLoggedIn is false", () => {
  const req = {
    session: {
      cookie: {},
    },
  } as any;

  applySessionPersistence(req, false);

  assert.equal(req.session.stayLoggedIn, false);
  assert.equal(req.session.cookie.maxAge, getSessionPolicy().idleTimeoutMs);
});

test("applySessionPersistence sets 14-day maxAge when stayLoggedIn is true", () => {
  const req = {
    session: {
      cookie: {},
    },
  } as any;

  applySessionPersistence(req, true);

  assert.equal(req.session.stayLoggedIn, true);
  assert.equal(req.session.cookie.maxAge, getStayLoggedInMaxAgeMs());
});
