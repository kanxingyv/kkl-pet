import type { Host, PersistedState } from "./host";
import { DEFAULT_STATE } from "./host";

const KEY = "kkl-pet-state";

/**
 * 扩展版 Host。
 * 与站内版的差异只有三处：资源从 chrome-extension:// 取、状态存 chrome.storage、可以 fetch。
 */
export function createExtHost(): Host {
  const hasStorage = typeof chrome !== "undefined" && !!chrome?.storage?.sync;

  const read = async (): Promise<PersistedState> => {
    if (!hasStorage) return { ...DEFAULT_STATE };
    try {
      const data = await chrome!.storage.sync.get(KEY);
      return { ...DEFAULT_STATE, ...((data[KEY] as Partial<PersistedState>) ?? {}) };
    } catch {
      return { ...DEFAULT_STATE };
    }
  };

  const write = async (patch: Partial<PersistedState>): Promise<void> => {
    if (!hasStorage) return;
    try {
      await chrome!.storage.sync.set({ [KEY]: { ...(await read()), ...patch } });
    } catch {
      /* 配额或权限异常时静默降级为不持久化 */
    }
  };

  return {
    kind: "extension",
    assetUrl(rel) {
      const clean = rel.replace(/^\/+/, "");
      if (typeof chrome !== "undefined" && chrome?.runtime?.getURL) {
        return chrome.runtime.getURL(clean);
      }
      return clean;
    },
    canFetch: () => true,
    readState: read,
    writeState: write,

    onRouteChange(cb) {
      // content script 的隔离世界改不了页面的 history，
      // 好在扩展场景下 SPA 换页由 MutationObserver 兜住结构变化，这里只补整页跳转
      const fire = () => cb();
      addEventListener("popstate", fire);
      addEventListener("hashchange", fire);
      return () => {
        removeEventListener("popstate", fire);
        removeEventListener("hashchange", fire);
      };
    },

    expose(api) {
      // 页面世界默认拿不到，用一个只读事件桥给需要的站点脚本
      (window as unknown as Record<string, unknown>).__kklPet = api;
    },
  };
}
