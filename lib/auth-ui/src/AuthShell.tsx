import React from "react";

export function AuthShell({
  children,
  title,
  subtitle,
  maxWidthClassName = "max-w-md",
  brand,
}: {
  children: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  maxWidthClassName?: string;
  brand?: {
    logoSrc: string;
    logoAlt: string;
    backgroundSrc: string;
    backgroundAlt: string;
  };
}) {
  return (
    <div className="min-h-screen flex items-center justify-center relative bg-slate-50 dark:bg-slate-950 overflow-hidden">
      <div className="absolute inset-0 z-0">
        {brand ? (
          <img
            src={brand.backgroundSrc}
            alt={brand.backgroundAlt}
            className="w-full h-full object-cover opacity-60 mix-blend-multiply"
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-background" />
      </div>

      <div className={`relative z-10 w-full ${maxWidthClassName} p-6`}>
        {brand ? (
          <div className="flex justify-center mb-8">
            <img
              src={brand.logoSrc}
              alt={brand.logoAlt}
              className="w-16 h-16 object-contain drop-shadow-xl"
            />
          </div>
        ) : null}

        <div className="p-8 bg-white/95 dark:bg-card/90 border border-white/20 shadow-2xl shadow-primary/5 rounded-2xl">
          {title || subtitle ? (
            <div className="text-center mb-8">
              {title ? (
                <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2">
                  {title}
                </h1>
              ) : null}
              {subtitle ? (
                <p className="text-muted-foreground">{subtitle}</p>
              ) : null}
            </div>
          ) : null}
          {children}
        </div>
      </div>
    </div>
  );
}
