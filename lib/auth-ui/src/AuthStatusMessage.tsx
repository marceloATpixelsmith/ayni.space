import React from "react";

export function AuthStatusMessage({
  message,
  tone = "default",
  align = "left",
  className,
}: {
  message?: string | null;
  tone?: "default" | "error";
  align?: "left" | "center";
  className?: string;
}) {
  if (!message) {
    return null;
  }

  const toneClassName =
    tone === "error" ? "text-destructive" : "text-muted-foreground";
  const alignClassName = align === "center" ? "text-center" : "text-left";

  return (
    <p
      className={`mt-4 text-sm ${toneClassName} ${alignClassName} ${className ?? ""}`}
      role={tone === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      {message}
    </p>
  );
}
