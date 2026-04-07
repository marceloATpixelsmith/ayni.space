import React from "react";

export function AuthMethodDivider() {
  return (
    <div className="my-5 flex items-center gap-4" aria-hidden="true">
      <div className="h-px flex-1 bg-border" />
      <span className="text-sm text-muted-foreground uppercase tracking-wide">
        OR
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}
