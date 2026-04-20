import { isAuthDebugEnabledRuntime } from "./runtimeSettings";
const PREFIX = "[AUTH-DEBUG]";
const FLOW_STORAGE_KEY = "auth:flow-id";
const LAST_EVENT_KEY = "auth:last-event";

function serializeValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") return /\s/.test(value) ? JSON.stringify(value) : value || '""';
  return JSON.stringify(value);
}

export function isAuthDebugEnabled() {
  return isAuthDebugEnabledRuntime();
}

export function getAuthFlowId(): string {
  const existing = window.sessionStorage.getItem(FLOW_STORAGE_KEY);
  if (existing) return existing;
  const generated = crypto.randomUUID();
  window.sessionStorage.setItem(FLOW_STORAGE_KEY, generated);
  return generated;
}

export function beginAuthDebugFlow(reason: string): string {
  const flowId = crypto.randomUUID();
  window.sessionStorage.setItem(FLOW_STORAGE_KEY, flowId);
  if (isAuthDebugEnabledRuntime()) {
    logAuthDebug("flow_started", { reason, flowId });
  }
  return flowId;
}

export function logAuthDebug(event: string, fields: Record<string, unknown> = {}) {
  if (!isAuthDebugEnabledRuntime()) return;
  const flowId = getAuthFlowId();
  const line = [
    `${PREFIX} layer=frontend`,
    `event=${event}`,
    `flowId=${flowId}`,
    ...Object.entries(fields).map(([key, value]) => `${key}=${serializeValue(value)}`),
  ].join(" ");
  window.sessionStorage.setItem(LAST_EVENT_KEY, JSON.stringify({ event, flowId, ts: Date.now(), fields }));
  console.info(line);
}

export function getLastAuthDebugEventSummary(): string | null {
  return window.sessionStorage.getItem(LAST_EVENT_KEY);
}
