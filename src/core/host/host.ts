/**
 * Host 抽象——两壳（站内 / 扩展）唯一的差异点。
 * core 只通过这个接口接触环境，从而同一份代码能跑在两种宿主里。
 */

export interface PersistedState {
  /** 用户是否开启宠物 */
  enabled: boolean;
  /** 当前皮肤 id */
  skin: string;
  /** 用户自定义缩放（相对 manifest.display.height） */
  scale?: number;
}

export interface Host {
  readonly kind: "site" | "extension";

  /** 把 skins/<id>/<file> 这样的相对路径转成可加载的绝对 URL */
  assetUrl(rel: string): string;

  /** 站内版 connect-src 'none'，不能 fetch；扩展版可以 */
  canFetch(): boolean;

  readState(): Promise<PersistedState>;
  writeState(patch: Partial<PersistedState>): Promise<void>;

  /** SPA 路由变化（pushState/replaceState/popstate/hashchange）后回调 */
  onRouteChange(cb: () => void): () => void;

  /** 把公开 API 挂到宿主能访问的地方（站内版 = window.KKLPet） */
  expose(api: unknown): void;
}

export const DEFAULT_STATE: PersistedState = {
  enabled: true,
  skin: "kkl-whitebird",
};
