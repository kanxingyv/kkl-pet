# 对外 API

站内版挂在 `window.KKLPet`，同时提供 `window.kklPet` 这个更短的控制入口。
扩展版跑在 content script 的隔离世界里，页面脚本拿不到（这是浏览器的隔离语义，不是缺陷）。

## mount

```js
const handle = KKLPet.mount({
  skin: "kkl-whitebird",     // 皮肤 id 或 manifest 对象
  scale: 1,                  // 相对 manifest.display.height
  zIndex: 2147483000,
  target: document.body,     // 挂载父节点
  reducedMotion: "auto",     // auto | force | off
  interactive: true,         // 是否允许拖拽
  debug: false,              // 世界叠层，等价于 URL 加 ?pet-debug
});
```

窄屏会自动收尺寸：`displayHeight = min(162, innerWidth * 0.24)`，否则 390px 的手机屏上会压住正文。

## handle

| 方法 | 说明 |
| --- | --- |
| `getState()` | `{ clip, frame, state, x, y, surface, reduced, surfaces, enabled }` |
| `diag()` | 探针耗时、表面数、图规模，验收用 |
| `walkTo(target)` | 走到选择器对应元素所在表面，或 `{x, y}` 点下方。返回 `{ok, code}` |
| `hide()` / `show()` | 隐藏 / 显示（不卸载） |
| `dismiss()` | 关闭并持久化，下次访问不再出现 |
| `summon()` | 唤醒并持久化 |
| `unmount()` | 完全移除 DOM、观察器、事件 |

```js
const r = await handle.walkTo(".card");
// 可达 → { ok: true }
// 不可达 → { ok: false, code: "PET_E_UNREACHABLE" }，宠物原地不动
```

`walkTo("body")` / `walkTo("floor")` 表示回到地面。

## 事件

```js
const off = KKLPet.on("statechange", (e) => console.log(e));
off(); // 取消订阅
```

`ready` · `statechange` · `actionstart` · `actionend` · `navigatefail` · `dragstart` · `dragend` · `error`

## 其他

```js
KKLPet.skins();                    // ["kkl-whitebird"]
KKLPet.registerSkin(id, manifest);
KKLPet.version;                    // "0.1.0"
KKLPet.errors;                     // 错误码表
```

## 错误码

| 码 | 含义 |
| --- | --- |
| `PET_E_MANIFEST` | manifest 字段非法，信息里会指出具体字段 |
| `PET_E_NO_SKIN` | 皮肤未注册 |
| `PET_E_UNREACHABLE` | 目标不可达（正常结果，不是异常） |
| `PET_E_TELEPORT` | 防退化断言触发：出现了非连续位移 |
| `PET_E_ASSET` | 素材加载失败 |
| `PET_E_NO_FETCH` | 站内版受 `connect-src 'none'` 限制，不能远程拉 manifest |

## 站内版额外的入口

- 页脚「打开桌面宠物」链接（关闭后才显示）
- `Alt + P` 切换（宠物不进 tab 序，这是键盘用户唯一的开关）
- `window.kklPet.summon()` / `.dismiss()` / `.handle`

## 运行时约束

`prefers-reduced-motion: reduce` 下：

- 只播 idle 的第一帧（静态）
- 不发起自主移动
- 仍可拖拽，但松手后**直接落到地面、不播下落动画**——这是全方案唯一允许的「非连续」例外，出于无障碍要求

其余任何情况，包括初始出现、导航、滚动导致支撑面消失，都必须是连续位移。
