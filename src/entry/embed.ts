import { createApi, type PetHandle } from "../core";
import { createEmbedHost } from "../core/host/embed-host";

// esbuild 的 dataurl loader 会把这些 webp 转成 base64 data URI 内联进 bundle，
// 所以产物不依赖任何外部请求——任意站点一行 <script> 就能跑。
import idleSheet from "../../skins/kkl-whitebird/out/idle.webp";
import walkSheet from "../../skins/kkl-whitebird/out/walk.webp";
import climbSheet from "../../skins/kkl-whitebird/out/climb.webp";
import sitSheet from "../../skins/kkl-whitebird/out/sit.webp";
import waveSheet from "../../skins/kkl-whitebird/out/wave.webp";
import fallSheet from "../../skins/kkl-whitebird/out/fall.webp";
import sleepSheet from "../../skins/kkl-whitebird/out/sleep.webp";
import peekSheet from "../../skins/kkl-whitebird/out/peek.webp";
import jumpSheet from "../../skins/kkl-whitebird/out/jump.webp";
import landSheet from "../../skins/kkl-whitebird/out/land.webp";
import dragSheet from "../../skins/kkl-whitebird/out/drag.webp";

const SKIN = "kkl-whitebird";

const sheets: Record<string, string> = {
  [`skins/${SKIN}/idle.webp`]: idleSheet,
  [`skins/${SKIN}/walk.webp`]: walkSheet,
  [`skins/${SKIN}/climb.webp`]: climbSheet,
  [`skins/${SKIN}/sit.webp`]: sitSheet,
  [`skins/${SKIN}/wave.webp`]: waveSheet,
  [`skins/${SKIN}/fall.webp`]: fallSheet,
  [`skins/${SKIN}/sleep.webp`]: sleepSheet,
  [`skins/${SKIN}/peek.webp`]: peekSheet,
  [`skins/${SKIN}/jump.webp`]: jumpSheet,
  [`skins/${SKIN}/land.webp`]: landSheet,
  [`skins/${SKIN}/drag.webp`]: dragSheet,
};

/**
 * 单文件植入入口。
 *
 * 用法：
 *   <script src="https://你的域名/pet.embed.js" defer></script>
 *
 * 不传 skin 就挂默认皮肤。关闭状态存 localStorage，Alt+P 双向切换。
 */
const host = createEmbedHost(sheets);
const api = createApi(host);
host.expose(api);

let handle: PetHandle | null = null;

const summon = async (): Promise<void> => {
  if (handle) return;
  const state = await host.readState();
  await host.writeState({ enabled: true });
  try {
    handle = api.mount({ skin: state.skin, scale: state.scale });
  } catch (err) {
    console.error("[kkl-pet] mount failed", err);
  }
};

const dismiss = async (): Promise<void> => {
  await host.writeState({ enabled: false });
  handle?.unmount();
  handle = null;
};

(window as unknown as Record<string, unknown>).kklPet = {
  summon,
  dismiss,
  get mounted() {
    return handle !== null;
  },
};

const boot = async (): Promise<void> => {
  if (document.readyState === "loading") {
    await new Promise<void>((resolve) =>
      document.addEventListener("DOMContentLoaded", () => resolve(), { once: true })
    );
  }
  const state = await host.readState();
  if (state.enabled) await summon();
};

addEventListener("keydown", (e) => {
  if (!e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key !== "p" && e.key !== "P") return;
  e.preventDefault();
  if (handle) void dismiss();
  else void summon();
});

void boot();
