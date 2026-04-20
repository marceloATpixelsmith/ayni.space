import { Router, type IRouter } from "express";
import { requireSuperAdmin } from "../middlewares/requireAuth.js";
import { getAllSettings, updateAppSetting, updateSetting } from "../lib/settings.js";
import { writeAuditLog } from "../lib/audit.js";

const router: IRouter = Router();
router.use(requireSuperAdmin);

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

router.get("/settings", async (_req, res) => {
  const all = await getAllSettings();
  res.json(all);
});

router.patch("/settings", async (req, res) => {
  const key = asString(req.body?.key);
  const valueType = asString(req.body?.valueType) as "string" | "number" | "boolean" | "json" | null;
  if (!key || !valueType) {
    res.status(400).json({ error: "key and valueType are required" });
    return;
  }
  const setting = await updateSetting({
    key,
    value: req.body?.value,
    valueType,
    description: typeof req.body?.description === "string" ? req.body.description : null,
    updatedBy: req.session.userId ?? null,
  });
  await writeAuditLog({ req, userId: req.session.userId, action: "platform.setting.update", resourceType: "setting", resourceId: setting?.id, metadata: { key, valueType } });
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
  const valueType = asString(req.body?.valueType) as "string" | "number" | "boolean" | "json" | null;
  if (!appId || !key || !valueType) {
    res.status(400).json({ error: "app id, key and valueType are required" });
    return;
  }
  const setting = await updateAppSetting({
    appId,
    key,
    value: req.body?.value,
    valueType,
    description: typeof req.body?.description === "string" ? req.body.description : null,
    updatedBy: req.session.userId ?? null,
  });
  await writeAuditLog({ req, userId: req.session.userId, action: "platform.app_setting.update", resourceType: "app_setting", resourceId: setting?.id, metadata: { appId, key, valueType } });
  res.json({ setting });
});

export default router;
