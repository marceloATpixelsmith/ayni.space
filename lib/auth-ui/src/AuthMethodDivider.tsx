import React from "react";
import { useAuthI18n } from "@workspace/frontend-security";

export function AuthMethodDivider() {
  const { t } = useAuthI18n();
  return (
    <div className="my-5 flex items-center gap-4" aria-hidden="true">
      <div className="h-px flex-1 bg-border" />
      <span className="text-sm text-muted-foreground uppercase tracking-wide">
        {t("auth.methodDivider.or", "OR")}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}
