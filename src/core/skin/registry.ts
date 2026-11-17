import { PET_ERRORS } from "../util/log";
import type { SkinManifest } from "./schema";
import { validateManifest } from "./validate";
import whitebirdRaw from "../../../skins/kkl-whitebird/manifest.json";

/**
 * 内置皮肤注册表。
 * 站内版受 `connect-src 'none'` 限制不能 fetch，所以皮肤必须在构建期就打进来。
 * 扩展版可以运行时 fetch 外部 manifest，走 registerSkin()。
 */
const REGISTRY: Record<string, unknown> = {
  "kkl-whitebird": whitebirdRaw,
};

const cache = new Map<string, SkinManifest>();

export function skinIds(): string[] {
  return Object.keys(REGISTRY);
}

export function hasSkin(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(REGISTRY, id);
}

export function registerSkin(id: string, raw: unknown): void {
  REGISTRY[id] = raw;
  cache.delete(id);
}

export function loadSkin(id: string): SkinManifest {
  const cached = cache.get(id);
  if (cached) return cached;

  const raw = REGISTRY[id];
  if (!raw) {
    const err = new Error(`skin "${id}" is not registered; available: ${skinIds().join(", ")}`);
    (err as Error & { code?: string }).code = PET_ERRORS.NO_SKIN;
    throw err;
  }

  const manifest = validateManifest(raw);
  cache.set(id, manifest);
  return manifest;
}
