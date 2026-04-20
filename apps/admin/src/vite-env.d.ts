/// <reference types="vite/client" />

interface ViteTypeOptions {
  readonly strictImportMetaEnv: unknown;
}

interface ImportMetaEnv {
  readonly VITE_AUTH_DEBUG: string;
}
