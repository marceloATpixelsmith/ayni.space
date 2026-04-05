import { randomUUID } from "crypto";
import type { Request, Response } from "express";

const AUTH_DEBUG_ENABLED = process.env["AUTH_DEBUG"] === "true";
const PREFIX = "[AUTH-DEBUG]";

function serializeValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") {
    if (!value) return '""';
    return /\s/.test(value) ? JSON.stringify(value) : value;
  }
  return JSON.stringify(value);
}

function resolveRequestFlowId(req: Request): string | null {
  const headerFlowId = typeof req.headers["x-auth-flow-id"] === "string" ? req.headers["x-auth-flow-id"].trim() : "";
  if (headerFlowId) return headerFlowId;
  if (typeof req.session?.authFlowId === "string" && req.session.authFlowId.trim()) {
    return req.session.authFlowId.trim();
  }
  if (typeof req.correlationId === "string" && req.correlationId.trim()) {
    return req.correlationId.trim();
  }
  return null;
}

export function ensureAuthFlowId(req: Request): string {
  const existing = resolveRequestFlowId(req);
  if (existing) {
    if (!req.session.authFlowId) req.session.authFlowId = existing;
    return existing;
  }
  const generated = randomUUID();
  req.session.authFlowId = generated;
  return generated;
}

export function authDebugEnabled() {
  return AUTH_DEBUG_ENABLED;
}

export function logAuthDebug(req: Request, event: string, fields: Record<string, unknown> = {}) {
  if (!AUTH_DEBUG_ENABLED) return;
  const flowId = ensureAuthFlowId(req);
  const line = [
    `${PREFIX} layer=backend`,
    `event=${event}`,
    `flowId=${flowId}`,
    ...Object.entries(fields).map(([key, value]) => `${key}=${serializeValue(value)}`),
  ].join(" ");
  console.info(line);
}

function unwrapSignedCookieValue(cookieValue: string): string {
  if (!cookieValue) return "";
  const decoded = (() => {
    try {
      return decodeURIComponent(cookieValue);
    } catch {
      return cookieValue;
    }
  })();
  return decoded.startsWith("s:") ? decoded.slice(2) : decoded;
}

export function toVisibleSessionId(cookieValue: string | null | undefined): string | null {
  if (!cookieValue) return null;
  const unsignedValue = unwrapSignedCookieValue(cookieValue.trim());
  if (!unsignedValue) return null;
  const signatureSeparatorIndex = unsignedValue.lastIndexOf(".");
  if (signatureSeparatorIndex <= 0) {
    return unsignedValue;
  }
  return unsignedValue.slice(0, signatureSeparatorIndex);
}

export function getRequestCookieValue(req: Request, cookieName: string): string | null {
  const rawCookieHeader = req.headers["cookie"];
  if (typeof rawCookieHeader !== "string" || rawCookieHeader.trim().length === 0) {
    return null;
  }

  const entries = rawCookieHeader.split(";");
  for (const entry of entries) {
    const [rawName, ...rawValueParts] = entry.split("=");
    if (rawName?.trim() !== cookieName) continue;
    const value = rawValueParts.join("=").trim();
    return value || null;
  }
  return null;
}

export function getSetCookieValueForName(res: Response, cookieName: string): string | null {
  const setCookieHeader = res.getHeader("set-cookie");
  const setCookieValues = Array.isArray(setCookieHeader)
    ? setCookieHeader.map((value) => String(value))
    : typeof setCookieHeader === "string"
      ? [setCookieHeader]
      : [];

  for (const cookie of setCookieValues) {
    const [nameValue] = cookie.split(";", 1);
    const [rawName, ...rawValueParts] = nameValue.split("=");
    if (rawName?.trim() !== cookieName) continue;
    const cookieValue = rawValueParts.join("=").trim();
    return cookieValue || null;
  }
  return null;
}
