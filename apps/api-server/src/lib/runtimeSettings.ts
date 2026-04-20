import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { appSettingsTable, appsTable, db, settingsTable, type SettingValueType } from "@workspace/db";

export const GLOBAL_SETTING_KEYS = {
  SENTRY_DSN: "SENTRY_DSN",
  SENTRY_ENVIRONMENT: "SENTRY_ENVIRONMENT",
  GOOGLE_REDIRECT_URI: "GOOGLE_REDIRECT_URI",
  TURNSTILE_ENABLED: "TURNSTILE_ENABLED",
  IPQS_BLOCK_THRESHOLD: "IPQS_BLOCK_THRESHOLD",
  IPQS_STEP_UP_THRESHOLD: "IPQS_STEP_UP_THRESHOLD",
  IPQS_TIMEOUT_MS: "IPQS_TIMEOUT_MS",
  OPENAI_MAX_RETRIES: "OPENAI_MAX_RETRIES",
  OPENAI_MODEL: "OPENAI_MODEL",
  OPENAI_TEMPERATURE: "OPENAI_TEMPERATURE",
  OPENAI_TIMEOUT_MS: "OPENAI_TIMEOUT_MS",
} as const;

export const APP_SETTING_KEYS = {
  ALLOWED_ORIGINS: "ALLOWED_ORIGINS",
  MFA_ISSUER: "MFA_ISSUER",
  VITE_AUTH_DEBUG: "VITE_AUTH_DEBUG",
  VITE_SENTRY_ENVIRONMENT: "VITE_SENTRY_ENVIRONMENT",
  VITE_SENTRY_DSN: "VITE_SENTRY_DSN",
  BASE_PATH: "BASE_PATH",
  VITE_API_BASE_URL: "VITE_API_BASE_URL",
  VITE_APP_SLUG: "VITE_APP_SLUG",
  VITE_TURNSTILE_SITE_KEY: "VITE_TURNSTILE_SITE_KEY",
} as const;

export type ParsedSettingValue = string | number | boolean | Record<string, unknown> | unknown[];

type CachedRuntime = {
  loadedAtMs: number;
  allowedOrigins: string[];
  appIssuersBySlug: Record<string, string>;
  globalSettings: Record<string, ParsedSettingValue>;
};

function parseCsv(value: string | undefined): string[] {
  return (value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
}

const FALLBACK_RUNTIME: CachedRuntime = {
  loadedAtMs: 0,
  allowedOrigins: parseCsv(process.env["ALLOWED_ORIGINS"]),
  appIssuersBySlug: {},
  globalSettings: {},
};

let cachedRuntime = FALLBACK_RUNTIME;
let inFlightRefresh: Promise<void> | null = null;

function parseSettingValue(value: string, valueType: SettingValueType): ParsedSettingValue {
  if (valueType === "number") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (valueType === "boolean") return value.trim().toLowerCase() === "true";
  if (valueType === "json") {
    try {
      return JSON.parse(value) as ParsedSettingValue;
    } catch {
      return {};
    }
  }
  return value;
}

function serializeSettingValue(value: unknown, valueType: SettingValueType): string {
  if (valueType === "json") return JSON.stringify(value ?? {});
  if (valueType === "boolean") return value === true ? "true" : "false";
  if (valueType === "number") {
    const num = Number(value);
    if (!Number.isFinite(num)) throw new Error("Numeric setting requires a finite number");
    return String(num);
  }
  return String(value ?? "");
}

export function getGlobalSettingSnapshot<T extends ParsedSettingValue>(key: string, fallback: T): T {
  const cached = cachedRuntime.globalSettings[key];
  if (cached !== undefined) return cached as T;
  const fromEnv = process.env[key];
  if (fromEnv === undefined) return fallback;
  if (typeof fallback === "boolean") return (fromEnv.trim().toLowerCase() === "true") as T;
  if (typeof fallback === "number") {
    const parsed = Number(fromEnv);
    return (Number.isFinite(parsed) ? parsed : fallback) as T;
  }
  return fromEnv as T;
}

export async function listGlobalSettings() {
  const rows = await db.query.settingsTable.findMany();
  return rows.map((row: any) => ({ ...row, parsedValue: parseSettingValue(row.value, row.valueType) }));
}

export async function listAppSettings() {
  const rows = await db.select({
    id: appSettingsTable.id,
    appId: appSettingsTable.appId,
    appSlug: appsTable.slug,
    key: appSettingsTable.key,
    value: appSettingsTable.value,
    valueType: appSettingsTable.valueType,
    description: appSettingsTable.description,
    updatedBy: appSettingsTable.updatedBy,
    createdAt: appSettingsTable.createdAt,
    updatedAt: appSettingsTable.updatedAt,
  }).from(appSettingsTable).innerJoin(appsTable, eq(appSettingsTable.appId, appsTable.id));

  return rows.map((row: any) => ({ ...row, parsedValue: parseSettingValue(row.value, row.valueType) }));
}

export async function upsertGlobalSetting(params: { key: string; value: unknown; valueType: SettingValueType; description?: string | null; updatedBy?: string | null; }) {
  const serializedValue = serializeSettingValue(params.value, params.valueType);
  const existing = await db.query.settingsTable.findFirst({ where: eq(settingsTable.key, params.key) });
  const row = existing
    ? (await db.update(settingsTable).set({ value: serializedValue, valueType: params.valueType, description: params.description ?? null, updatedBy: params.updatedBy ?? null, updatedAt: new Date() }).where(eq(settingsTable.id, existing.id)).returning())[0]
    : (await db.insert(settingsTable).values({ id: randomUUID(), key: params.key, value: serializedValue, valueType: params.valueType, description: params.description ?? null, updatedBy: params.updatedBy ?? null }).returning())[0];
  await refreshRuntimeCache({ force: true });
  return row;
}

export async function upsertAppSetting(params: { appId: string; key: string; value: unknown; valueType: SettingValueType; description?: string | null; updatedBy?: string | null; }) {
  const serializedValue = serializeSettingValue(params.value, params.valueType);
  const existing = await db.query.appSettingsTable.findFirst({ where: and(eq(appSettingsTable.appId, params.appId), eq(appSettingsTable.key, params.key)) });
  const row = existing
    ? (await db.update(appSettingsTable).set({ value: serializedValue, valueType: params.valueType, description: params.description ?? null, updatedBy: params.updatedBy ?? null, updatedAt: new Date() }).where(eq(appSettingsTable.id, existing.id)).returning())[0]
    : (await db.insert(appSettingsTable).values({ id: randomUUID(), appId: params.appId, key: params.key, value: serializedValue, valueType: params.valueType, description: params.description ?? null, updatedBy: params.updatedBy ?? null }).returning())[0];
  await refreshRuntimeCache({ force: true });
  return row;
}

export async function getGlobalSettingValue<T extends ParsedSettingValue>(key: string, fallback: T): Promise<T> {
  const row = await db.query.settingsTable.findFirst({ where: eq(settingsTable.key, key) });
  if (!row) return fallback;
  return parseSettingValue(row.value, row.valueType) as T;
}

export async function getGlobalSettingValues(keys: string[]) {
  if (keys.length === 0) return new Map<string, ParsedSettingValue>();
  const rows = await db.query.settingsTable.findMany({ where: inArray(settingsTable.key, keys) });
  const parsed = new Map<string, ParsedSettingValue>();
  for (const row of rows as any[]) parsed.set(row.key, parseSettingValue(row.value, row.valueType));
  return parsed;
}

export async function getAppSettingValueBySlug<T extends ParsedSettingValue>(appSlug: string, key: string, fallback: T): Promise<T> {
  const row = await db.select({ value: appSettingsTable.value, valueType: appSettingsTable.valueType })
    .from(appSettingsTable)
    .innerJoin(appsTable, eq(appSettingsTable.appId, appsTable.id))
    .where(and(eq(appsTable.slug, appSlug), eq(appSettingsTable.key, key)))
    .limit(1);
  if (!row[0]) return fallback;
  return parseSettingValue(row[0].value, row[0].valueType) as T;
}

export async function refreshRuntimeCache(options: { force?: boolean } = {}) {
  if (!options.force && inFlightRefresh) return inFlightRefresh;
  const now = Date.now();
  if (!options.force && now - cachedRuntime.loadedAtMs < 15_000) return;

  inFlightRefresh = (async () => {
    const [globalRows, allowedOriginRows, issuerRows] = await Promise.all([
      db.query.settingsTable.findMany(),
      db.select({ value: appSettingsTable.value }).from(appSettingsTable).where(eq(appSettingsTable.key, APP_SETTING_KEYS.ALLOWED_ORIGINS)),
      db.select({ appSlug: appsTable.slug, value: appSettingsTable.value }).from(appSettingsTable).innerJoin(appsTable, eq(appSettingsTable.appId, appsTable.id)).where(eq(appSettingsTable.key, APP_SETTING_KEYS.MFA_ISSUER)),
    ]);

    cachedRuntime = {
      loadedAtMs: Date.now(),
      allowedOrigins: Array.from(new Set(allowedOriginRows.map((row: any) => row.value.trim()).filter(Boolean))),
      appIssuersBySlug: Object.fromEntries(issuerRows.map((row: any) => [row.appSlug, row.value])),
      globalSettings: Object.fromEntries(globalRows.map((row: any) => [row.key, parseSettingValue(row.value, row.valueType)])),
    };
  })().finally(() => {
    inFlightRefresh = null;
  });

  return inFlightRefresh;
}

export function getAllowedOriginsSnapshot(): string[] {
  return cachedRuntime.allowedOrigins.length > 0 ? cachedRuntime.allowedOrigins : parseCsv(process.env["ALLOWED_ORIGINS"]);
}

export async function getEffectiveAllowedOrigins(): Promise<string[]> {
  await refreshRuntimeCache();
  return getAllowedOriginsSnapshot();
}

export async function getMfaIssuerForAppSlug(appSlug: string | null | undefined, fallback: string): Promise<string> {
  if (!appSlug) return fallback;
  await refreshRuntimeCache();
  return cachedRuntime.appIssuersBySlug[appSlug] ?? fallback;
}

export type FrontendRuntimeSettings = {
  appSlug: string;
  apiBaseUrl: string;
  basePath: string;
  authDebug: boolean;
  sentryEnvironment: string;
  sentryDsn: string | null;
  turnstileSiteKey: string | null;
};

export async function getFrontendRuntimeSettingsForApp(appSlug: string): Promise<FrontendRuntimeSettings | null> {
  const app = await db.query.appsTable.findFirst({ where: eq(appsTable.slug, appSlug) });
  if (!app) return null;

  const rows = await db.select({
    key: appSettingsTable.key,
    value: appSettingsTable.value,
    valueType: appSettingsTable.valueType,
  }).from(appSettingsTable).innerJoin(appsTable, eq(appSettingsTable.appId, appsTable.id)).where(eq(appsTable.slug, appSlug));

  const byKey = new Map<string, ParsedSettingValue>();
  for (const row of rows) {
    byKey.set(row.key, parseSettingValue(row.value, row.valueType));
  }

  const readString = (key: string, fallback: string): string => {
    const value = byKey.get(key);
    if (typeof value === "string" && value.trim()) return value;
    return fallback;
  };

  const readNullableString = (key: string, fallback: string | null): string | null => {
    const value = byKey.get(key);
    if (typeof value === "string" && value.trim()) return value;
    return fallback;
  };

  const readBoolean = (key: string, fallback: boolean): boolean => {
    const value = byKey.get(key);
    if (typeof value === "boolean") return value;
    if (typeof value === "string") return value.trim().toLowerCase() === "true";
    return fallback;
  };

  return {
    appSlug: readString(APP_SETTING_KEYS.VITE_APP_SLUG, app.slug),
    apiBaseUrl: readString(APP_SETTING_KEYS.VITE_API_BASE_URL, ""),
    basePath: readString(APP_SETTING_KEYS.BASE_PATH, "/"),
    authDebug: readBoolean(APP_SETTING_KEYS.VITE_AUTH_DEBUG, false),
    sentryEnvironment: readString(
      APP_SETTING_KEYS.VITE_SENTRY_ENVIRONMENT,
      String(getGlobalSettingSnapshot<string>(
        GLOBAL_SETTING_KEYS.SENTRY_ENVIRONMENT,
        process.env["SENTRY_ENVIRONMENT"] ?? process.env["NODE_ENV"] ?? "development",
      )),
    ),
    sentryDsn: readNullableString(
      APP_SETTING_KEYS.VITE_SENTRY_DSN,
      String(getGlobalSettingSnapshot<string>(GLOBAL_SETTING_KEYS.SENTRY_DSN, process.env["SENTRY_DSN"] ?? "")).trim() || null,
    ),
    turnstileSiteKey: readNullableString(APP_SETTING_KEYS.VITE_TURNSTILE_SITE_KEY, null),
  };
}
