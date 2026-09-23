# JARVIS UI Design Files

Primary visual/UI files changed or relevant in this pass:

- `src/ui/styles/global.css` — global futuristic design system, immersive Home, Settings controls, responsive layouts, animations.
- `src/App.tsx` — Home composition, microphone lifecycle/permission handling, screen-share entry point, Serious Mode and state-driven UI wiring.
- `src/ui/core/JarvisVisualizer.ts` — Three.js JARVIS core, orbital rings, energy spikes, core particles/dust, continuous animation and camera framing.
- `src/ui/core/JarvisVisualizerView.tsx` — visualizer mounting/resizing and real microphone analyser feed.
- `src/ui/settings/SettingsPage.tsx` — Settings page structure and all settings controls/providers.
- `src/ui/components/ConversationView.tsx` — Home conversation rendering.
- `src/ui/components/StatusBar.tsx` — top navigation/HUD chrome.
- `src/ui/components/ScreenShareOverlay.tsx` — live screen-share overlay UI.
- `src/ui/diagnostics/Diagnostics.tsx` — system diagnostics/event-log UI.
- `src/ui/components/AudioVisualizer.tsx` — microphone visual feedback.
- `src/ui/components/ConfirmationDialog.tsx` — security confirmation UI.
- `src/ui/components/ConflictDialog.tsx` — file conflict decision UI.
- `src/ui/dashboard/Dashboard.tsx` — Dashboard UI (intentionally not rebuilt/bloated in this pass).
- `src/ui/design3d/DesignStudio.tsx` — 3D Design Studio UI.
- `src/ui/ar/ARView.tsx` and `src/ui/ar/ARControlBar.tsx` — AR UI.

Functional voice/API files inspected/modified:

- `src/voice/providers/WebSpeechProvider.ts`
- `src/voice/providers/WakeWordProvider.ts`
- `src/voice/CommandRouter.ts`
- `src/ai/providers/GeminiProvider.ts`
- `src/ai/providers/ClaudeProvider.ts`
- `src/ai/providers/GrokProvider.ts`
- `src/ai/providers/DeepSeekProvider.ts`
- `src/ai/providers/OpenAICompatibleProvider.ts`
- `src/screen/WebScreenCaptureProvider.ts`


## Newly wired capability files
- `src/voice/providers/WakeWordProvider.ts` — same-recognizer Hello/Hey/Hi JARVIS fallback
- `src/websearch/TauriWebSearchProvider.ts` — real Tauri-backed web-search adapter
- `src/voice/__tests__/WakeWordProvider.test.ts` — wake-word behavior tests
- `src/websearch/__tests__/TauriWebSearchProvider.test.ts` — search adapter mapping tests
- `src-tauri/src/research.rs` — bounded live web discovery/source extraction and concurrent enrichment
- `src-tauri/src/commands.rs` + `src-tauri/src/main.rs` — registered `web_research` command
