import React from "react";

export function GoogleAuthButton({
  onClick,
  disabled,
  loading,
  idleLabel,
  loadingLabel,
  className,
  variant,
}: {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  idleLabel: string;
  loadingLabel: string;
  className?: string;
  variant?: "default" | "outline";
}) {
  const variantClassName =
    variant === "outline"
      ? "border border-input bg-background hover:bg-accent hover:text-accent-foreground"
      : "bg-primary text-primary-foreground hover:bg-primary/90";
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center whitespace-nowrap rounded-md px-4 py-2 w-full h-12 text-base font-medium shadow-md transition-all group disabled:pointer-events-none disabled:opacity-50 ${variantClassName} ${className ?? ""}`}
      onClick={onClick}
      disabled={disabled}
      data-variant={variant ?? "default"}
    >
      {loading ? loadingLabel : idleLabel}
    </button>
  );
}
