# AGENTS.md

写给接手这个仓库的 AI 代理。人也能读，但它是按「冷启动」写的。

## 这是什么

浏览器桌面宠物「丁小红白」。**一套 core，两个壳**：Chrome MV3 扩展（可装进任意网站）与站内版（嵌入 kkl.ltd）。

宠物会在页面上走动、沿元素边缘攀爬、坐在卡片顶边、探头看输入框，可拖拽抛掷，也可关闭。

## 三条不能破的约束

改任何东西之前先读这三条。它们不是风格偏好，是这个项目存在的理由。

### 1. 禁止瞬移

**所有位置变化必须是连续的 walk / climb / fall 位移段。** 代码里不存在 `setPosition(target)` 这类兜底。

实现方式：

- 图节点是「表面上的采样点」，不是表面本身。只有同一 x 上的两点才能靠 walk / climb 连起来
- 同表面：线性链 walk
- 上方 → 下方：fall（重力积分）
- 下方 → 上方：climb，**沿目标元素左右边缘**，横移摊进整个攀爬时长
- 左右视口边缘：整条可攀爬的墙
- 不可达的目标**直接放弃**（进 30 秒黑名单），不是「想办法挪过去」

`src/core/pet.ts` 的 `#tick` 里有防退化断言：任何一帧的单帧位移超过物理上限就报 `PET_E_TELEPORT`。这条断言抓到过真实的 bug（climb 到顶时横移 28px）。

唯一的例外是 `prefers-reduced-motion` 用户拖拽松手后直接落地面——无障碍要求，写在 `docs/api.md`。

### 2. 样式不能靠 `<style>` 或内联 style

宿主页的 CSP 可能是 `style-src 'self'`（kkl.ltd 就是）。所以：

- CSS 在构建期被 esbuild 的 text loader 内联成字符串（`src/core/styles/pet.css`）
- 运行时 `new CSSStyleSheet().replaceSync(css)` + `shadowRoot.adoptedStyleSheets` 注入 shadow root
- 动态值只用 `el.style.*`（CSSOM）和 `el.animate()`（WAAPI）——这两者不受 CSP 限制

`src/core/render/host-el.ts` 里 `adoptStyles()` 有三级降级：adopted → 同源 `<link>` → `<style>`。**不要为了方便直接插 `<style>`**，那会在 kkl.ltd 上直接失效。

### 3. 不碰用户的表单

`peek` 只站在输入框边框上、探个头。**绝不 focus、绝不写入 input。** 验收脚本 `tools/verify-behavior.mjs` 里有断言：`input.value` 与 `document.activeElement` 全程不变。

## 架构

```
src/
├─ entry/site.ts        站内壳（推导资源基址 / 持久化 / Alt+P / 页脚入口）
├─ entry/extension.ts   MV3 content script 壳
└─ core/
   ├─ pet.ts            编排器，全库唯一跑 rAF 的地方
   ├─ machine.ts        表驱动状态机（非法转移会拒绝并 warn）
   ├─ brain.ts          行为决策（加权随机 + 冷却 + 失败黑名单）
   ├─ animator.ts       clip 播放与优先级
   ├─ world/probe.ts    家具探测（DFS + 剪枝 + 预算 + 包含去重）
   ├─ world/world.ts    表面集合、地面、左右墙、落点查找
   ├─ nav/graph.ts      端口节点 + 有向边
   ├─ nav/dijkstra.ts   最短路径（代价单位 ms，不是 px）
   ├─ nav/plan.ts       边序列 → 位移段，合并连续 walk
   ├─ nav/exec.ts       位移段执行器（严格连续，段末精确对齐）
   ├─ render/           六层 DOM、sprite 偏移、尘土、调试叠层
   ├─ input/drag.ts     pointer 拖拽 + 抛掷
   ├─ skin/             manifest 协议、校验、注册表
   └─ host/             Host 抽象（两壳唯一差异点）
```

**两壳的唯一差异在 `host/`**：资源 baseURL、持久化（localStorage / chrome.storage.sync）、路由钩子。core 100% 共用。

产物是 **IIFE**：MV3 的 `content_scripts` 不支持 `type:"module"`，这是两壳能共用一份产物的前提。运行时零依赖。

## 常用命令

```bash
npm install
npm run build                  # dist/site + dist/extension
npm run build:dev              # 不压缩 + inline sourcemap
npm run typecheck

npm run serve                  # 带真实 CSP 的测试台 → http://127.0.0.1:5180/
                               # 加 ?pet-debug 看世界叠层（表面/端口/路径）
node tools/serve-web.mjs 5181  # kkl-web 的带 CSP 预览

node tools/verify.mjs http://127.0.0.1:5180/ out.png 1440 900
node tools/verify-nav.mjs      # 导航、路径、零瞬移
node tools/verify-behavior.mjs # 15 秒自动行为 + 拖拽 + 表单安全
node tools/verify-site.mjs     # 三档宽度 + Alt+P + 持久化
node tools/verify-ext.mjs      # 装扩展实测（会弹真实浏览器窗口）

node scripts/sync-to-web.mjs   # 同步到 ../kkl-web/assets/pet/
```

## 素材怎么改

**不要手改 `skins/*/out/*.webp`**，那是 `tools/petkit` 生成的。

```bash
node tools/petkit/cli.mjs all              # ingest → procedural → qa → pack
node tools/petkit/cli.mjs procedural --only walk   # 只重做一个动作
```

动作骨骼在 `tools/petkit/steps/05-procedural.mjs` 的 `MOTIONS` 表里，每个动作是一个 `fn(i, n)` 返回 `{rotate, scaleX, scaleY, dx, dy}`。全部是刚体变换——**不做肢体再articulation**，这是画风一致的前提。

QA 会检查脚底漂移，阈值按动作区分（`07-qa.mjs` 的 `LIMITS`）。改完一定要跑 `qa` 并看 `out/_contact/<action>.png`（带红线基准）。

素材规格：324×324@2x，锚点 (162, 300)，角色高 258，11 个动作约 924KB。

### 关于 AI 生成

`docs/assets.md` 里有完整实测记录。结论是：**多视角一致性是当前图像模型的硬边界**，两张 AI 侧身图都因为比例/五官漂移而不可用，所以首批素材改成程序化。`03-plan.mjs` + `actions/*.actions.json` 是 AI 通道的接口，接回来时在 `04-normalize` 补归一化。

## 常见陷阱（都踩过）

| 症状 | 原因 | 修法 |
| --- | --- | --- |
| 走路时脚底上下抽 10px | 旋转给图像加了透明边，按图像边界对齐 | 旋转后重量 alpha 包围盒、裁透明边、按内容底边对齐（`lib/image.mjs` 的 `composeFrame`） |
| 用 `--only` 后其他动作消失 | `pack` 覆盖了 `manifest.clips` | 已改成合并写入 |
| 发布包里多 700KB | `copySkins` 把 `out/_contact` 也复制了 | `build.mjs` 里有 filter 排除 |
| 服务器上旧文件删不掉 | install 脚本只覆盖不删除 | 手工 `rm -rf` |
| 首屏出现两只鸟 | 宠物初始位置与主站海报同侧 | 改成底部中偏右（`viewW * 0.72`） |
| 窄屏宠物压住正文 | 162px 在 390 屏上占 1/4 | `displayHeight = min(162, innerWidth * 0.24)` |

## 约定

- **提交按文件加**，别 `git add -A`
- 代码与素材分开提交；换素材时 message 写清楚哪个动作、多少帧、改了什么参数
- `dist/` 不入库（`npm run build` 可重建）
- `skins/*/out/*.webp` **要**入库——它是设计资产，换一版 sharp 重跑像素就变了
- `skins/*/src/{normalized,gen}` 不入库，可从 `src/raw/base.png` 重新生成
- 中文文档、中文提交信息

## 还没做的

- 扩展的 popup UI（开关 / 皮肤切换 / 本站禁用），现在只能靠 Alt+P 与 API
- MV3 里给页面世界暴露 API（需要 `chrome.scripting.executeScript({ world: 'MAIN' })` 注入桥接）
- 按站点禁用（`disabledHosts`）
- `climb` 的手臂动作帧
- 第二只皮肤（换皮肤流程见 `docs/assets.md`，但还没有实跑验证）
