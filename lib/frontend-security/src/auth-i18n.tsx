import React from "react";

export const AUTH_LOCALE_EN = "en" as const;
export type AuthLocale = typeof AUTH_LOCALE_EN;

export type AuthI18nMessages = Record<string, string>;

const AuthI18nContext = React.createContext<{ t: (key: string, fallback?: string) => string } | null>(null);

export function AuthI18nProvider({ children, messages }: { children: React.ReactNode; messages: AuthI18nMessages }) {
  const t = React.useCallback(
    (key: string, fallback?: string) => messages[key] ?? fallback ?? key,
    [messages],
  );
  return <AuthI18nContext.Provider value={{ t }}>{children}</AuthI18nContext.Provider>;
}

export function useAuthI18n() {
  const context = React.useContext(AuthI18nContext);
  if (!context) {
    throw new Error("useAuthI18n must be used within AuthI18nProvider");
  }
  return context;
}

export const authEnMessages: AuthI18nMessages = {
  "auth.methodDivider.or": "OR",
  "auth.validation.email.invalid": "Enter a valid email address.",
  "auth.validation.password.letter": "Password must include at least one letter.",
  "auth.validation.password.upper": "Password must include at least one uppercase letter.",
  "auth.validation.password.lower": "Password must include at least one lowercase letter.",
  "auth.validation.password.number": "Password must include at least one number.",
  "auth.validation.password.symbol": "Password must include at least one symbol.",
  "auth.validation.password.length": "Password must be at least 8 characters.",
};
