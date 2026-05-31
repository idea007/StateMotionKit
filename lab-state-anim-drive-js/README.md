# State Anim Drive Web Lab

用于运行导出状态动画包的独立浏览器 runtime。

这个 demo 会加载 state animation descriptor 或 store zip，构建运行时状态机，并使用 SVG 渲染结果。它用于在编辑器外验证导出资源，不替代编辑器内的预览渲染器。

## 特性

- 加载 `.zip` 包或兼容的 descriptor `.json` 文件。
- 支持播放、暂停、重置和逐帧推进。
- 支持切换 layer state 和触发 interruption transition。
- 基于自动生成的 UI 控件驱动 state machine 参数。
- 渲染 vector layer、frame node、opacity、color、transform 和 path 关键帧。
- 展示 runtime 状态和 warning，方便调试。

## 快速开始

```bash
cd lab-state-anim-drive-js
python3 -m http.server 5211
```

打开：

```text
http://localhost:5211/
```

然后在页面里选择文件：

- `../robot-state-anim.zip`
- 其他导出的状态动画 zip
- 兼容的 state animation descriptor JSON

## 输入格式

推荐输入是包含以下文件的 store zip：

- `index.json`
- `state-anim.json`
- 一个或多个 `.state.compiled.json` 文件

如果 descriptor JSON 包含 `variants[]`、`faceParts[]`，以及 `variants[].compiledUrl` 或内联 `variants[].motion`，也可以直接加载。

## 控件

- **Play / Pause**：通过 `requestAnimationFrame` 连续播放。
- **Step +1f**：将当前 runtime 推进 1 帧。
- **Reset**：恢复 state machine 参数和 layer state 默认值。
- **Interrupt**：触发第一个 trigger-like 参数，便于测试打断过渡。
- **Layer States**：在可用时切换单个 layer 的 state。
- **Params**：编辑生成的 state machine 参数。

## 开发说明

- `app.js` 包含独立 runtime、包加载逻辑和 SVG renderer。
- `pathMorphRuntime.js` 来自编辑器 path morph runtime 的生成产物。除非要冻结 lab 专用版本，否则不要手工修改。
- `技术文档.md` 记录更详细的 runtime 行为和一致性边界。

## 已知限制

- SVG 渲染用于 runtime 验证，不保证与 Pixi/WebGL 预览像素级一致。
- pixel-match transition、复杂 filter、mask 和编辑器专用诊断能力没有完整复现。
- 引用相邻文件的本地 descriptor JSON 可能受浏览器沙箱限制，推荐优先使用 zip 包。

## Smoke 检查

```bash
node --check app.js
node --check pathMorphRuntime.js
```
