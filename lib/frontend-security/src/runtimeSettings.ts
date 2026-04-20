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

function parseString(value: string | undefined, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

let state: FrontendRuntimeSettings = {
  apiBaseUrl: parseString(env.VITE_API_BASE_URL, ""),
  appSlug: parseString(env.VITE_APP_SLUG, "admin"),
  basePath: parseString(env.BASE_PATH, "/"),
  authDebug: false,
  sentryEnvironment: env.MODE ?? "development",
  sentryDsn: null,
  turnstileSiteKey: null,
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
