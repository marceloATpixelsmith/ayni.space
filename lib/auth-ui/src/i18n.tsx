import React from "react";
import { authEn } from "./locales/en/auth";

const AUTH_LOCALES = {
  en: authEn,
} as const;

type AuthLocale = keyof typeof AUTH_LOCALES;
type AuthMessages = typeof authEn;
export type AuthTranslationKey = keyof AuthMessages;
export type AuthMessageMap = AuthMessages;

const DEFAULT_LOCALE: AuthLocale = "en";

const AuthI18nContext = React.createContext<AuthMessages>(
  AUTH_LOCALES[DEFAULT_LOCALE],
);

export function getAuthMessage(
  key: AuthTranslationKey,
  fallback?: string,
): string {
  return AUTH_LOCALES[DEFAULT_LOCALE][key] ?? fallback ?? key;
}

export function formatAuthMessage(
  key: AuthTranslationKey,
  replacements: Record<string, string | number | null | undefined>,
  fallback?: string,
): string {
  const template = getAuthMessage(key, fallback);
  return template.replace(/\{([^}]+)\}/g, (_match, token: string) => {
    const value = replacements[token];
    return value == null ? "" : String(value);
  });
}

export function AuthI18nProvider({ children }: { children: React.ReactNode }) {
  return (
    <AuthI18nContext.Provider value={AUTH_LOCALES[DEFAULT_LOCALE]}>
      {children}
    </AuthI18nContext.Provider>
  );
}

export function useAuthI18n() {
  const messages = React.useContext(AuthI18nContext);
  const t = React.useCallback(
    (key: AuthTranslationKey, fallback?: string) =>
      messages[key] ?? fallback ?? key,
    [messages],
  );
  const format = React.useCallback(
    (
      key: AuthTranslationKey,
      replacements: Record<string, string | number | null | undefined>,
      fallback?: string,
    ) => {
      const template = messages[key] ?? fallback ?? key;
      return template.replace(/\{([^}]+)\}/g, (_match, token: string) => {
        const value = replacements[token];
        return value == null ? "" : String(value);
      });
    },
    [messages],
  );
  return { t, format };
}
