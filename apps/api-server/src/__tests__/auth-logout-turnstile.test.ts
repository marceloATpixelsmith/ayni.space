import test from "node:test";
import assert from "node:assert/strict";

import { createMountedSessionApp, ensureTestDatabaseEnv } from "./helpers.js";

ensureTestDatabaseEnv();

process.env["ALLOWED_ORIGINS"] = "http://localhost:5173";
process.env["GOOGLE_CLIENT_ID"] = "test-client";
process.env["GOOGLE_CLIENT_SECRET"] = "test-secret";
process.env["GOOGLE_REDIRECT_URI"] = "http://localhost:3000/api/auth/google/callback";

const { default: authRouter } = await import("../routes/auth.js");
const sessionLib = await import("../lib/session.js");

async function requestJson(
  app: ReturnType<typeof createMountedSessionApp>,
  method: "POST" | "GET",
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind test server");
  }

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    return {
      status: response.status,
      body: (await response.json().catch(() => null)) as Record<string, unknown> | null,
      headers: response.headers,
    };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

test("logout clears cookie with shared session cookie options", async () => {
  const prevNodeEnv = process.env["NODE_ENV"];
  const prevCookieDomain = process.env["SESSION_COOKIE_DOMAIN"];
  process.env["NODE_ENV"] = "production";
  process.env["SESSION_COOKIE_DOMAIN"] = "admin.test.local";

  let destroyed = false;

  try {
    const app = createMountedSessionApp(
      [{ path: "/api/auth", router: authRouter }],
      {
        userId: "logout-user",
        destroy: (cb?: (err?: unknown) => void) => {
          destroyed = true;
          cb?.();
        },
      },
    );

    const response = await requestJson(app, "POST", "/api/auth/logout");
    assert.equal(response.status, 200);
    assert.equal(destroyed, true);

    const setCookie = response.headers.get("set-cookie") ?? "";
    assert.match(setCookie, new RegExp(`${sessionLib.getSessionCookieName()}=;`, "i"));
    assert.match(setCookie, /Domain=admin\.test\.local/i);
    assert.match(setCookie, /Path=\//i);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.match(setCookie, /Secure/i);
  } finally {
    if (prevNodeEnv === undefined) delete process.env["NODE_ENV"];
    else process.env["NODE_ENV"] = prevNodeEnv;

    if (prevCookieDomain === undefined) delete process.env["SESSION_COOKIE_DOMAIN"];
    else process.env["SESSION_COOKIE_DOMAIN"] = prevCookieDomain;
  }
});

test("google oauth url endpoint fails closed without valid turnstile token", async () => {
  const prevEnabled = process.env["TURNSTILE_ENABLED"];
  const prevSecret = process.env["TURNSTILE_SECRET_KEY"];
  process.env["TURNSTILE_ENABLED"] = "true";
  delete process.env["TURNSTILE_SECRET_KEY"];

  try {
    const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }], {});

    const missingToken = await requestJson(
      app,
      "POST",
      "/api/auth/google/url",
      {},
      { origin: "http://localhost:5173" },
    );
    assert.equal(missingToken.status, 403);
    assert.equal(missingToken.body?.error, "Please complete the verification challenge.");

    const invalidToken = await requestJson(
      app,
      "POST",
      "/api/auth/google/url",
      {},
      {
        origin: "http://localhost:5173",
        "cf-turnstile-response": "bad-token",
      },
    );
    assert.equal(invalidToken.status, 403);
    assert.equal(invalidToken.body?.error, "Security verification failed. Please try again.");
  } finally {
    if (prevEnabled === undefined) delete process.env["TURNSTILE_ENABLED"];
    else process.env["TURNSTILE_ENABLED"] = prevEnabled;
    if (prevSecret === undefined) delete process.env["TURNSTILE_SECRET_KEY"];
    else process.env["TURNSTILE_SECRET_KEY"] = prevSecret;
  }
});
