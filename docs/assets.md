# 素材管线与换皮肤

## 为什么要写清楚这一节

这套宠物的技术难点不在引擎，在**素材一致性**。

现有角色只有一张 300×300 的 GIF（一条 10 帧、0.38 秒的原地呼吸循环）和一张 600×600 的 PNG。没有走路、爬行、坐下的动作，也没有逐帧源文件。

我实测过 AI 生成多视角帧：以基础图作参考图 + `input_fidelity: high`，连跑两张，结果都不达标——

| 问题 | 第一次 | 第二次（改进 prompt + 洋红色键背景） |
| --- | --- | --- |
| 背景 | 把"透明"画成了棋盘格，且没有 alpha 通道 | 纯洋红，可抠 |
| 角色 | 身体拉成鸡蛋形，脚消失 | 比例偏高偏窄，眼睛从闭眼变成睁眼 |
| 可用性 | 不可用 | 单独看像，和原图并排就是"另一只鸟" |

**结论**：多视角一致性是当前图像模型的硬边界，不是 prompt 能解决的问题。而 idle 用的是原图，一旦切到 AI 生成的侧身帧，神态会突然变脸。

所以首批素材改成**从同一张基础图做刚体变换**（缩放 / 旋转 / 位移），一致性问题彻底消失。代价是没有真正的侧身——但对 Q 版圆滚滚的角色，正面小碎步 + 左右摇摆反而更讨喜（参考 Desktop Goose 的做法：动作少、交互强）。

管线保留着，等有更强的模型或更好的多视角方案时，`normalize` 那条路可以随时接回来。

## 管线结构

```
tools/petkit/
├─ cli.mjs
├─ lib/image.mjs            读 RGBA、alpha 包围盒、脚底质心、贴图、拼条
├─ actions/
│  └─ kkl-whitebird.actions.json   动作规格与生成 prompt（AI 通道用）
└─ steps/
   ├─ 01-idle.mjs          从静态图生成呼吸循环
   ├─ 02-ingest.mjs        量基础图：bbox、脚底锚点、主色板、描边色
   ├─ 03-plan.mjs          展开成待生成任务清单（AI 通道用）
   ├─ 05-procedural.mjs    程序化合成全部动作帧 ← 当前实际使用
   ├─ 06-pack.mjs          PNG 序列 → 水平条 webp + 更新 manifest.clips
   └─ 07-qa.mjs            contact sheet + 锚点漂移检查
```

每个 step 只读写磁盘，可单独重跑、可断点续跑。

## 当前流程（从一张图生成整套动作）

```bash
node tools/petkit/steps/02-ingest.mjs      # 量基础图
node tools/petkit/steps/05-procedural.mjs  # 合成 11 个动作
node tools/petkit/steps/07-qa.mjs          # 检查锚点漂移，出 contact sheet
node tools/petkit/steps/06-pack.mjs        # 打包 webp + 更新 manifest
```

产物：

- `skins/kkl-whitebird/src/normalized/<action>/fNN.png` —— 逐帧留档
- `skins/kkl-whitebird/out/<action>.webp` —— 水平条 spritesheet
- `skins/kkl-whitebird/out/_contact/<action>.png` —— 每动作一张，带脚底线
- `skins/kkl-whitebird/manifest.json` —— `clips` 被自动更新

`05-procedural.mjs` 里的 `MOTIONS` 表定义了每个动作的骨骼：

```js
walk: {
  frames: 8, fps: 12,
  fn: (i, n) => {
    const p = (i / n) * Math.PI * 2;
    return {
      rotate: Math.sin(p) * 3.6,          // 左右摇摆
      scaleY: 1 + Math.sin(p * 2) * 0.022, // 双倍频率上下颠
      dx: Math.sin(p) * 4.5,               // 重心左右移
      dy: -Math.abs(Math.sin(p * 2)) * 2.2 // 抬脚
    };
  }
}
```

全部是刚体变换，**不做肢体再articulation**——这是画风一致的前提。

## QA 在查什么

| 检查 | 阈值 | 为什么 |
| --- | --- | --- |
| 脚底漂移 | idle/walk/fall/peek ≤ 4px，climb ≤ 8px，jump ≤ 30px | 漂移超了走路会上下抽 |
| 顶部起伏 | ≤ 26px（land/jump 单独放宽） | 太大说明某帧姿态异常 |
| contact sheet | 每动作一行 + 红线基准 | 肉眼看脚是否压在同一条线上 |

这里踩过一个坑：**旋转会给图像加一圈透明边，按图像边界对齐会让脚底每帧漂几像素**。修法是旋转后重新量 alpha 包围盒、裁掉透明边，再按内容底边对齐。修之前 walk 的漂移是 10px，修完是 2px。

## 接 AI 生成通道

`03-plan.mjs` 会把 `actions.json` 展开成任务清单，每条含完整 prompt、参考图、落地路径：

```bash
node tools/petkit/steps/03-plan.mjs --emit   # 输出 JSONL
```

`actions.json` 的关键是 `base.style` 这一段会被**原样拼到每个 prompt 前面**，避免风格漂移：

```json
"style": "flat vector cartoon mascot, thick warm-brown outline in #a9634f, pure white chubby round body, tiny yellow beak, pink blush cheeks, red swim trunks, closed happy eyes, absolutely no shading, no gradient, no drop shadow, transparent background, full body centered"
```

实测经验：

- 不要写 `transparent background` 然后指望模型真给 alpha，它经常画一个棋盘格上去 → 改成**纯洋红 `#FF00FF` 色键**，后期抠图
- `do not redesign` / `keep it identical` 比 `same character` 有效
- 每个视角先生成一张"站姿锚点"人工确认，再拿它当同视角后续任务的第二张参考图
- 内置 ImageGen 单张约 5–10 credits，一张 1024×1024 出图

拿到图之后：

```bash
# 04-normalize 尚未实现：AI 通道的洋红色键抠底 → 包围盒对齐 → 统一画布。
# 当前走程序化路径，不需要这一步；接回 AI 通道时在这里补。
node tools/petkit/steps/06-pack.mjs        # 打包
```

这是刻意的取舍：在一致性没解决之前，写一半的归一化脚本没有意义。

## 换一只宠物

最小操作三步：

1. 新建 `skins/<id>/`，放 `src/raw/base.png`（一张正面透明 PNG）与 `out/*.webp`
2. 抄一份 `manifest.json`，改 `id`、`name`、`canvas`、`anchor`、`clips`
3. 在 `src/core/skin/registry.ts` 的 `REGISTRY` 里加一行 import

运行期也可以用 `KKLPet.registerSkin(id, manifest)` + `setSkin` 切换，但 webp 必须是可访问的 URL。

## manifest 里最容易搞错的三件事

**`anchor`**：画布内的脚底坐标。所有帧必须共用同一锚点——这是走路不左右抖的前提。渲染器用它算负 margin，翻转与压扁都绕这个点进行。

**`body.width`**：宠物实际宽度。导航建图时用它判断两个表面是否有足够重叠可以跨越，以及边缘采样点的内缩距离。填大了会走到元素外面，填小了会卡在缝隙里。

**`clips[].frames`**：必须和 webp 里的实际帧数一致。数量不符会出现半帧或跳帧。

## 素材规格速查

| 项 | 值 |
| --- | --- |
| 画布 | 324 × 324（2x，显示 162 CSS px） |
| 锚点 | (162, 300) |
| 角色高度 | 258 / 324 |
| spritesheet | 水平条，webp quality 92 |
| 单动作帧数 | 4–10 |
| 包体 | 11 个动作约 945KB |
