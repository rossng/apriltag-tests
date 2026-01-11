/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly GROUND_TRUTH_DIR: string;
  readonly RESULTS_DIR: string;
  readonly DETECTORS: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
