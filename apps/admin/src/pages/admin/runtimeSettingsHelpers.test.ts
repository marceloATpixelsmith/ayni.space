import { describe, expect, it } from "vitest";
import { parseSettingDraft, toDraftString } from "./runtimeSettingsHelpers";

describe("runtimeSettingsHelpers", () => {
  it("parses booleans and numbers in typed form", () => {
    expect(parseSettingDraft({ key: "TURNSTILE_ENABLED", value: "true", valueType: "boolean" }, "false")).toEqual({
      ok: true,
      value: false,
    });
    expect(parseSettingDraft({ key: "IPQS_TIMEOUT_MS", value: "3000", valueType: "number" }, "2500")).toEqual({
      ok: true,
      value: 2500,
    });
  });

  it("returns validation errors for bad numeric/json drafts", () => {
    const invalidNumber = parseSettingDraft({ key: "OPENAI_TIMEOUT_MS", value: "2000", valueType: "number" }, "abc");
    expect(invalidNumber.ok).toBe(false);
    if (!invalidNumber.ok) expect(invalidNumber.error).toContain("finite number");

    const invalidJson = parseSettingDraft({ key: "SOME_JSON", value: "{}", valueType: "json" }, "{oops");
    expect(invalidJson.ok).toBe(false);
    if (!invalidJson.ok) expect(invalidJson.error).toContain("valid JSON");
  });

  it("normalizes json drafts for textarea presentation", () => {
    expect(toDraftString({ key: "JSON", value: "{\"mode\":\"strict\"}", valueType: "json" })).toContain("\n");
    expect(toDraftString({ key: "STRING", value: "hello", valueType: "string" })).toBe("hello");
  });
});
