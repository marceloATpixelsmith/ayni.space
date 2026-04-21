import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { appSettingsTable, appsTable, db, settingsTable, type SettingValueType } from "@workspace/db";

export const GLOBAL_SETTING_KEYS = {
  SENTRY_DSN: "SENTRY_DSN",
  SENTRY_ENVIRONMENT: "SENTRY_ENVIRONMENT",
  GOOGLE_REDIRECT_URI: "GOOGLE_REDIRECT_URI",
  TURNSTILE_ENABLED: "TURNSTILE_ENABLED",
  RATE_LIMIT_ENABLED: "RATE_LIMIT_ENABLED",
  RATE_LIMIT_WINDOW_MS: "RATE_LIMIT_WINDOW_MS",
  RATE_LIMIT_MAX: "RATE_LIMIT_MAX",
  AUTH_RATE_LIMIT_MAX: "AUTH_RATE_LIMIT_MAX",
  IPQS_BLOCK_THRESHOLD: "IPQS_BLOCK_THRESHOLD",
  IPQS_STEP_UP_THRESHOLD: "IPQS_STEP_UP_THRESHOLD",
  IPQS_TIMEOUT_MS: "IPQS_TIMEOUT_MS",
  OPENAI_MAX_RETRIES: "OPENAI_MAX_RETRIES",
  OPENAI_MODEL: "OPENAI_MODEL",
  OPENAI_TEMPERATURE: "OPENAI_TEMPERATURE",
  OPENAI_TIMEOUT_MS: "OPENAI_TIMEOUT_MS",
} as const;
export const GLOBAL_NON_SECRET_RUNTIME_SETTING_KEYS = Object.values(GLOBAL_SETTING_KEYS);

export const APP_SETTING_KEYS = {
  ALLOWED_ORIGIN: "ALLOWED_ORIGIN",
  MFA_ISSUER: "MFA_ISSUER",
  VITE_AUTH_DEBUG: "VITE_AUTH_DEBUG",
  VITE_SENTRY_ENVIRONMENT: "VITE_SENTRY_ENVIRONMENT",
  VITE_SENTRY_DSN: "VITE_SENTRY_DSN",
  BASE_PATH: "BASE_PATH",
  VITE_API_BASE_URL: "VITE_API_BASE_URL",
  VITE_APP_SLUG: "VITE_APP_SLUG",
  VITE_TURNSTILE_SITE_KEY: "VITE_TURNSTILE_SITE_KEY",
} as const;
export const APP_NON_SECRET_RUNTIME_SETTING_KEYS = Object.values(APP_SETTING_KEYS);
const LEGACY_ALLOWED_ORIGINS_KEY = "ALLOWED_ORIGINS";

export type ParsedSettingValue = string | number | boolean | Record<string, unknown> | unknown[];
type RuntimeCache = {
  loadedAtMs: number;
  globalByKey: Record<string, ParsedSettingValue>;
  appById: Record<string, Record<string, ParsedSettingValue>>;
  appBySlug: Record<string, Record<string, ParsedSettingValue>>;
};

const FALLBACK_CACHE: RuntimeCache = { loadedAtMs: 0, globalByKey: {}, appById: {}, appBySlug: {} };
let cache = FALLBACK_CACHE;
let inFlightRefresh: Promise<void> | null = null;

function parseCsv(value: string | undefined): string[] {
  return (value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
}

export function parseSettingValue(value: string, valueType: SettingValueType): ParsedSettingValue {
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

export function serializeSettingValue(value: unknown, valueType: SettingValueType): string {
  if (valueType === "json") return JSON.stringify(value ?? {});
  if (valueType === "boolean") return value === true ? "true" : "false";
  if (valueType === "number") {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error("Numeric setting requires a finite number");
    return String(parsed);
  }
  return String(value ?? "");
}

export function getGlobalSettingSnapshot<T extends ParsedSettingValue>(key: string, fallback: T): T {
  const fromCache = cache.globalByKey[key];
  if (fromCache !== undefined) return fromCache as T;
  const fromEnv = process.env[key];
  if (fromEnv === undefined) return fallback;
  if (typeof fallback === "boolean") return (fromEnv.trim().toLowerCase() === "true") as T;
  if (typeof fallback === "number") {
    const parsed = Number(fromEnv);
    return (Number.isFinite(parsed) ? parsed : fallback) as T;
  }
  return fromEnv as T;
}

export async function refreshSettingsCache(options: { force?: boolean } = {}) {
  if (!options.force && inFlightRefresh) return inFlightRefresh;
  if (!options.force && Date.now() - cache.loadedAtMs < 15_000) return;

  inFlightRefresh = (async () => {
    const [globalRows, appRows] = await Promise.all([
      db.query.settingsTable.findMany(),
      db.select({
        appId: appSettingsTable.appId,
        appSlug: appsTable.slug,
        key: appSettingsTable.key,
        value: appSettingsTable.value,
        valueType: appSettingsTable.valueType,
      }).from(appSettingsTable).innerJoin(appsTable, eq(appSettingsTable.appId, appsTable.id)),
    ]);

    const appById: RuntimeCache["appById"] = {};
    const appBySlug: RuntimeCache["appBySlug"] = {};
    for (const row of appRows) {
      const parsed = parseSettingValue(row.value, row.valueType);
      appById[row.appId] = appById[row.appId] ?? {};
      appBySlug[row.appSlug] = appBySlug[row.appSlug] ?? {};
      appById[row.appId]![row.key] = parsed;
      appBySlug[row.appSlug]![row.key] = parsed;
    }

    cache = {
      loadedAtMs: Date.now(),
      globalByKey: Object.fromEntries(globalRows.map((row: any) => [row.key, parseSettingValue(row.value, row.valueType)])),
      appById,
      appBySlug,
    };
  })().catch(() => {
    // fail safe: keep previous cache
  }).finally(() => {
    inFlightRefresh = null;
  });

  return inFlightRefresh;
}

export async function getSetting<T extends ParsedSettingValue>(key: string, fallback: T): Promise<T> {
  await refreshSettingsCache();
  return getGlobalSettingSnapshot(key, fallback);
}

export async function getAppSetting<T extends ParsedSettingValue>(appId: string, key: string, fallback: T): Promise<T> {
  await refreshSettingsCache();
  const value = cache.appById[appId]?.[key];
  if (value !== undefined) return value as T;
  return fallback;
}

export async function getAppSettingBySlug<T extends ParsedSettingValue>(slug: string, key: string, fallback: T): Promise<T> {
  await refreshSettingsCache();
  const value = cache.appBySlug[slug]?.[key];
  if (value !== undefined) return value as T;
  return fallback;
}

export async function getAllSettings() {
  const [globalSettings, appSettings] = await Promise.all([
    db.query.settingsTable.findMany(),
    db.select({
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
    }).from(appSettingsTable).innerJoin(appsTable, eq(appSettingsTable.appId, appsTable.id)),
  ]);
  return {
    globalSettings: globalSettings.map((row: any) => ({ ...row, parsedValue: parseSettingValue(row.value, row.valueType) })),
    appSettings: appSettings.map((row: any) => ({ ...row, parsedValue: parseSettingValue(row.value, row.valueType) })),
  };
}

export async function updateSetting(params: { key: string; value: unknown; valueType: SettingValueType; description?: string | null; updatedBy?: string | null; }) {
  const serializedValue = serializeSettingValue(params.value, params.valueType);
  const existing = await db.query.settingsTable.findFirst({ where: eq(settingsTable.key, params.key) });
  const row = existing
    ? (await db.update(settingsTable).set({ value: serializedValue, valueType: params.valueType, description: params.description ?? null, updatedBy: params.updatedBy ?? null, updatedAt: new Date() }).where(eq(settingsTable.id, existing.id)).returning())[0]
    : (await db.insert(settingsTable).values({ id: randomUUID(), key: params.key, value: serializedValue, valueType: params.valueType, description: params.description ?? null, updatedBy: params.updatedBy ?? null }).returning())[0];
  await refreshSettingsCache({ force: true });
  return row;
}

export async function updateAppSetting(params: { appId: string; key: string; value: unknown; valueType: SettingValueType; description?: string | null; updatedBy?: string | null; }) {
  const serializedValue = serializeSettingValue(params.value, params.valueType);
  const existing = await db.query.appSettingsTable.findFirst({ where: and(eq(appSettingsTable.appId, params.appId), eq(appSettingsTable.key, params.key)) });
  const row = existing
    ? (await db.update(appSettingsTable).set({ value: serializedValue, valueType: params.valueType, description: params.description ?? null, updatedBy: params.updatedBy ?? null, updatedAt: new Date() }).where(eq(appSettingsTable.id, existing.id)).returning())[0]
    : (await db.insert(appSettingsTable).values({ id: randomUUID(), appId: params.appId, key: params.key, value: serializedValue, valueType: params.valueType, description: params.description ?? null, updatedBy: params.updatedBy ?? null }).returning())[0];
  await refreshSettingsCache({ force: true });
  return row;
}

export async function getGlobalSettingValues(keys: string[]) {
  if (keys.length === 0) return new Map<string, ParsedSettingValue>();
  const rows = await db.query.settingsTable.findMany({ where: inArray(settingsTable.key, keys) });
  return new Map(rows.map((row: any) => [row.key, parseSettingValue(row.value, row.valueType)]));
}

export async function getEffectiveAllowedOrigins(): Promise<string[]> {
  await refreshSettingsCache();
  const canonicalOrigins = Object.values(cache.appById).flatMap((byKey) => {
    const single = byKey[APP_SETTING_KEYS.ALLOWED_ORIGIN];
    if (typeof single === "string" && single.trim()) return [single.trim()];
    return [];
  });

  const dedupedCanonical = Array.from(new Set(canonicalOrigins));
  if (dedupedCanonical.length > 0) return dedupedCanonical;

  const legacyOrigins = Object.values(cache.appById).flatMap((byKey) => {
    const legacyPlural = byKey[LEGACY_ALLOWED_ORIGINS_KEY];
    if (typeof legacyPlural === "string" && legacyPlural.trim()) return parseCsv(legacyPlural);
    return [];
  });
  const dedupedLegacy = Array.from(new Set(legacyOrigins));
  if (dedupedLegacy.length > 0) return dedupedLegacy;

  return parseCsv(process.env["ALLOWED_ORIGINS"]);
}

export function getAllowedOriginsSnapshot(): string[] {
  const fromDb = Object.values(cache.appById).flatMap((byKey) => {
    const single = byKey[APP_SETTING_KEYS.ALLOWED_ORIGIN];
    if (typeof single === "string" && single.trim()) return [single.trim()];
    return [];
  });
  if (fromDb.length > 0) return Array.from(new Set(fromDb));
  return parseCsv(process.env["ALLOWED_ORIGINS"]);
}

export async function getMfaIssuerForAppSlug(appSlug: string | null | undefined, fallback: string): Promise<string> {
  if (!appSlug) return fallback;
  const value = await getAppSettingBySlug<string>(appSlug, APP_SETTING_KEYS.MFA_ISSUER, fallback);
  return typeof value === "string" && value.trim() ? value : fallback;
}
