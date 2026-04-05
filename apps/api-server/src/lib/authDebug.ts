import { randomUUID } from "crypto";
import type { Request } from "express";

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
