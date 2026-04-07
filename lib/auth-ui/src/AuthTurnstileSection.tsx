import React from "react";

export function AuthTurnstileSection({
  enabled,
  TurnstileWidget,
  guidanceMessage,
  status,
}: {
  enabled: boolean;
  TurnstileWidget: React.ComponentType;
  guidanceMessage?: string;
  status?: string;
}) {
  return (
    <>
      <div className="mt-6">{enabled ? <TurnstileWidget /> : null}</div>
      {guidanceMessage ? (
        <p
          className={`mt-4 text-sm text-center ${status === "error" || status === "expired" ? "text-destructive" : "text-muted-foreground"}`}
          role="status"
        >
          {guidanceMessage}
        </p>
      ) : null}
    </>
  );
}
