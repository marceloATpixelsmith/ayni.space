import React from "react";
import { useAuthI18n } from "./i18n";

export function AuthMethodDivider() {
  const { t } = useAuthI18n();

  return (
    <div className="my-5 flex items-center gap-4" aria-hidden="true">
      <div className="h-px flex-1 bg-border" />
      <span className="text-sm text-muted-foreground uppercase tracking-wide">
        {t("auth_method_divider_or", "OR")}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}
