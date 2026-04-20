/// <reference types="vite/client" />

interface ViteTypeOptions {
  readonly strictImportMetaEnv: unknown;
}

interface ImportMetaEnv {
  readonly VITE_AUTH_DEBUG: string;
  readonly VITE_SENTRY_ENVIRONMENT: string;
  readonly VITE_SENTRY_DSN: string;
  readonly VITE_TURNSTILE_SITE_KEY: string;
  readonly VITE_API_BASE_URL: string;
  readonly VITE_APP_SLUG: string;
  readonly BASE_PATH: string;
}
