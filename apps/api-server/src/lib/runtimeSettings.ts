import { eq } from "drizzle-orm";
import { appSettingsTable, appsTable, db } from "@workspace/db";
import {
  APP_SETTING_KEYS,
  GLOBAL_SETTING_KEYS,
  getAllowedOriginsSnapshot,
  getAppSetting,
  getAppSettingBySlug,
  getEffectiveAllowedOrigins,
  getGlobalSettingSnapshot,
  getGlobalSettingValues,
  getMfaIssuerForAppSlug,
  getSetting,
  refreshSettingsCache,
  type ParsedSettingValue,
} from "./settings.js";

export {
  APP_SETTING_KEYS,
  GLOBAL_SETTING_KEYS,
  getAllowedOriginsSnapshot,
  getAppSetting,
  getAppSettingBySlug,
  getEffectiveAllowedOrigins,
  getGlobalSettingSnapshot,
  getGlobalSettingValues,
  getMfaIssuerForAppSlug,
  getSetting,
};
export type { ParsedSettingValue };

export async function refreshRuntimeCache(options: { force?: boolean } = {}) {
  return refreshSettingsCache(options);
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

  const readString = async (key: string, fallback: string): Promise<string> => {
    const value = await getAppSetting(app.id, key, fallback);
    return typeof value === "string" && value.trim() ? value : fallback;
  };

  const readNullableString = async (key: string, fallback: string | null): Promise<string | null> => {
    const value = await getAppSetting(app.id, key, fallback ?? "");
    if (typeof value === "string" && value.trim()) return value;
    return fallback;
  };

  const readBoolean = async (key: string, fallback: boolean): Promise<boolean> => {
    const value = await getAppSetting(app.id, key, fallback);
    if (typeof value === "boolean") return value;
    if (typeof value === "string") return value.trim().toLowerCase() === "true";
    return fallback;
  };

  return {
    appSlug: await readString(APP_SETTING_KEYS.VITE_APP_SLUG, app.slug),
    apiBaseUrl: await readString(APP_SETTING_KEYS.VITE_API_BASE_URL, ""),
    basePath: await readString(APP_SETTING_KEYS.BASE_PATH, "/"),
    authDebug: await readBoolean(APP_SETTING_KEYS.VITE_AUTH_DEBUG, false),
    sentryEnvironment: await readString(
      APP_SETTING_KEYS.VITE_SENTRY_ENVIRONMENT,
      String(getGlobalSettingSnapshot<string>(GLOBAL_SETTING_KEYS.SENTRY_ENVIRONMENT, process.env["SENTRY_ENVIRONMENT"] ?? process.env["NODE_ENV"] ?? "development")),
    ),
    sentryDsn: await readNullableString(
      APP_SETTING_KEYS.VITE_SENTRY_DSN,
      String(getGlobalSettingSnapshot<string>(GLOBAL_SETTING_KEYS.SENTRY_DSN, process.env["SENTRY_DSN"] ?? "")).trim() || null,
    ),
    turnstileSiteKey: await readNullableString(APP_SETTING_KEYS.VITE_TURNSTILE_SITE_KEY, null),
  };
}

export async function listGlobalSettings() {
  const rows = await db.query.settingsTable.findMany();
  return rows.map((row: any) => ({ ...row, parsedValue: row.value }));
}

export async function listAppSettings() {
  return db.select({
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
}
