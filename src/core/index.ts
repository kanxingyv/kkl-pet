import type { Host } from "./host/host";
import { Pet, type PetOptions } from "./pet";
import { loadSkin, registerSkin, skinIds } from "./skin/registry";
import { Emitter, type Handler } from "./util/emitter";
import { PET_ERRORS } from "./util/log";

export type PetEvent =
  | "ready"
  | "statechange"
  | "actionstart"
  | "actionend"
  | "navigatefail"
  | "dragstart"
  | "dragend"
  | "error";

export interface MountOptions extends PetOptions {
  /** 关闭时是否持久化，默认 true */
  persistDisabled?: boolean;
}

export interface PetState {
  clip: string;
  frame: number;
  x: number;
  y: number;
  reduced: boolean;
  enabled: boolean;
}

export interface WalkResult {
  ok: boolean;
  code?: string;
}

export interface PetHandle {
  getState(): PetState;
  /** 诊断数据：探针耗时、表面数、图规模。 */
  diag(): Record<string, unknown>;
  /** 走到某个选择器对应元素所在的表面，或视口内某点下方。不可达时 ok=false，绝不瞬移。 */
  walkTo(target: string | { x: number; y: number }): Promise<WalkResult>;
  hide(): void;
  show(): void;
  dismiss(): Promise<void>;
  summon(): Promise<void>;
  unmount(): void;
}

export interface KKLPetApi {
  mount(options?: MountOptions): PetHandle;
  skins(): string[];
  registerSkin(id: string, raw: unknown): void;
  on<T>(evt: PetEvent, fn: Handler<T>): () => void;
  off<T>(evt: PetEvent, fn: Handler<T>): void;
  readonly version: string;
  readonly errors: typeof PET_ERRORS;
}

/**
 * 组装对外 API。core 不关心自己跑在站内还是扩展里——Host 决定了这件事。
 */
export function createApi(host: Host): KKLPetApi {
  const bus = new Emitter<PetEvent>();
  let current: Pet | null = null;
  let enabled = true;

  const buildHandle = (pet: Pet): PetHandle => ({
    getState: () => ({ ...pet.state, enabled }),
    diag: () => pet.diag,

    walkTo: async (target) => {
      if (typeof target === "string") {
        // body / html 视作「回到地面」，比报 unreachable 更符合直觉
        if (target === "body" || target === "html" || target === "floor") {
          const ok = await pet.walkToSurface("floor");
          return ok ? { ok: true } : { ok: false, code: PET_ERRORS.UNREACHABLE };
        }
        const el = document.querySelector(target);
        if (!el) return { ok: false, code: PET_ERRORS.UNREACHABLE };
        const surfaceId = pet.surfaceForElement(el);
        if (!surfaceId) return { ok: false, code: PET_ERRORS.UNREACHABLE };
        const ok = await pet.walkToSurface(surfaceId);
        return ok ? { ok: true } : { ok: false, code: PET_ERRORS.UNREACHABLE };
      }
      const ok = await pet.walkToPoint(target.x, target.y);
      return ok ? { ok: true } : { ok: false, code: PET_ERRORS.UNREACHABLE };
    },

    hide: () => pet.hide(),
    show: () => pet.show(),
    dismiss: async () => {
      enabled = false;
      pet.hide();
      await host.writeState({ enabled: false });
      bus.emit("statechange", { enabled });
    },
    summon: async () => {
      enabled = true;
      if (current === pet) pet.show();
      await host.writeState({ enabled: true });
      bus.emit("statechange", { enabled });
    },
    unmount: () => {
      pet.destroy();
      if (current === pet) current = null;
    },
  });

  const mount = (opts: MountOptions = {}): PetHandle => {
    const skinId = opts.skin ?? "kkl-whitebird";

    let manifest;
    try {
      manifest = loadSkin(skinId);
    } catch (err) {
      bus.emit("error", { code: PET_ERRORS.NO_SKIN, message: String(err) });
      throw err;
    }

    if (current) current.destroy();
    const pet = new Pet(host, manifest, opts);
    current = pet;
    enabled = true;

    void pet
      .init()
      .then(() => bus.emit("ready", { skin: skinId }))
      .catch((err: unknown) => {
        bus.emit("error", { code: PET_ERRORS.ASSET, message: String(err) });
        if (typeof console !== "undefined") console.error("[kkl-pet] init failed", err);
      });

    return buildHandle(pet);
  };

  return {
    mount,
    skins: skinIds,
    registerSkin,
    on: (evt, fn) => bus.on(evt, fn),
    off: (evt, fn) => bus.off(evt, fn),
    get version() {
      return __PET_VERSION__;
    },
    errors: PET_ERRORS,
  };
}
