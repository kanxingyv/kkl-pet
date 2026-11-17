import petCss from "../styles/pet.css";

export interface PetLayers {
  host: HTMLElement;
  root: HTMLElement;
  flip: HTMLElement;
  squash: HTMLElement;
  sprite: HTMLElement;
  shadow: HTMLElement;
  fx: HTMLElement;
  debug: HTMLElement;
}

export interface CreateLayersOptions {
  /** 默认 2147483000（低于 2147483647，被宿主大弹窗盖住是预期行为） */
  zIndex?: number;
  /** 挂载父节点，默认 body */
  target?: Element | null;
  /** 同源 CSS 回退地址。仅当 constructable stylesheet 不可用时使用。 */
  cssHref?: string;
}

function el(tag: string, cls?: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

/**
 * 注入样式。
 * 首选 constructable stylesheet：不产生 <style> 元素，因此不受宿主页 `style-src` 约束。
 * 这条路径是站内版能上线的地基（kkl.ltd 的 CSP 是 style-src 'self'，无 unsafe-inline）。
 */
function adoptStyles(shadow: ShadowRoot, cssHref?: string): "adopted" | "link" | "style" {
  try {
    if (typeof CSSStyleSheet !== "undefined" && "replaceSync" in CSSStyleSheet.prototype) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(petCss);
      shadow.adoptedStyleSheets = [sheet];
      return "adopted";
    }
  } catch {
    /* 落到下面的回退 */
  }

  if (cssHref) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = cssHref;
    shadow.appendChild(link);
    return "link";
  }

  const style = document.createElement("style");
  style.textContent = petCss;
  shadow.appendChild(style);
  return "style";
}

export function createLayers(opts: CreateLayersOptions = {}): {
  layers: PetLayers;
  styleMode: "adopted" | "link" | "style";
} {
  const host = el("div");
  host.id = "kkl-pet-host";
  host.setAttribute("aria-hidden", "true");
  host.setAttribute("role", "presentation");
  // 用 CSSOM 写，不用 style 属性字符串——同样避开 CSP
  host.style.position = "fixed";
  host.style.top = "0px";
  host.style.left = "0px";
  host.style.width = "0px";
  host.style.height = "0px";
  host.style.zIndex = String(opts.zIndex ?? 2147483000);
  host.style.pointerEvents = "none";

  const shadow = host.attachShadow({ mode: "closed" });
  const styleMode = adoptStyles(shadow, opts.cssHref);
  host.dataset.petStyle = styleMode;

  const shadowEllipse = el("div", "pet-shadow");
  const root = el("div", "pet-root");
  const flip = el("div", "pet-flip");
  const squash = el("div", "pet-squash");
  const sprite = el("div", "pet-sprite");
  const fx = el("div", "pet-fx");
  const debug = el("div", "pet-debug");

  for (let i = 0; i < 3; i++) fx.appendChild(el("div", "pet-dust"));

  squash.appendChild(sprite);
  flip.appendChild(squash);
  root.appendChild(shadowEllipse);
  root.appendChild(flip);
  root.appendChild(fx);
  // debug 挂在 shadow 根上，不放进 root——否则会被 root 的 translate 挪走
  shadow.appendChild(root);
  shadow.appendChild(debug);

  const parent = opts.target ?? document.body ?? document.documentElement;
  parent.appendChild(host);

  return {
    layers: { host, root, flip, squash, sprite, shadow: shadowEllipse, fx, debug },
    styleMode,
  };
}
