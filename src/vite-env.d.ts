/// <reference types="vite/client" />

/** 빌드 시 주입되는 앱 버전 (vite.config.ts) */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
