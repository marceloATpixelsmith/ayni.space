import React from "react";
import { Chrome } from "lucide-react";
import { Button } from "@/components/ui/button";

export function GoogleAuthButton({
  onClick,
  disabled,
  loading,
  idleLabel,
  loadingLabel,
  className,
}: {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  idleLabel: string;
  loadingLabel: string;
  className?: string;
}) {
  return (
    <Button
      size="lg"
      className={`w-full h-12 text-base font-medium shadow-md transition-all group ${className ?? ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      <Chrome className="w-5 h-5 mr-3 group-hover:scale-110 transition-transform" />
      {loading ? loadingLabel : idleLabel}
    </Button>
  );
}
