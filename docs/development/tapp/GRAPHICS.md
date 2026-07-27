# Tapp 图形与轻量游戏能力

本文描述 **第一版** 轻量交互 / 游戏相关能力：Canvas、WebGL、包内资源、音频与
生命周期。整体沙箱边界见 [安全沙箱](SANDBOX.md)，API 细节见
[API 参考](API_REFERENCE.md)。

## 第一版承诺

| 支持 | 不支持（明确不做） |
| ---- | ------------------ |
| Page 内 Canvas 2D / WebGL / WebGL2 | Widget 上跑重 3D 场景 |
| 包内 `assets/` 静态资源 → blob URL | 任意外网贴图 / CDN 引擎脚本 |
| `media:audio` 时 `media-src blob: data:` | 任意 `https:` 音视频流 |
| `'wasm-unsafe-eval'`（CSP） | Worker / SharedArrayBuffer / 多线程 WASM |
| 全屏、`allow-pointer-lock`、pause/resume | 默认放开 `allow-same-origin` |

开发者可直接使用浏览器原生 API（`canvas.getContext('2d'|'webgl2')`、Web Audio、
`requestAnimationFrame`）。宿主 **不** 提供自研 WebGL 引擎封装。

## 包内资源 `manifest.assets`

在 Manifest 中声明相对安装根的路径，且必须位于 `assets/` 下：

```json
{
  "assets": [
    "assets/sprite.png",
    "assets/beep.wav",
    "assets/level.json"
  ]
}
```

约束：

- 每包最多 64 个资源；单文件 ≤ 5 MiB；合计 ≤ 20 MiB
- 允许二进制；**不允许** `.js` / `.html` 作为 asset 路径
- 直接安装可在请求体中附带 `assets: { "assets/foo.png": "<base64>" }`
- `.tapp` 压缩包只需在 zip 内放入对应文件
- **不要** 把关卡贴图塞进 `Tapp.storage`（那是用户数据，有 5 MiB 硬限）

运行时：

```javascript
const list = await Tapp.assets.list();
const { url, mimeType, size } = await Tapp.assets.getUrl("assets/sprite.png");
const img = new Image();
img.src = url; // 仅 data: / blob: 可通过沙箱图片策略

const { buffer } = await Tapp.assets.getArrayBuffer("assets/level.json");
// iframe 销毁时自动 revoke；也可手动：
Tapp.assets.revoke(url);
Tapp.assets.revokeAll();
```

`blob:` URL **必须在沙箱内创建**（无 `allow-same-origin` 时不能与父页面共享 blob）。
宿主只返回 base64，SDK 在 iframe 内 `createObjectURL`。

## 音频

- 权限：`media:audio`（basic）
- 授予后 CSP 为 `media-src blob: data:`，可用 `new Audio(blobUrl)` 播放包内音频
- **Web Audio API**（`AudioContext` + 振荡器）不依赖 `media-src`，可用于程序化音效
- 切后台时请在 `Tapp.lifecycle.onPause` 中暂停；`onResume` 恢复

## WASM

CSP `script-src` 包含 `'wasm-unsafe-eval'`，可用包内 `.wasm` 经
`Tapp.assets.getArrayBuffer` 后 `WebAssembly.instantiate`。
仍禁止 Worker 与任意网络 `importScripts`。

## 生命周期与性能

宿主在页面不可见时发送 `lifecycle:pause` / `lifecycle:resume`。游戏循环应：

```javascript
let paused = false;
Tapp.lifecycle.onPause(() => { paused = true; /* stop audio */ });
Tapp.lifecycle.onResume(() => { paused = false; });
Tapp.lifecycle.onDestroy(() => {
  cancelAnimationFrame(raf);
  Tapp.assets.revokeAll();
});

function frame(ts) {
  if (!paused) update(ts);
  draw();
  requestAnimationFrame(frame);
}
```

建议：

- 重渲染只放在 **Page**（或全屏窗口），不要把主循环塞进多个 Widget
- 失焦后停止 rAF 累加逻辑与音频，避免后台空转
- 指针锁定依赖用户手势；全屏使用 `Tapp.ui.fullscreen.*` 并申请 `ui:fullscreen`

## 官方示例

内置示例仅 **helloWorld**（`com.myriad.hello-world`）。社交客户端 **Aro**、
联机 **斗地主** 等完整应用发布在官方
[tapp-store](https://github.com/Myriad-You/tapp-store)
（`apps/com.myriad.aro`、`apps/com.myriad.doudizhu`），经商店索引安装。目录协议、
`manifest.assets` 在商店中的路径拼接与安装回退见 [Tapp 商店](STORE.md)。

## 后续（非第一版）

blob Worker、更大资源预算、WebGPU opt-in 等单独设计，不改变默认沙箱哲学。
