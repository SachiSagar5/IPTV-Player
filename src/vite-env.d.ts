/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_CORS_PROXY: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
