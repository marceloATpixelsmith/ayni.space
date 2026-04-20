/// <reference types="vite/client" />

interface ViteTypeOptions {
  readonly strictImportMetaEnv: unknown;
}

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_APP_SLUG: string;
  readonly BASE_PATH: string;
}
