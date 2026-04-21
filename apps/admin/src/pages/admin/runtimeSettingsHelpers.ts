export type SettingValueType = "string" | "number" | "boolean" | "json";

export type RuntimeSettingLike = {
  key: string;
  value: string;
  valueType: SettingValueType;
};

export function parseSettingDraft(setting: RuntimeSettingLike, draftValue: string): { ok: true; value: unknown } | { ok: false; error: string } {
  if (setting.valueType === "boolean") return { ok: true, value: draftValue === "true" };
  if (setting.valueType === "number") {
    const numeric = Number(draftValue);
    if (!Number.isFinite(numeric)) return { ok: false, error: `${setting.key} must be a finite number.` };
    return { ok: true, value: numeric };
  }
  if (setting.valueType === "json") {
    try {
      return { ok: true, value: JSON.parse(draftValue) };
    } catch {
      return { ok: false, error: `${setting.key} must be valid JSON.` };
    }
  }
  return { ok: true, value: draftValue };
}

export function toDraftString(setting: RuntimeSettingLike): string {
  if (setting.valueType === "json") {
    try {
      return JSON.stringify(JSON.parse(setting.value), null, 2);
    } catch {
      return setting.value;
    }
  }
  return setting.value;
}
