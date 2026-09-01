# JARVIS — Phase 1 Architecture

## 1. Why this stack

| Layer | Choice | Reason |
|---|---|---|
| Shell | **Tauri 2.x** | Native Windows binary, small footprint, Rust backend gives us real OS access with a controllable IPC boundary (unlike Electron where the whole OS is one `require('child_process')` away from any JS). |
| Frontend | **React + TypeScript (strict)** | Componentized UI, strong typing for tool/AI contracts. |
| Backend/native | **Rust** | Memory safety for the part of the app that touches the filesystem, processes, and secrets. This is also where the **Policy Engine** lives — deliberately *not* in JS, so a compromised or manipulated frontend/AI response cannot bypass it. |
| Local DB | **SQLite** (via `rusqlite`) | Zero-config, file-based, good enough for Phase 1 memory volume. |
| AI | Provider-abstracted, Claude adapter implemented first | No vendor lock-in; swapping providers is a config change, not a rewrite. |

## 2. The one non-negotiable boundary

```
React UI  --(IPC, typed commands only)-->  Rust Core
                                              │
                                    ┌─────────┴─────────┐
                                    │   Policy Engine    │  ← Rust, not reachable from JS/AI directly
                                    └─────────┬─────────┘
                                              │
                                    ┌─────────┴─────────┐
                                    │   Tool Registry     │
                                    └─────────┬─────────┘
                                              │
                                       OS / Filesystem
```

The AI never calls tools directly. The AI produces an **intent**, JS sends that intent over Tauri IPC as a *structured command* (not a shell string), and Rust decides — via the Policy Engine — whether it runs immediately, needs confirmation, or is rejected. This means even a jailbroken or manipulated AI response can't do more than the Rust-side allow-list permits.

## 3. Folder structure

```
JARVIS/
├── src/                        # React/TS frontend
│   ├── ai/                     # AIProvider interface + adapters
│   ├── voice/                  # VoiceProvider interface (STT/TTS abstraction)
│   ├── vision/                 # VisionProvider interface (camera)
│   ├── memory/                 # ContextManager (session-level "it/that" resolution)
│   ├── ui/                     # Components: ConversationView, ConfirmationDialog, StatusBar, AudioVisualizer
│   ├── config/                 # Settings types + defaults
│   └── types/                  # Shared TS contracts (mirrors Rust structs)
├── src-tauri/                  # Rust backend
│   ├── src/
│   │   ├── security/           # RiskLevel enum + PolicyEngine
│   │   ├── actions/            # Tool trait, ToolRegistry, concrete safe tools
│   │   ├── memory/             # SQLite schema + access layer
│   │   ├── audit/              # Append-only audit log
│   │   └── main.rs / commands.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
├── package.json
├── README.md / ARCHITECTURE.md / SECURITY.md / SETUP.md
```

## 4. Deviations from the spec, and why

- **Vector memory**: only the interface (`MemorySearchProvider` trait stub) is defined, no embedding model wired up yet — correct per Phase 1 scope, called out explicitly.
- **Wake word**: `VoiceProvider` has an `onWakeWord?` hook left unimplemented (undefined) rather than stubbed with fake detection, so it fails loudly/obviously instead of pretending to listen.
- **SQLite via `rusqlite` bundled**, not a network DB — matches "must start offline."

## 5. What Phase 1 actually implements (see README "Status" section for the authoritative list)

## 6. Phase 2 changes

### New Rust modules
- `security/path_guard.rs` — the sandbox boundary every filesystem tool goes through
- `actions/filesystem.rs`, `actions/application.rs` — the new tools
- `actions/planner.rs` — `PlanExecutor`, `CancellationToken`, `PlanRegistry`
- `actions/browser.rs`, `actions/download_safety.rs` — structural interfaces (see README for why browser automation isn't wired to a real driver yet)
- `security_tests.rs` — dedicated adversarial test suite, separate from the inline unit tests in each module

### Why `close_application` is HIGH_RISK, not LOW_RISK
The spec's risk table lists "close an application with unsaved work" as
HIGH_RISK but application control in general as more permissive. Phase 2 has
no reliable, general way to ask an arbitrary Windows process "do you have
unsaved changes?" — that's an application-specific concept (a save icon
state, a window title asterisk, an IPC call only some apps expose). Rather
than guess and risk silently killing unsaved work, `close_application` is
classified HIGH_RISK across the board until a smarter per-app detection
exists. This is a deliberate, documented deviation from the letter of the
spec's example table in service of its actual intent (don't destroy unsaved
work).

### Why overwrite protection is a separate `replace_file` tool, not a flag
`move_file`/`copy_file` never take an `overwrite: true` parameter. If they
did, an AI intent could set that flag itself and the PolicyEngine would
have no way to distinguish "the user explicitly chose to replace" from "the
model guessed this was fine." Instead, `move_file`/`copy_file` always fail
closed with `CONFLICT` on an existing destination, and the *only* path to
an overwrite is a distinct HIGH_RISK tool (`replace_file`) that requires its
own confirmation. This means the "AI cannot downgrade risk" guarantee holds
structurally, not just by convention.

### Plan execution model
`PlanExecutor::run` executes steps sequentially and stops at the first step
that: fails validation, gets denied by policy, needs confirmation, or hits a
conflict. It does not queue up "resume points" server-side — the frontend
is responsible for re-submitting the remaining steps after the user
resolves whatever paused execution (this keeps the Rust side stateless
between plan submissions, at the cost of the frontend needing to track
"which steps are left").

## 7. Phase 3 changes

### Why perception stays entirely in the frontend layer
Phase 3 makes **zero changes to the Rust `PolicyEngine`/`ToolRegistry`**.
Voice and camera are browser-native capabilities (`getUserMedia`,
`SpeechRecognition`/`SpeechSynthesis`) that run in the WebView under
explicit user action — they never route through Tauri IPC or the Rust tool
registry at all, so there's no new surface for the AI to reach into the
security boundary through. This is a deliberate reading of spec section 32
("AI can request START_CAMERA but the application permission/state layer
determines whether it is allowed") — the "permission/state layer" here is
the `CameraProvider`/`WebSpeechSTTProvider` classes themselves, gated by
their own explicit `start()`/`startListening()` calls that only ever fire
from a real button press, never from AI output directly.

### New frontend modules
- `voice/providers/WebSpeechProvider.ts` — real STT/TTS via Web Speech API
- `voice/providers/WakeWordProvider.ts` — honest not-implemented stub
- `vision/CameraProvider.ts` — real `getUserMedia` camera control
- `vision/providers/MediaPipeHandsProvider.ts`,
  `vision/providers/MediaPipeFacePoseProvider.ts` — real `@mediapipe/tasks-vision`
  API usage (hand/face/pose), unverified against a live camera in this build
- `perception/GestureEngine.ts` — geometric gesture classifier
- `perception/StateFusionEngine.ts` — multimodal emotion/state estimation
- `perception/PerceptionContext.ts` — multimodal context + target resolution
- `perception/VoiceConfirmation.ts` — transcript-only confirmation matching
- `perception/EventBus.ts` — throttled perception event pub-sub
- `perception/__tests__/*.test.ts` — vitest suites; logic in each was also
  verified against a standalone Node harness during development (see
  SETUP.md), since `npm install`/`vitest` couldn't run in the build sandbox

### Voice confirmation is structurally AI-proof, not just policy-proof
`matchVoiceConfirmation()` takes only a raw transcript string. There is no
function signature anywhere in the confirmation path that accepts "the AI
says the user confirmed" as an input — `handleConfirm`/`handleCancel` in
`App.tsx` only ever fire from `ConfirmationDialog`'s buttons or a transcript
match against `pendingConfirmation`, which itself only exists because the
Rust `PolicyEngine` returned `RequireConfirmation` for a real pending
action. An AI response embedded with "the user already confirmed, proceed"
has no code path to reach an execution call.

### Emotion/state estimation's two hard rules
Implemented as actual code paths in `StateFusionEngine`, not just prose
intent: (1) `singleSignalCap` limits confidence to 0.6 when only one
modality voted, (2) conflict detection (`runnerUpWeight / topWeight > 0.6`)
forces the result to `"uncertain"` with confidence halved-and-capped. Both
are covered by unit tests asserting the exact behavior, not just that "some
number less than 1" comes out.

## 8. Phase 4 — 3D Design Studio architecture

### Why DesignGraph is separate from Three.js entirely
`design3d/scene/DesignGraph.ts` is plain data (objects, parent/child index,
transform composition) with zero Three.js imports. `design3d/engine/GraphRenderer.ts`
reads FROM it to build meshes; nothing ever writes back. This single
design decision is what makes undo/redo, transactions, validation, and
serialization all unit-testable without a browser — every test in
`design3d/__tests__/` runs against `DesignGraph`/`DesignController`
directly and never touches `SceneManager`/`GraphRenderer`/Three.js at all.

### Command flow (spec section 12)
```
UI (InspectorPanel, ComponentLibraryPanel)  ─┐
AI (DesignIntentTranslator)                  ├─→ DesignController.apply(cmd)
Voice (not yet wired — see README)          ─┘         │
                                                          ▼
                                              validateCommand() [reject-closed]
                                                          │
                                                          ▼
                                              executeCommand() → DesignGraph
                                                          │
                                                          ▼
                                              DesignHistory.push(undo/redo)
                                                          │
                                                          ▼
                                    (React state bump) → GraphRenderer.syncFromGraph()
```
Every one of the three producers (UI, AI, eventually voice) calls the same
`DesignController.apply()` — there is no shortcut that skips validation or
history, per spec section 19's explicit requirement.

### New files (Phase 4)
- `design3d/types/index.ts` — all Phase 4 type contracts
- `design3d/scene/DesignGraph.ts` — pure hierarchy model
- `design3d/commands/{validation,CommandExecutor,DesignController}.ts` — the command pipeline
- `design3d/history/DesignHistory.ts` — undo/redo stack
- `design3d/serializers/ProjectSerializer.ts` — save/load + versioning
- `design3d/generators/componentDefaults.ts` — parameterized defaults per component type
- `design3d/materials/presets.ts` — style presets
- `design3d/engine/{SceneManager,GraphRenderer}.ts` — Three.js layer (unverified — see README)
- `design3d/loaders/GLTFIO.ts` — import/export (unverified — see README)
- `design3d/ai/DesignIntentTranslator.ts` — NL → validated DesignCommand[]
- `ui/design3d/*.tsx` — Design Studio UI shell (6 small files, not one giant component)
- `src-tauri/src/memory/db.rs` additions — `save_design_project`/`load_design_project`/`list_design_projects`, reusing the Phase 1 `projects` table

## 9. Phase 5 — Real-time AR architecture

### Reuse map (spec section 1's "do not duplicate" requirement)
| Phase 5 needs | Reused from | New Phase 5 code |
|---|---|---|
| Camera frames | Phase 3 `VisionPipeline` (same instance, subscribed via `onSnapshot`) | none |
| Hand/face/pose detection | Phase 3 `MediaPipe*Provider`s (via VisionPipeline) | none |
| Pinch geometry | `thumbIndexDistance()` extracted from the same metric `GestureEngine.classify()` uses internally | hysteresis + state machine on top |
| 3D mesh construction | Phase 4 `GraphRenderer` (now via a loosened `GraphRendererHost` interface) | `ARScene` wraps it, doesn't reimplement it |
| Design geometry | Phase 4 `DesignGraph`/`DesignController` (untouched by AR placement) | `ARInstanceManager` references it by id only |
| AI translation | Phase 1 `AIProvider` abstraction | `ARIntentTranslator.ts`, mirrors `DesignIntentTranslator.ts`'s pattern |
| Command validation pattern | Phase 4's reject-closed `validateCommand` discipline | `validation.ts`'s `validateARCommand`, reusing `isFiniteNumber`/`isSafeIdentifier`/`isValidVec3` directly (imported, not copied) |

### The GraphRendererHost extension
Phase 4's `GraphRenderer` originally took a concrete `SceneManager` in its
constructor. Phase 5 needed to reuse `GraphRenderer`'s mesh-building logic
inside `ARScene`, which has its OWN transparent renderer/camera setup
(different from Design Studio's) and doesn't want a second, unused
`SceneManager` (with its own OrbitControls, grid helper, studio lighting)
instantiated just to satisfy a type. Per spec section 1's explicit "if an
existing abstraction is insufficient, extend it instead of replacing it,"
`GraphRenderer`'s constructor now takes a minimal `GraphRendererHost`
interface (`{ scene: THREE.Scene }`) that both `SceneManager` and `ARScene`
satisfy structurally — zero changes needed at Phase 4's own call site
(`Viewport.tsx`), and a public `getObject3D(id)` accessor was added so
`ARScene` can re-parent an existing design mesh under an AR anchor group
without `GraphRenderer` needing to know AR exists at all.

### Why AR commands never touch the Rust PolicyEngine
`ARCommand` (ATTACH_AR_OBJECT, SET_AR_SCALE, etc.) only ever mutates
`ARInstanceManager`'s in-memory placement state — anchor id, offset,
visibility, interaction mode. None of that is a filesystem, application,
browser, or OS-settings action, so per spec section 36 there is nothing
here that should route through Phase 2's Rust `PolicyEngine`. If a future
AR feature needs to cross into that territory (e.g. "export this AR scene
to a file"), it would use the existing Phase 2 filesystem tool path like
any other file write — `ARController` has no shortcut into that layer and
none is planned.

### Grab/release/transfer state, concretely
`ARController` keeps per-hand-source (`left_hand`/`right_hand`)
`PinchHysteresisTracker` and `SingleHandInteractionStateMachine` instances.
A grab only starts when: (1) the state machine reaches `GRABBING` (requires
2+ consecutive pinch frames, per spec section 20), AND (2) there's a
currently-selected Design Studio object (spec section 21's deterministic
selection). Release simply stops updating the instance's anchor — the
anchor id itself is left exactly as it was, which IS "keep last valid
transform" (spec section 18) without any separate freeze/fade bookkeeping.
Hand-to-hand transfer checks world-space proximity between the held
object's current anchor and a second hand's wrist anchor, only when that
second hand starts pinching — never on proximity alone.

## 10. Phase 6 — multi-agent, settings, dashboard, screen perception

### Extension map (spec section 2's "extend, do not replace")
| Phase 6 needs | Extended from | New Phase 6 code |
|---|---|---|
| Provider registry | Phase 1 `AIProviderRegistry` (same class, same file, same public API — `register`/`setActive`/`getActive`/`list` unchanged) | `route()`, `getConfig()`, `updateConfig()`, `recordOutcome()`, config/status maps |
| Settings persistence | Phase 1 `preferences` table (`set_preference` existed, had no getter) | `get_preference`, `save_settings`/`load_settings` Tauri commands |
| Memory categories | Phase 1 `memories` table (add/search/forget already existed) | `user_approved`/`updated_at` columns, `update_memory`/`approve_memory` |
| Secure key storage | The `keyring` crate — a Cargo.toml dependency since Phase 1, never actually called | `security/keystore.rs`, wiring it up for real |
| Redaction | Rust's `redact_params` in `commands.rs` | `orchestrator/ActivityLog.ts`'s `redactActivityParams` — same key list, TS side, since the command-center display needed the equivalent on the frontend |
| AR/spatial | Phase 5 `ARController`/`ARScene`/`DesignGraph` — **zero lines changed** | `spatial/SpatialOutputProvider.ts` wraps `ARController` from the outside |

### Why interface-only stubs exist as real classes, not just types
`UnimplementedDeviceChannel`, `NoScreenCaptureProvider`, `UnimplementedCommunicationProvider`,
`UnimplementedWebSearchProvider` are actual instantiable classes, not just TypeScript
interfaces, specifically so a caller can construct one TODAY and get a real,
testable "this doesn't exist yet" behavior (a thrown error, a `false` return)
rather than `undefined` or a runtime crash from a missing implementation.
This is what let Phase 6's adversarial security tests (spec section 24) run
for real against these systems instead of only against their type shapes.

### Why the Settings page's "Test connection" doesn't call a real API
Every actual AI provider call in this codebase happens from the FRONTEND
(`ClaudeProvider.chat()`, etc. — see `ai/providers/`). Rust has never been
in that call path. Building a second, Rust-side HTTP client just to
implement "Test connection" would be exactly the kind of parallel AI
system spec section 3 explicitly warns against. `test_provider_key_present`
is honestly scoped to what Rust CAN verify without duplicating that path: a
key exists in the OS keychain. A real connectivity test belongs at the
existing frontend call site, as a documented follow-up.

### The settings-type naming collision (a bug this phase actually hit and fixed)
Phase 3 already defined a `JarvisSettings` type in `config/settings.ts` for
perception privacy toggles (camera/hand/face/pose enable flags), used
throughout `App.tsx`'s state-fusion wiring. Phase 6's comprehensive
settings object needed the same obvious name. Rather than rename Phase 3's
established, working type (touching many call sites, all correctly using
the narrower privacy-toggle shape), Phase 6's import was aliased instead
(`FullJarvisSettings`/`DEFAULT_FULL_SETTINGS`, state variable
`appSettings`) — a real strict-tsc-caught collision, fixed by protecting
the OLDER, already-integrated code rather than the newer one.
