import test from "node:test";
import assert from "node:assert/strict";

import { customFetch } from "./custom-fetch.js";

test("customFetch sends credentialed requests by default and emits auth-client trace", async () => {
  const capturedLogs: string[] = [];
  const originalLog = console.log;
  const originalFetch = globalThis.fetch;

  try {
    console.log = ((...args: unknown[]) => {
      capturedLogs.push(String(args[0] ?? ""));
    }) as typeof console.log;

    let capturedCredentials: RequestCredentials | undefined;
    let capturedUrl = "";

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      capturedCredentials = init?.credentials;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    }) as typeof fetch;

    const payload = await customFetch<{ ok: boolean }>("/api/auth/me", { method: "GET", responseType: "json" });
    assert.deepEqual(payload, { ok: true });
    assert.equal(capturedUrl, "/api/auth/me");
    assert.equal(capturedCredentials, "include");
    assert.ok(capturedLogs.some((line) => line.includes("[AUTH-CHECK-TRACE] AUTH CLIENT REQUEST path=/api/auth/me credentialsMode=include")));
  } finally {
    console.log = originalLog;
    globalThis.fetch = originalFetch;
  }
});

test("customFetch keeps auth/session requests credentialed even if request options omit credentials", async () => {
  const originalFetch = globalThis.fetch;
  let capturedCredentials: RequestCredentials | undefined;

  try {
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedCredentials = init?.credentials;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    }) as typeof fetch;

    await customFetch<{ ok: boolean }>("/api/auth/me", {
      method: "GET",
      credentials: "omit",
      responseType: "json",
    });
    assert.equal(capturedCredentials, "include");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
