# Setup — JARVIS Phase 1

## Prerequisites (Windows 10/11)
1. **Node.js** 18+ — https://nodejs.org
2. **Rust** (stable) via rustup — https://rustup.rs
3. **Tauri v2 prerequisites** — Microsoft Visual Studio C++ Build Tools + WebView2 (usually preinstalled on Win 11). Full list: https://v2.tauri.app/start/prerequisites/
4. An Anthropic API key — https://console.anthropic.com

## Install
```bash
git clone <this repo>
cd JARVIS
npm install
```

## Configure your API key (dev)
The current skeleton reads a dev-only key from `localStorage` under
`jarvis_dev_api_key` (see `App.tsx` — clearly commented as a placeholder).
For now, run the app once, open devtools, and run:
```js
localStorage.setItem("jarvis_dev_api_key", "sk-ant-...");
```
**Before any real use**, replace this with the `keyring`-backed secure
storage described in `SECURITY.md` — a Tauri command that reads/writes the
OS credential vault instead of localStorage. This is flagged as the top
follow-up item.

## Run in development
```bash
npm run tauri dev
```
This starts Vite on `localhost:1420` and launches the Tauri window pointed
at it, per `tauri.conf.json`.

## Run tests
- Rust unit tests: `cd src-tauri && cargo test`
- Frontend: `npm run test` (vitest — no tests written yet in this skeleton
  beyond what's needed to bootstrap; add tests alongside each new tool/provider)

## Build a Windows package
```bash
npm run tauri build
```
Produces an NSIS installer and MSI under `src-tauri/target/release/bundle/`.
You'll need real icon files in `src-tauri/icons/` first — the ones referenced
in `tauri.conf.json` are placeholders and are NOT included in this skeleton.

## Wiring up what's stubbed
Two things in this skeleton are interfaces without a working backend, by design:
1. **Clipboard tools** (`read_clipboard`, `write_clipboard`) — add
   `tauri-plugin-clipboard-manager` and call it from `tools.rs::execute`.
2. **Voice pipeline** — the `VoiceProvider` TS interface exists
   (`src/types/voice.ts`) but has no STT/TTS implementation wired into
   `App.tsx` yet. Recommended first implementation: Web Speech API for STT/TTS
   (built into WebView2/Chromium, zero extra native deps) as `providers/WebSpeechProvider.ts`.

## Phase 2 notes

### New dependencies
`Cargo.toml` now includes `trash` (Recycle Bin deletion) and `sysinfo`
(process inspection). Run `cargo build` after pulling Phase 2 to fetch them —
I could not verify these resolve/compile in this sandbox (no network).
`sysinfo`'s process API has changed across its 0.2x/0.3x versions; if
`list_running_applications` fails to compile, check `sysinfo`'s current
docs for the `Process` accessor names (`.name()`, `.cpu_usage()`, `.memory()`)
against whatever version Cargo actually resolves.

### Running the Phase 2 security test suite
```bash
cd src-tauri
cargo test security_tests -- --test-threads=1
```
The `--test-threads=1` is required: several tests in this module call
`std::env::set_var("USERPROFILE", ...)` to isolate a temp workspace, and
that's process-global state that will race under parallel test execution.
This is flagged as a known limitation in the file itself — the real fix is
refactoring `PathGuard` to take an injected root rather than reading the
environment, which is a good candidate for a quick follow-up before Phase 3.

### Wiring up what's still stubbed (Phase 2 additions)
1. **Browser automation** — `actions/browser.rs` defines `BrowserOperation`
   and the `BrowserProvider` trait, but nothing implements the trait. The
   most realistic path: spawn a Node + Playwright sidecar process from Rust
   (Tauri supports sidecar binaries) and communicate over stdio/a local
   socket with a small fixed JSON protocol matching `BrowserOperation`'s
   variants — critically, never pass an AI-generated string as a shell
   argument or script to that sidecar, only structured enum variants.
2. **Recycle Bin restore** — `delete_file.rollback()` currently returns
   `ToolError::Unavailable` with an honest explanation. A real
   implementation needs the Windows Shell API's `IFileOperation` (or a
   crate wrapping it) to restore-by-original-path; `trash` doesn't do this.
3. **`close_application`'s unsaved-work detection** — currently always
   HIGH_RISK because Phase 2 can't detect this generically (see
   ARCHITECTURE.md). A per-application heuristic (window title asterisk,
   `WM_CLOSE` response, etc.) could downgrade specific well-known apps.

## Phase 3 notes

### Voice — works out of the box in a real build
`WebSpeechSTTProvider`/`WebSpeechTTSProvider` use the browser-native
`SpeechRecognition`/`SpeechSynthesis` APIs, which WebView2 (Chromium)
supports without any extra install. Push-to-talk: hold the mic button,
speak, release. No API key, no extra setup.

### Wake word status: NOT IMPLEMENTED
`src/voice/providers/WakeWordProvider.ts`'s `NotImplementedWakeWordProvider`
throws on `start()` by design (spec section 6 explicitly forbids pretending
this works). Building a real one needs either a licensed model (e.g.
Porcupine) or a bundled open-source detector (e.g. openWakeWord's ONNX
model) run continuously against short mic buffers — a real subsystem, not
a quick addition. Push-to-talk is the supported activation method.

### Camera — works out of the box; hand/face/pose tracking needs model files
`CameraProvider` (preview, start/stop) works with no extra setup. Hand/face/
pose tracking needs:
```bash
npm install @mediapipe/tasks-vision
```
plus downloading the model files MediaPipe requires (not bundled — these
are typically tens of MB each):
- `hand_landmarker.task` from Google's MediaPipe model zoo
- `face_landmarker.task`
- `pose_landmarker_lite.task` (or `full`/`heavy` depending on your CPU/GPU budget)

Then call e.g.:
```ts
const hands = new MediaPipeHandsProvider();
await hands.initialize("/models/wasm", "/models/hand_landmarker.task");
```
inside a `requestAnimationFrame` loop feeding the camera's `<video>` element
and current timestamp into `hands.detect(video, timestamp)`. **I could not
download these model files or run this against a real camera in this
sandbox (no network) — the integration code is written against MediaPipe's
documented API but is unverified.** Budget a real first test session for
this before relying on gesture/face features.

### Running the Phase 3 perception unit tests
```bash
npm install
npm run test  # vitest — GestureEngine, StateFusionEngine, VoiceConfirmation, PerceptionContext
```
These specific test files' logic (not just their existence) was already
verified once during development via a standalone `node` script compiling
the relevant `.ts` files directly with `tsc` and exercising them with
synthetic inputs — see the dev notes in
`src/perception/__tests__/GestureEngine.test.ts`'s header comment. Running
`npm run test` re-confirms this in a real toolchain rather than checking it
for the first time.

### Settings UI
There is still no dedicated Settings screen (true since Phase 1). The four
Phase 3 privacy toggles (`emotionDetectionEnabled`, `cameraBasedStateEnabled`,
`voiceBasedStateEnabled`, `behaviorBasedStateEnabled`) exist in
`config/settings.ts` and are wired into `StateFusionEngine`/`App.tsx`, but
there's no UI to flip them yet — they're hard-set to `false` by
`DEFAULT_SETTINGS` until a Settings panel is built. This is a concrete,
scoped next step, not a deep architectural gap.

## Phase 3 completion pass — running the new pipeline tests
```bash
npm run test  # includes vision/__tests__/normalizeMediaPipeResults.test.ts and vision/__tests__/VisionPipeline.test.ts
```
`VisionPipeline.test.ts` doesn't need a real browser or camera — it injects
a fake frame scheduler and fake detectors, so it genuinely exercises the
lifecycle logic (duplicate-start prevention, stale-callback rejection after
stop, transition-only events, restart requiring re-attach) deterministically.
This was verified with a standalone `node` harness during development
(6 scenarios, including the pinch/fist regression test) before being
written as this vitest file — see the file's own comments for specifics.

**Still pending real hardware verification**: everything from `attachStream()`
inward that touches an actual `HTMLVideoElement` fed by a real camera, and
everything inside `MediaPipeHandsProvider`/`Face`/`Pose`'s `detect()` calls,
since those require the actual `@mediapipe/tasks-vision` package + model
files + a camera, none of which are available in this build sandbox.

## Phase 4 — Design Studio

### Install
```bash
npm install  # now includes three + @types/three
```

### Running Phase 4 tests
```bash
npm run test  # includes design3d/__tests__/*.test.ts
```
These are pure-logic tests (validation, command execution, undo/redo,
transactions, serialization) — no browser or WebGL needed, and their
behavior was already verified once via a standalone `node` harness during
development (32 checks, all passing) before being written as these vitest files.

**Not covered by `npm run test`**: anything in `design3d/engine/`,
`design3d/loaders/GLTFIO.ts`, or `ui/design3d/Viewport.tsx` — these need a
real browser/WebGL context, which this build sandbox doesn't have. Opening
the Design Studio for the first time in a real build is the actual first
test of that code.

### GLTF import limitations (read before relying on this)
Imported GLTF/GLB files become a single opaque node in the design graph —
they are NOT decomposed into native, editable JARVIS components. You can
move/scale/delete the imported asset as a whole, but the Inspector's
per-parameter fields won't apply to it. See `design3d/loaders/GLTFIO.ts`'s
doc comment for the full explanation.

## Phase 5 — AR mode

### Running the Phase 5 tests
```bash
npm run test  # includes ar/__tests__/*.test.ts
```
Most of these are pure-logic tests (coordinate mapping, orientation,
smoothing, anchor tracking states, interaction state machine, command
validation) — no browser needed, and already verified once via a
standalone Node harness during development.

`ARController.test.ts` is the exception: `ARController` constructs a real
`ARScene`, which imports `three`. If your test runner doesn't resolve
`three` (e.g. it's not installed yet), this specific file will fail to
load. It was verified during development using a minimal hand-written
`three` shim (~80 lines, covering just the classes `ARScene`/`GraphRenderer`
touch) run directly under plain `node` — 11 orchestration checks, all
passing, including grab/release/transfer/two-hand-scale end-to-end. Once
you `npm install` (which pulls the real `three` package), this same test
file should run against the real library instead — that's the actual
first verification of `ARScene` itself, not just `ARController`'s logic
around it.

### Hardware verification checklist — NOT YET PERFORMED
Spec section 42's 20-item checklist requires real camera hardware. None of
it has been run. If you have a Windows machine with a camera, running
through that checklist (starting the app, opening AR mode, testing wrist
anchoring, pinch grab/release, two-hand scale, hand-to-hand transfer, and
confirming no duplicate camera pipelines appear) is the single most
valuable next step before trusting this phase in practice.

### Known first-run risks (things I could not verify)
1. **MediaPipe's actual coordinate convention** — `CoordinateMapper`'s
   mirroring math is verified against my own assumptions about MediaPipe's
   output space (documented in its file header), not against real
   `detectForVideo()` output. If real landmarks turn out to use a
   different convention than assumed, the AR overlay may not align with
   the camera as expected on the very first real test.
2. **Three.js version compatibility** — written against Three.js r160+
   style imports (matching Phase 4's `SceneManager`); if a different
   version resolves via `npm install`, some import paths
   (`three/examples/jsm/...`) may need adjusting.
3. **Performance** — `ARScene.update()`'s per-frame cost has not been
   profiled against a real render loop; spec section 37's performance
   requirements are structurally addressed (transforms updated, not
   geometry rebuilt, per-frame) but not measured.

## Phase 6 — multi-agent, settings, dashboard, screen perception

### Running the Phase 6 tests
```bash
npm run test  # includes ai/__tests__, orchestrator/__tests__, settings/__tests__
```
All Phase 6 pure-logic tests (routing, state machine, redaction, memory
guard, simulation controls, settings validation, interface-only stub
behavior) run under plain Node/vitest — no browser needed. They were
verified once via a standalone Node harness during development (15
consolidated checks across every module, all passing) before being
written as the vitest files you'll find in each `__tests__/` directory.

### Configuring a new AI provider
1. Open Settings → AI.
2. Enter an API key for the provider and click Save — this calls
   `save_provider_key`, which stores it via the OS keychain (Windows
   Credential Manager / macOS Keychain / Linux Secret Service) through the
   `keyring` crate. The key never appears in `localStorage`, SQLite, or
   any log file.
3. Click Test — this only confirms the key is present in the keychain,
   not that it's valid for real API calls (see ARCHITECTURE.md for why).
4. Toggle Enabled and set a priority — the router (`aiProviderRegistry.route()`)
   will consider this provider for future requests automatically.

### OS keychain — HARDWARE/OS-UNVERIFIED
`security/keystore.rs` has never been compiled in this sandbox (no
`cargo`). Before trusting it: `cargo build` on a real machine, then
manually verify save/status/remove round-trip through the Settings UI,
and confirm the key actually appears in the OS's real credential store
(e.g. Windows Credential Manager's UI) — not just that the app reports
success.

### Screen capture — HARDWARE-UNVERIFIED
`WebScreenCaptureProvider` uses real `getDisplayMedia()`. On first use in
a real browser/Tauri WebView, the OS's own screen-recording permission
prompt will appear (this is NOT something the app can bypass or
pre-answer). Verify: the picker appears, a captured frame actually shows
the right content, and calling `capture()` a second time re-prompts
rather than reusing a cached stream (this is intentional — see
ARCHITECTURE.md's "no continuous capture" note).

### Known first-run risks
1. **Provider capability defaults** — `App.tsx` currently registers
   Claude with capabilities `["TEXT","VISION","TOOL_CALLING","STRUCTURED_OUTPUT","STREAMING","LONG_CONTEXT"]`
   based on Claude's documented capabilities, not verified against a live
   API call. Gemini/Grok/DeepSeek are NOT registered anywhere yet — the
   Settings UI will show them as available slots (via
   `aiProviderRegistry.allConfigs()`) only once something actually calls
   `.register()` for each; that wiring is a follow-up, not present yet.
2. **Settings/preferences collision risk** — Phase 3's narrower
   `JarvisSettings` (privacy toggles) and Phase 6's comprehensive
   `JarvisSettings` (7 full sections) are DIFFERENT types with the same
   name, disambiguated via import aliasing in `App.tsx` (see
   ARCHITECTURE.md). If you add new code that imports `JarvisSettings`,
   double-check which file you're importing from.
3. **3D visualizer performance** — like Phase 5's `ARScene`, `JarvisVisualizer`'s
   render loop has not been profiled against a real GPU.
