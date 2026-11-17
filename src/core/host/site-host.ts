import type { Host, PersistedState } from "./host";
import { DEFAULT_STATE } from "./host";

const STORAGE_KEY = "kkl-pet:v1";

/**
 * 站内版 Host。
 * 约束：站点 CSP 是 `connect-src 'none'`，所以这里不能 fetch，皮肤 manifest 由构建期内置。
 */
export function createSiteHost(baseUrl: string): Host {
  const base = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";

  const read = (): PersistedState => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_STATE };
      return { ...DEFAULT_STATE, ...(JSON.parse(raw) as Partial<PersistedState>) };
    } catch {
      return { ...DEFAULT_STATE };
    }
  };

  const write = (patch: Partial<PersistedState>): void => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...read(), ...patch }));
    } catch {
      /* 隐私模式下 localStorage 可能抛错，静默降级为不持久化 */
    }
  };

  return {
    kind: "site",
    assetUrl: (rel) => base + rel.replace(/^\/+/, ""),
    canFetch: () => false,
    readState: async () => read(),
    writeState: async (patch) => write(patch),

    onRouteChange(cb) {
      const fire = () => cb();
      const patchHistory = (name: "pushState" | "replaceState") => {
        const original = history[name];
        history[name] = function patched(this: History, ...args: unknown[]) {
          const result = (original as (...a: unknown[]) => unknown).apply(this, args);
          fire();
          return result;
        } as typeof history.pushState;
      };
      patchHistory("pushState");
      patchHistory("replaceState");
      addEventListener("popstate", fire);
      addEventListener("hashchange", fire);
      return () => {
        removeEventListener("popstate", fire);
        removeEventListener("hashchange", fire);
      };
    },

    expose(api) {
      (window as unknown as Record<string, unknown>).KKLPet = api;
    },
  };
}
