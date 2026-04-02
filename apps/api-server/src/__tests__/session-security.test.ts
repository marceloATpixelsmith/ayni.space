import test from "node:test";
import assert from "node:assert/strict";
import { ensureTestDatabaseEnv } from "./helpers.js";

ensureTestDatabaseEnv();
process.env["SESSION_SECRET"] ??= "test-session-secret";

const sessionLib = await import("../lib/session.js");

function withEnv(key: string, value: string | undefined, fn: () => void) {
  const prev = process.env[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

test("session cookie flags are hardened in production", () => {
  withEnv("NODE_ENV", "production", () => {
    withEnv("SESSION_IDLE_TIMEOUT_MS", "1800000", () => {
      const options = sessionLib.buildSessionOptions("secret");
      assert.equal(options.cookie?.httpOnly, true);
      assert.equal(options.cookie?.secure, true);
      assert.equal(options.cookie?.sameSite, "none");
      assert.equal(options.cookie?.maxAge, 1800000);
      assert.equal(options.rolling, true);
    });
  });
});

test("absolute session timeout returns 401 and destroys session", async () => {
  const middleware = sessionLib.sessionSecurityMiddleware();
  const now = Date.now();

  let destroyed = false;
  let cleared = false;
  let statusCode = 200;
  let payload: unknown;

  const req: any = {
    ip: "127.0.0.1",
    get: () => "test-agent",
    session: {
      id: "sid-1",
      userId: "user-1",
      sessionCreatedAt: now - 10_000,
      sessionAuthenticatedAt: now - (24 * 60 * 60 * 1000 + 1_000),
      destroy: (cb: () => void) => {
        destroyed = true;
        cb();
      },
    },
  };

  const res: any = {
    clearCookie: () => {
      cleared = true;
    },
    status: (code: number) => {
      statusCode = code;
      return {
        json: (body: unknown) => {
          payload = body;
        },
      };
    },
  };

  let nextCalled = false;
  await new Promise<void>((resolve) => {
    middleware(req, res, () => {
      nextCalled = true;
      resolve();
    });
    setTimeout(resolve, 0);
  });

  assert.equal(nextCalled, false);
  assert.equal(destroyed, true);
  assert.equal(cleared, true);
  assert.equal(statusCode, 401);
  assert.match(String((payload as { error?: string })?.error), /Session expired/i);
});

test("session anomaly writes observational audit event when ip or ua changes", async () => {
  const events: unknown[] = [];
  const middleware = sessionLib.sessionSecurityMiddleware({
    writeAuditLogFn: (event) => {
      events.push(event);
    },
  });

  const req: any = {
    ip: "10.1.2.3",
    get: () => "ua-next",
    session: {
      id: "sid-2",
      userId: "user-2",
      sessionCreatedAt: Date.now() - 1000,
      sessionAuthenticatedAt: Date.now() - 1000,
      lastIp: "10.0.0.1",
      lastUserAgent: "ua-prev",
      destroy: (_cb: () => void) => {},
    },
  };

  const res: any = {
    clearCookie: () => undefined,
    status: () => ({ json: () => undefined }),
  };

  await new Promise<void>((resolve) => {
    middleware(req, res, () => resolve());
  });

  assert.equal(events.length, 1);
  const event = events[0] as { action?: string; resourceType?: string };
  assert.equal(event.action, "session.anomaly_observed");
  assert.equal(event.resourceType, "session");
  assert.equal(req.session.lastIp, "10.1.2.3");
  assert.equal(req.session.lastUserAgent, "ua-next");
  assert.equal(typeof req.session.lastSeenAt, "number");
});
