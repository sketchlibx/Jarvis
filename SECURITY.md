# JARVIS Security Model — Phase 1

## Threat model this phase defends against
- A manipulated or hallucinating AI response trying to trigger a destructive OS action.
- The frontend (JS/React) being compromised and calling into Rust with attacker-controlled params.
- Silent, invisible camera/microphone activation.
- API keys or secrets leaking into logs or the SQLite DB.

## Trust boundary
```
React/TS (untrusted-ish: renders AI output, user input)
        |  Tauri IPC — typed commands ONLY, no arbitrary eval/shell string passthrough
        v
Rust core (trusted: PolicyEngine, ToolRegistry, filesystem/process access)
```
The AI never gets a "run this shell command" tool in Phase 1. `LaunchCommand`
from the spec's tool list is deliberately **not implemented yet** — it's the
highest-risk tool in the list and needs its own hardened sandbox design
before it ships, which is out of scope for Phase 1.

## Risk tiers → confirmation
| Tier | Confirmation required | Phase 1 tools at this tier |
|---|---|---|
| SAFE | No | `open_url`, `read_clipboard` |
| LOW_RISK | No | `open_application`, `write_clipboard`, `create_folder` |
| HIGH_RISK | Yes | *(none implemented yet — reserved for delete/move/overwrite in Phase 2)* |
| CRITICAL | Yes, with explicit "may be irreversible" warning | *(none implemented yet — reserved for shell exec, security setting changes)* |

The tier is a compile-time constant on each `Tool` implementation in Rust —
it is never computed from AI output, so nothing the model says can move an
action to a lower tier.

## Secrets
- API keys are never written into source, `tauri.conf.json`, or the SQLite DB.
- Intended storage: OS credential store via the `keyring` crate (already a
  dependency) — a `SecretsStore` wrapper is the next piece to implement
  before wiring real Settings persistence (currently the frontend skeleton
  uses `localStorage` as an explicit, commented **dev-only placeholder** —
  see `App.tsx`, must be replaced before any real use).
- `audit_logs` only ever receives tool id, JSON params the tool itself
  produces, and outcome — never raw API keys or full clipboard contents.

## Camera & microphone
- No code path starts the camera or mic without a direct, visible user
  action (button press or explicit voice command already being processed).
- `VisionProvider`/`SpeechToTextProvider` status is always shown in the
  `StatusBar` — there is no hidden state.

## What's intentionally NOT secured yet (because it's not built yet)
- Multi-device transfer (Phase 9) — no network exposure exists in Phase 1/2 at all.
- Arbitrary shell execution — not implemented. Never will be as a general
  `execute(command: string)` tool; see the Phase 2 section below.
- Browser automation is interface-only (no real driver behind it yet), so
  the browser-specific risk classification described below is defined but
  not yet exercised by working code — see README for details.

## Phase 2 security additions

### Path sandbox (`PathGuard`)
Every filesystem tool resolves its path argument through `PathGuard::validate`
before touching disk:
1. Reject empty paths, control characters (including NUL).
2. Reject any `..` path component outright — no traversal resolution attempted, just refusal.
3. Resolve relative paths against the workspace root (`%USERPROFILE%\JARVIS\Workspace`,
   discovered at runtime — never a hard-coded username).
4. Canonicalize to collapse symlink/`.` tricks.
5. Reject anything under a fixed list of protected Windows directories
   (`C:\Windows`, `C:\Program Files`, `C:\Program Files (x86)`, `C:\ProgramData`,
   `C:\System Volume Information`, `C:\Boot`, `C:\Recovery`) — checked
   case-insensitively, regardless of workspace setting.
6. Reject anything outside the workspace root unless the specific tool call
   explicitly opts into `allow_outside_workspace` (no Phase 2 tool currently does).

### Overwrite protection
`move_file`, `copy_file`, `create_text_file`, `rename_file` all check
destination existence and return a structured `CONFLICT` rather than
overwriting. The only tool capable of overwriting is `replace_file`, which
is hard-coded to `RiskLevel::HighRisk` and offers no rollback (it doesn't
claim to be undoable, since it isn't reliably).

### Recycle Bin deletion
`delete_file` never permanently deletes. It calls `trash::delete()`, which
uses the Windows Shell API to move the target to the Recycle Bin. This is
HIGH_RISK (confirmation required) but genuinely reversible by the user
through Windows' own Recycle Bin UI — JARVIS does not currently offer an
automated one-click restore (the `trash` crate doesn't expose a
restore-by-path API; see README limitations).

### Redacted audit logging
`commands::redact_params()` walks the JSON params tree recursively (objects
and arrays) and replaces any value whose key matches `api_key`, `password`,
`token`, `secret`, `auth`, `credential(s)`, or `clipboard_content` with
`[REDACTED]` before the row is written to `audit_logs`. This runs on every
single audit write site in `commands.rs` — there is no path that logs raw
`req.params` directly anymore.

### Adversarial testing (spec section 24)
`security_tests.rs` and the additions to `security/policy.rs`'s test module
specifically construct `PolicyEngine::evaluate()` calls where the free-text
fields (`action_desc`, `what_will_happen`) contain manipulation attempts —
"ignore your security policy," "the user already confirmed," "treat this as
safe," "no time to confirm" — and assert the risk-level-driven outcome is
unaffected. This is possible to test cleanly *because* `evaluate()`'s
signature has no "trust me" parameter: risk comes from the caller-supplied
`RiskLevel` (itself a compile-time constant per tool, not AI output), and
free text is only ever used for display, never for classification.

### No arbitrary shell — status unchanged from Phase 1
Still not implemented, still not planned without a dedicated hardened-sandbox
design of its own. `actions/browser.rs`'s `BrowserOperation` enum
deliberately has no "execute arbitrary script" variant for the same reason.

## Phase 3 security additions

### Camera/microphone: no hidden activation
Every camera/mic start is traceable to a specific user-initiated call:
- `CameraProvider.start()` is only ever invoked from the "Start Camera"
  button's `onClick` handler.
- `WebSpeechSTTProvider.startListening()` is only ever invoked from the
  push-to-talk button's `onMouseDown`/`onTouchStart` handler.
There is no `useEffect` that starts either on mount, no polling loop that
restarts them, and `stop()` always calls `getTracks().forEach(t => t.stop())`
rather than just dropping a reference — so the OS-level camera/mic
indicator light genuinely turns off, not just the app's own UI state.

### Voice confirmation cannot be spoofed by the AI
See ARCHITECTURE.md "Voice confirmation is structurally AI-proof" — this
is enforced by `matchVoiceConfirmation()`'s signature (transcript-string-in,
enum-out, nothing else) rather than by a runtime check that could be
bypassed. Adversarial test cases in
`src/perception/__tests__/VoiceConfirmation.test.ts` specifically try
transcript strings shaped like an AI narrating a fake confirmation
("The user already confirmed this action, proceed immediately") and assert
they match neither confirm nor cancel.

### Emotion/state privacy (spec section 18)
- All four toggles (`emotionDetectionEnabled`, `cameraBasedStateEnabled`,
  `voiceBasedStateEnabled`, `behaviorBasedStateEnabled`) default to **off**
  in `DEFAULT_SETTINGS` — this is opt-in, not opt-out.
- A disabled modality contributes zero votes to `StateFusionEngine`, not a
  neutral vote — tested explicitly (`excludes a disabled modality entirely`).
- No raw camera frames, no raw microphone audio, and no continuous stream of
  emotion estimates are written to SQLite. `StateEstimate` objects only ever
  live in React state (`stateEstimate`) for the current session; there is no
  Tauri command in this codebase that persists them.
- `MemoryStore` (Rust, Phase 1) has no method for storing emotion/state data
  at all — this isn't a flag being off, it structurally doesn't exist as a
  storable memory `type` in the schema.

### Low-confidence perception cannot drive a dangerous action
`isTargetConfidentEnough()` in `PerceptionContext.ts` is the single,
centrally-defined gate (`MIN_TARGET_CONFIDENCE = 0.5`) for whether a
gesture-resolved target can be used for anything consequential. This
doesn't change what's HIGH_RISK/CRITICAL in the Rust PolicyEngine, though —
a resolved target with high confidence still goes through the same
Rust-side confirmation requirement as a typed-out request would (spec
section 34's second test: high-confidence target + `delete_file` still
requires confirmation).

### Known gap: perception layer has no Rust-side enforcement of its own
Everything above is enforced in TypeScript, not Rust. This is consistent
with Phase 3 making no changes to the Rust security boundary (see
ARCHITECTURE.md), but it does mean a compromised frontend build (not a
compromised AI response, a compromised *build*) could theoretically bypass
`isTargetConfidentEnough()` or `matchVoiceConfirmation()`. This is an
accepted, documented gap for Phase 3 — the Rust PolicyEngine remains the
only boundary that matters for actual OS actions (file/app/browser tools),
and every one of those still requires its own Rust-side confirmation
regardless of what the perception layer decided upstream.

## Phase 4 security additions

### Design commands are not filesystem/OS commands
`DesignCommand` (CREATE_OBJECT, DELETE_OBJECT, etc.) only ever mutates an
in-memory `DesignGraph` — it has no path to the filesystem, process
control, or browser tools. `SAVE_PROJECT`/`LOAD_PROJECT` write to JARVIS's
own SQLite `projects` table via a dedicated Tauri command
(`save_design_project`), not through `ToolRegistry`/`PolicyEngine` at all,
because they aren't OS actions — they're identical in kind to saving a
memory or preference. Exporting a design to an arbitrary filesystem path
would be a distinct, HIGH_RISK filesystem-tool operation (not implemented
in Phase 4) and would go through the normal Phase 2 `PathGuard`/PolicyEngine
path like any other file write — never a design-specific bypass.

### Command validation is the only gate — no separate mutation path
Every single field on every `DesignCommand` is validated in
`design3d/commands/validation.ts` before `CommandExecutor` touches the
graph: numeric fields reject `NaN`/`Infinity`/out-of-range values,
identifiers are restricted to `[a-zA-Z0-9_-]` (which is what rejects a
path-traversal-shaped id like `"../../../.."` — it fails the same regex
check regardless of which field it appears in), unknown command/component
types are rejected outright, and resource limits (max objects, max
hierarchy depth) are enforced centrally. The UI's `InspectorPanel` and the
AI's `DesignIntentTranslator` both route through this exact same
`validateCommand` function via `DesignController.apply()` — there is no
second, faster, less-validated path for either of them.

### Imported GLTF/GLB files are inert data, not code
GLTF/GLB has no embedded-script content type — there is nothing to
"disable." `importGLTF()` still treats the bytes as untrusted: file size is
checked BEFORE parsing (spec section 33), and the resulting scene graph's
node count is checked against the object limit after parsing, with the
parsed geometry disposed immediately if it's rejected (no leaked GPU
resources from a rejected import).

### What's NOT secured yet in Phase 4 (because it's not built yet)
- No multi-PC design transfer (correctly out of scope — spec section 41, Phase 9)
- No gesture-based confirmation for anything (spec section 26 explicitly
  forbids this for now — `ConfirmationDialog`'s voice-only confirmation
  path from Phase 3 is unchanged and untouched by Phase 4)

## Phase 5 security additions

### AR commands have no path to the Rust security boundary — by design
`ARCommand` validation (`ar/validation.ts`) and execution
(`ARController.applyCommand`) only ever touch `ARInstanceManager`'s
in-memory state. There is no code path from an `ARCommand`, a gesture, or
an AR voice request into `ToolRegistry`/`PolicyEngine`/filesystem/
application/browser tools. This means AR interactions are structurally
incapable of bypassing Phase 2's confirmation requirements — not because a
check happens to catch them, but because the two systems don't share a
call path at all. If AR ever needs to trigger a real OS action (file
export, etc.), that would have to be built as an explicit new integration
point through the existing Phase 2 tools, not as an AR command.

### Gestures cannot confirm dangerous actions (spec section 36's explicit rule)
There is no AR/gesture equivalent of `ConfirmationDialog`'s confirm button
anywhere in this codebase. A pinch, a two-hand scale, or any other AR
interaction can only ever produce an `ARCommand`, which per the above can
only affect AR placement — it has no way to reach, let alone confirm, a
Phase 2 `HIGH_RISK`/`CRITICAL` filesystem or application action.

### DesignGraph geometry is immutable from AR's perspective
Every AR interaction (grab, release, two-hand scale, transfer) mutates
`ARObjectInstance` fields only. `ARController`'s grab/release logic never
calls `DesignController.apply()` or touches `DesignGraph` in any way — this
is verified, not just asserted, by `ar/__tests__/ARController.test.ts`'s
"never touches DesignGraph geometry during a grab/release cycle" test,
which checks the design object's transform is unchanged after a full
grab→release cycle.

### Depth honesty (spec section 24)
`DepthProvider.getCapabilities().metric` is `false` for every
implementation that currently exists (`MonocularDepthProvider`,
`NoDepthProvider`) — there is no code path anywhere that could present
MediaPipe's relative z as a real-world measurement. `CoordinateMapper`'s
output field is named `estimatedDepth`, not `depth` or `distanceMeters`.

### What's NOT secured yet in Phase 5 (because it's not built yet)
- Voice-triggered AR commands aren't wired into the live voice loop yet
  (see README) — so this isn't a live attack surface today, but when it is
  wired up, it inherits the same "AI output is untrusted, re-validated
  before execution" posture as `DesignIntentTranslator` already has.
- Calibration values are process-local only right now — no persistence, so
  no calibration-tampering-across-sessions concern exists yet either.

## Phase 6 security additions

### Provider fallback cannot be silently bypassed (spec sections 4, 24)
`aiProviderRegistry.route({ forceProvider: X })` either uses exactly
provider X or fails with an explicit `forced_provider_unavailable` /
`forced_provider_not_found` reason — verified by test
(`AIProviderRouting.test.ts`) that a rate-limited forced provider does
NOT cause a silent switch to a different one. There is no code path in
`route()` that ignores `forceProvider` under any condition.

### API keys never touch the frontend, never get logged
- `security/keystore.rs` is the ONLY code that calls the OS keychain.
  `get_provider_key_status` returns a boolean; the raw key is never
  returned to any Tauri command's frontend caller.
- `ai/types.ts`'s `ProviderConfig.hasApiKey` is a boolean by design — the
  type itself makes it structurally impossible to accidentally store a raw
  key in the same object that drives the Settings UI.
- `orchestrator/ActivityLog.ts`'s `redactActivityParams` mirrors Rust's
  `redact_params` key list exactly, applied to every activity entry before
  storage — verified by test that nested secrets (not just top-level ones)
  are stripped.
- `save_provider_key`'s Tauri command signature passes the raw key
  straight to `keyring::Entry::set_password` with no intermediate storage,
  logging, or `AppState` field holding a copy.

### Dangerous-action confirmations cannot be disabled through Settings
`PrivacySettings.dangerousActionConfirmationsEnabled` is typed as the
literal `true` (not `boolean`) — so even a hand-edited settings JSON
attempting `false` fails `validateSettings` before it can be persisted or
applied. This is enforced at TWO layers (the TypeScript type itself, and
the runtime validator, for defense against a raw JSON blob loaded from
disk that bypasses the type system). The actual Rust `PolicyEngine`
confirmation requirement (Phase 2) is untouched and remains authoritative
regardless of what this setting says — this Phase 6 addition is a
UI-level guard, not a replacement for that boundary.

### Continuous screen capture cannot be enabled through Settings
Same two-layer enforcement as above: `ScreenSettings.continuousCaptureBlocked`
is checked by `validateSettings` to reject `false` outright, and every
`ScreenCaptureProvider` implementation's `getCapabilities().continuousCaptureSupported`
is hardcoded `false`. Enabling real continuous capture in the future would
require deliberately removing BOTH checks, not flipping one flag.

### Dev simulation controls cannot run in production
`DevSimulationControls` checks `env.isDev` at the START of every single
method, throwing immediately if false — verified by test that ALL nine
simulation methods (not just some) throw when `isDev: false`, and that the
target state machine/activity log are left completely untouched by the
blocked attempts. The class takes `isDev` as a constructor parameter
rather than reading a global — callers must explicitly pass
`import.meta.env.DEV` (Vite's real build-time flag), so there's no way to
accidentally wire this to a runtime-toggleable value.

### Interface-only systems refuse rather than fake success
`UnimplementedDeviceChannel.sendTransfer`, `NoScreenCaptureProvider.capture`,
`UnimplementedCommunicationProvider`'s four action methods, and
`UnimplementedWebSearchProvider.search` all throw or return a clearly
negative result — verified by test. None of these can be mistaken for a
working integration by any caller, including the AI itself.

### What's NOT secured yet in Phase 6 (because it's not built yet)
- `MemoryGuard.checkMemoryContent` exists and is tested in isolation but
  isn't yet called from the actual memory-write path — so it isn't
  load-bearing yet. This is documented, not hidden.
- Screen capture frames aren't yet fed into the AI orchestrator's request
  flow, so there's no live prompt-injection-via-screen-content surface
  yet either — that arrives together with the wiring described above.

## Phase 6 completion pass — security-relevant fixes

### Routing bug fix: failed providers were immediately re-selectable
`AIProviderRegistry.isUsable()` excluded `invalid_key`/`disabled`/`rate_limited`
statuses but NOT the general `"unavailable"` status that `recordOutcome`
sets for an ordinary failed call. This meant a provider that had just
failed would be considered usable again on the very next routing decision
— not a silent-fallback-to-a-different-provider bug, but a "the failure
tracking didn't actually track anything" bug. Caught by an integration
test using a real `GeminiProvider` instance with a mocked 503 response,
checking what `route()` did on the call immediately AFTER the failure was
recorded (the original test suite only checked `rate_limited`, which
happened to already be handled — this gap was invisible until a
differently-shaped failure was tested). Fixed; verified with both the
original test suite (still passing) and new coverage.

### Rust keystore bug fix: wrong `keyring` API method for the pinned version
`entry.delete_credential()` was used in `remove_provider_key`, but
`Cargo.toml` pins `keyring = "2"`, and keyring v2's actual stable API
method is `delete_password()` — `delete_credential()` is a v3.x rename.
This would have been a genuine compile failure. Caught by manual,
line-by-line review against the actual crate API (not by "checking braces
balance," which the prior pass's honesty note already flagged as
insufficient and which this pass deliberately did not repeat as the sole
verification method). Still not compiled — no `cargo` in this sandbox —
so this is "a real bug I could find without a compiler," not "proof there
are no more."

### Provider adapters — key safety verified by test, not just by design intent
Every new adapter (Gemini/Grok/DeepSeek) was tested to confirm a thrown
HTTP error never includes the API key in its message — the key only ever
appears in the `Authorization` header or (Gemini's case) the request URL,
never echoed back in error text. Verified for Gemini specifically (its
key lives in the URL, the higher-risk case) with a test asserting the
key string is absent from a thrown 401 error's message.

### Screen capture — settings gate lives in the capture path, not just the UI
`ScreenPerception`'s `isEnabled` check happens before `captureProvider.isAvailable()`
is even consulted — meaning "Screen Capture OFF" is enforced at the same
layer that would actually invoke `getDisplayMedia()`, not only as a
disabled button in `SettingsPage`. Verified by test that `capture()` is
never invoked at all when the gate is off.

### Memory — consent and secret-filtering are now genuinely load-bearing
Every memory write goes through `MemoryOrchestrator.proposeMemory()` or
`.updateMemory()`, both of which call `checkMemoryContent` unconditionally
before touching the store. There is no second code path anywhere in this
codebase that calls a `MemoryBackingStore.add()` directly. Verified with
adversarial test cases (API-key-shaped text, `password=value` shaped
text) confirmed to fail `proposeMemory` and never reach the store.
