import { PET_ERRORS } from "../util/log";
import type { ClipId, ClipSpec, SkinManifest } from "./schema";
import { CLIP_IDS, DEFAULT_BEHAVIORS, DEFAULT_FX, SCHEMA_VERSION } from "./schema";

class ManifestError extends Error {
  code = PET_ERRORS.MANIFEST;
  constructor(msg: string) {
    super(msg);
    this.name = "ManifestError";
  }
}

function num(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) {
    throw new ManifestError(`${field} must be a number in [${min}, ${max}], got ${String(v)}`);
  }
  return v;
}

function str(v: unknown, field: string): string {
  if (typeof v !== "string" || !v) throw new ManifestError(`${field} must be a non-empty string`);
  return v;
}

function obj(v: unknown, field: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new ManifestError(`${field} must be an object`);
  }
  return v as Record<string, unknown>;
}

/**
 * 运行时校验 manifest。
 * 手写而非引第三方：协议很小，多一个依赖不值得；而且错误信息要能直接指出字段。
 */
export function validateManifest(raw: unknown): SkinManifest {
  const m = obj(raw, "manifest");

  if (m.schemaVersion !== SCHEMA_VERSION) {
    throw new ManifestError(`schemaVersion must be ${SCHEMA_VERSION}, got ${String(m.schemaVersion)}`);
  }

  const id = str(m.id, "id");
  if (!/^[a-z0-9-]{3,32}$/.test(id)) {
    throw new ManifestError(`id must match ^[a-z0-9-]{3,32}$, got "${id}"`);
  }

  const canvas = obj(m.canvas, "canvas");
  const canvasW = num(canvas.width, "canvas.width", 16, 4096);
  const canvasH = num(canvas.height, "canvas.height", 16, 4096);
  const pixelRatio = num(canvas.pixelRatio, "canvas.pixelRatio", 1, 4);

  const anchor = obj(m.anchor, "anchor");
  const anchorX = num(anchor.x, "anchor.x", 0, canvasW);
  const anchorY = num(anchor.y, "anchor.y", 0, canvasH);

  const body = obj(m.body, "body");
  const display = obj(m.display, "display");
  const facing = obj(m.facing, "facing");
  const palette = obj(m.palette, "palette");
  const sprite = obj(m.sprite, "sprite");

  const clipsRaw = obj(m.clips, "clips");
  const clips: Partial<Record<ClipId, ClipSpec>> = {};
  let clipCount = 0;

  for (const key of Object.keys(clipsRaw)) {
    if (!(CLIP_IDS as readonly string[]).includes(key)) continue; // 未知 clip 忽略，前向兼容
    const c = obj(clipsRaw[key], `clips.${key}`);
    const spec: ClipSpec = {
      sheet: str(c.sheet, `clips.${key}.sheet`),
      frames: Math.round(num(c.frames, `clips.${key}.frames`, 1, 64)),
      fps: num(c.fps, `clips.${key}.fps`, 1, 60),
      loop: c.loop !== false,
      view: (c.view === "side" || c.view === "back" ? c.view : "front") as ClipSpec["view"],
      mirror: c.mirror === true,
    };
    clips[key as ClipId] = spec;
    clipCount += 1;
  }

  if (clipCount === 0) throw new ManifestError("clips must contain at least one known clip");
  if (!clips.idle) throw new ManifestError("clips.idle is required — it is the fallback for missing clips");

  const b = obj(m.behaviors ?? {}, "behaviors");
  const tick = Array.isArray(b.brainTickMs) ? b.brainTickMs : DEFAULT_BEHAVIORS.brainTickMs;

  const manifest: SkinManifest = {
    schemaVersion: SCHEMA_VERSION,
    id,
    name: str(m.name, "name"),
    version: str(m.version, "version"),
    author: typeof m.author === "string" ? m.author : undefined,
    license: typeof m.license === "string" ? m.license : undefined,
    homepage: typeof m.homepage === "string" ? m.homepage : undefined,

    canvas: { width: canvasW, height: canvasH, pixelRatio },
    anchor: { x: anchorX, y: anchorY },
    body: {
      width: num(body.width, "body.width", 8, 512),
      height: num(body.height, "body.height", 8, 512),
      hitPadding: typeof body.hitPadding === "number" ? Math.max(0, body.hitPadding) : 6,
    },
    display: {
      height: num(display.height, "display.height", 24, 512),
      minScale: typeof display.minScale === "number" ? display.minScale : 0.7,
      maxScale: typeof display.maxScale === "number" ? display.maxScale : 1.4,
    },
    facing: {
      default: facing.default === "left" ? "left" : "right",
      flipAxis: "x",
      deadZonePx: typeof facing.deadZonePx === "number" ? facing.deadZonePx : 6,
    },

    palette: {
      outline: typeof palette.outline === "string" ? palette.outline : "#a9634f",
      body: typeof palette.body === "string" ? palette.body : "#ffffff",
      accent: typeof palette.accent === "string" ? palette.accent : "#c23b45",
    },
    sprite: {
      layout: "strip-h",
      format: sprite.format === "png" ? "png" : "webp",
    },

    clips,

    behaviors: {
      walkSpeed: num(b.walkSpeed ?? DEFAULT_BEHAVIORS.walkSpeed, "behaviors.walkSpeed", 10, 600),
      climbSpeed: num(b.climbSpeed ?? DEFAULT_BEHAVIORS.climbSpeed, "behaviors.climbSpeed", 10, 600),
      gravity: num(b.gravity ?? DEFAULT_BEHAVIORS.gravity, "behaviors.gravity", 100, 20000),
      terminalVelocity: num(
        b.terminalVelocity ?? DEFAULT_BEHAVIORS.terminalVelocity,
        "behaviors.terminalVelocity",
        100,
        6000
      ),
      brainTickMs: [
        typeof tick[0] === "number" ? tick[0] : 900,
        typeof tick[1] === "number" ? tick[1] : 1400,
      ],
      minDwellMs: typeof b.minDwellMs === "number" ? b.minDwellMs : DEFAULT_BEHAVIORS.minDwellMs,
      sameActionCooldownMs:
        typeof b.sameActionCooldownMs === "number"
          ? b.sameActionCooldownMs
          : DEFAULT_BEHAVIORS.sameActionCooldownMs,
      moveCooldownMs:
        typeof b.moveCooldownMs === "number" ? b.moveCooldownMs : DEFAULT_BEHAVIORS.moveCooldownMs,
      minTravelPx: typeof b.minTravelPx === "number" ? b.minTravelPx : DEFAULT_BEHAVIORS.minTravelPx,
      idleToSleepMs:
        typeof b.idleToSleepMs === "number" ? b.idleToSleepMs : DEFAULT_BEHAVIORS.idleToSleepMs,
      interruptByUserMs:
        typeof b.interruptByUserMs === "number"
          ? b.interruptByUserMs
          : DEFAULT_BEHAVIORS.interruptByUserMs,
      weights: {
        ...DEFAULT_BEHAVIORS.weights,
        ...(typeof b.weights === "object" && b.weights ? (b.weights as Record<string, number>) : {}),
      },
    },

    fx: {
      dustColor: typeof (m.fx as Record<string, unknown>)?.dustColor === "string"
        ? ((m.fx as Record<string, unknown>).dustColor as string)
        : DEFAULT_FX.dustColor,
      landSquash: Array.isArray((m.fx as Record<string, unknown>)?.landSquash)
        ? ((m.fx as Record<string, unknown>).landSquash as [number, number, number])
        : DEFAULT_FX.landSquash,
      shadowColor:
        typeof (m.fx as Record<string, unknown>)?.shadowColor === "string"
          ? ((m.fx as Record<string, unknown>).shadowColor as string)
          : DEFAULT_FX.shadowColor,
    },

    content: typeof m.content === "object" && m.content ? (m.content as SkinManifest["content"]) : undefined,
  };

  return manifest;
}
