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


test("logout fail-closes protected auth/me route in subsequent request", async () => {
  const state: { session: Record<string, unknown> | null } = {
    session: {
      id: "session-after-logout",
      userId: "logout-user",
      destroy: (cb?: (err?: unknown) => void) => {
        state.session = null;
        cb?.();
      },
      save: (cb?: (err?: unknown) => void) => cb?.(),
      regenerate: (cb?: (err?: unknown) => void) => cb?.(),
    },
  };

  const expressMod = await import("express");
  const app = expressMod.default();
  app.use(expressMod.default.json());
  app.use((req, _res, next) => {
    (req as unknown as { session: Record<string, unknown> }).session =
      state.session ?? {
        id: "session-after-logout",
        destroy: (cb?: (err?: unknown) => void) => cb?.(),
        save: (cb?: (err?: unknown) => void) => cb?.(),
        regenerate: (cb?: (err?: unknown) => void) => cb?.(),
      };
    next();
  });
  app.use("/api/auth", authRouter);

  const logout = await requestJson(app, "POST", "/api/auth/logout");
  assert.equal(logout.status, 200);
  const me = await requestJson(app, "GET", "/api/auth/me");
  assert.equal(me.status, 401);
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
    assert.equal(missingToken.body?.code, "TURNSTILE_MISSING_TOKEN");

  } finally {
    if (prevEnabled === undefined) delete process.env["TURNSTILE_ENABLED"];
    else process.env["TURNSTILE_ENABLED"] = prevEnabled;
    if (prevSecret === undefined) delete process.env["TURNSTILE_SECRET_KEY"];
    else process.env["TURNSTILE_SECRET_KEY"] = prevSecret;
  }
});

test("google oauth url returns auth URL when origin is allowed and turnstile already verified", async () => {
  const prevEnabled = process.env["TURNSTILE_ENABLED"];
  process.env["TURNSTILE_ENABLED"] = "false";

  try {
    const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }], {
      save: (cb?: (err?: unknown) => void) => cb?.(),
    });

    const response = await requestJson(
      app,
      "POST",
      "/api/auth/google/url",
      {},
      { origin: "http://localhost:5173" },
    );
    assert.equal(response.status, 200);
    assert.equal(typeof response.body?.url, "string");
    assert.equal(String(response.body?.url).startsWith("https://accounts.google.com/"), true);
  } finally {
    if (prevEnabled === undefined) delete process.env["TURNSTILE_ENABLED"];
    else process.env["TURNSTILE_ENABLED"] = prevEnabled;
  }
});

test("google oauth url returns clear config error when oauth env is missing", async () => {
  const prevClientId = process.env["GOOGLE_CLIENT_ID"];
  const prevTurnstileEnabled = process.env["TURNSTILE_ENABLED"];
  process.env["TURNSTILE_ENABLED"] = "false";
  delete process.env["GOOGLE_CLIENT_ID"];
  const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }], { save: (cb?: (err?: unknown) => void) => cb?.() });

  try {
    const response = await requestJson(app, "POST", "/api/auth/google/url", {}, { origin: "http://localhost:5173" });
    assert.equal(response.status, 500);
    assert.equal(response.body?.code, "OAUTH_CONFIG_MISSING");
  } finally {
    if (prevClientId === undefined) delete process.env["GOOGLE_CLIENT_ID"];
    else process.env["GOOGLE_CLIENT_ID"] = prevClientId;
    if (prevTurnstileEnabled === undefined) delete process.env["TURNSTILE_ENABLED"];
    else process.env["TURNSTILE_ENABLED"] = prevTurnstileEnabled;
  }
});

test("google oauth url rejects disallowed origins with explicit error code", async () => {
  const prevTurnstileEnabled = process.env["TURNSTILE_ENABLED"];
  process.env["TURNSTILE_ENABLED"] = "false";
  const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }], { save: (cb?: (err?: unknown) => void) => cb?.() });

  try {
    const response = await requestJson(app, "POST", "/api/auth/google/url", {}, { origin: "http://evil.example" });
    assert.equal(response.status, 400);
    assert.equal(response.body?.code, "ORIGIN_NOT_ALLOWED");
  } finally {
    if (prevTurnstileEnabled === undefined) delete process.env["TURNSTILE_ENABLED"];
    else process.env["TURNSTILE_ENABLED"] = prevTurnstileEnabled;
  }
});
