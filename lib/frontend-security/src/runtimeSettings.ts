import React from "react";

export type FrontendRuntimeSettings = {
  apiBaseUrl: string;
  appSlug: string;
  basePath: string;
  authDebug: boolean;
  sentryEnvironment: string;
  sentryDsn: string | null;
  turnstileSiteKey: string | null;
};

type FrontendRuntimeSettingsPatch = Partial<FrontendRuntimeSettings>;

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (typeof value !== "string") return fallback;
  return value.trim().toLowerCase() === "true";
}

function parseString(value: string | undefined, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function parseNullableString(value: string | undefined, fallback: string | null) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed : fallback;
}

let state: FrontendRuntimeSettings = {
  apiBaseUrl: parseString(env.VITE_API_BASE_URL, ""),
  appSlug: parseString(env.VITE_APP_SLUG, "admin"),
  basePath: parseString(env.BASE_PATH, "/"),
  authDebug: parseBoolean(env.VITE_AUTH_DEBUG, false),
  sentryEnvironment: parseString(env.VITE_SENTRY_ENVIRONMENT, env.MODE ?? "development"),
  sentryDsn: parseNullableString(env.VITE_SENTRY_DSN, null),
  turnstileSiteKey: parseNullableString(env.VITE_TURNSTILE_SITE_KEY, null),
};

const subscribers = new Set<() => void>();

function emit() {
  for (const subscriber of subscribers) {
    subscriber();
  }
}

export function getFrontendRuntimeSettings() {
  return state;
}

export function getBootstrapAppSlug() {
  return state.appSlug;
}

export function applyFrontendRuntimeSettings(patch: FrontendRuntimeSettingsPatch) {
  state = {
    ...state,
    ...patch,
  };
  emit();
}

export function subscribeFrontendRuntimeSettings(callback: () => void) {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

export function useFrontendRuntimeSettings() {
  return React.useSyncExternalStore(
    subscribeFrontendRuntimeSettings,
    getFrontendRuntimeSettings,
    getFrontendRuntimeSettings,
  );
}

export function isAuthDebugEnabledRuntime() {
  return state.authDebug;
}
