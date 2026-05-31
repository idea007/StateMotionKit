# StateMotionKit

<p>
  <a href="./README.zh-CN.md">简体中文</a>
</p>

<p>
  <a href="./LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg"></a>
  <img alt="Runtime: Web and Android" src="https://img.shields.io/badge/runtime-Web%20%2B%20Android-0f766e.svg">
  <img alt="Status: Lab" src="https://img.shields.io/badge/status-lab-orange.svg">
</p>

StateMotionKit is a set of standalone experimental runtimes for playing exported state animation packages.

It focuses on one practical question: after an animation template is exported from the editor, can the same state machine, transitions, control layers, and vector path animations continue to run in a normal Web page or Android app?

## Demo

| Web demo | Android demo |
| --- | --- |
| <img src="./docs/assets/web-demo.gif" alt="StateMotionKit Web demo" width="520"> | <img src="./docs/assets/android-demo.gif" alt="StateMotionKit Android demo" width="260"> |
| [MP4](./docs/assets/web-demo.mp4) | [MP4](./docs/assets/android-demo.mp4) |

## Features

- Load exported state animation packages in store zip format.
- Drive state machine layers with enum and trigger parameters.
- Play per-layer states, transitions, exit time, and non-loop completion logic.
- Project control layer output onto motion layers, including theme and transform controls.
- Sample `position`, `scale`, `rotation`, `opacity`, `fill`, `stroke`, and `path` keyframes.
- Preview the same exported package in two standalone runtimes:
  - Web demo rendered with SVG.
  - Android demo rendered with a custom Canvas `View`.

## Quick Start

### Web

```bash
cd lab-state-anim-drive-js
python3 -m http.server 5211
```

Open `http://localhost:5211/`, then choose `robot-state-anim.zip` or another exported state animation zip from the page.

### Android

Open `lab-state-anim-drive-android` in Android Studio, or build from the command line:

```bash
cd lab-state-anim-drive-android
./gradlew assembleDebug
```

The Android demo reads the bundled asset:

```text
app/src/main/assets/state_anim_robot.zip
```

The generated debug APK is written to:

```text
app/build/outputs/apk/debug/app-debug.apk
```

## Project Structure

```text
.
├── README.md                     # English README shown by GitHub
├── README.zh-CN.md               # Chinese README
├── lab-state-anim-drive-js/      # Browser-side state animation driver
│   ├── README.md                 # Web demo usage
│   ├── index.html                # Page entry
│   ├── app.js                    # Runtime, package loading, SVG rendering
│   ├── pathMorphRuntime.js       # Generated path morph runtime
│   ├── styles.css
│   └── 技术文档.md
├── lab-state-anim-drive-android/ # Android Canvas demo
│   ├── README.md
│   └── app/src/main/
├── docs/assets/                  # README demo media
├── robot-state-anim.zip          # Sample exported package
└── LICENSE
```

## Package Input

The labs are designed for exported state animation packages that contain:

- `index.json`
- `state-anim.json`
- one or more `.state.compiled.json` files
- optional preview or SVG resources

The Web demo can also load compatible descriptor JSON files. For local descriptor files that reference relative compiled assets, zip packages are recommended because browsers cannot freely read adjacent files from disk.

## Runtime Coverage

The current labs cover the core playback path:

- state and transition selection
- frame advancement and speed control
- trigger consumption
- `exitTime` and `onComplete`
- control layer projection
- path interpolation and path morph fallback
- SVG path parsing on Android

These labs are not full editor runtimes. Pixel-level effects, Pixi/WebGL rendering details, complex masks, filters, and editor-only diagnostics may differ from the source editor.

## Design Goals

- **Portable**: each lab can be copied into another project without importing the editor source tree.
- **Inspectable**: runtime state should be visible enough to debug state transitions and control layer projections.
- **Conservative**: unsupported editor features should degrade visibly instead of failing silently.
- **Comparable**: the same exported package can be checked across Web and Android.

## Roadmap

- Add fixture-based runtime tests for descriptor and zip loading.
- Add visual regression samples for common state transitions.
- Extract shared package parsing rules into a small documented runtime core.
- Add more exported packages that cover masks, nested frames, and complex path morph cases.

## Documentation

- [Chinese README](./README.zh-CN.md)
- [Web demo README](./lab-state-anim-drive-js/README.md)
- [Web runtime technical notes](./lab-state-anim-drive-js/技术文档.md)
- [Android demo README](./lab-state-anim-drive-android/README.md)

## License

StateMotionKit is released under the [Apache License 2.0](./LICENSE).
