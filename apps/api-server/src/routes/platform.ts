import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { appSettingsTable, appsTable, db, settingValueTypeEnumValues } from "@workspace/db";
import { requireSuperAdmin } from "../middlewares/requireAuth.js";
import {
  APP_RUNTIME_SETTING_DEFINITIONS,
  GLOBAL_RUNTIME_SETTING_DEFINITIONS,
  OPERATOR_EDITABLE_APP_RUNTIME_SETTING_KEYS,
  OPERATOR_EDITABLE_GLOBAL_RUNTIME_SETTING_KEYS,
  getAllSettings,
  updateAppSetting,
  updateSetting,
} from "../lib/settings.js";
import { writeAuditLog } from "../lib/audit.js";

const router: IRouter = Router();
router.use(requireSuperAdmin);

type SettingValueType = (typeof settingValueTypeEnumValues)[number];
const VALUE_TYPES = new Set<SettingValueType>(settingValueTypeEnumValues);
const GLOBAL_KEYS = new Set<string>(OPERATOR_EDITABLE_GLOBAL_RUNTIME_SETTING_KEYS);
const APP_KEYS = new Set<string>(OPERATOR_EDITABLE_APP_RUNTIME_SETTING_KEYS);

type ParsedMutation = {
  valueType: SettingValueType;
  value: unknown;
  description: string | null;
};

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSettingMutation(payload: unknown): ParsedMutation | null {
  if (!isObject(payload)) return null;
  const valueType = asString(payload["valueType"]);
  if (!valueType || !VALUE_TYPES.has(valueType as SettingValueType)) return null;
  return {
    valueType: valueType as SettingValueType,
    value: payload["value"],
    description: typeof payload["description"] === "string" ? payload["description"] : null,
  };
}

async function getActiveAppById(appId: string) {
  return db.query.appsTable.findFirst({ where: and(eq(appsTable.id, appId), eq(appsTable.isActive, true)) });
}

router.get("/settings", async (_req, res) => {
  const [all, apps] = await Promise.all([
    getAllSettings(),
    db.query.appsTable.findMany({ where: eq(appsTable.isActive, true) }),
  ]);

  res.json({
    ...all,
    apps: apps.map((app: { id: string; slug: string; name: string; domain: string; baseUrl: string | null; turnstileSiteKeyOverride: string | null }) => ({
      id: app.id,
      slug: app.slug,
      name: app.name,
      domain: app.domain,
      baseUrl: app.baseUrl,
      turnstileSiteKeyOverride: app.turnstileSiteKeyOverride,
    })),
    editableKeyRegistry: {
      global: GLOBAL_RUNTIME_SETTING_DEFINITIONS,
      app: APP_RUNTIME_SETTING_DEFINITIONS,
    },
  });
});

router.patch("/settings", async (req, res) => {
  const key = asString(req.body?.key);
  const parsed = parseSettingMutation(req.body);
  if (!key || !parsed) {
    res.status(400).json({ error: "key and valueType are required" });
    return;
  }
  if (!GLOBAL_KEYS.has(key)) {
    res.status(400).json({ error: "Unsupported global runtime setting key" });
    return;
  }

  const setting = await updateSetting({
    key,
    value: parsed.value,
    valueType: parsed.valueType,
    description: parsed.description,
    updatedBy: req.session.userId ?? null,
  });

  await writeAuditLog({
    req,
    userId: req.session.userId,
    action: "platform.setting.update",
    resourceType: "setting",
    resourceId: setting?.id,
    metadata: { key, valueType: parsed.valueType },
  });

  res.json({ setting });
});

router.get("/apps/:id/settings", async (req, res) => {
  const appId = asString(req.params["id"]);
  if (!appId) {
    res.status(400).json({ error: "id is required" });
    return;
  }

  const app = await getActiveAppById(appId);
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }

  const appSettings = await db.select({
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
  }).from(appSettingsTable).innerJoin(appsTable, eq(appSettingsTable.appId, appsTable.id)).where(eq(appSettingsTable.appId, appId));

  res.json({
    app: {
      id: app.id,
      slug: app.slug,
      name: app.name,
      domain: app.domain,
      baseUrl: app.baseUrl,
      turnstileSiteKeyOverride: app.turnstileSiteKeyOverride,
    },
    appSettings,
  });
});

router.patch("/apps/:id/settings", async (req, res) => {
  const appId = asString(req.params["id"]);
  const key = asString(req.body?.key);
  const parsed = parseSettingMutation(req.body);

  if (!appId || !key || !parsed) {
    res.status(400).json({ error: "app id, key and valueType are required" });
    return;
  }
  if (!APP_KEYS.has(key)) {
    res.status(400).json({ error: "Unsupported app runtime setting key" });
    return;
  }

  const app = await getActiveAppById(appId);
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }

  const setting = await updateAppSetting({
    appId,
    key,
    value: parsed.value,
    valueType: parsed.valueType,
    description: parsed.description,
    updatedBy: req.session.userId ?? null,
  });

  await writeAuditLog({
    req,
    userId: req.session.userId,
    action: "platform.app_setting.update",
    resourceType: "app_setting",
    resourceId: setting?.id,
    metadata: { appId, key, valueType: parsed.valueType },
  });

  res.json({ setting });
});

export default router;
