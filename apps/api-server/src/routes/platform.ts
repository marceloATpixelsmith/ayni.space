import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { appsTable, db, settingValueTypeEnumValues } from "@workspace/db";
import { requireSuperAdmin } from "../middlewares/requireAuth.js";
import {
  APP_NON_SECRET_RUNTIME_SETTING_KEYS,
  GLOBAL_NON_SECRET_RUNTIME_SETTING_KEYS,
  getAllSettings,
  updateAppSetting,
  updateSetting,
} from "../lib/settings.js";
import { writeAuditLog } from "../lib/audit.js";

const router: IRouter = Router();
router.use(requireSuperAdmin);
const VALUE_TYPES = new Set(settingValueTypeEnumValues);
const GLOBAL_KEYS = new Set<string>(GLOBAL_NON_SECRET_RUNTIME_SETTING_KEYS);
const APP_KEYS = new Set<string>(APP_NON_SECRET_RUNTIME_SETTING_KEYS);

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSettingMutation(payload: unknown): { valueType: "string" | "number" | "boolean" | "json"; value: unknown; description: string | null } | null {
  if (!isObject(payload)) return null;
  const valueType = asString(payload["valueType"]) as "string" | "number" | "boolean" | "json" | null;
  if (!valueType || !VALUE_TYPES.has(valueType)) return null;
  return {
    valueType,
    value: payload["value"],
    description: typeof payload["description"] === "string" ? payload["description"] : null,
  };
}

router.get("/settings", async (_req, res) => {
  const [all, apps] = await Promise.all([
    getAllSettings(),
    db.query.appsTable.findMany({ where: eq(appsTable.isActive, true) }),
  ]);
  res.json({
    ...all,
    apps: apps.map((app: { id: string; slug: string; name: string }) => ({ id: app.id, slug: app.slug, name: app.name })),
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
  await writeAuditLog({ req, userId: req.session.userId, action: "platform.setting.update", resourceType: "setting", resourceId: setting?.id, metadata: { key, valueType: parsed.valueType } });
  res.json({ setting });
});

router.get("/apps/:id/settings", async (req, res) => {
  const appId = asString(req.params["id"]);
  if (!appId) {
    res.status(400).json({ error: "id is required" });
    return;
  }
  const all = await getAllSettings();
  res.json({
    appSettings: all.appSettings.filter((row: any) => row.appId === appId),
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
  const setting = await updateAppSetting({
    appId,
    key,
    value: parsed.value,
    valueType: parsed.valueType,
    description: parsed.description,
    updatedBy: req.session.userId ?? null,
  });
  await writeAuditLog({ req, userId: req.session.userId, action: "platform.app_setting.update", resourceType: "app_setting", resourceId: setting?.id, metadata: { appId, key, valueType: parsed.valueType } });
  res.json({ setting });
});

export default router;
