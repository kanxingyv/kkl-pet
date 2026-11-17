import type { Host, PersistedState } from "./host";
import { DEFAULT_STATE } from "./host";

/**
 * 单文件植入版 Host。
 *
 * 素材在构建期被 esbuild 的 dataurl loader 转成 base64 内联进 js，
 * 所以运行时不需要任何网络请求——一个 <script> 即可。
 */
export function createEmbedHost(sheets: Record<string, string>): Host {
  const KEY = "kkl-pet:v1";

  const read = (): PersistedState => {
    try {
      const raw = localStorage.getItem(KEY);
      return { ...DEFAULT_STATE, ...((raw ? JSON.parse(raw) : {}) as Partial<PersistedState>) };
    } catch {
      return { ...DEFAULT_STATE };
    }
  };

  const write = (patch: Partial<PersistedState>): void => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...read(), ...patch }));
    } catch {
      /* 隐私模式或配额异常时静默降级 */
    }
  };

  return {
    kind: "site",
    assetUrl(rel) {
      const key = rel.replace(/^\/+/, "");
      return sheets[key] ?? key;
    },
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
