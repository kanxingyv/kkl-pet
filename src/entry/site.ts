import { createApi, type PetHandle } from "../core";
import { createSiteHost } from "../core/host/site-host";

/**
 * 站内壳。整个文件的价值就是：推导资源基址、读持久化状态、挂 API、给一个能关也能再打开的入口。
 *
 * 站点 CSP 是 `script-src 'self'` / `style-src 'self'` / `connect-src 'none'`：
 * - 只能外部 js，不能内联
 * - 不能 fetch，皮肤 manifest 由构建期内置
 */
const self = document.currentScript as HTMLScriptElement | null;
const baseUrl = self?.src
  ? new URL(".", self.src).href
  : new URL("/assets/pet/", location.href).href;

const host = createSiteHost(baseUrl);
const api = createApi(host);
host.expose(api);

let handle: PetHandle | null = null;

const restoreLink = document.querySelector<HTMLElement>("[data-pet-restore]");

function setRestoreVisible(visible: boolean): void {
  if (restoreLink) restoreLink.hidden = !visible;
}

async function summon(): Promise<void> {
  const state = await host.readState();
  await host.writeState({ enabled: true });
  setRestoreVisible(false);
  try {
    handle = api.mount({ skin: state.skin, scale: state.scale });
  } catch (err) {
    console.error("[kkl-pet] mount failed", err);
  }
}

async function dismiss(): Promise<void> {
  await host.writeState({ enabled: false });
  setRestoreVisible(true);
  handle?.unmount();
  handle = null;
}

const boot = async (): Promise<void> => {
  const state = await host.readState();
  if (state.enabled) {
    try {
      handle = api.mount({ skin: state.skin, scale: state.scale });
    } catch (err) {
      console.error("[kkl-pet] mount failed", err);
    }
  } else {
    setRestoreVisible(true);
  }
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void boot(), { once: true });
} else {
  void boot();
}

// 页脚入口
restoreLink?.addEventListener("click", (e) => {
  e.preventDefault();
  void summon();
});

// Alt+P 双向开关。宠物不进 tab 序，这是键盘用户唯一的入口。
addEventListener("keydown", (e) => {
  if (!e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key !== "p" && e.key !== "P") return;
  e.preventDefault();
  if (handle) void dismiss();
  else void summon();
});

// 供页面内其他脚本手动控制
(window as unknown as Record<string, unknown>).kklPet = {
  summon,
  dismiss,
  get handle() {
    return handle;
  },
};
