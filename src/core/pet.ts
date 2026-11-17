import { Animator } from "./animator";
import { Brain, type BrainContext, type Intent } from "./brain";
import type { Host } from "./host/host";
import { DragController } from "./input/drag";
import { StateMachine, STATE_CLIP, type StateName } from "./machine";
import { dijkstra } from "./nav/dijkstra";
import { LegRunner } from "./nav/exec";
import { buildGraph } from "./nav/graph";
import { planLegs } from "./nav/plan";
import type { Leg, NavGraph } from "./nav/types";
import { DebugOverlay } from "./render/debug";
import { createLayers } from "./render/host-el";
import { Renderer } from "./render/renderer";
import type { SkinManifest } from "./skin/schema";
import { CLIP_IDS, type ClipId } from "./skin/schema";
import { Invalidation } from "./world/invalidation";
import type { SurfaceKind } from "./world/types";
import { World } from "./world/world";

export interface PetOptions {
  skin?: string;
  scale?: number;
  zIndex?: number;
  target?: Element | null;
  reducedMotion?: "auto" | "force" | "off";
  interactive?: boolean;
  debug?: boolean;
}

const DEBUG_QUERY = "pet-debug";
const TELEPORT_TOLERANCE = 1.6;

function randRange(min: number, max: number): number {
  return min + Math.random() * Math.max(1, max - min);
}

/**
 * Pet 编排器。全库只有这里跑 requestAnimationFrame。
 * 每帧顺序：dt → 拖拽 / LegRunner → Brain 决策 → Animator → Renderer。
 */
export class Pet {
  #host: Host;
  #manifest: SkinManifest;
  #renderer: Renderer;
  #animator = new Animator();
  #machine = new StateMachine();
  #brain = new Brain();
  #drag: DragController;
  #world = new World();
  #runner = new LegRunner();
  #invalid: Invalidation;
  #debug: DebugOverlay;

  #graph: NavGraph | null = null;
  #surfaceId = "floor";
  #x = 0;
  #y = 0;
  #activeClip: ClipId | null = null;
  #clipUrls = new Map<ClipId, string>();
  #stateUntil = 0;
  #dragging = false;
  #interactive: boolean;

  #raf = 0;
  #last = 0;
  #running = false;
  #destroyed = false;
  #reduced: boolean;
  #displayHeight: number;
  #footOffset = 0;

  #walkResolve: ((ok: boolean) => void) | null = null;
  #offRoute: (() => void) | null = null;

  #onResize = () => {
    if (this.#destroyed) return;
    this.#clampToViewport();
    this.#renderer.setPosition(this.#x, this.#y);
  };

  #onUserScroll = () => this.#brain.noteUserInput();

  constructor(host: Host, manifest: SkinManifest, opts: PetOptions = {}) {
    this.#host = host;
    this.#manifest = manifest;
    this.#interactive = opts.interactive !== false;

    const base = manifest.display.height;
    const scale = opts.scale ?? 1;
    // 窄屏上 162px 会占掉四分之一屏幕并压住正文，按视口宽度设一个硬上限
    const viewportCap = Math.min(220, Math.round(window.innerWidth * 0.24));
    this.#displayHeight = Math.round(
      Math.min(
        manifest.display.maxScale * base,
        Math.max(manifest.display.minScale * base, base * scale),
        viewportCap
      )
    );

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.#reduced = opts.reducedMotion === "force" || (opts.reducedMotion !== "off" && mq.matches);

    const { layers } = createLayers({
      zIndex: opts.zIndex,
      target: opts.target,
      cssHref: host.assetUrl("pet.css"),
    });
    this.#renderer = new Renderer(layers, manifest, this.#displayHeight);
    this.#animator.setFrameHandler((frame) => this.#renderer.setFrame(frame));

    const debugOn = opts.debug ?? new URLSearchParams(location.search).has(DEBUG_QUERY);
    this.#debug = new DebugOverlay(layers.debug, debugOn);

    this.#invalid = new Invalidation({
      onStructural: () => this.#refreshWorld(),
      onGeometry: () => this.#syncGeometry(),
    });

    this.#machine.onChange((next) => {
      const clip = STATE_CLIP[next];
      if (clip) this.#wantClip(clip, true);
    });

    this.#drag = new DragController(
      {
        onStart: () => this.#beginDrag(),
        onMove: (x, y) => this.#moveDrag(x, y),
        onEnd: (x, y, vx, vy) => this.#endDrag(x, y, vx, vy),
      },
      () => ({ x: this.#x, y: this.#y })
    );

    if (this.#interactive) this.#drag.attach(layers.sprite);

    this.#runner.onFinished(() => {
      const snap = this.#runner.snapshot;
      this.#x = snap.x;
      this.#y = snap.y;
      this.#surfaceId = this.#world.supportAt(this.#x, this.#y).id;
      this.#renderer.setPosition(this.#x, this.#y);
      this.#renderer.landSquash();
      this.#renderer.dust();
      this.#renderer.setShadow(0);
      this.#brain.noteMoveEnd();
      this.#machine.set("land");
      this.#stateUntil = performance.now() + 300;

      const resolve = this.#walkResolve;
      this.#walkResolve = null;
      resolve?.(true);
    });

    const pr = manifest.canvas.pixelRatio || 1;
    const canvasCssH = manifest.canvas.height / pr;
    const anchorCssY = manifest.anchor.y / pr;
    this.#footOffset = (canvasCssH - anchorCssY) * (this.#displayHeight / canvasCssH);
  }

  get state(): {
    clip: string;
    frame: number;
    state: string;
    x: number;
    y: number;
    surface: string;
    reduced: boolean;
    surfaces: number;
  } {
    return {
      clip: this.#animator.clipId,
      frame: this.#animator.frame,
      state: this.#machine.state,
      x: this.#x,
      y: this.#y,
      surface: this.#surfaceId,
      reduced: this.#reduced,
      surfaces: this.#world.surfaces.length,
    };
  }

  get diag(): Record<string, unknown> {
    return {
      probe: this.#world.stats,
      surfaces: this.#world.surfaces.length,
      ledges: this.#world.ledges.length,
      nodes: this.#graph?.nodes.length ?? 0,
      edges: this.#graph ? this.#graph.edges.reduce((n, e) => n + e.length, 0) : 0,
      state: this.#machine.state,
    };
  }

  async init(): Promise<void> {
    const idle = this.#manifest.clips.idle;
    if (!idle) throw new Error("manifest.clips.idle is required");

    const url = this.#host.assetUrl(`skins/${this.#manifest.id}/${idle.sheet}`);
    this.#clipUrls.set("idle", url);
    await this.#renderer.preload(url);
    this.#renderer.applyClip(idle, url);
    this.#activeClip = "idle";
    this.#animator.play("idle", idle, { force: true });

    this.#placeOnFloor();
    this.#renderer.setPosition(this.#x, this.#y);
    this.#renderer.show(true);

    this.#refreshWorld();
    this.#preloadAllClips();

    addEventListener("resize", this.#onResize, { passive: true });
    addEventListener("scroll", this.#onUserScroll, { passive: true, capture: true });
    this.#invalid.start();
    this.#offRoute = this.#host.onRouteChange(() => this.#refreshWorld());

    this.#machine.force("idle");
    this.#brain.noteIdleSince(performance.now());

    if (!this.#reduced) this.#start();
  }

  // ── 世界 ──

  #refreshWorld(): void {
    if (this.#destroyed) return;
    this.#world.refresh();
    this.#rebuildGraph();
    this.#debug.renderSurfaces(this.#world.surfaces);
  }

  #rebuildGraph(): void {
    this.#graph = buildGraph(this.#world, {
      bodyW: this.#manifest.body.width,
      walkSpeed: this.#manifest.behaviors.walkSpeed,
      climbSpeed: this.#manifest.behaviors.climbSpeed,
    });
  }

  #syncGeometry(): void {
    if (this.#destroyed) return;
    const sparse = this.#world.syncRects();
    if (sparse) {
      this.#world.refresh();
      this.#rebuildGraph();
    }
    this.#debug.renderSurfaces(this.#world.surfaces);

    if (this.#dragging || !this.#runner.done) return;

    const support = this.#world.surfaceById(this.#surfaceId);
    const gone = !support || (support.kind === "ledge" && !support.el?.isConnected);

    if (gone) {
      this.#dropToSupport();
    } else if (support && support.kind !== "wall" && support.kind !== "floor") {
      this.#y = support.rect.y;
      this.#renderer.setPosition(this.#x, this.#y);
    }
  }

  #dropToSupport(): void {
    const landing = this.#world.findLanding(this.#x, this.#y);
    this.#surfaceId = landing.surface.id;
    if (landing.y <= this.#y + 1) return;
    this.#machine.set("fall");
    this.#runner.start(
      [{ type: "fall", fromX: this.#x, fromY: this.#y, toX: this.#x, toY: landing.y }],
      this.#x,
      this.#y,
      landing.surface.id
    );
  }

  // ── 导航 ──

  walkToSurface(surfaceId: string, preferX?: number): Promise<boolean> {
    const graph = this.#graph;
    if (!graph) return Promise.resolve(false);
    if (this.#dragging) return Promise.resolve(false);

    const startIdx = this.#nearestNode(this.#surfaceId, this.#x);
    const goalIdx = this.#nearestNode(surfaceId, preferX ?? this.#x);
    if (startIdx < 0 || goalIdx < 0) return Promise.resolve(false);

    const path = dijkstra(graph, startIdx, goalIdx);
    if (!path) return Promise.resolve(false);

    const startNode = graph.nodes[startIdx];
    const legs: Leg[] = [];

    if (Math.abs(startNode.x - this.#x) > 0.5) {
      legs.push({
        type: "walk",
        surfaceId: this.#surfaceId,
        y: startNode.y,
        fromX: this.#x,
        toX: startNode.x,
      });
    }
    legs.push(...planLegs(path));

    this.#debug.renderSurfaces(this.#world.surfaces);
    this.#debug.renderPath(path.nodeIds.map((i) => graph.nodes[i]));

    return this.#run(legs);
  }

  walkToPoint(x: number, y: number): Promise<boolean> {
    const landing = this.#world.findLanding(x, y);
    return this.walkToSurface(landing.surface.id, x);
  }

  walkToNearestInput(): Promise<boolean> {
    const inputs = this.#world.inputSurfaces();
    if (inputs.length === 0) return Promise.resolve(false);

    let best = inputs[0];
    let bestD = Infinity;
    for (const s of inputs) {
      const dx = s.rect.x + s.rect.w / 2 - this.#x;
      const dy = s.rect.y - this.#y;
      const d = dx * dx + dy * dy * 2;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return this.walkToSurface(best.id, best.rect.x + best.rect.w / 2);
  }

  surfaceForElement(el: Element): string | null {
    let node: Element | null = el;
    while (node) {
      const hit = this.#world.ledges.find((s) => s.el === node);
      if (hit) return hit.id;
      node = node.parentElement;
    }
    return null;
  }

  #nearestNode(surfaceId: string, x: number): number {
    const graph = this.#graph;
    if (!graph) return -1;

    const ids = graph.bySurface.get(surfaceId);
    if (!ids || ids.length === 0) return -1;

    let best = ids[0];
    let bestD = Infinity;
    for (const i of ids) {
      const d = Math.abs(graph.nodes[i].x - x);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  #run(legs: Leg[]): Promise<boolean> {
    if (legs.length === 0) return Promise.resolve(true);
    if (this.#reduced) return Promise.resolve(false);

    this.#stateUntil = 0;
    this.#brain.resetIdle();

    return new Promise<boolean>((resolve) => {
      this.#walkResolve = resolve;
      this.#machine.set("walk");
      this.#runner.start(legs, this.#x, this.#y, this.#surfaceId);
    });
  }

  // ── 拖拽 ──

  #beginDrag(): void {
    this.#dragging = true;
    this.#runner.stop();
    this.#stateUntil = 0;
    this.#renderer.setDragging(true);
    this.#renderer.setShadow(0);
    this.#machine.force("drag");
    this.#brain.noteUserInput();
    this.#resolveWalk(false);
  }

  #moveDrag(x: number, y: number): void {
    this.#x = x;
    this.#y = y;
    this.#renderer.setPosition(x, y);
  }

  #endDrag(x: number, y: number, vx: number, vy: number): void {
    this.#dragging = false;
    this.#renderer.setDragging(false);

    const viewW = window.innerWidth;
    const viewH = window.innerHeight;
    const halfW = this.#displayHeight / 2;

    const cx = Math.min(Math.max(x, halfW), Math.max(halfW, viewW - halfW));
    const cy = Math.min(Math.max(y, this.#displayHeight), viewH - 2);

    // 用拖拽速度估算落点横向偏移，但不超过 180px——否则会横飞
    const gravity = this.#manifest.behaviors.gravity;
    const fallDist = Math.max(20, viewH - cy);
    const estSec = Math.sqrt((2 * fallDist) / gravity);
    const drift = Math.min(180, Math.max(-180, vx * estSec * 1000));
    const tx = Math.min(Math.max(cx + drift, halfW), Math.max(halfW, viewW - halfW));

    const landing = this.#world.findLanding(tx, cy);
    this.#x = cx;
    this.#y = cy;
    this.#renderer.setPosition(cx, cy);
    this.#surfaceId = this.#world.supportAt(cx, cy).id;

    this.#machine.force("fall");
    this.#runner.start(
      [{ type: "fall", fromX: cx, fromY: cy, toX: tx, toY: landing.y }],
      cx,
      cy,
      landing.surface.id
    );
    void vy;
  }

  // ── 决策 ──

  #think(now: number): void {
    const ctx: BrainContext = {
      now,
      state: this.#machine.state,
      x: this.#x,
      y: this.#y,
      surfaceId: this.#surfaceId,
      surfaceKind: this.#currentSurfaceKind(),
      world: this.#world,
      behaviors: this.#manifest.behaviors,
    };

    const intent = this.#brain.decide(ctx);
    if (!intent) {
      this.#brain.noteIdleSince(now);
      return;
    }
    this.#execute(intent);
  }

  #execute(intent: Intent): void {
    switch (intent.kind) {
      case "wander": {
        const target = intent.surfaceId;
        void this.walkToSurface(target, intent.x).then((ok) => {
          if (!ok) this.#brain.blacklistTarget(target, performance.now());
        });
        break;
      }
      case "idle":
        this.#setState("idle");
        break;
      case "sit":
        this.#setState("sit", randRange(8000, 20_000));
        break;
      case "sleep":
        this.#setState("sleep", randRange(6000, 12_000));
        break;
      case "wave":
        this.#setState("wave", 1250);
        break;
      case "jump":
        this.#setState("jump", 750);
        break;
      case "peek":
        void this.walkToNearestInput().then((ok) => {
          if (ok) this.#setState("peek", randRange(4000, 6000));
        });
        break;
    }
  }

  #setState(next: StateName, duration = 0): void {
    if (!this.#machine.set(next)) return;
    this.#stateUntil = duration > 0 ? performance.now() + duration : 0;
    if (next === "idle") this.#brain.noteIdleSince(performance.now());
  }

  #currentSurfaceKind(): SurfaceKind {
    return this.#world.surfaceById(this.#surfaceId)?.kind ?? "floor";
  }

  // ── 动画 ──

  #preloadAllClips(): void {
    for (const id of CLIP_IDS) {
      const spec = this.#manifest.clips[id];
      if (!spec) continue;
      const url = this.#host.assetUrl(`skins/${this.#manifest.id}/${spec.sheet}`);
      this.#clipUrls.set(id, url);
      void this.#renderer.preload(url).catch(() => {
        /* 素材缺失不阻塞其他动作 */
      });
    }
  }

  #wantClip(id: ClipId, force = false): void {
    const spec = this.#manifest.clips[id];
    if (!spec) {
      if (this.#activeClip !== "idle") this.#wantClip("idle", force);
      return;
    }
    if (this.#activeClip === id && !force) return;

    const url = this.#clipUrls.get(id);
    if (!url) return;

    this.#activeClip = id;
    this.#renderer.applyClip(spec, url);
    this.#animator.play(id, spec, { force });
  }

  // ── 位置 ──

  #placeOnFloor(): void {
    // 位于底部中偏右：桌面端与首屏右上角的海报在垂直方向错开，
    // 窄屏上又避开了左下角的主按钮。
    const halfW = this.#displayHeight / 2;
    const viewW = window.innerWidth;
    const wanted = viewW * 0.72;
    this.#x = Math.max(halfW + 12, Math.min(viewW - halfW - 12, wanted));
    this.#y = window.innerHeight - this.#footOffset;
    this.#surfaceId = "floor";
  }

  #clampToViewport(): void {
    const halfW = this.#displayHeight / 2;
    const { w, h } = this.#world.viewport;
    this.#x = Math.min(Math.max(this.#x, halfW), Math.max(halfW, w - halfW));
    this.#y = Math.min(this.#y, h - this.#footOffset);
    this.#syncGeometry();
  }

  #resolveWalk(ok: boolean): void {
    const r = this.#walkResolve;
    this.#walkResolve = null;
    r?.(ok);
  }

  // ── 主循环 ──

  #start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#last = 0;
    this.#raf = requestAnimationFrame(this.#tick);
  }

  #stop(): void {
    this.#running = false;
    if (this.#raf) cancelAnimationFrame(this.#raf);
    this.#raf = 0;
  }

  #tick = (now: number): void => {
    if (this.#destroyed) return;
    this.#raf = requestAnimationFrame(this.#tick);

    if (!this.#last) {
      this.#last = now;
      return;
    }
    const dt = Math.min(50, now - this.#last);
    this.#last = now;

    if (this.#dragging) {
      this.#animator.update(dt);
      return;
    }

    const b = this.#manifest.behaviors;

    if (!this.#runner.done) {
      const px = this.#x;
      const py = this.#y;

      this.#runner.step(dt, b.walkSpeed, b.climbSpeed, b.gravity, b.terminalVelocity);

      const snap = this.#runner.snapshot;
      this.#x = snap.x;
      this.#y = snap.y;
      if (!this.#runner.done && snap.surfaceId) this.#surfaceId = snap.surfaceId;

      const maxStep =
        Math.max(b.walkSpeed, b.terminalVelocity) * (dt / 1000) * TELEPORT_TOLERANCE + 4;
      const moved = Math.hypot(this.#x - px, this.#y - py);
      if (moved > maxStep) {
        console.error(
          `[kkl-pet] PET_E_TELEPORT moved ${moved.toFixed(1)}px in ${dt.toFixed(1)}ms leg=${this.#runner.currentLegType}`
        );
      }

      this.#renderer.setPosition(this.#x, this.#y);
      this.#renderer.setFlip(snap.dx < -0.5);

      const clip = snap.clip;
      if (clip === "walk") this.#machine.set("walk");
      else if (clip === "climb") this.#machine.set("climb");
      else if (clip === "fall") this.#machine.set("fall");
    } else {
      if (this.#stateUntil && now >= this.#stateUntil) {
        this.#stateUntil = 0;
        this.#setState("idle");
      }

      const st = this.#machine.state;
      if (st === "idle" || st === "sit") this.#think(now);
      else if (st === "sleep") this.#brain.resetIdle();
    }

    this.#animator.update(dt);
  };

  hide(): void {
    this.#renderer.show(false);
    this.#stop();
    this.#invalid.stop();
    removeEventListener("scroll", this.#onUserScroll, { capture: true });
  }

  show(): void {
    if (this.#destroyed) return;
    this.#renderer.show(true);
    this.#invalid.start();
    addEventListener("scroll", this.#onUserScroll, { passive: true, capture: true });
    if (!this.#reduced) this.#start();
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#stop();
    this.#runner.stop();
    this.#invalid.stop();
    this.#offRoute?.();
    this.#drag.detach();
    removeEventListener("resize", this.#onResize);
    removeEventListener("scroll", this.#onUserScroll, { capture: true });
    this.#renderer.destroy();
  }
}
