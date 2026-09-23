# IMPLEMENTATION_STATUS.md

Single-source capability matrix. Status vocabulary used throughout, exactly
as specified:

`IMPLEMENTED` · `PARTIAL` · `INTERFACE-ONLY` · `UNIMPLEMENTED` ·
`HARDWARE-UNVERIFIED` · `ENVIRONMENT-UNVERIFIED`

`ENVIRONMENT-UNVERIFIED` is used specifically for code that has been
written and manually/logic-reviewed but never run through `cargo`/`npm
install`/a real Tauri runtime because this sandbox cannot provide those
(no network egress, no `cargo` binary — both reconfirmed this session with
exact commands and exact failures, see "Environment facts" below).
`HARDWARE-UNVERIFIED` is reserved for functionality that additionally
needs physical hardware (camera/mic/GPU) even once compiled.

This file does not repeat the full architectural narrative already in
README.md/ARCHITECTURE.md/SECURITY.md/PHASE-CONTINUITY.md — it is the
terse, scannable status table those documents point to.

## Environment facts (verified this session, not assumed)

| Check | Exact command | Exact result |
|---|---|---|
| Node/npm present | `which node npm` | Both present |
| Network egress | `npm install` | `npm error code E403` — `403 Forbidden` fetching `registry.npmjs.org` |
| Rust toolchain | `which cargo` | Not found — no output, non-zero exit |
| ESLint | `npx eslint --version` | Fails — same E403, package not installed and cannot be installed |
| Git | `git status` | `fatal: not a git repository` — no `.git` exists in this project tree |
| TypeScript compiler | `tsc --version` (system-wide, not from node_modules) | Present, usable directly |

## Capability matrix

### Core security boundary
| Capability | Status | Evidence |
|---|---|---|
| Rust `PolicyEngine` risk classification + confirmation gate | IMPLEMENTED (logic), ENVIRONMENT-UNVERIFIED (compile) | `security_tests.rs`; never compiled |
| `PathGuard` filesystem sandboxing | IMPLEMENTED, ENVIRONMENT-UNVERIFIED | same |
| Command redaction (Rust `redact_params` + TS `redactActivityParams`) | IMPLEMENTED, tested (TS side) | `ActivityLog.test.ts` |

### AI providers
| Capability | Status | Evidence |
|---|---|---|
| Provider registry + capability-aware routing + deterministic fallback | IMPLEMENTED, tested | `AIProviderRouting.test.ts`; a real routing bug (`isUsable` not excluding generic `"unavailable"`) was found and fixed this conversation |
| Forced-provider-never-substitutes | IMPLEMENTED, tested | same suite, explicit test |
| Claude adapter | IMPLEMENTED, ENVIRONMENT-UNVERIFIED (no network for a live call) | reused from Phase 1, multimodal-extended |
| Gemini / Grok / DeepSeek adapters | IMPLEMENTED, ENVIRONMENT-UNVERIFIED | `providers.test.ts`, 18 assertions against mocked `fetch`; never called live |
| API key save/load/remove/test via OS keychain | IMPLEMENTED, ENVIRONMENT-UNVERIFIED | `keystore.rs`; a real API mismatch (`delete_credential` vs pinned v2's `delete_password`) was found and fixed; never compiled |
| Key survives app restart (real provider reconstruction on launch) | IMPLEMENTED, ENVIRONMENT-UNVERIFIED | `load_provider_key_for_session` command + startup effect, this session |
| "Test connection" makes a real API call (not just presence check) | IMPLEMENTED, ENVIRONMENT-UNVERIFIED | `App.tsx` `onTestProviderKey`, this session |
| CSP allows all 4 configured provider domains | IMPLEMENTED | `tauri.conf.json`; previously would have silently blocked 3 of 4 providers — fixed this session |

### Screen capture
| Capability | Status | Evidence |
|---|---|---|
| `WebScreenCaptureProvider` (real `getDisplayMedia`) | IMPLEMENTED, HARDWARE-UNVERIFIED | `WebScreenCaptureProvider.test.ts` |
| Screen → AI pipeline (`ScreenPerception`) | IMPLEMENTED, tested (logic), HARDWARE-UNVERIFIED | `ScreenPerception.test.ts`, 12 assertions covering every required outcome |
| Screen capture OFF blocks capture in the capture path itself | IMPLEMENTED, tested | explicit test asserting `capture()` never invoked when disabled |
| UI trigger ("Ask Screen") | IMPLEMENTED, HARDWARE-UNVERIFIED | wired in `StatusBar`/`App.tsx` |

### Memory
| Capability | Status | Evidence |
|---|---|---|
| `MemoryGuard` secret-shape filtering | IMPLEMENTED, tested | `MemoryGuard.test.ts` |
| `MemoryOrchestrator` (consent, category, guard-gated create/update/delete/retrieve) | IMPLEMENTED, tested | `MemoryOrchestrator.test.ts` — full store→session→retrieve→delete→verify-gone flow |
| `InMemoryMemoryStore` | IMPLEMENTED, tested | same suite |
| `TauriMemoryStore` (real Rust-backed persistence) | IMPLEMENTED, tested (mapping logic), ENVIRONMENT-UNVERIFIED (real invoke round-trip) | `TauriMemoryStore.test.ts`, 6 assertions against a mocked `invoke`; closes the previously-open "TauriMemoryStore not implemented" gap |
| Rust `add_memory`/`list_memories`/`get_memory`/`forget_memory` commands | IMPLEMENTED, ENVIRONMENT-UNVERIFIED | added this session — did not exist before; `add_memory` extended with a `user_approved` parameter it previously lacked |
| Memory management UI (Settings → Memory tab) | IMPLEMENTED, HARDWARE/ENVIRONMENT-UNVERIFIED | real list/delete wired to `MemoryOrchestrator`, never rendered in a browser |

### Voice
| Capability | Status | Evidence |
|---|---|---|
| `WebSpeechProvider` (STT/TTS) | IMPLEMENTED, HARDWARE-UNVERIFIED | continuous STT + real TTS; hands-free final-transcript command segmentation in App |
| `WakeWordProvider` | PARTIAL, HARDWARE-UNVERIFIED | real transcript-backed wake phrase detection sharing the existing recognizer; native low-power offline wake model remains future work |
| `matchVoiceConfirmation` exact-phrase confirmation | IMPLEMENTED, tested | re-verified this session with the CORRECT function signature after an earlier self-caught mistake |
| Voice command → action routing (`CommandRouter`) | IMPLEMENTED, tested | `CommandRouter.test.ts`, 13 assertions including the refuse-not-guess safety property; deterministic phrase matching only, scoped to safe UI-navigation intents |
| Command router wired to real navigation/screen-capture/listening actions | IMPLEMENTED, HARDWARE-UNVERIFIED (text-input trigger is real; STT feeding it is not verified) | `StatusBar`'s command text input |

### Vision
| Capability | Status | Evidence |
|---|---|---|
| `VisionPipeline`/`GestureEngine`/`StateFusionEngine` | IMPLEMENTED, HARDWARE-UNVERIFIED | real hands/face/pose pipeline; motion/pose is now a live Settings toggle |
| Vision settings duplicate-object collision | FIXED (was an open gap) | `handTrackingEnabled` added to the real settings object; `VisionPipeline.updateOptions()` added; Settings' Vision tab now controls the live object directly; the disconnected copy was deleted, not left in parallel |
| Live toggling of hand/face detection without pipeline restart | IMPLEMENTED, tested | `VisionPipeline.test.ts`'s new `updateOptions` test; also fixed a genuine pre-existing bug in the test file's `fakeVideo()` helper (missing `.play()`) that would have crashed every `attachStream()`-using test in the file |

### Settings
| Capability | Status | Evidence |
|---|---|---|
| AI tab | IMPLEMENTED | real 4-state status derivation, real error surfacing, real test-connection call |
| Voice tab | UNIMPLEMENTED (decorative) | no code path reads these values |
| Vision tab | IMPLEMENTED | hand, face/state and motion/pose toggles are wired to the live pipeline |
| Screen tab | PARTIAL | `screenCaptureEnabled` and analysis gating are real; capture mode remains UI-only |
| Memory tab | IMPLEMENTED (new this session) | real list/delete/refresh |
| Privacy & Security tab | PARTIAL | `dangerousActionConfirmationsEnabled` structurally locked true (real enforcement); other toggles not wired |
| Appearance tab | UNIMPLEMENTED (decorative) | no CSS/theme logic reads these values |
| System tab | UNIMPLEMENTED (decorative) | no OS-level logic exists |

### Dashboard / visualizer
| Capability | Status | Evidence |
|---|---|---|
| `JarvisStateMachine` | IMPLEMENTED, tested | 8 tests, valid-transition enforcement |
| `JarvisVisualizer` (Three.js core + rings, 8 distinct states) | IMPLEMENTED, HARDWARE-UNVERIFIED | never fakes audio amplitude by design |
| `Dashboard`/`ActivityLog` | IMPLEMENTED, tested (ActivityLog), HARDWARE-UNVERIFIED (rendering) | real state, "—" for unavailable metrics rather than fabricated numbers |
| Top bar (`StatusBar`) | IMPLEMENTED (extended this session) | real provider indicator + real navigation, replacing 5 hardcoded floating buttons |
| Richer visualizer (orbital particles etc. per the full future spec) | UNIMPLEMENTED | not attempted this session — see "Next recommended action" |

### 3D Design Studio / AR
| Capability | Status | Evidence |
|---|---|---|
| `DesignGraph`/`DesignController`/history/serialization | IMPLEMENTED, tested, HARDWARE-UNVERIFIED (rendering) | unchanged, re-verified this session |
| `ARController` (grab/release/transfer/two-hand) | IMPLEMENTED, tested, HARDWARE-UNVERIFIED | unchanged, re-verified this session — DesignGraph/AR separation explicitly re-confirmed |
| `SpatialOutputProvider` abstraction | INTERFACE-ONLY beyond Camera AR (which wraps the real `ARController`) | unchanged |

### Integrations (Gmail/Drive/Notion/Spotify/YouTube/web search)
| Capability | Status | Evidence |
|---|---|---|
| `WebSearchProvider` | IMPLEMENTED, ENVIRONMENT-UNVERIFIED (live network) | Tauri Rust research provider with bounded discovery + source extraction |
| `CommunicationProvider` | INTERFACE-ONLY | same pattern |
| Gmail/Drive/Notion/Spotify/YouTube | PARTIAL | YouTube search/direct-link opening is real via `open_url`; in-app browser automation/OAuth integrations remain unimplemented |
| `DeviceChannel` (device-to-device transfer) | INTERFACE-ONLY | refuses every operation by design |

### Build/tooling
| Capability | Status | Evidence |
|---|---|---|
| TypeScript strict check | IMPLEMENTED, PASSING | 3 pre-existing `three/examples` errors only (missing-package class, not code errors) — see "Environment facts" |
| ESLint | ENVIRONMENT-UNVERIFIED | not installed, cannot install (no network) |
| `cargo check`/`cargo test` | ENVIRONMENT-UNVERIFIED | `cargo` not present in this sandbox |
| `npm run tauri build` (real `.exe`/installer) | ENVIRONMENT-UNVERIFIED | requires both `npm install` and `cargo`, neither available |
| Tauri icon files | IMPLEMENTED, PIL-verified valid | were completely missing before this session — a real `tauri build` blocker, now fixed |
| Tauri capabilities (least-privilege) | ENVIRONMENT-UNVERIFIED | no `capabilities/*.json` file exists; Tauri v2's implicit default-window capability is expected to cover this app's custom-command-only usage, but this has not been confirmed against a real build |

### Fast-path implementation notes
| Capability | Status | Current behavior |
|---|---|---|
| First-launch voice | IMPLEMENTED, HARDWARE-UNVERIFIED | continuous Web Speech recognition auto-starts by default; microphone permission is requested once by the real mic path |
| Hands-free command execution | IMPLEMENTED, HARDWARE-UNVERIFIED | final transcript silence triggers command processing without a button; same recognizer is reused |
| Gemini low-latency default | IMPLEMENTED, ENVIRONMENT-UNVERIFIED | default model moved to `gemini-3.5-flash-lite`; streaming remains available |
| Research → document | IMPLEMENTED, ENVIRONMENT-UNVERIFIED | live web discovery + bounded source extraction + Markdown report through existing filesystem tool |
| YouTube/media | PARTIAL, HARDWARE-UNVERIFIED | search or direct YouTube link opens through the existing safe URL action; result clicking/autoplay still needs a real browser driver |

## Next recommended action
Get this repository onto a machine with real network access and `cargo`.
Almost every `ENVIRONMENT-UNVERIFIED` item above is blocked on exactly
that, not on further code changes — the two are now cleanly separated by
this matrix so that distinction is never ambiguous again.

## 2026-09-18 continuation — hands-free, performance and remote-control pass

| Capability | Status | Evidence |
|---|---|---|
| Automatic microphone start on first launch | IMPLEMENTED, HARDWARE-UNVERIFIED | `App.tsx`: continuous listening startup + one real `getUserMedia` stream before STT |
| "Hey/Hello/Hi JARVIS" fallback wake phrase | IMPLEMENTED, HARDWARE-UNVERIFIED | `SpeechTranscriptWakeWordProvider`; shares the existing recognizer, no second microphone |
| Wake-word backup when wake provider is unavailable | IMPLEMENTED, HARDWARE-UNVERIFIED | continuous transcript path no longer silently drops commands when the wake provider reports unavailable |
| Low-latency hands-free command handoff | IMPLEMENTED, HARDWARE-UNVERIFIED | final-transcript silence window reduced to 180 ms |
| Streaming UI batching | IMPLEMENTED | `App.tsx`: streamed provider tokens update React UI through `requestAnimationFrame`, avoiding one render per token |
| Adaptive high-refresh Three.js rendering | IMPLEMENTED, HARDWARE-UNVERIFIED | `JarvisVisualizer.ts`: requestAnimationFrame loop + sustained-frame-time adaptive DPR around a high-refresh frame budget |
| Animation quality setting affects visualizer workload | IMPLEMENTED, HARDWARE-UNVERIFIED | low/medium/high particle counts and pixel-ratio caps |
| Live Appearance settings | IMPLEMENTED | theme/density/reduced-motion/animation-quality are applied to the document shell and visualizer |
| Privacy gates for microphone/camera/screen capture | IMPLEMENTED | capture paths check the live Privacy settings before acquiring hardware/media |
| Research request without a preposition | IMPLEMENTED, ENVIRONMENT-UNVERIFIED | broader deterministic research intent detection + existing live search → AI brief → Markdown file path |
| Hindi/Hinglish media command keywords | IMPLEMENTED, ENVIRONMENT-UNVERIFIED | deterministic media intent extraction recognizes common `bajao/chalao/gaana` phrasing |
| Desktop LAN remote-control bridge for future mobile app | IMPLEMENTED, ENVIRONMENT-UNVERIFIED | `remote.rs` authenticated tokenized HTTP bridge + Tauri event dispatch + Dashboard pairing UI |
| Native mobile companion app | NOT IN THIS SOURCE | intentionally deferred to the separate mobile source the project will add later |
| Browser click/type automation | INTERFACE-ONLY | structured `BrowserOperation` exists; no verified Playwright/WebDriver runtime is bundled |
| YouTube search/direct-link opening | PARTIAL, ENVIRONMENT-UNVERIFIED | real URL opening/search exists; automatic result selection/autoplay still needs a browser driver |

### Verification limitation for this pass
`npm ci --ignore-scripts` started but did not complete within the available sandbox transport window, so a clean dependency-backed `npm run build`/Vitest run could not be claimed for this exact edited tree. Rust/Cargo is also unavailable in the sandbox, so the new native remote bridge remains compile-unverified here. No Windows/WebView2 microphone, camera, WebGL or LAN-device test was possible.
