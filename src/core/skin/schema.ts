/**
 * 皮肤协议（manifest.json）——换宠物的唯一契约。
 * 只提供一张基础图 + 一份符合本协议的素材包，就能换一只宠物。
 */

export const SCHEMA_VERSION = 1;

/** 全部可能的动作片段。素材可分阶段产出，缺失的回退到 idle。 */
export type ClipId =
  | "idle"
  | "walk"
  | "climb"
  | "sit"
  | "drag"
  | "fall"
  | "land"
  | "peek"
  | "sleep"
  | "wave"
  | "jump";

export const CLIP_IDS: readonly ClipId[] = [
  "idle",
  "walk",
  "climb",
  "sit",
  "drag",
  "fall",
  "land",
  "peek",
  "sleep",
  "wave",
  "jump",
];

/** 视角。front 用在坐/睡/招手，side 用在走/爬/落。 */
export type ViewAngle = "front" | "side" | "back";

export interface ClipSpec {
  /** 相对 skins/<id>/ 的文件名，水平条 spritesheet */
  sheet: string;
  frames: number;
  fps: number;
  loop: boolean;
  view: ViewAngle;
  /** 该视角左右对称时可为 true，翻转免额外素材 */
  mirror?: boolean;
}

export interface Palette {
  outline: string;
  body: string;
  accent: string;
}

/** 行为参数。全部可被 Host / 用户覆盖。 */
export interface Behaviors {
  walkSpeed: number;
  climbSpeed: number;
  gravity: number;
  terminalVelocity: number;
  /** [min, max] 随机决策间隔，ms */
  brainTickMs: [number, number];
  /** 任何自动态最短停留，防抽搐 */
  minDwellMs: number;
  /** 同一 clip 不连续两次 */
  sameActionCooldownMs: number;
  /** 一次移动结束后的观察期 */
  moveCooldownMs: number;
  /** 目标横向距离小于此值就不移动 */
  minTravelPx: number;
  /** 静置多久进入睡眠 */
  idleToSleepMs: number;
  /** 用户滚轮/鼠标移动后的静默期 */
  interruptByUserMs: number;
  weights: Record<string, number>;
}

export interface FxSpec {
  dustColor: string;
  /** 落地压扁序列 [起始, 过冲, 归位] */
  landSquash: [number, number, number];
  shadowColor: string;
}

export interface SkinManifest {
  schemaVersion: number;
  id: string;
  name: string;
  version: string;
  author?: string;
  license?: string;
  homepage?: string;

  /** 素材画布尺寸（纹理 px）。pixelRatio 用于换算 CSS px。 */
  canvas: { width: number; height: number; pixelRatio: number };
  /** 画布内的脚底锚点。所有帧必须共用同一锚点——这是走路不抖的前提。 */
  anchor: { x: number; y: number };
  /** 碰撞盒与命中盒（CSS px） */
  body: { width: number; height: number; hitPadding: number };
  /** 默认展示高度与缩放边界（CSS px） */
  display: { height: number; minScale: number; maxScale: number };
  facing: { default: "left" | "right"; flipAxis: "x"; deadZonePx: number };

  palette: Palette;
  sprite: { layout: "strip-h"; format: "webp" | "png" };

  clips: Partial<Record<ClipId, ClipSpec>>;

  behaviors: Behaviors;
  fx: FxSpec;

  content?: { credit?: string; licenseNote?: string };
}

export const DEFAULT_BEHAVIORS: Behaviors = {
  walkSpeed: 85,
  climbSpeed: 52,
  gravity: 2600,
  terminalVelocity: 1400,
  brainTickMs: [900, 1400],
  minDwellMs: 1200,
  sameActionCooldownMs: 8000,
  moveCooldownMs: 2500,
  minTravelPx: 120,
  idleToSleepMs: 120_000,
  interruptByUserMs: 1500,
  weights: { wander: 40, idle: 30, sit: 12, peek: 10, wave: 5, jump: 3, sleep: 2 },
};

export const DEFAULT_FX: FxSpec = {
  dustColor: "#d8c3b4",
  landSquash: [0.72, 1.06, 1.0],
  shadowColor: "rgba(56,39,31,.22)",
};
