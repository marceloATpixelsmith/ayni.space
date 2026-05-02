import React from "react";
import { authEn } from "./locales/en/auth";

const AUTH_LOCALES = {
  en: authEn,
} as const;

type AuthLocale = keyof typeof AUTH_LOCALES;
type AuthMessages = typeof authEn;
export type AuthTranslationKey = keyof AuthMessages;

const DEFAULT_LOCALE: AuthLocale = "en";

const AuthI18nContext = React.createContext<AuthMessages>(AUTH_LOCALES[DEFAULT_LOCALE]);

export function AuthI18nProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthI18nContext.Provider value={AUTH_LOCALES[DEFAULT_LOCALE]}>
      {children}
    </AuthI18nContext.Provider>
  );
}

export function useAuthI18n() {
  const messages = React.useContext(AuthI18nContext);
  const t = React.useCallback(
    (key: AuthTranslationKey, fallback?: string) => messages[key] ?? fallback ?? key,
    [messages],
  );
  return { t };
}
