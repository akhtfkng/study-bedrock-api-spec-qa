import path from "node:path";
import { buildIndex, loadSpecFiles } from "@/lib/openapi-index";
import type { OpenApiIndex, SpecFile } from "@/lib/openapi-index";

const SPEC_DIR = path.join(process.cwd(), "public", "specs");

let cachedSpecFiles: Promise<SpecFile[]> | null = null;
let cachedIndex: Promise<OpenApiIndex> | null = null;

type ResetListener = () => void;
const resetListeners: ResetListener[] = [];

export function getSpecDirectory(): string {
  return SPEC_DIR;
}

export function onSpecCacheReset(listener: ResetListener): () => void {
  resetListeners.push(listener);
  return () => {
    const index = resetListeners.indexOf(listener);
    if (index >= 0) {
      resetListeners.splice(index, 1);
    }
  };
}

function notifySpecCacheReset(): void {
  for (const listener of [...resetListeners]) {
    try {
      listener();
    } catch (error) {
      console.warn("[spec-loader] Spec cache reset listener threw", error);
    }
  }
}

export async function loadCachedSpecFiles(options?: { forceReload?: boolean }): Promise<SpecFile[]> {
  if (options?.forceReload) {
    cachedSpecFiles = null;
    notifySpecCacheReset();
  }

  if (!cachedSpecFiles) {
    cachedSpecFiles = loadSpecFiles(SPEC_DIR);
  }

  return cachedSpecFiles;
}

export async function loadCachedOpenApiIndex(options?: { forceReload?: boolean }): Promise<OpenApiIndex> {
  if (options?.forceReload) {
    cachedIndex = null;
    notifySpecCacheReset();
  }

  if (!cachedIndex) {
    cachedIndex = (async () => {
      const specs = await loadCachedSpecFiles({ forceReload: options?.forceReload });
      return buildIndex(specs);
    })();
  }

  return cachedIndex;
}

export function resetSpecCaches(): void {
  cachedSpecFiles = null;
  cachedIndex = null;
  notifySpecCacheReset();
}
