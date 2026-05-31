# State Anim Drive Android Lab

这是 `lab-state-anim-drive-js` 的 Kotlin/Android 演示版本。应用会从 `app/src/main/assets/state_anim_robot.zip` 读取导出的 state anim package，解析 `index.json`、`state-anim.json` 和各个 `.state.compiled.json`，然后用自定义 `View` 在 Android Canvas 上播放状态动画。

## 特性

- 读取导出的 store zip。
- 支持状态机 enum / trigger 参数。
- 支持 action layer 状态切换、非循环状态完成后回到默认状态。
- 支持主题 control layer 的 fill 投影。
- 支持 jumping control layer 的 transform 投影。
- 支持 `position / scale / rotation / opacity / fill / stroke / path` 关键帧采样。
- SVG path 通过 Kotlin 解析后绘制到 Android Canvas。

## 快速开始

用 Android Studio 打开本目录：

```text
lab-state-anim-drive-android
```

或者在命令行构建：

```bash
cd lab-state-anim-drive-android
./gradlew assembleDebug
```

生成 APK：

```text
app/build/outputs/apk/debug/app-debug.apk
```

## Runtime 流程

1. `StateAnimLoader` 从 assets 读取 zip 并解析导出描述。
2. `StateAnimPlayer` 推进状态机、transition、trigger 和 control layer 投影。
3. `StateAnimView` 将当前 snapshot 绘制到 Android Canvas。
4. `MainActivity` 提供播放、步进、重置、打断和参数切换控件。

## 项目文件

```text
app/src/main/java/com/example/stateanimdrive/
├── MainActivity.kt
├── StateAnimLoader.kt
├── StateAnimPlayer.kt
├── StateAnimView.kt
├── SvgPathData.kt
├── AnimationMath.kt
└── Models.kt
```

## 已知限制

这个 demo 不是完整编辑器运行时移植，目标是让导出的 state anim package 在普通 Android 页面中独立演示。它针对当前 zip 的数据形态实现了核心播放链路；像 JS 版本中的 pixel-match 贴图过渡、复杂 path morph 诊断等编辑器能力没有完整迁移。
