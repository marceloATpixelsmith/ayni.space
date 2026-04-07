import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { ensureTestDatabaseEnv } from "./helpers.js";

ensureTestDatabaseEnv();
process.env["RATE_LIMIT_ENABLED"] = "true";
const {
  authRateLimiter,
  setRateLimitStoreForTests,
} = await import("../middlewares/rateLimit.js");

let rateLimitTestPrefixCounter = 0;

function nextRateLimitTestPrefix(base: string) {
  rateLimitTestPrefixCounter += 1;
  return `${base}-${process.pid}-${rateLimitTestPrefixCounter}`;
}

function createRateLimitedApp(max: number, clientIp: string, windowMs?: number) {
  const app = express();
  app.set("trust proxy", true);
  app.use(
    "/api/auth/google/url",
    (req, _res, next) => {
      req.headers["x-forwarded-for"] = clientIp;
      next();
    },
    authRateLimiter({ max, keyPrefix: nextRateLimitTestPrefix("test-auth-google-url"), windowMs }),
  );
  app.post("/api/auth/google/url", (_req, res) => {
    res.status(200).json({ url: "https://accounts.google.com/o/oauth2/v2/auth?state=test" });
  });

  return app;
}

async function requestJson(app: express.Express, path = "/api/auth/google/url", headers: Record<string, string> = {}) {
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind test server");
  }

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { method: "POST", headers });
    const body = (await response.json()) as Record<string, unknown>;
    return {
      status: response.status,
      body,
      retryAfter: response.headers.get("retry-after"),
    };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

test("google auth url limiter allows normal login attempts without 429", async () => {
  const app = createRateLimitedApp(20, "203.0.113.10");

  for (let index = 0; index < 5; index += 1) {
    const result = await requestJson(app);
    assert.equal(result.status, 200);
    assert.equal(typeof result.body.url, "string");
  }
});

test("google auth url limiter returns 429 after configured threshold", async () => {
  const app = createRateLimitedApp(2, "203.0.113.11");

  assert.equal((await requestJson(app)).status, 200);
  assert.equal((await requestJson(app)).status, 200);

  const limited = await requestJson(app);
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error, "Too many requests, please try again later.");
  assert.equal(limited.body.code, "RATE_LIMITED");
  assert.equal(typeof limited.retryAfter, "string");
});

async function waitForStatus(
  app: express.Express,
  expectedStatus: number,
  { timeoutMs = 1_000, pollMs = 25 }: { timeoutMs?: number; pollMs?: number } = {},
) {
  const startedAt = Date.now();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await requestJson(app);
    if (result.status === expectedStatus) {
      return result;
    }

    if (Date.now() - startedAt >= timeoutMs) {
      assert.fail(`Timed out waiting for status ${expectedStatus}; last status was ${result.status}`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

test("google auth url limiter unlocks after rate limit window resets", async () => {
  const app = createRateLimitedApp(1, "203.0.113.111", 100);
  assert.equal((await requestJson(app)).status, 200);
  assert.equal((await requestJson(app)).status, 429);
  await waitForStatus(app, 200, { timeoutMs: 10_000, pollMs: 50 });
});

test("google auth url limiter does not consume generic auth limiter budget", async () => {
  const app = express();
  app.set("trust proxy", true);
  app.use(
    "/api/auth/google/url",
    (req, _res, next) => {
      req.headers["x-forwarded-for"] = "203.0.113.12";
      next();
    },
    authRateLimiter({ max: 2, keyPrefix: nextRateLimitTestPrefix("test-auth-google-url-isolated") }),
  );
  app.use(
    "/api/auth",
    authRateLimiter({
      max: 2,
      keyPrefix: nextRateLimitTestPrefix("test-auth-generic"),
      skip: (req) => req.path === "/google/url" || req.path === "/google/callback",
    }),
  );
  app.post("/api/auth/google/url", (_req, res) => {
    res.status(200).json({ url: "https://accounts.google.com/o/oauth2/v2/auth?state=test" });
  });
  app.post("/api/auth/me", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  assert.equal((await requestJson(app)).status, 200);
  assert.equal((await requestJson(app)).status, 200);

  assert.equal((await requestJson(app, "/api/auth/me")).status, 200);
  assert.equal((await requestJson(app, "/api/auth/me")).status, 200);
  const genericLimited = await requestJson(app, "/api/auth/me");
  assert.equal(genericLimited.status, 429);
});

test("rate limiter ignores spoofed forwarded headers when trust proxy is disabled", async () => {
  const app = express();
  app.set("trust proxy", false);
  app.use("/api/auth/google/url", authRateLimiter({ max: 1, keyPrefix: nextRateLimitTestPrefix("spoof-check") }));
  app.post("/api/auth/google/url", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  assert.equal((await requestJson(app, "/api/auth/google/url", { "x-forwarded-for": "203.0.113.1" })).status, 200);
  const second = await requestJson(app, "/api/auth/google/url", { "x-forwarded-for": "198.51.100.2" });
  assert.equal(second.status, 429);
});

test("rate limiter honors forwarded client ip when trust proxy is enabled", async () => {
  const app = express();
  app.set("trust proxy", true);
  app.use("/api/auth/google/url", authRateLimiter({ max: 1, keyPrefix: nextRateLimitTestPrefix("trusted-proxy") }));
  app.post("/api/auth/google/url", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  assert.equal((await requestJson(app, "/api/auth/google/url", { "x-forwarded-for": "203.0.113.50" })).status, 200);
  assert.equal((await requestJson(app, "/api/auth/google/url", { "x-forwarded-for": "198.51.100.50" })).status, 200);
});

test("production rate limiter fails closed when distributed store is unavailable", async () => {
  const prevNodeEnv = process.env["NODE_ENV"];
  process.env["NODE_ENV"] = "production";
  setRateLimitStoreForTests({
    consume: async () => {
      throw new Error("store down");
    },
  });

  try {
    const app = express();
    app.use("/api/auth/google/url", authRateLimiter({ max: 1, keyPrefix: nextRateLimitTestPrefix("prod-fail-closed") }));
    app.post("/api/auth/google/url", (_req, res) => {
      res.status(200).json({ ok: true });
    });

    const result = await requestJson(app);
    assert.equal(result.status, 503);
    assert.equal(result.body.code, "RATE_LIMIT_UNAVAILABLE");
  } finally {
    setRateLimitStoreForTests(null);
    if (prevNodeEnv === undefined) delete process.env["NODE_ENV"];
    else process.env["NODE_ENV"] = prevNodeEnv;
  }
});

test("production rate limiter uses emergency local limiter when distributed table is missing", async () => {
  const prevNodeEnv = process.env["NODE_ENV"];
  process.env["NODE_ENV"] = "production";
  setRateLimitStoreForTests({
    consume: async () => {
      const error = new Error('relation "platform.rate_limits" does not exist') as Error & { code: string };
      error.code = "42P01";
      throw error;
    },
  });

  try {
    const app = express();
    app.use("/api/auth/google/url", authRateLimiter({ max: 1, keyPrefix: nextRateLimitTestPrefix("prod-emergency-fallback") }));
    app.post("/api/auth/google/url", (_req, res) => {
      res.status(200).json({ ok: true });
    });

    const first = await requestJson(app);
    assert.equal(first.status, 200);

    const second = await requestJson(app);
    assert.equal(second.status, 429);
    assert.equal(second.body.code, "RATE_LIMITED");
  } finally {
    setRateLimitStoreForTests(null);
    if (prevNodeEnv === undefined) delete process.env["NODE_ENV"];
    else process.env["NODE_ENV"] = prevNodeEnv;
  }
});
