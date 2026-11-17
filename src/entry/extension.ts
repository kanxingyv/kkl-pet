import { createApi } from "../core";
import { createExtHost } from "../core/host/ext-host";

/**
 * MV3 content script 壳。
 *
 * 约束与对策：
 * - content_scripts 不支持 type:"module" → 构建成 IIFE（build.mjs）
 * - 只在顶层帧运行（all_frames:false），否则每个 iframe 都会长出一只宠物
 * - 样式走 constructable stylesheet，不产生 <style>，不受宿主页 style-src 影响
 */
if (window.top === window.self) {
  const host = createExtHost();
  const api = createApi(host);
  host.expose(api);

  const boot = async (): Promise<void> => {
    // document_idle 时 body 通常已就绪；极端情况下等一拍
    if (!document.body) {
      await new Promise<void>((resolve) =>
        document.addEventListener("DOMContentLoaded", () => resolve(), { once: true })
      );
    }

    const state = await host.readState();
    if (!state.enabled) return;

    try {
      api.mount({ skin: state.skin, scale: state.scale });
    } catch (err) {
      console.error("[kkl-pet] mount failed", err);
    }
  };

  void boot();
}
