import React from "react";

export function FieldValidationMessage({ id, message }: { id: string; message?: string | null }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs text-destructive" role="alert" aria-live="polite">
      {message}
    </p>
  );
}
