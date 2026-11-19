# kkl-pet

让一只卡通白鸟住进网页。它会走动、沿元素边缘攀爬、坐在卡片上、探头看输入框，可以被拖走扔掉。

**所有位移都是连续的 walk / climb / fall，不存在瞬移。**

![走路循环](https://cdn.jsdelivr.net/gh/kanxingyv/kkl-pet@master/docs/demo-walk.gif)

![站在网页元素上](https://cdn.jsdelivr.net/gh/kanxingyv/kkl-pet@master/docs/demo-site.png)

## 特性

- **不瞬移** — 位置只能沿位移段连续变化，代码里没有 `setPosition(target)` 这类兜底；单帧位移超限会触发 `PET_E_TELEPORT` 断言
- **不碰表单** — `peek` 只蹲在输入框边框上探头，绝不 focus、绝不写入，验收脚本里有断言
- **不受宿主 CSP 限制** — 样式走 constructable stylesheet 进 shadow root，`style-src 'self'` 也拦不住
- **零运行时依赖** — 站内版与扩展产物各 50KB，无框架无库
- **11 个动作** — 7 个 AI 分帧动画 + 4 个程序化刚体变换

## 快速开始

```bash
npm install
npm run build          # → dist/site + dist/extension + dist/embed
npm run serve          # 带真实 CSP 的测试台 → http://127.0.0.1:5180/
```

测试台地址加 `?pet-debug` 能看到世界模型叠层：所有可站立表面、导航端口、当前路径。

`node scripts/sync-to-web.mjs` 是作者自用的同步脚本（把产物拷进主站），外部使用不需要它。

## 三种接入方式

| 方式 | 适用场景 | 怎么用 |
| --- | --- | --- |
| **站内版** | 自己的站点，CSP 可控 | `<script src="/assets/pet/pet.js" defer></script>` |
| **浏览器扩展** | 任意站点，包括严格 CSP | 加载 `dist/extension`（开发者模式） |
| **单文件植入** | 任意站点，一行 script | `<script src="https://kkl.ltd/assets/pet/pet.embed.js" defer></script>` |

### 单文件植入的边界

`pet.embed.js` 把 11 个动作的素材全部内联成 data URI（约 962KB），产物不依赖任何外部请求，拷到哪都能用。

但它**挡不住 CSP**：

- 站点 `script-src` 不允许这个来源 → 脚本根本不执行
- 站点 `img-src` 不允许 `data:` → 素材加载失败

判断方法：打开目标站点，F12 看响应头里有没有 `Content-Security-Policy`。没有这一行，单文件植入就能用。

kkl.ltd 自己是 `script-src 'self'`，所以只能走站内版或扩展——这也是当初为什么要把样式做成 constructable stylesheet。

### 单文件版的用法

```html
<script src="https://kkl.ltd/assets/pet/pet.embed.js" defer></script>
```

装好后按 `Alt + P` 开关。关闭状态存 `localStorage`，同一域名下不再出现。

比站内版少两个能力：没有页脚入口（第三方站点没有你的页脚），不读取站点自己的皮肤配置。

## 目录

```
src/
├─ entry/site.ts        站内壳（推导资源基址 / 读持久化 / Alt+P / 页脚入口）
├─ entry/extension.ts   MV3 content script 壳
└─ core/
   ├─ pet.ts            编排器，全库唯一跑 rAF 的地方
   ├─ machine.ts        表驱动状态机（非法转移会被拒绝并告警）
   ├─ brain.ts          行为决策（加权随机 + 冷却 + 失败黑名单）
   ├─ animator.ts       clip 播放与优先级
   ├─ world/probe.ts    家具探测（DFS + 剪枝 + 预算 + 包含去重）
   ├─ world/world.ts    表面集合、地面、左右墙、落点查找
   ├─ nav/graph.ts      端口节点 + 有向边（walk / climb / fall）
   ├─ nav/dijkstra.ts   最短路径（代价单位 ms）
   ├─ nav/plan.ts       边序列 → 位移段，合并连续 walk
   ├─ nav/exec.ts       位移段执行器（严格连续，段末精确对齐）
   ├─ render/           六层 DOM、sprite 偏移、脏土、调试叠层
   ├─ input/drag.ts     pointer 拖拽 + 抛掷
   ├─ skin/             manifest 协议、校验、注册表
   └─ host/             Host 抽象（站内 / 扩展的唯一差异点）
skins/kkl-whitebird/   皮肤：manifest.json + out/*.webp
tools/petkit/          素材管线（六个 step，见 docs/assets.md）
shells/extension/      MV3 manifest 与图标
```

## 关键设计

### 禁止瞬移

宠物不能"设置坐标"，只能沿位移段移动。图节点是**表面上的采样点**，只有同一 x 上的两点才能靠 walk / climb 连起来。

- 同表面：线性链 walk
- 上方 → 下方：fall（重力积分）
- 下方 → 上方：climb（沿目标表面左右边缘，横移摊进攀爬时长）
- 左右视口边缘：整条可攀爬的墙

不可达的目标直接放弃，进 30 秒黑名单。代码里没有 `setPosition(target)` 这种兜底。

`pet.ts` 里有防退化断言：任何一帧的单帧位移超过物理上限就报 `PET_E_TELEPORT`。

### 滚动时宠物不跟随内容

宠物是视口坐标系里的居民。站在某个表面上时每帧对齐该表面（骑乘 carry），表面滚走就立刻 fall——既不悬空也不"粘"在半空。

### 样式不受宿主 CSP 限制

CSS 在构建期内联成字符串，运行时通过 `new CSSStyleSheet()` + `adoptedStyleSheets` 注入 shadow root。不产生 `<style>` 元素，因此 kkl.ltd 的 `style-src 'self'` 与任意宿主站的 CSP 都拦不住。

动态值只用 `el.style.*`（CSSOM）和 `el.animate()`（WAAPI），同样不受限。

### 不碰用户的表单

`peek` 只站在输入框边框上、探头看。**绝不 focus、绝不写入**。验收脚本里有断言：`input.value` 与 `document.activeElement` 全程不变。

## 构建产物

| target | 产物 | 说明 |
| --- | --- | --- |
| site | `dist/site/pet.js`（约 50KB）+ `skins/` | 站内 `<script defer>` |
| extension | `dist/extension/` | MV3，content_scripts 加载 `pet.js` |

产物是 IIFE——MV3 的 `content_scripts` 不支持 `type:"module"`，这是两壳能共用一份产物的前提。运行时零依赖。

## 换一只宠物

见 `docs/assets.md`。最小操作是三件事：换 `out/*.webp`、改 `manifest.json`、在 `skin/registry.ts` 加一行。

## 文档

- `docs/素材规格书.md` —— **素材作业清单：6 个动作、每张一段可直接复制的 prompt**
- `docs/api.md` —— 对外 JS API 与事件
- `docs/assets.md` —— 素材管线与换皮肤手册

## 授权

代码 MIT（[LICENSE](./LICENSE)），角色形象与 `skins/` 下的全部美术素材 CC BY-NC 4.0（[LICENSE-ASSETS](./LICENSE-ASSETS)）。

想商用角色形象需要单独授权；做自己的宠物请画自己的角色，代码随便用。
