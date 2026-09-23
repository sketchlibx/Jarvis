import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { StatusBar } from "./ui/components/StatusBar";
import { ConversationView } from "./ui/components/ConversationView";
import { ConfirmationDialog } from "./ui/components/ConfirmationDialog";
import { ConflictDialog } from "./ui/components/ConflictDialog";
import { TaskProgress } from "./ui/components/TaskProgress";
import { AudioVisualizer } from "./ui/components/AudioVisualizer";
import { CameraPanel } from "./ui/components/CameraPanel";
import { StateIndicator } from "./ui/components/StateIndicator";
import { DebugPanel } from "./ui/components/DebugPanel";
import { ContextManager } from "./memory/ContextManager";
import { aiProviderRegistry } from "./ai/AIProvider";
import { ClaudeProvider } from "./ai/providers/ClaudeProvider";
import { GeminiProvider } from "./ai/providers/GeminiProvider";
import { GrokProvider } from "./ai/providers/GrokProvider";
import { DeepSeekProvider } from "./ai/providers/DeepSeekProvider";
import { OpenAICompatibleGenericProvider } from "./ai/providers/OpenAICompatibleProvider";
import { createWebSpeechVoiceProvider } from "./voice/providers/WebSpeechProvider";
import { CameraProvider } from "./vision/CameraProvider";
import { VisionPipeline } from "./vision/VisionPipeline";
import { MediaPipeHandsProvider } from "./vision/providers/MediaPipeHandsProvider";
import { MediaPipeFaceProvider, MediaPipePoseProvider } from "./vision/providers/MediaPipeFacePoseProvider";
import { PerceptionContext } from "./perception/PerceptionContext";
import { JarvisVisualizerView } from "./ui/core/JarvisVisualizerView";
import { Dashboard } from "./ui/dashboard/Dashboard";
import { SettingsPage } from "./ui/settings/SettingsPage";
import { JarvisStateMachine } from "./orchestrator/JarvisStateMachine";
import type { JarvisState } from "./orchestrator/JarvisStateMachine";
import { ActivityLog } from "./orchestrator/ActivityLog";
import type { ActivityEntry } from "./orchestrator/ActivityLog";
import { DEFAULT_SETTINGS as DEFAULT_FULL_SETTINGS, type JarvisSettings as FullJarvisSettings } from "./settings/types";
import { ScreenPerception } from "./screen/ScreenPerception";
import { WebScreenCaptureProvider } from "./screen/WebScreenCaptureProvider";
import { MemoryOrchestrator } from "./orchestrator/MemoryOrchestrator";
import { TauriMemoryStore } from "./orchestrator/TauriMemoryStore";
import { TauriConversationStore } from "./memory/TauriConversationStore";
import { parseMemoryCommand } from "./orchestrator/MemoryCommands";
import { executeMemoryCommand, buildMemoryContextBlock } from "./orchestrator/MemoryCommandExecutor";
import { extractSpeechText } from "./orchestrator/SpeechContentFilter";
import { detectCommandWidget, type CommandWidgetRequest } from "./orchestrator/WidgetCommands";
import { isVisionStatusQuery, buildVisionStatusReply, buildVisionContextForPrompt } from "./orchestrator/VisionStatusResponse";
import type { MemoryEntry } from "./orchestrator/MemoryGuard";
import { routeVoiceCommand } from "./voice/CommandRouter";
import { ScreenShareOverlay } from "./ui/components/ScreenShareOverlay";
import { CommandWidgets } from "./ui/components/CommandWidgets";
import { PerceptionEventBus } from "./perception/EventBus";
import { GestureEngine } from "./perception/GestureEngine";
import { StateFusionEngine } from "./perception/StateFusionEngine";
import { matchVoiceConfirmation } from "./perception/VoiceConfirmation";
import { DesignStudio } from "./ui/design3d/DesignStudio";
import { Diagnostics } from "./ui/diagnostics/Diagnostics";
import { TauriWebSearchProvider } from "./websearch/TauriWebSearchProvider";
import type { DesignController } from "./design3d/commands/DesignController";
import { serializeProject } from "./design3d/serializers/ProjectSerializer";
import { DEFAULT_SETTINGS, type JarvisSettings } from "./config/settings";
import type { AIMessage, AIProvider } from "./types/ai";
import type { ActionRequest, ActionResponse, ConfirmationExplanation, PlanReport, PlanStep } from "./types/tool";
import type { MicStatus } from "./types/voice";
import type { CameraStatus } from "./types/vision";
import type { RemoteBridgeInfo, RemoteCommand, RemoteView } from "./device/RemoteControlBridge";
import type { FaceObservation, HandObservation, PoseObservation, StateEstimate, VisionPipelineStats } from "./types/perception";

const BASE_SYSTEM_PROMPT = `You are JARVIS, a calm, concise, intelligent, respectful desktop assistant.\nKeep responses short. Only ask clarifying questions when genuinely necessary.`;

const STATE_LABELS: Record<JarvisState, string> = {
  IDLE: "Idle", LISTENING: "Listening", THINKING: "Thinking", SPEAKING: "Speaking",
  EXECUTING: "Executing", WAITING_CONFIRMATION: "Waiting for confirmation", ERROR: "Error", OFFLINE: "Offline",
};

function stripWakePrefix(text: string): string {
  return text.replace(/^\s*(?:hey|hello|hi)\s+jarvis(?:[,.:;!\-]\s*|\s+)/i, "").trim();
}

function isResearchRequest(text: string): boolean {
  const researchVerb = /\b(research|investigate|look\s+up|find\s+out|latest\s+information|study|report)\b/i;
  const connector = /\b(on|about|for|regarding|into|whether|why|how)\b/i;
  const naturalResearch = /\b(research|investigate|look\s+up|find\s+out)\b.+/i.test(text);
  const hinglishResearch = /\b(research|investigate|study)\b.*\b(karke|karo|kar|do|de|ke)\b/i.test(text);
  return (researchVerb.test(text) && connector.test(text)) || naturalResearch || hinglishResearch;
}

function extractResearchTopic(text: string): string {
  const cleaned = text.replace(/^\s*(?:research|investigate|look\s+up|find\s+out)\b[:\s-]*/i, "").replace(/^\s*(?:for|about|on|into)\s+/i, "").trim();
  return cleaned || text.trim();
}

function isMediaRequest(text: string): boolean {
  const mediaTarget = /\b(youtube|song|music|video|track|gaana|gana)\b/i.test(text);
  const action = /\b(play|watch|listen|open|show|baja|bajao|chala|chalao|lagao|sunao)\b/i.test(text);
  return mediaTarget && action;
}

function extractMediaQuery(text: string): string {
  return text
    .replace(/^\s*(?:play|watch|listen(?:\s+to)?|open|show|baja(?:o)?|chala(?:o)?|lagao|sunao)\s*/i, "")
    .replace(/^\s*(?:this|a|the|yeh|ye|ek)\s*/i, "")
    .replace(/\b(?:on|from|pe)\s+(?:youtube|spotify|youtube music)\b/i, "")
    .replace(/\b(?:youtube|song|music|video|track|gaana|gana)\b/i, "")
    .trim();
}

function slugifyFileName(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "research";
}

function remoteViewToAppView(view: RemoteView): "assistant" | "dashboard" | "settings" | "design" {
  return view;
}


export default function App() {
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [input, setInput] = useState("");
  const [commandWidget, setCommandWidget] = useState<CommandWidgetRequest | null>(null);
  const [aiAvailable, setAiAvailable] = useState(true);
  const [pendingConfirmation, setPendingConfirmation] = useState<{
    request: ActionRequest;
    explanation: ConfirmationExplanation;
  } | null>(null);
  const [pendingConflict, setPendingConflict] = useState<{
    request: ActionRequest;
    destination: string;
  } | null>(null);
  const [currentPlan, setCurrentPlan] = useState<PlanReport | null>(null);
  const [planRunning, setPlanRunning] = useState(false);
  const contextRef = useRef(new ContextManager());

  // -------------------------------------------------------------------
  // Phase 3 — voice, camera, perception state
  // -------------------------------------------------------------------
  const [settings, setSettings] = useState<JarvisSettings>(DEFAULT_SETTINGS); // Phase 7: now genuinely settable — see SettingsPage's Vision tab wiring below
  const [view, setView] = useState<"assistant" | "design" | "settings" | "dashboard" | "diagnostics">("assistant");
  const [seriousMode, setSeriousMode] = useState(false);
  const [micStatus, setMicStatus] = useState<MicStatus>("idle");
  const [speaking, setSpeaking] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>("off");
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [hands, setHands] = useState<HandObservation[]>([]);
  const [faceObservation, setFaceObservation] = useState<FaceObservation | null>(null);
  const [poseObservation, setPoseObservation] = useState<PoseObservation | null>(null);
  const [visionStats, setVisionStats] = useState<VisionPipelineStats | null>(null);
  const [debugMode, setDebugMode] = useState(false);
  const [eventRate, setEventRate] = useState(0);
  const [stateEstimate, setStateEstimate] = useState<StateEstimate | null>(null);
  const [micAnalyser, setMicAnalyser] = useState<AnalyserNode | null>(null);
  const [screenShareStream, setScreenShareStream] = useState<MediaStream | null>(null);
  const [screenRecording, setScreenRecording] = useState(false);
  const screenRecorderRef = useRef<MediaRecorder | null>(null);
  const screenChunksRef = useRef<Blob[]>([]);

  const voiceRef = useRef(createWebSpeechVoiceProvider("en-US", {
    rate: DEFAULT_FULL_SETTINGS.voice.speechSpeed,
    pitch: DEFAULT_FULL_SETTINGS.voice.pitch,
    volume: DEFAULT_FULL_SETTINGS.voice.volume,
    voiceName: DEFAULT_FULL_SETTINGS.voice.voice !== "default" ? DEFAULT_FULL_SETTINGS.voice.voice : undefined,
  }));
  const cameraRef = useRef(new CameraProvider());
  const perceptionRef = useRef(new PerceptionContext());
  const eventBusRef = useRef(new PerceptionEventBus());
  const gestureEngineRef = useRef(new GestureEngine());
  const handsProviderRef = useRef(new MediaPipeHandsProvider());
  const faceProviderRef = useRef(new MediaPipeFaceProvider());
  const poseProviderRef = useRef(new MediaPipePoseProvider());
  const visionPipelineRef = useRef<VisionPipeline | null>(null);
  const stateMachineRef = useRef<JarvisStateMachine>(new JarvisStateMachine());
  const activityLogRef = useRef<ActivityLog>(new ActivityLog());

  // ---------------------------------------------------------------------
  // Phase B root-cause fix: MediaPipeHandsProvider was constructed
  // (`handsProviderRef`) but its `.initialize(wasmBasePath,
  // modelAssetPath)` was never actually called anywhere in this file —
  // confirmed by grep before this fix. `isInitialized` was therefore
  // permanently false, so VisionPipeline's own per-frame check
  // (`this.hands?.isInitialized`) never ran the detector — camera frames
  // arrived (camera FPS > 0) but nothing ever counted as a processed
  // vision frame (vision FPS stuck at 0), exactly the reported symptom.
  // This was a silent gap, not a crash — nothing surfaced it.
  //
  // Fix: real initialization, using WASM files copied from the already-
  // installed @mediapipe/tasks-vision package into public/mediapipe/wasm
  // (served locally — no CDN/network dependency for the runtime engine
  // itself) and Google's real, documented model URL (the model weights
  // are never bundled by the npm package itself; MediaPipe's own official
  // examples fetch this the same way). `visionAvailable` is TRUTHFUL —
  // "available" only after a real successful initialize() resolves,
  // "unavailable" only after a real attempt actually failed (e.g. no
  // network to fetch the model), never assumed from the camera or UI
  // state alone.
  // ---------------------------------------------------------------------
  const [visionAvailable, setVisionAvailable] = useState<"unknown" | "initializing" | "available" | "unavailable">("unknown");
  const visionInitPromiseRef = useRef<Promise<void> | null>(null);

  const ensureVisionInitialized = useCallback(async (): Promise<boolean> => {
    if (handsProviderRef.current.isInitialized) {
      setVisionAvailable("available");
      return true;
    }
    if (!visionInitPromiseRef.current) {
      setVisionAvailable("initializing");
      visionInitPromiseRef.current = handsProviderRef.current.initialize(
        "/mediapipe/wasm",
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task"
      );
    }
    try {
      await visionInitPromiseRef.current;
      setVisionAvailable("available");
      return true;
    } catch (err) {
      // Reset so a LATER camera start can genuinely retry (e.g. network
      // came back) rather than being permanently stuck in a failed state
      // from one bad attempt.
      visionInitPromiseRef.current = null;
      setVisionAvailable("unavailable");
      activityLogRef.current.record({
        requestText: "Vision model initialization",
        interpretedIntent: "vision.init",
        providerName: null,
        toolName: "vision",
        status: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }, []);

  const [appSettings, setAppSettings] = useState<FullJarvisSettings>(DEFAULT_FULL_SETTINGS);

  // Keeps the REAL TTS provider's rate/pitch/volume/voice in sync with
  // Settings' Voice tab — previously createWebSpeechVoiceProvider() was
  // called with zero config ever, so these fields existed in Settings but
  // had literally no effect on anything (a real "control that isn't
  // wired" gap). Also fires once settings are restored from
  // load_settings() on startup, not just on live edits.
  useEffect(() => {
    voiceRef.current.tts.updateConfig?.({
      rate: appSettings.voice.speechSpeed,
      pitch: appSettings.voice.pitch,
      volume: appSettings.voice.volume,
      voiceName: appSettings.voice.voice !== "default" ? appSettings.voice.voice : undefined,
    });
  }, [appSettings.voice.speechSpeed, appSettings.voice.pitch, appSettings.voice.volume, appSettings.voice.voice]);

  // Keep the selected TTS engine and voice live without recreating the
  // VoiceProvider (which would detach STT/TTS listeners). Kokoro is the
  // no-payment local default; ElevenLabs remains optional.
  useEffect(() => {
    const tts = voiceRef.current.tts as typeof voiceRef.current.tts & {
      setTTSProvider?: (provider: "web_speech" | "elevenlabs" | "kokoro") => void;
      configureKokoro?: (config: { voice: string }) => void;
      updateKokoroVoice?: (voice: string) => void;
      updateElevenLabsVoice?: (voiceId: string, modelId: string) => void;
    };
    tts.configureKokoro?.({ voice: appSettings.voice.kokoroVoice });
    tts.updateKokoroVoice?.(appSettings.voice.kokoroVoice);
    tts.updateElevenLabsVoice?.(appSettings.voice.elevenLabsVoiceId, appSettings.voice.elevenLabsModel);
    tts.setTTSProvider?.(
      appSettings.voice.ttsProvider === "elevenlabs"
        ? "elevenlabs"
        : appSettings.voice.ttsProvider === "kokoro"
          ? "kokoro"
          : "web_speech",
    );
  }, [appSettings.voice.ttsProvider, appSettings.voice.kokoroVoice, appSettings.voice.elevenLabsVoiceId, appSettings.voice.elevenLabsModel]);

  // Appearance settings are live UI controls, not decorative values.
  useEffect(() => {
    document.documentElement.dataset.jarvisTheme = appSettings.appearance.theme;
    document.documentElement.dataset.jarvisDensity = appSettings.appearance.density;
    document.documentElement.dataset.jarvisReducedMotion = appSettings.appearance.reducedMotion ? "true" : "false";
    document.documentElement.dataset.jarvisAnimationQuality = appSettings.appearance.animationQuality;
  }, [appSettings.appearance.theme, appSettings.appearance.density, appSettings.appearance.reducedMotion, appSettings.appearance.animationQuality]);

  const [wakeWordUnavailable, setWakeWordUnavailable] = useState(false);

  useEffect(() => () => {
    if (streamUiRafRef.current !== null) cancelAnimationFrame(streamUiRafRef.current);
    streamUiRafRef.current = null;
    streamUiPendingRef.current = null;
  }, []);


  // Functional wake-word fallback uses the SAME recognizer as continuous
  // listening. It never acquires a second mic stream. When enabled, a final
  // transcript containing "hey/hello/hi jarvis" emits a real wake event.
  useEffect(() => {
    const wake = voiceRef.current.wakeWord;
    if (!appSettings.voice.wakeWordEnabled || !wake) {
      wake?.stop();
      setWakeWordUnavailable(false);
      return;
    }
    // Wake-word detection uses the same recognizer as automatic listening.
    // Turning it on therefore also enables the continuous recognizer instead
    // of leaving an apparently enabled but silent wake service.
    if (!appSettings.voice.continuousListeningEnabled) {
      setAppSettings((current) => ({ ...current, voice: { ...current.voice, continuousListeningEnabled: true } }));
    }
    let cancelled = false;
    const unsubscribe = wake.onWakeWord(() => {
      if (!cancelled) {
        wakeArmedUntilRef.current = Date.now() + 10000;
        activityLogRef.current.record({ requestText: "Wake word detected", interpretedIntent: "voice.wake_word", providerName: null, toolName: "voice.wake-word", status: "completed", errorMessage: null });
      }
    });
    void wake.start().then(() => {
      if (!cancelled) setWakeWordUnavailable(false);
    }).catch((err) => {
      if (!cancelled) {
        setWakeWordUnavailable(true);
        activityLogRef.current.record({ requestText: "Wake word unavailable", interpretedIntent: "voice.wake_word", providerName: null, toolName: "voice.wake-word", status: "error", errorMessage: err instanceof Error ? err.message : String(err) });
      }
    });
    return () => { cancelled = true; unsubscribe(); wake.stop(); };
  }, [appSettings.voice.wakeWordEnabled]);

  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [memoriesLoading, setMemoriesLoading] = useState(false);
  // Home command-center state — the actual JarvisStateMachine's current
  // state (mirrored into React state so the orb + label re-render), the
  // most recent activity-log entry, and real online/offline status. All
  // three used to live only inside the separate Dashboard view and were
  // never actually wired to real events there (stateMachineRef was created
  // but nothing ever called .transition() on it); wiring it for real is
  // part of this pass, not just moving the JSX.
  const [jarvisState, setJarvisState] = useState<JarvisState>("IDLE");
  const [activityEntries, setActivityEntries] = useState<ActivityEntry[]>([]);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [remoteBridge, setRemoteBridge] = useState<RemoteBridgeInfo | null>(null);

  const refreshMemories = useCallback(async () => {
    setMemoriesLoading(true);
    try {
      setMemories(await memoryRef.current.retrieveApprovedMemories());
    } finally {
      setMemoriesLoading(false);
    }
  }, []);

  // ---------------------------------------------------------------------
  // Phase 2, items 1/2/5: real conversation persistence + memory
  // injection readiness. `conversationRef` talks to its OWN Rust
  // commands/tables (create_conversation/save_message/...), entirely
  // separate from `memoryRef` above — conversation history and long-term
  // memory stay two systems, per item 6, even though both eventually feed
  // into the same AI call.
  // ---------------------------------------------------------------------
  const conversationRef = useRef<TauriConversationStore>(new TauriConversationStore(invoke));
  const conversationIdRef = useRef<string | null>(null);
  // Messages are only ever persisted once a real conversation id exists.
  // A message sent in the brief window before startup hydration finishes
  // is queued here rather than dropped or raced against a null id.
  const pendingPersistRef = useRef<Array<{ role: AIMessage["role"]; content: string }>>([]);
  // Set the moment the user sends/says/types anything, BEFORE hydration
  // might complete — guards against the hydration effect below clobbering
  // whatever is already on screen with the restored history (item 10:
  // "prevent... race conditions... stale context").
  const userHasSentAnythingRef = useRef(false);

  const persistMessage = useCallback((role: AIMessage["role"], content: string) => {
    const conversationId = conversationIdRef.current;
    if (!conversationId) {
      // Hydration hasn't finished yet — queue it; the hydration effect
      // below drains this queue in order once the real id is known,
      // so nothing sent during startup is silently lost.
      pendingPersistRef.current.push({ role, content });
      return;
    }
    conversationRef.current.saveMessage(conversationId, role, content).catch((err) => {
      // Persistence failing must never break the live conversation the
      // user is having right now — this is a best-effort mirror to disk,
      // not the source of truth for the current session's UI state.
      console.warn("conversation persistence: failed to save message", err);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refreshMemories();
        const { conversationId, messages: stored } = await conversationRef.current.resumeOrCreate();
        if (cancelled) return;
        conversationIdRef.current = conversationId;
        if (stored.length > 0) {
          const restored: AIMessage[] = stored.map((m) => ({ role: m.role, content: m.content }));
          if (userHasSentAnythingRef.current) {
            // The user already started interacting before hydration
            // finished — prepend restored history rather than clobbering
            // what's already on screen, and rebuild ContextManager's
            // history in the correct chronological order.
            setMessages((prev) => [...restored, ...prev]);
            const alreadyAdded = contextRef.current.getHistory(1000);
            contextRef.current.clear();
            for (const m of restored) contextRef.current.addMessage(m);
            for (const m of alreadyAdded) contextRef.current.addMessage(m);
          } else {
            setMessages(restored);
            for (const m of restored) contextRef.current.addMessage(m);
          }
        }
        // Drain anything sent during the brief hydration window, in order.
        const queued = pendingPersistRef.current;
        pendingPersistRef.current = [];
        for (const item of queued) {
          conversationRef.current.saveMessage(conversationId, item.role, item.content).catch((err) => {
            console.warn("conversation persistence: failed to save queued message", err);
          });
        }
      } catch (err) {
        // A persistence failure at startup must not block the assistant
        // from being usable — fall back to session-only behavior (a null
        // conversationId means persistMessage just queues forever, which
        // is fine: an in-memory-only session, not a crash).
        console.warn("conversation persistence: failed to resume/create conversation", err);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const appSettingsRef = useRef(appSettings);
  useEffect(() => { appSettingsRef.current = appSettings; }, [appSettings]);
  // Real live path: gated by the ACTUAL settings state (via a ref, so the
  // gate always reflects the current value even though ScreenPerception
  // itself is constructed once) — not a decorative toggle. Verified by
  // ScreenPerception.test.ts's "screen capture OFF means no capture
  // happens at all" test.
  const screenPerceptionRef = useRef<ScreenPerception>(
    new ScreenPerception(new WebScreenCaptureProvider(), () => appSettingsRef.current.screen.screenCaptureEnabled && appSettingsRef.current.screen.screenAnalysisEnabled)
  );
  // Closes PHASE-CONTINUITY.md gap #1 — a real, persistent memory store
  // backed by the Rust commands added this session, wired through the
  // SAME MemoryOrchestrator/MemoryGuard consent-and-secret-filtering path
  // already tested against InMemoryMemoryStore. No second memory system.
  const memoryRef = useRef<MemoryOrchestrator>(
    new MemoryOrchestrator(new TauriMemoryStore(invoke))
  );
  const hiddenVideoRef = useRef<HTMLVideoElement | null>(null);
  const eventCountRef = useRef(0);
  const stateFusionRef = useRef(
    new StateFusionEngine({
      voiceEnabled: settings.voiceBasedStateEnabled,
      faceEnabled: settings.cameraBasedStateEnabled,
      behaviorEnabled: settings.behaviorBasedStateEnabled,
    })
  );
  const ttsAbortRef = useRef<AbortController | null>(null);
  const listeningStartRef = useRef<number>(0);
  const interruptionCountRef = useRef(0);
  const commandTimestampsRef = useRef<number[]>([]);
  const correctionCountRef = useRef(0);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const resumeListeningWhenIdleRef = useRef(false);
  const handlePushToTalkDownRef = useRef<(() => Promise<void>) | null>(null);
  const handlePushToTalkUpRef = useRef<(() => Promise<void>) | null>(null);
  const didSpeakResponseRef = useRef(false);
  const autoCommandTimerRef = useRef<number | null>(null);
  const webSearchRef = useRef(new TauriWebSearchProvider(invoke));
  const handleSendRef = useRef<((text: string) => Promise<void>) | null>(null);
  const handleStartScreenShareRef = useRef<(() => Promise<void>) | null>(null);
  const handleStopScreenShareRef = useRef<(() => void) | null>(null);
  const remoteCommandInFlightRef = useRef(false);
  const wakeArmedUntilRef = useRef(0);
  const streamUiRafRef = useRef<number | null>(null);
  const streamUiPendingRef = useRef<string | null>(null);
  /** Phase 7 security/reliability pass: the AbortController backing
   * whichever provider call (research/generatePlan/chat/streamChat) is
   * currently in flight inside handleSend, so a timeout and a real
   * user-initiated "stop"/"cancel" can both actually cancel the network
   * request — previously nothing could, and a stalled call left the UI
   * stuck in THINKING indefinitely. `abortReasonRef` distinguishes the two
   * so the catch block can show an accurate message and decide whether the
   * abort should count against the provider's routing health. */
  const activeChatAbortRef = useRef<AbortController | null>(null);
  const abortReasonRef = useRef<"user" | "timeout" | null>(null);

  // Lazily construct the pipeline once — it coordinates the already-created
  // provider/engine/context/bus instances above rather than owning parallel
  // ones, per the "do not create a second parallel vision architecture" requirement.
  if (!visionPipelineRef.current) {
    visionPipelineRef.current = new VisionPipeline(
      handsProviderRef.current, faceProviderRef.current, poseProviderRef.current,
      gestureEngineRef.current, perceptionRef.current, eventBusRef.current,
      { enableHands: settings.handTrackingEnabled, enableFace: settings.cameraBasedStateEnabled, enablePose: settings.poseTrackingEnabled, targetFps: 15,
        onStreamEnded: () => { setCameraStatus("error"); cameraRef.current.stop(); } }
    );
  }

  // Phase 7: keeps the ALREADY-RUNNING VisionPipeline's live options in
  // sync whenever Settings changes — closes the "Camera OFF must actually
  // prevent camera processing" requirement without reconstructing the
  // pipeline (which would risk the duplicate-pipeline bug class every
  // prior phase's tests guard against). `updateOptions` patches
  // `this.options`, which the detect loop already reads fresh every
  // frame (see VisionPipeline.ts) — so this takes effect on the very next
  // frame, not just at next app launch.
  useEffect(() => {
    visionPipelineRef.current?.updateOptions({
      enableHands: settings.handTrackingEnabled,
      enableFace: settings.cameraBasedStateEnabled,
      enablePose: settings.poseTrackingEnabled,
    });
  }, [settings.handTrackingEnabled, settings.cameraBasedStateEnabled, settings.poseTrackingEnabled]);

  // Real online/offline signal, driving both the status dot (previously
  // read navigator.onLine only once at render, so it never actually
  // updated) and the state machine's OFFLINE state.
  useEffect(() => {
    const goOnline = () => { setIsOnline(true); stateMachineRef.current.transition("IDLE"); };
    const goOffline = () => { setIsOnline(false); stateMachineRef.current.transition("OFFLINE"); };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  useEffect(() => stateMachineRef.current.onTransition((e) => { setJarvisState(e.state); activityLogRef.current.record({ requestText: `State → ${e.state}`, interpretedIntent: "state.transition", providerName: null, toolName: "state-machine", status: e.state === "ERROR" ? "error" : "understanding", errorMessage: e.detail ?? null }); }), []);
  useEffect(() => {
    const saved = localStorage.getItem("jarvis.diagnostics.v1");
    if (saved) { try { const parsed = JSON.parse(saved) as ActivityEntry[]; setActivityEntries(parsed); } catch { /* ignore corrupt diagnostic cache */ } }
    return activityLogRef.current.onChange((entries) => {
      setActivityEntries(entries);
      try { localStorage.setItem("jarvis.diagnostics.v1", JSON.stringify(entries)); } catch { /* storage is best-effort */ }
    });
  }, []);

  /** Momentary ERROR flash: transitions to ERROR, then back to IDLE after a
   * couple of seconds (ERROR has no automatic exit of its own in
   * JarvisStateMachine — ERROR -> IDLE is a deliberate user/system-driven
   * transition, not a timer, elsewhere in the state machine's design, so
   * this timeout is this call site's own choice, not a change to the
   * shared state machine class). */
  const flashError = useCallback(() => {
    stateMachineRef.current.transition("ERROR");
    setTimeout(() => stateMachineRef.current.transition("IDLE"), 2500);
  }, []);

  useEffect(() => {
    const unsubMic = voiceRef.current.stt.onStatusChange(setMicStatus);
    const unsubTts = voiceRef.current.tts.onStatusChange((s) => {
      setSpeaking(s === "speaking");
      stateMachineRef.current.transition(s === "speaking" ? "SPEAKING" : "IDLE");
      if ((s === "idle" || s === "error") && resumeListeningWhenIdleRef.current && appSettingsRef.current.voice.continuousListeningEnabled) {
        resumeListeningWhenIdleRef.current = false;
        window.setTimeout(() => { void handlePushToTalkDownRef.current?.(); }, 180);
      }
    });
    const unsubCam = cameraRef.current.onStatusChange(setCameraStatus);

    const pipeline = visionPipelineRef.current!;
    const unsubSnapshot = pipeline.onSnapshot((snapshot) => {
      setHands(snapshot.hands);
      setFaceObservation(snapshot.face);
      setPoseObservation(snapshot.pose);
      if (settings.cameraBasedStateEnabled && snapshot.face) {
        refreshFaceSignal(snapshot.face);
      }
    });
    const unsubStats = pipeline.onStats(setVisionStats);

    // Rolling event-rate counter for the debug panel — genuinely counts
    // EventBus emissions, not a fake number.
    const unsubEvents: Array<() => void> = [
      "hand.detected", "hand.lost", "gesture.detected", "face.detected", "face.lost", "pose.detected", "pose.lost",
    ].map((type) => eventBusRef.current.on(type as any, () => { eventCountRef.current += 1; }));
    const rateInterval = setInterval(() => {
      setEventRate(eventCountRef.current);
      eventCountRef.current = 0;
    }, 1000);

    return () => {
      unsubMic();
      unsubTts();
      unsubCam();
      unsubSnapshot();
      unsubStats();
      unsubEvents.forEach((u) => u());
      clearInterval(rateInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ensureProvider = useCallback(() => {
    try {
      return aiProviderRegistry.getActive();
    } catch {
      // BUGFIX (Phase 7 productization pass): this previously constructed
      // `new ClaudeProvider({ apiKey })` with `apiKey` possibly being an
      // empty string (a totally fresh install has nothing in
      // localStorage) — and `ClaudeProvider`'s constructor THROWS on an
      // empty key. That throw happened inside this catch block with
      // nothing further up the chain to catch it, so calling
      // `ensureProvider()` on a fresh install would crash. This was
      // always latent, but became reachable on EVERY app launch once the
      // new startup key-loading effect started calling `ensureProvider()`
      // eagerly (see below) rather than only lazily when the user first
      // sent a chat message. Fixed by using the SAME safe placeholder
      // pattern already used for Gemini/Grok/DeepSeek below, rather than
      // a construction path that can throw.
      const savedKey = window.localStorage.getItem("jarvis_dev_api_key");
      const provider = new ClaudeProvider({ apiKey: savedKey || "placeholder-unconfigured" });
      aiProviderRegistry.register(provider, {
        displayName: "Claude", enabled: true, hasApiKey: !!savedKey, model: "claude-sonnet-5", priority: 0,
        capabilities: ["TEXT", "VISION", "TOOL_CALLING", "STRUCTURED_OUTPUT", "STREAMING", "LONG_CONTEXT"],
      });
      // Register PLACEHOLDER entries for the other providers so they
      // appear in Settings with the correct capability metadata — closes
      // the gap where Settings could show "hasApiKey: true" for a
      // provider with no actual provider INSTANCE behind it (the router
      // would then have nothing real to call). A placeholder is
      // constructed with a non-empty dummy key ONLY to satisfy the
      // constructor's non-empty-key guard; `hasApiKey: false` in the
      // config is what actually gates routing (see AIProviderRegistry.isUsable),
      // so this placeholder can never be selected by route() until a real
      // key replaces it via `registerProviderWithRealKey` below.
      aiProviderRegistry.register(new GeminiProvider({ apiKey: "placeholder-unconfigured" }), {
        displayName: "Gemini", enabled: true, hasApiKey: false, priority: 1,
        capabilities: ["TEXT", "VISION", "STREAMING", "STRUCTURED_OUTPUT", "LONG_CONTEXT"],
      });
      aiProviderRegistry.register(new GrokProvider({ apiKey: "placeholder-unconfigured" }), {
        displayName: "Grok", enabled: true, hasApiKey: false, priority: 2,
        capabilities: ["TEXT", "STREAMING", "TOOL_CALLING"],
      });
      aiProviderRegistry.register(new DeepSeekProvider({ apiKey: "placeholder-unconfigured" }), {
        displayName: "DeepSeek", enabled: true, hasApiKey: false, priority: 3,
        capabilities: ["TEXT", "STREAMING", "TOOL_CALLING"],
      });
      // "openai_compatible" — see OpenAICompatibleProvider.ts's
      // OpenAICompatibleGenericProvider doc comment for why this is new
      // this session. Its constructor REQUIRES a real baseUrl/model, so
      // the placeholder here uses obviously-fake values (same discipline
      // as the "placeholder-unconfigured" API key above) purely to
      // satisfy that constructor guard — `hasApiKey: false` is what
      // actually keeps route() from ever selecting it.
      aiProviderRegistry.register(
        new OpenAICompatibleGenericProvider({ apiKey: "placeholder-unconfigured", baseUrl: "https://placeholder.invalid", model: "placeholder-model" }),
        {
          displayName: "OpenAI-compatible", enabled: true, hasApiKey: false, priority: 4,
          capabilities: ["TEXT", "STREAMING", "TOOL_CALLING"],
        }
      );
      return provider;
    }
  }, []);

  /** THE actual live path Settings -> real provider instance -> router
   * (closing the audit's "Provider Settings → Actual Router" gap). Called
   * after a key is successfully saved to the OS keychain — constructs a
   * REAL provider bound to that key and re-registers it, replacing the
   * placeholder. Without this, saving a key in Settings only flipped a
   * metadata flag with no live provider behind it.
   *
   * `extra` is ONLY meaningful for "openai_compatible" — see
   * OpenAICompatibleGenericProvider's constructor, which requires a real
   * baseUrl+model that (unlike every other provider) has no built-in
   * default this app could fall back to. */
  const registerProviderWithRealKey = useCallback((providerName: string, apiKey: string, extra?: {
    baseUrl?: string;
    model?: string;
    voiceId?: string;
    modelId?: string;
  }) => {
    if (providerName === "elevenlabs") {
      const tts = voiceRef.current.tts as typeof voiceRef.current.tts & { configureElevenLabs?: (config: { voiceId: string; modelId?: string }) => void };
      const voiceId = extra?.voiceId?.trim() || appSettingsRef.current.voice.elevenLabsVoiceId;
      const modelId = extra?.modelId?.trim() || appSettingsRef.current.voice.elevenLabsModel;
      tts.configureElevenLabs?.({ voiceId, modelId });
      return;
    }
    const existingConfig = aiProviderRegistry.getConfig(providerName);
    if (!existingConfig) return;
    let provider;
    if (providerName === "gemini") provider = new GeminiProvider({ apiKey, model: existingConfig.model !== "default" ? existingConfig.model : undefined });
    else if (providerName === "grok") provider = new GrokProvider({ apiKey, model: existingConfig.model !== "default" ? existingConfig.model : undefined });
    else if (providerName === "deepseek") provider = new DeepSeekProvider({ apiKey, model: existingConfig.model !== "default" ? existingConfig.model : undefined });
    else if (providerName === "claude") provider = new ClaudeProvider({ apiKey, model: existingConfig.model !== "default" ? existingConfig.model : undefined });
    else if (providerName === "openai_compatible") {
      const baseUrl = extra?.baseUrl?.trim();
      const model = extra?.model?.trim();
      // Deliberately does NOT fall back to a guessed endpoint — there is
      // no "the" OpenAI-compatible endpoint the way there is for Grok/
      // DeepSeek. Without both fields the provider simply stays
      // unregistered/placeholder rather than constructing something that
      // would silently point nowhere real.
      if (!baseUrl || !model) return;
      try {
        provider = new OpenAICompatibleGenericProvider({ apiKey, baseUrl, model });
      } catch {
        return;
      }
    } else return;
    aiProviderRegistry.register(provider, {
      hasApiKey: true,
      ...(providerName === "openai_compatible" ? { baseUrl: extra?.baseUrl, model: extra?.model } : {}),
    });
  }, []);

  // Loads any previously-saved keys back into real provider instances on
  // startup — without this, a key saved in a prior session would show
  // "configured" in the keychain (get_provider_key_status) but have no
  // actual working provider behind it after a restart, since the
  // placeholder registration above always starts with hasApiKey:false.
  // Runs once per app launch. See keystore.rs's `get_provider_key` doc
  // comment for why loading the real key into frontend memory here is a
  // deliberate, documented design decision rather than a security gap.
  useEffect(() => {
    let cancelled = false;
    ensureProvider(); // guarantees Claude + gemini/grok/deepseek/openai_compatible placeholders are registered BEFORE we try to load saved keys onto them — without this call, aiProviderRegistry.getConfig() would return undefined for everything on first mount and every key-load below would silently no-op
    (async () => {
      // REAL BUG FOUND AND FIXED THIS SESSION: `load_settings` has always
      // existed as a registered Tauri command (src-tauri/src/commands.rs)
      // but nothing in the frontend ever called it — `save_settings`
      // worked, but every setting (including defaultProvider and
      // fallbackBehavior, both otherwise dead per gap #12) was silently
      // discarded on every restart. Loaded FIRST and awaited so
      // openai_compatible's baseUrl/model (which live here, not the
      // keychain) are ready before the provider-key restoration loop
      // below needs them.
      let restoredAi = appSettings.ai;
      try {
        const raw = await invoke<string | null>("load_settings");
        if (!cancelled && raw) {
          const parsed = JSON.parse(raw) as Partial<FullJarvisSettings>;
          const restored = { ...DEFAULT_FULL_SETTINGS, ...parsed, ai: { ...DEFAULT_FULL_SETTINGS.ai, ...(parsed.ai ?? {}) }, voice: { ...DEFAULT_FULL_SETTINGS.voice, ...(parsed.voice ?? {}) }, screen: { ...DEFAULT_FULL_SETTINGS.screen, ...(parsed.screen ?? {}) }, privacy: { ...DEFAULT_FULL_SETTINGS.privacy, ...(parsed.privacy ?? {}) }, appearance: { ...DEFAULT_FULL_SETTINGS.appearance, ...(parsed.appearance ?? {}) }, system: { ...DEFAULT_FULL_SETTINGS.system, ...(parsed.system ?? {}) } } as FullJarvisSettings;
          // This project is intentionally moving to the free local TTS path.
          // Migrate the previous ElevenLabs selection so an old saved setting
          // cannot unexpectedly trigger paid API usage after an upgrade.
          if (restored.voice.ttsProvider === "elevenlabs") restored.voice.ttsProvider = "kokoro";
          setAppSettings(restored);
          restoredAi = restored.ai;
        }
      } catch {
        // No settings saved yet (fresh install) — DEFAULT_FULL_SETTINGS
        // (the initial state) is the correct, honest fallback.
      }

      for (const name of ["claude", "gemini", "grok", "deepseek", "openai_compatible"]) {
        try {
          const key = await invoke<string | null>("load_provider_key_for_session", { providerName: name });
          if (!cancelled && key) {
            registerProviderWithRealKey(
              name, key,
              name === "openai_compatible"
                ? { baseUrl: restoredAi.openAiCompatibleBaseUrl ?? undefined, model: restoredAi.openAiCompatibleModel ?? undefined }
                : undefined
            );
          }
        } catch {
          // No saved key, or keychain unavailable in this environment —
          // the provider simply stays at its placeholder/disabled state,
          // which is the correct honest fallback, not an app-breaking error.
        }
      }

      // Do NOT auto-select ElevenLabs merely because an API key exists. A
      // saved key can belong to a free account, where some voices return 402.
      // The selected TTS engine is now controlled by the persisted Settings
      // value, with Kokoro as the free/local default.
    })();
    return () => { cancelled = true; };
  }, [registerProviderWithRealKey, ensureProvider]);

  const runToolRequest = useCallback(async (req: ActionRequest) => {
    const response = await invoke<ActionResponse>("request_action", { req });
    if (response.status === "NeedsConfirmation") {
      stateMachineRef.current.transition("WAITING_CONFIRMATION");
      setPendingConfirmation({ request: req, explanation: response.explanation });
      return `This needs your confirmation: ${response.explanation.action}.`;
    }
    if (response.status === "Conflict") {
      // Reuses WAITING_CONFIRMATION for a file conflict too — both are the
      // same underlying situation from the orb's point of view: JARVIS is
      // paused, waiting on a real user decision before it can proceed.
      stateMachineRef.current.transition("WAITING_CONFIRMATION");
      setPendingConflict({ request: req, destination: response.destination });
      return `${response.destination} already exists — want me to replace it or create a copy?`;
    }
    if (response.status === "Denied") return `I can't do that: ${response.reason}`;
    if (response.status === "Error") { flashError(); return `That failed: ${response.message}`; }
    return response.message;
  }, [flashError]);

  const handleConflictReplace = useCallback(async () => {
    if (!pendingConflict) return;
    const replaceReq: ActionRequest = {
      tool_id: "replace_file",
      params: pendingConflict.request.params,
      user_request: pendingConflict.request.user_request,
      interpreted_intent: "user chose Replace after a conflict",
    };
    setPendingConflict(null);
    stateMachineRef.current.transition("EXECUTING");
    const text = await runToolRequest(replaceReq); // will surface the HIGH_RISK ConfirmationDialog
    setMessages((prev) => [...prev, { role: "assistant", content: text }]);
  }, [pendingConflict, runToolRequest]);

  const handleConflictCopy = useCallback(async () => {
    if (!pendingConflict) return;
    const original = String(pendingConflict.request.params.destination ?? pendingConflict.request.params.path ?? "");
    const renamed = original.replace(/(\.[^.]*)?$/, (ext) => ` (copy)${ext}`);
    const copyReq: ActionRequest = {
      ...pendingConflict.request,
      params: { ...pendingConflict.request.params, destination: renamed },
    };
    setPendingConflict(null);
    stateMachineRef.current.transition("EXECUTING");
    const text = await runToolRequest(copyReq);
    setMessages((prev) => [...prev, { role: "assistant", content: text }]);
  }, [pendingConflict, runToolRequest]);

  const handleConflictCancel = useCallback(() => {
    setPendingConflict(null);
    stateMachineRef.current.transition("IDLE");
    setMessages((prev) => [...prev, { role: "assistant", content: "Cancelled." }]);
  }, []);

  const runPlan = useCallback(async (steps: PlanStep[], userRequest: string, interpretedIntent: string) => {
    setPlanRunning(true);
    stateMachineRef.current.transition("EXECUTING");
    const report = await invoke<PlanReport>("execute_plan", {
      req: { steps, user_request: userRequest, interpreted_intent: interpretedIntent },
    });
    setCurrentPlan(report);
    setPlanRunning(false);

    const lastOutcome = report.outcomes[report.outcomes.length - 1];
    if (lastOutcome?.status === "NeedsConfirmation") {
      // Surface the confirmation dialog for the step that paused the plan.
      // Resuming after confirm re-submits only the remaining steps.
      const pausedIndex = report.outcomes.length - 1;
      const remaining = steps.slice(pausedIndex);
      stateMachineRef.current.transition("WAITING_CONFIRMATION");
      setPendingConfirmation({
        request: {
          tool_id: remaining[0].tool_id,
          params: remaining[0].params,
          user_request: userRequest,
          interpreted_intent: interpretedIntent,
        },
        explanation: lastOutcome.explanation,
      });
    }
    setMessages((prev) => [...prev, { role: "assistant", content: report.summary }]);
    speak(report.summary);
  }, []);

  const handleCancelPlan = useCallback(async () => {
    if (!currentPlan) return;
    await invoke("cancel_plan", { req: { plan_id: currentPlan.plan_id } });
  }, [currentPlan]);

  const handleConfirm = useCallback(async () => {
    if (!pendingConfirmation) return;
    stateMachineRef.current.transition("EXECUTING");
    const response = await invoke<ActionResponse>("confirm_action", { req: pendingConfirmation.request });
    setPendingConfirmation(null);
    if (response.status === "Error") stateMachineRef.current.transition("ERROR");
    const text = response.status === "Executed" ? response.message
      : response.status === "Error" ? `That failed: ${response.message}`
      : "Cancelled.";
    setMessages((prev) => [...prev, { role: "assistant", content: text }]);
    speak(text);
  }, [pendingConfirmation]);

  const handleCancel = useCallback(async () => {
    if (!pendingConfirmation) return;
    await invoke("cancel_action", { req: pendingConfirmation.request });
    setPendingConfirmation(null);
    stateMachineRef.current.transition("IDLE");
    setMessages((prev) => [...prev, { role: "assistant", content: "Cancelled." }]);
    speak("Cancelled.");
  }, [pendingConfirmation]);

  // ---------------------------------------------------------------------
  // Phase 2, item 7: THE unified deterministic command pipeline. Every
  // entry point — typed text, the StatusBar text box, remote SendText
  // commands, and voice transcripts (after voice's own confirmation/stop-
  // word checks, which must run first and stay in handlePushToTalkUp since
  // they depend on real pending-confirmation/listening state text input
  // doesn't have) — funnels through this SAME function before anything
  // reaches the AI. It does not execute filesystem/app/browser tools
  // itself; navigation and mode switches are just React state, and
  // anything that touches the OS still goes through the existing Rust
  // PolicyEngine via runPlan/request_action exactly as before (item 8).
  // Returns true if `text` was fully handled (caller should stop and not
  // fall through to the AI), false otherwise.
  // ---------------------------------------------------------------------
  const dispatchSystemCommand = useCallback((text: string): boolean => {
    if (isVisionStatusQuery(text)) {
      // Phase B.4: deterministic, truthful — never routed to the AI,
      // which was observed answering "I cannot see you, as I do not have
      // access to a camera" regardless of actual camera/vision state.
      const reply = buildVisionStatusReply({
        cameraStatus,
        visionAvailable,
        handsDetected: hands.length,
        faceDetected: faceObservation?.detected ?? false,
      });
      activityLogRef.current.record({ requestText: text, interpretedIntent: "vision.status_query", providerName: null, toolName: "vision", status: "completed", errorMessage: null });
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
      persistMessage("assistant", reply);
      speak(reply);
      stateMachineRef.current.transition("IDLE");
      return true;
    }
    const routed = routeVoiceCommand(text);
    if (!routed.matched) return false;
    switch (routed.intent.type) {
      case "OPEN_SETTINGS": setView("settings"); break;
      case "OPEN_DASHBOARD": setView("dashboard"); break;
      case "OPEN_DESIGN_STUDIO": setView("design"); break;
      case "START_SCREEN_CAPTURE": setAppSettings((s) => ({ ...s, screen: { ...s.screen, screenCaptureEnabled: true } })); break;
      case "STOP_SCREEN_CAPTURE": setAppSettings((s) => ({ ...s, screen: { ...s.screen, screenCaptureEnabled: false } })); break;
      case "START_LISTENING": break;
      case "STOP_LISTENING": break;
      case "ACTIVATE_SERIOUS_MODE": {
        setSeriousMode(true);
        activityLogRef.current.record({ requestText: text, interpretedIntent: "serious_mode.activate", providerName: null, toolName: "mode", status: "completed", errorMessage: null });
        const reply = "Serious mode activated.";
        setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
        persistMessage("assistant", reply);
        speak(reply);
        break;
      }
      case "DEACTIVATE_SERIOUS_MODE": {
        setSeriousMode(false);
        activityLogRef.current.record({ requestText: text, interpretedIntent: "serious_mode.deactivate", providerName: null, toolName: "mode", status: "completed", errorMessage: null });
        const reply = "Serious mode deactivated.";
        setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
        persistMessage("assistant", reply);
        speak(reply);
        break;
      }
      case "GET_TIME":
      case "GET_DATE":
      case "GET_DAY": {
        // Phase 7: answered entirely from the real local system clock
        // (`routeVoiceCommand` computed `spokenText` from `new Date()`) —
        // never routed to the AI, which has no reliable notion of "now".
        const reply = routed.intent.spokenText;
        activityLogRef.current.record({ requestText: text, interpretedIntent: `system.${routed.intent.type.toLowerCase()}`, providerName: null, toolName: "clock", status: "completed", errorMessage: null });
        setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
        persistMessage("assistant", reply);
        speak(reply);
        break;
      }
    }
    stateMachineRef.current.transition("IDLE");
    return true;
  }, [persistMessage, cameraStatus, visionAvailable, hands, faceObservation]);

  // ---------------------------------------------------------------------
  // Phase 2, items 3/4: "remember this"/"forget this" — the ONLY code path
  // that creates or deletes a memory from the live conversation. Always
  // goes through MemoryOrchestrator (which always runs MemoryGuard first);
  // there is no second, more direct way to write a memory from chat.
  // Deterministic parsing (MemoryCommands.ts) means this only ever fires
  // for an exact recognized phrase — never an AI guess at "the user
  // probably wants this remembered."
  // ---------------------------------------------------------------------
  const handleMemoryCommand = useCallback(async (cmd: Extract<ReturnType<typeof parseMemoryCommand>, { matched: true }>, originalText: string) => {
    stateMachineRef.current.transition("THINKING");
    try {
      const outcome = await executeMemoryCommand(cmd, memoryRef.current);
      if (outcome.added) setMemories((prev) => [...prev, outcome.added as MemoryEntry]);
      if (outcome.removedIds) {
        const removed = new Set(outcome.removedIds);
        setMemories((prev) => prev.filter((m) => !removed.has(m.id)));
      }
      activityLogRef.current.record({
        requestText: originalText,
        interpretedIntent: cmd.action === "remember" ? "memory.remember" : "memory.forget",
        providerName: null,
        toolName: "memory",
        status: outcome.rejected ? "error" : "completed",
        errorMessage: outcome.rejected ? outcome.reply : null,
      });
      setMessages((prev) => [...prev, { role: "assistant", content: outcome.reply }]);
      persistMessage("assistant", outcome.reply);
      speak(outcome.reply);
    } finally {
      stateMachineRef.current.transition("IDLE");
    }
  }, [persistMessage]);

  const handleSend = useCallback(async (overrideText?: string) => {
    const raw = (overrideText ?? input).trim();
    if (!raw) return;
    if (!overrideText) setInput("");
    userHasSentAnythingRef.current = true;

    const resolved = contextRef.current.resolvePronouns(raw);
    const userMsg: AIMessage = { role: "user", content: raw };
    contextRef.current.addMessage(userMsg);
    setMessages((prev) => [...prev, userMsg]);
    persistMessage("user", raw);
    stateMachineRef.current.transition("THINKING");

    // Unified deterministic pipeline (item 7): system/navigation commands,
    // then explicit memory commands, both checked before anything else —
    // including before widget detection, so e.g. "open settings" never
    // gets misread as a would-be widget/AI request.
    if (dispatchSystemCommand(resolved)) return;
    const memCmd = parseMemoryCommand(resolved);
    if (memCmd.matched) {
      void handleMemoryCommand(memCmd, raw);
      return;
    }

    let routedProviderName: string | null = null;

    const chatController = new AbortController();
    activeChatAbortRef.current = chatController;
    abortReasonRef.current = null;
    const timeoutMs = Math.max(5, appSettings.ai.requestTimeoutSeconds ?? 60) * 1000;
    const timeoutHandle = window.setTimeout(() => {
      abortReasonRef.current = "timeout";
      chatController.abort();
    }, timeoutMs);

    try {
      // Widget commands are deterministic and provider-independent. They open
      // only inside the command center; no separate dashboard/window is made.
      const widget = detectCommandWidget(resolved);
      if (widget) {
        setCommandWidget(widget);
        stateMachineRef.current.transition("IDLE");
        return;
      }
      // Fast local/tool paths run before AI-provider routing. They should work
      // even on a fresh install before an API key is configured.
      // Real media shortcut. Opening a YouTube search page is a truthful
      // browser action; the app does NOT claim it clicked a result or
      // autoplayed a video, because that requires a real browser driver.
      if (isMediaRequest(resolved)) {
        const mediaQuery = extractMediaQuery(resolved);
        if (mediaQuery) {
          const directYouTube = mediaQuery.match(/https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=[^&\s]+|youtu\.be\/[A-Za-z0-9_-]+)/i)?.[0];
          const url = directYouTube ?? `https://www.youtube.com/results?search_query=${encodeURIComponent(mediaQuery)}`;
          const result = await runToolRequest({
            tool_id: "open_url",
            params: { url },
            user_request: raw,
            interpreted_intent: directYouTube ? "media.open" : "media.search",
          });
          const assistantMsg: AIMessage = {
            role: "assistant",
            content: directYouTube
              ? `I opened the YouTube video link. ${result}`
              : `I opened YouTube search for “${mediaQuery}”. ${result}`,
          };
          contextRef.current.addMessage(assistantMsg);
          setMessages((prev) => [...prev, assistantMsg]);
          persistMessage("assistant", assistantMsg.content);
          void speak(extractSpeechText(assistantMsg.content).speechText);
          return;
        }
      }

      // Real web-research path. Discovery and source text come from the Tauri
      // research provider; the AI only synthesizes what it receives. A markdown
      // report is then written through the existing sandboxed filesystem tool.
      if (isResearchRequest(resolved)) {
        const topic = extractResearchTopic(resolved);
        try {
          const search = await webSearchRef.current.search(topic);
          let researchProvider: AIProvider | undefined;
          try {
            ensureProvider();
            const researchRoute = aiProviderRegistry.route({
              task: "chat",
              forceProvider: appSettings.ai.fallbackBehavior === "strict" ? appSettings.ai.defaultProvider ?? undefined : undefined,
              preferProvider: appSettings.ai.fallbackBehavior === "fallback" ? appSettings.ai.defaultProvider ?? undefined : undefined,
            });
            researchProvider = researchRoute.success ? aiProviderRegistry.getProviderInstance(researchRoute.providerName) : undefined;
          } catch {
            researchProvider = undefined;
          }
          const sourceContext = search.results.length
            ? search.results.map((src, i) => `Source ${i + 1}: ${src.title}\nURL: ${src.url}\nExtract: ${src.snippet}`).join("\n\n")
            : "The live search backend returned no source results.";
          const researchPrompt = `You are preparing a factual research brief. Use ONLY the supplied web-source material below.\nTopic: ${JSON.stringify(topic)}\nKeep clear source attribution, distinguish facts from uncertainty, and do not claim to have read anything not included.\n\n${sourceContext}`;
          let brief = sourceContext;
          if (researchProvider) {
            brief = await researchProvider.chat([
              { role: "system", content: "Produce a concise factual research brief with a Sources section. Use only the supplied source material. Never invent missing facts or citations." },
              { role: "user", content: researchPrompt },
            ], chatController.signal);
          }
          const fileName = `JARVIS_Research_${slugifyFileName(topic)}_${new Date().toISOString().slice(0,19).replace(/[:T]/g, "-")}.md`;
          const reportBody = `# JARVIS Research Brief\n\n**Topic:** ${topic}\n**Searched:** ${search.searchedAt}\n\n${brief}\n\n## Sources\n${search.results.map((src) => `- [${src.title}](${src.url})`).join("\n") || "No source links were returned by the search backend."}\n`;
          const saved = await runToolRequest({ tool_id: "create_text_file", params: { path: fileName, content: reportBody }, user_request: raw, interpreted_intent: "research.create_document" });
          const assistantMsg: AIMessage = { role: "assistant", content: `Research completed using live web sources and saved the report as ${fileName}. ${saved}` };
          contextRef.current.addMessage(assistantMsg);
          setMessages((prev) => [...prev, assistantMsg]);
          persistMessage("assistant", assistantMsg.content);
          void speak(extractSpeechText(assistantMsg.content).speechText);
          return;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const assistantMsg: AIMessage = { role: "assistant", content: `I couldn't complete the live research request: ${message}` };
          contextRef.current.addMessage(assistantMsg);
          setMessages((prev) => [...prev, assistantMsg]);
          persistMessage("assistant", assistantMsg.content);
          void speak(extractSpeechText(assistantMsg.content).speechText);
          return;
        }
      }


      // AI chat path. Only ordinary language requests reach provider routing;
      // media opening and live research above have their own real backends.
      // -----------------------------------------------------------------
      ensureProvider();
      const routed = aiProviderRegistry.route({
        task: "chat",
        forceProvider: appSettings.ai.fallbackBehavior === "strict" ? appSettings.ai.defaultProvider ?? undefined : undefined,
        preferProvider: appSettings.ai.fallbackBehavior === "fallback" ? appSettings.ai.defaultProvider ?? undefined : undefined,
      });
      const provider = routed.success ? aiProviderRegistry.getProviderInstance(routed.providerName) : undefined;
      routedProviderName = routed.success ? routed.providerName : null;

      if (!routed.success || !provider) {
        setAiAvailable(false);
        flashError();
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "AI is unavailable right now. Check your API key or connection in Settings." },
        ]);
        return;
      }

      const baseWithMode = seriousMode
        ? `${BASE_SYSTEM_PROMPT}\nSERIOUS MODE ACTIVE: be concise, operational and professional. You may use the existing PC tools/actions when appropriate, but NEVER bypass security policies or user confirmations for dangerous/destructive actions.`
        : BASE_SYSTEM_PROMPT;
      // Phase 2, item 5: inject only APPROVED long-term memories (never
      // anything ai_inferred-and-unapproved — retrieveApprovedMemories
      // already enforces that filter) into the system prompt. Capped at
      // 20 entries / ~2000 chars so a large memory store can't silently
      // crowd out actual conversation history in the context window.
      // Reads the already-loaded `memories` React state (refreshed at
      // startup and kept current by remember/forget above) rather than
      // re-invoking Tauri on every single message.
      const memoryBlock = buildMemoryContextBlock(memories);
      // Phase B.5: only genuinely available perception data is ever
      // injected — never a fabricated "I can see you". `null` (camera
      // never touched) adds nothing, so an ordinary text-only session's
      // prompt isn't cluttered with "camera is off" on every message.
      const visionContext = buildVisionContextForPrompt({
        cameraStatus,
        visionAvailable,
        handsDetected: hands.length,
        faceDetected: faceObservation?.detected ?? false,
      });
      const systemPrompt = `${baseWithMode}${memoryBlock}${visionContext ? `\n\n${visionContext}` : ""}`;
      const recentHistory = contextRef.current.getHistory().slice(-18).map((message) => ({
        ...message,
        content: message.content.length > 5000 ? `${message.content.slice(0, 5000)}…` : message.content,
      }));
      const history = [{ role: "system", content: systemPrompt } as AIMessage, ...recentHistory];

      // Heuristic multi-step trigger: sequencing language ("and then", "then",\n      // multiple commas) suggests a plan rather than a single reply. This is
      // a simple heuristic, not full intent classification — it's meant to
      // catch the "create a folder, open it, and create a file" style request
      // from the spec, not to route every message.
      const looksMultiStep = /\b(and then|then)\b/i.test(resolved) || (resolved.match(/,/g)?.length ?? 0) >= 2;

      if (looksMultiStep) {
        const plan = await provider.generatePlan(resolved, history, chatController.signal);
        // Real outcome tracking on the ACTUAL routed provider — previously
        // recordOutcome was only ever called from Settings' "Test
        // connection" button, so a provider silently failing during real
        // chat use never affected route()'s future candidate selection.
        aiProviderRegistry.recordOutcome(routed.providerName, { success: true });
        setAiAvailable(true);
        if (plan.length >= 2 && plan.every((s) => s.toolId)) {
          const steps: PlanStep[] = plan.map((s) => ({
            tool_id: s.toolId!,
            params: s.params ?? {},
            description: s.description,
          }));
          const previewMsg: AIMessage = {
            role: "assistant",
            content: `Plan:\n${plan.map((s, i) => `${i + 1}. ${s.description}`).join("\n")}`,
          };
          contextRef.current.addMessage(previewMsg);
          setMessages((prev) => [...prev, previewMsg]);
          await runPlan(steps, raw, "multi-step plan");
          return;
        }
        // Fall through to a normal chat reply if the plan wasn't
        // tool-shaped (e.g. it was just a multi-part question, not actions).
      }

      aiProviderRegistry.recordOutcome(routed.providerName, { success: true });
      setAiAvailable(true);
      const providerMessages = [...history, { role: "user", content: resolved } as AIMessage];
      if (appSettings.ai.streamingEnabled && typeof provider.streamChat === "function") {
        let streamed = "";
        const assistantSeed: AIMessage = { role: "assistant", content: "" };
        contextRef.current.addMessage(assistantSeed);
        setMessages((prev) => [...prev, assistantSeed]);
        await provider.streamChat(providerMessages, (token) => {
          streamed += token;
          streamUiPendingRef.current = streamed;
          if (streamUiRafRef.current !== null) return;
          streamUiRafRef.current = requestAnimationFrame(() => {
            streamUiRafRef.current = null;
            const pending = streamUiPendingRef.current;
            if (pending === null) return;
            setMessages((prev) => {
              const next = [...prev];
              const idx = next.length - 1;
              if (idx >= 0 && next[idx].role === "assistant") next[idx] = { ...next[idx], content: pending };
              return next;
            });
          });
        }, chatController.signal);
        if (streamUiRafRef.current !== null) {
          cancelAnimationFrame(streamUiRafRef.current);
          streamUiRafRef.current = null;
        }
        const finalReply = streamed.trim();
        streamUiPendingRef.current = null;
        setMessages((prev) => {
          const next = [...prev];
          const idx = next.length - 1;
          if (idx >= 0 && next[idx].role === "assistant") next[idx] = { ...next[idx], content: streamed };
          return next;
        });
        if (finalReply) {
          contextRef.current.addMessage({ role: "assistant", content: finalReply });
          persistMessage("assistant", finalReply);
          // Phase 3: the screen already has the full `finalReply` above,
          // unmodified — only what's SPOKEN is passed through the
          // deterministic content filter (strips code/JSON/stack
          // traces/huge URLs/tables, never truncates mid-token).
          void speak(extractSpeechText(finalReply).speechText);
        } else {
          // Nothing to speak means nothing will drive the TTS
          // onStatusChange listener back to IDLE — without this, an
          // empty/blank provider reply left the state machine stuck in
          // THINKING indefinitely (Phase 7 fix).
          stateMachineRef.current.transition("IDLE");
        }
      } else {
        const reply = await provider.chat(providerMessages, chatController.signal);
        const assistantMsg: AIMessage = { role: "assistant", content: reply };
        contextRef.current.addMessage(assistantMsg);
        setMessages((prev) => [...prev, assistantMsg]);
        if (reply) {
          persistMessage("assistant", reply);
          void speak(extractSpeechText(reply).speechText);
        } else {
          stateMachineRef.current.transition("IDLE");
        }
      }
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      if (isAbort && abortReasonRef.current === "user") {
        // A user-initiated "stop"/"cancel" is not a provider failure —
        // don't feed it into recordOutcome's routing-health tracking.
        setMessages((prev) => [...prev, { role: "assistant", content: "Cancelled." }]);
        stateMachineRef.current.transition("IDLE");
      } else if (isAbort && abortReasonRef.current === "timeout") {
        if (routedProviderName) {
          aiProviderRegistry.recordOutcome(routedProviderName, { success: false, error: "request timed out" });
        }
        setAiAvailable(false);
        flashError();
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "The request timed out. Please try again." },
        ]);
      } else {
        // Feeds the SAME failure-tracking route() itself reads from
        // (isUsable() excludes "unavailable"/"invalid_key"/etc.) — a
        // provider that keeps failing during real use now actually gets
        // deprioritized by future route() calls, not just after a manual
        // Settings test.
        if (routedProviderName) {
          aiProviderRegistry.recordOutcome(routedProviderName, { success: false, error: err instanceof Error ? err.message : String(err) });
        }
        setAiAvailable(false);
        flashError();
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "AI is unavailable right now. Check your API key or connection in Settings." },
        ]);
      }
    } finally {
      window.clearTimeout(timeoutHandle);
      if (activeChatAbortRef.current === chatController) activeChatAbortRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, seriousMode, ensureProvider, runPlan, flashError, appSettings.ai.fallbackBehavior, appSettings.ai.defaultProvider, appSettings.ai.requestTimeoutSeconds]);

  // ---------------------------------------------------------------------
  // Phase 3 — speech output with interruption support (spec sections 5, 28)
  // ---------------------------------------------------------------------
  const speak = useCallback(async (text: string) => {
    didSpeakResponseRef.current = true;
    ttsAbortRef.current?.abort();
    const controller = new AbortController();
    ttsAbortRef.current = controller;
    try {
      await voiceRef.current.tts.speak(text, controller.signal);
    } catch (error) {
      // Local Kokoro is the free/default path. If its model download or
      // inference is unavailable, preserve the command flow and transparently
      // fall back to the real Windows/Web Speech voice for this utterance.
      // The user's selected Kokoro setting is restored immediately afterward
      // so a transient failure does not silently change their configuration.
      if (appSettingsRef.current.voice.ttsProvider === "kokoro") {
        const tts = voiceRef.current.tts as typeof voiceRef.current.tts & {
          setTTSProvider?: (provider: "web_speech" | "elevenlabs" | "kokoro") => void;
        };
        try {
          tts.setTTSProvider?.("web_speech");
          await voiceRef.current.tts.speak(text, controller.signal);
          tts.setTTSProvider?.("kokoro");
          return;
        } catch {
          tts.setTTSProvider?.("kokoro");
        }
      }
      void error;
      // TTS failure should never take down the command flow.
    }
  }, []);

  /** Reuses the existing Phase 2 cancellation architecture — no second
   * independent cancellation system, per spec section 5. */
  const interruptSpeech = useCallback(() => {
    ttsAbortRef.current?.abort();
    voiceRef.current.tts.stop();
  }, []);

  const cancelCurrentTask = useCallback(async () => {
    if (currentPlan && planRunning) {
      await invoke("cancel_plan", { req: { plan_id: currentPlan.plan_id } });
    }
    if (pendingConfirmation) await handleCancel();
    if (pendingConflict) handleConflictCancel();
    // Phase 7: "stop"/"cancel" must also abort a genuinely in-flight AI
    // provider call, not just a plan/confirmation — previously this was a
    // no-op for a plain chat request, which could hang indefinitely with
    // no way for the user to interrupt it.
    if (activeChatAbortRef.current) {
      abortReasonRef.current = "user";
      activeChatAbortRef.current.abort();
    }
  }, [currentPlan, planRunning, pendingConfirmation, pendingConflict, handleCancel, handleConflictCancel]);

  /** Records a real behavior signal from actual command timing/text —
   * genuinely computed from usage, not a placeholder. */
  const recordCommandForBehaviorSignal = useCallback((text: string) => {
    const now = Date.now();
    commandTimestampsRef.current.push(now);
    commandTimestampsRef.current = commandTimestampsRef.current.filter((t) => now - t < 60_000);
    if (/^(no|actually|i meant|not that)\b/i.test(text.trim())) {
      correctionCountRef.current += 1;
    }
  }, []);

  const lastVoiceSignalRef = useRef<Parameters<StateFusionEngine["estimate"]>[0]>(null);
  const lastFaceSignalRef = useRef<Parameters<StateFusionEngine["estimate"]>[1]>(null);

  /** Recomputes the fused estimate from whatever signals are currently
   * known (both voice and face persist across calls via refs, so a face
   * frame updating moments after a voice command doesn't discard the
   * voice signal, and vice versa). No staleness expiry yet — a documented
   * simplification, see SETUP.md. */
  const recomputeState = useCallback(() => {
    if (!settings.emotionDetectionEnabled) return;
    const now = Date.now();
    const recentCommands = commandTimestampsRef.current.filter((t) => now - t < 30_000);
    const behavior = settings.behaviorBasedStateEnabled ? {
      repeatedCorrections: correctionCountRef.current,
      rapidCommandCount: recentCommands.length,
      hesitationCount: 0, // requires per-command latency tracking not yet wired to a UI affordance
    } : null;
    const estimate = stateFusionRef.current.estimate(lastVoiceSignalRef.current, lastFaceSignalRef.current, behavior, null);
    setStateEstimate(estimate);
    perceptionRef.current.updateState(estimate);
  }, [settings.emotionDetectionEnabled, settings.behaviorBasedStateEnabled]);

  const refreshVoiceSignal = useCallback((voiceSignal: NonNullable<Parameters<StateFusionEngine["estimate"]>[0]>) => {
    lastVoiceSignalRef.current = settings.voiceBasedStateEnabled ? voiceSignal : null;
    recomputeState();
  }, [settings.voiceBasedStateEnabled, recomputeState]);

  /** Wired to VisionPipeline.onSnapshot — real face geometry in, no
   * placeholder. Only actually contributes when cameraBasedStateEnabled
   * (checked here AND already gating whether MediaPipeFaceProvider runs
   * at all via enableFace on the pipeline, so a disabled face state
   * setting means no face inference even happens, not just that its
   * result gets discarded). */
  const refreshFaceSignal = useCallback((face: FaceObservation) => {
    if (!settings.cameraBasedStateEnabled) return;
    lastFaceSignalRef.current = { present: face.detected, expressionFeatures: face.expressionFeatures, confidence: face.confidence };
    recomputeState();
  }, [settings.cameraBasedStateEnabled, recomputeState]);

  // ---------------------------------------------------------------------
  // Phase 3 — push-to-talk / tap-to-toggle voice loop
  // ---------------------------------------------------------------------
  const handlePushToTalkDown = useCallback(async () => {
    // Re-entrancy guard, checked against the PROVIDER's own synchronous
    // status (not the micStatus React state, which lags a render behind
    // during a fast double-tap/double-fired-event) — without this, two
    // overlapping calls would create a second SpeechRecognition instance
    // and silently orphan the first one's stream.
    if (voiceRef.current.stt.getStatus() === "listening" || voiceRef.current.stt.getStatus() === "starting") return;
    if (!appSettingsRef.current.privacy.microphoneAllowed) {
      flashError();
      activityLogRef.current.record({ requestText: "Microphone blocked by Privacy settings", interpretedIntent: "voice.listen.denied", providerName: null, toolName: "voice.stt", status: "error", errorMessage: "Microphone permission is disabled in Settings." });
      return;
    }
    if (speaking) interruptSpeech(); // user starting to talk while JARVIS speaks = interruption
    stateMachineRef.current.transition("LISTENING");
    listeningStartRef.current = Date.now();
    try {
      activityLogRef.current.record({ requestText: "Microphone start", interpretedIntent: "voice.listen.start", providerName: null, toolName: "voice.stt", status: "understanding", errorMessage: null });

      // WebView2 can expose SpeechRecognition while still withholding the
      // microphone permission until getUserMedia() explicitly requests it.
      // Request ONE real stream first, keep it for the analyser, then start
      // SpeechRecognition. This removes the permission race while avoiding
      // the old start→second-getUserMedia timing problem.
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone access is unavailable in this WebView.");
      if (micStreamRef.current) micStreamRef.current.getTracks().forEach((t) => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      micStreamRef.current = stream;

      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      if (ctx.state === "suspended") await ctx.resume();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      setMicAnalyser(analyser);

      try {
        await voiceRef.current.stt.startListening();
      } catch (err) {
        stream.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;
        await ctx.close().catch(() => {});
        audioCtxRef.current = null;
        setMicAnalyser(null);
        throw err;
      }
    } catch (err) {
      activityLogRef.current.record({ requestText: "Microphone start failed", interpretedIntent: "voice.listen.error", providerName: null, toolName: "voice.stt", status: "error", errorMessage: err instanceof Error ? err.message : String(err) });
      stateMachineRef.current.transition("ERROR");
      window.setTimeout(() => stateMachineRef.current.transition("IDLE"), 1200);
      // The provider still owns the canonical STT status; this catch only
      // cleans up the real analyser stream and surfaces a transient error.
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
      setMicAnalyser(null);
    }
  }, [speaking, interruptSpeech, flashError]);

  const autoListenStartedRef = useRef(false);
  const autoListenRetryRef = useRef<number | null>(null);
  // Phase 1 root-cause fix: this used to retry unconditionally on ANY of
  // permission_denied/unavailable/error, every 1.8s, forever. A REAL
  // permission denial doesn't change on its own — the browser/OS will
  // keep saying no until the user changes it manually — so retrying is
  // not just pointless, it's exactly the infinite
  // LISTENING→denied→ERROR→IDLE→LISTENING loop reported. Fixed:
  // permission_denied is NEVER auto-retried (only the explicit mic button
  // can retry it, since only a real user action can mean anything
  // changed); unavailable/error get a small BOUNDED number of retries
  // with backoff, then stop and require the same explicit manual action.
  const autoListenAttemptCountRef = useRef(0);

  useEffect(() => {
    if (micStatus === "listening") autoListenAttemptCountRef.current = 0;
    // Phase 1: SpeechRecognition can fail asynchronously (its own
    // "not-allowed" from `onerror`, well after `startListening()` already
    // resolved) even when the earlier getUserMedia() call for the
    // analyser succeeded — a real, documented Chromium/WebView2 quirk
    // where the speech-recognition service check is separate from raw
    // microphone permission. That case never passed through
    // handlePushToTalkDown's own synchronous catch block, so the mic
    // stream/AudioContext opened for the visualizer were never released —
    // a genuine resource leak. Cleaned up here too, keyed directly off the
    // provider's own reported status, regardless of which code path
    // caused it.
    if (micStatus === "permission_denied" || micStatus === "unavailable" || micStatus === "error") {
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
      setMicAnalyser(null);
    }
  }, [micStatus]);
  useEffect(() => {
    handlePushToTalkDownRef.current = handlePushToTalkDown;
    if (!appSettings.voice.continuousListeningEnabled) {
      autoListenStartedRef.current = false;
      resumeListeningWhenIdleRef.current = false;
      return;
    }
    if (autoListenStartedRef.current) return;
    autoListenStartedRef.current = true;
    const timer = window.setTimeout(() => { void handlePushToTalkDown(); }, 700);
    return () => window.clearTimeout(timer);
  }, [appSettings.voice.continuousListeningEnabled, handlePushToTalkDown]);

  useEffect(() => {
    if (!appSettings.voice.continuousListeningEnabled) {
      autoListenAttemptCountRef.current = 0;
      return;
    }
    // A real permission denial cannot self-recover — retrying only
    // reproduces the exact visible loop this fix exists to stop. The mic
    // button (an explicit user action) is the only thing that should ever
    // attempt again after this state.
    if (micStatus === "permission_denied") {
      autoListenAttemptCountRef.current = 0;
      return;
    }
    if (micStatus !== "unavailable" && micStatus !== "error") return;
    if (autoListenRetryRef.current) return;
    const MAX_AUTO_RETRIES = 2;
    if (autoListenAttemptCountRef.current >= MAX_AUTO_RETRIES) return;
    autoListenAttemptCountRef.current += 1;
    const backoffMs = 1800 * autoListenAttemptCountRef.current;
    autoListenRetryRef.current = window.setTimeout(() => {
      autoListenRetryRef.current = null;
      autoListenStartedRef.current = false;
      void handlePushToTalkDown();
    }, backoffMs);
    return () => {
      if (autoListenRetryRef.current) {
        clearTimeout(autoListenRetryRef.current);
        autoListenRetryRef.current = null;
      }
    };
  }, [appSettings.voice.continuousListeningEnabled, micStatus, handlePushToTalkDown]);

  const handlePushToTalkUp = useCallback(async () => {
    if (autoCommandTimerRef.current) {
      clearTimeout(autoCommandTimerRef.current);
      autoCommandTimerRef.current = null;
    }
    const transcript = await voiceRef.current.stt.stopListening();
    activityLogRef.current.record({ requestText: transcript || "Microphone stopped without transcript", interpretedIntent: "voice.listen.stop", providerName: null, toolName: "voice.stt", status: transcript ? "completed" : "error", errorMessage: transcript ? null : "No speech transcript captured" });
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    setMicAnalyser(null);
    if (!transcript) {
      stateMachineRef.current.transition("IDLE");
      return;
    }
    userHasSentAnythingRef.current = true;
    stateMachineRef.current.transition("THINKING");

    perceptionRef.current.updateVoice(transcript, 0.9);

    // Real speech-rate computation from actual hold duration + word count.
    const durationMinutes = Math.max((Date.now() - listeningStartRef.current) / 60000, 1 / 60);
    const wordCount = transcript.split(/\s+/).filter(Boolean).length;
    refreshVoiceSignal({
      speechRatePerMinute: wordCount / durationMinutes,
      pauseCount: 0,
      interruptionCount: interruptionCountRef.current,
      sentimentHint: null,
    });

    const commandText = stripWakePrefix(transcript);
    // Prime auto-resume before any deterministic early-return path.
    didSpeakResponseRef.current = false;
    resumeListeningWhenIdleRef.current = appSettingsRef.current.voice.continuousListeningEnabled;

    // Voice confirmation ONLY matches against a real pending state that
    // already exists — see VoiceConfirmation.ts doc comment. The AI is
    // never consulted here at all.
    if (pendingConfirmation) {
      const match = matchVoiceConfirmation(commandText);
      if (match === "confirm") return handleConfirm();
      if (match === "cancel") return handleCancel();
    }
    if (pendingConflict) {
      const match = matchVoiceConfirmation(commandText);
      if (match === "cancel") return handleConflictCancel();
      // "confirm"/"yes" is deliberately ambiguous for a 3-way conflict
      // (Replace vs Copy) — we don't guess which one the user meant.
    }
    if (/^(stop|cancel|abort)\.?$/i.test(commandText)) {
      return cancelCurrentTask();
    }

    // Deterministic voice commands are handled before the LLM so navigation
    // and mode switches do not depend on provider availability. Uses the
    // SAME dispatcher `handleSend` uses for typed/remote/StatusBar text
    // (item 7) — this used to be a second, separately-maintained copy of
    // this switch statement; now there is exactly one.
    if (dispatchSystemCommand(commandText)) return;

    recordCommandForBehaviorSignal(commandText);
    await handleSend(commandText);
    // If the reply path did not speak (for a deterministic navigation/action),
    // resume immediately rather than waiting forever for a TTS idle event.
    if (resumeListeningWhenIdleRef.current && !didSpeakResponseRef.current) {
      window.setTimeout(() => {
        if (!resumeListeningWhenIdleRef.current) return;
        resumeListeningWhenIdleRef.current = false;
        void handlePushToTalkDownRef.current?.();
      }, 160);
    }
  }, [pendingConfirmation, pendingConflict, handleConfirm, handleCancel, handleConflictCancel, cancelCurrentTask, refreshVoiceSignal, recordCommandForBehaviorSignal, handleSend, dispatchSystemCommand, speaking]);

  // Fully hands-free loop: the first launch can start the real recognizer and
  // submit a spoken command after a short final-transcript silence. No button
  // press is required once continuous listening is enabled. This does not
  // create a second recognizer; it uses the same final-transcript hook that the
  // wake-word fallback consumes.
  useEffect(() => {
    handlePushToTalkUpRef.current = handlePushToTalkUp;
    if (!appSettings.voice.continuousListeningEnabled) {
      if (autoCommandTimerRef.current) {
        clearTimeout(autoCommandTimerRef.current);
        autoCommandTimerRef.current = null;
      }
      return;
    }
    const unsubscribe = voiceRef.current.stt.onFinalTranscript?.((transcript) => {
      if (voiceRef.current.stt.getStatus() !== "listening") return;
      const normalized = transcript.trim();
      if (!normalized) return;

      // Wake-word mode is a real hands-free gate: the recognizer can stay
      // live on launch, but an automatic command is not submitted until a
      // real "hey/hello/hi jarvis" phrase has armed the session. Explicit
      // mic taps still go directly through handlePushToTalkUp.
      // When the native/recognizer-backed wake provider is unavailable,
      // continuous listening becomes the documented backup path instead of
      // leaving the microphone live while silently dropping commands.
      const wakeRequired = appSettingsRef.current.voice.wakeWordEnabled && !wakeWordUnavailable;
      const wakeArmed = wakeArmedUntilRef.current > Date.now();
      const commandText = stripWakePrefix(normalized);
      const isOnlyWake = !commandText && /^(?:hey|hello|hi)(?:\s+jarvis)?$/i.test(normalized);
      if (wakeRequired && !wakeArmed) return;
      if (isOnlyWake) return;

      if (autoCommandTimerRef.current) clearTimeout(autoCommandTimerRef.current);
      // Keep the handoff tight: enough time for Web Speech's final event
      // to settle, but short enough that the assistant starts thinking almost
      // immediately after the user stops speaking.
      autoCommandTimerRef.current = window.setTimeout(() => {
        autoCommandTimerRef.current = null;
        if (voiceRef.current.stt.getStatus() === "listening" && stripWakePrefix(normalized)) {
          wakeArmedUntilRef.current = 0;
          void handlePushToTalkUpRef.current?.();
        }
      }, 180);
    });
    if (!unsubscribe) return;

    return () => {
      unsubscribe();
      if (autoCommandTimerRef.current) {
        clearTimeout(autoCommandTimerRef.current);
        autoCommandTimerRef.current = null;
      }
      wakeArmedUntilRef.current = 0;
    };  }, [appSettings.voice.continuousListeningEnabled, wakeWordUnavailable, handlePushToTalkUp]);

  // Tap-vs-hold orchestration on top of handlePushToTalkDown/Up. Spec:
  // "support reliable tap-to-start/tap-to-stop AND press/hold if
  // practical." A quick tap (below HOLD_THRESHOLD_MS) starts listening
  // and LEAVES IT ON until the button is tapped again — holding the
  // button down while speaking is awkward, and a bare tap-release under
  // the old press-and-hold-only model always stopped listening within
  // the same instant it started, which is part of why real speech was
  // rarely captured even before the race-condition fix in
  // WebSpeechProvider.ts. A genuine hold (the button held past the
  // threshold) still behaves as classic press-and-hold: release = stop.
  //
  // Pointer Events (not separate mouse+touch handlers) deliberately: on
  // touch-capable Windows hardware, a single tap fires BOTH a touch event
  // AND a browser-synthesized mouse event for the same interaction —
  // wiring onMouseDown/onTouchStart separately (as this button used to)
  // double-invokes the handler for one tap. Pointer Events unify
  // mouse/touch/pen into one event stream in Chromium/WebView2 (this
  // app's fixed target), eliminating that duplication at the source
  // rather than trying to manually de-duplicate afterward.
  // Tap once to start continuous listening. Tap again to pause.
  // There is intentionally no press/hold mode: pointerup must never race
  // the asynchronous SpeechRecognition startup and immediately stop it.
  const handleMicPointerDown = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (voiceRef.current.stt.getStatus() === "listening" || voiceRef.current.stt.getStatus() === "starting") {
      void handlePushToTalkUp();
    } else {
      void handlePushToTalkDown();
    }
  }, [handlePushToTalkDown, handlePushToTalkUp]);

  const handleMicPointerUp = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
  }, []);

  const handleMicPointerCancel = useCallback(() => {
    // A cancelled pointer does not change the listening state. Only the
    // explicit second tap pauses it.
  }, []);

  const handleStartScreenShare = useCallback(async () => {
    if (!appSettingsRef.current.privacy.screenAllowed || !appSettingsRef.current.screen.screenCaptureEnabled) {
      flashError();
      activityLogRef.current.record({ requestText: "Screen capture blocked by Privacy/Screen settings", interpretedIntent: "screen.capture.denied", providerName: null, toolName: "screen.capture", status: "error", errorMessage: "Screen capture must be explicitly allowed and enabled." });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30, max: 60 } },
        audio: true,
      });
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        setScreenShareStream(null);
        setScreenRecording(false);
        screenRecorderRef.current = null;
      });
      setScreenShareStream(stream);
    } catch (err) {
      activityLogRef.current.record({ requestText: "Screen share start failed", interpretedIntent: "screen.share.start", providerName: null, toolName: "screen.share", status: "error", errorMessage: err instanceof Error ? err.message : String(err) });
    }
  }, [flashError]);

  const handleToggleScreenRecording = useCallback(() => {
    const stream = screenShareStream;
    if (!stream) return;
    if (screenRecorderRef.current?.state === "recording") {
      screenRecorderRef.current.stop();
      return;
    }
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus" : "video/webm";
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    screenChunksRef.current = [];
    recorder.ondataavailable = e => { if (e.data.size) screenChunksRef.current.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(screenChunksRef.current, { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `jarvis-screen-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      screenChunksRef.current = [];
      setScreenRecording(false);
      screenRecorderRef.current = null;
    };
    recorder.start(1000);
    screenRecorderRef.current = recorder;
    setScreenRecording(true);
  }, [screenShareStream]);

  const handleStopScreenShare = useCallback(() => {
    if (screenRecorderRef.current?.state === "recording") screenRecorderRef.current.stop();
    screenShareStream?.getTracks().forEach(t => t.stop());
    setScreenShareStream(null);
    setScreenRecording(false);
    screenRecorderRef.current = null;
  }, [screenShareStream]);

  handleSendRef.current = handleSend;
  handleStartScreenShareRef.current = handleStartScreenShare;
  handleStopScreenShareRef.current = handleStopScreenShare;

  // Desktop-side remote bridge: authenticated commands arriving from a future
  // companion app are routed into the SAME existing UI/voice/tool functions.
  // No parallel command system is created here.
  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void listen<RemoteCommand>("remote-command", ({ payload }) => {
      if (cancelled || remoteCommandInFlightRef.current) return;
      remoteCommandInFlightRef.current = true;
      const finish = () => { remoteCommandInFlightRef.current = false; };
      try {
        switch (payload.type) {
          case "send_text": {
            const task = handleSendRef.current?.(payload.text);
            if (task) void task.finally(finish); else finish();
            return;
          }
          case "open_view":
            setView(remoteViewToAppView(payload.view));
            finish();
            return;
          case "start_listening": {
            const task = handlePushToTalkDownRef.current?.();
            if (task) void task.finally(finish); else finish();
            return;
          }
          case "stop_listening": {
            const task = handlePushToTalkUpRef.current?.();
            if (task) void task.finally(finish); else finish();
            return;
          }
          case "start_screen_capture": {
            const task = handleStartScreenShareRef.current?.();
            if (task) void task.finally(finish); else finish();
            return;
          }
          case "stop_screen_capture":
            handleStopScreenShareRef.current?.();
            finish();
            return;
        }
      } catch {
        finish();
      }
    }).then((unlisten) => {
      if (cancelled) unlisten();
      else cleanup = unlisten;
    }).catch(() => { /* outside Tauri runtime this bridge simply stays unavailable */ });
    return () => { cancelled = true; cleanup?.(); };
  }, []);

  useEffect(() => {
    if (!remoteBridge?.enabled) return;
    const status = {
      state: jarvisState,
      mic_status: micStatus,
      camera_status: cameraStatus,
      online: isOnline,
      active_provider: aiProviderRegistry.allConfigs().find((c) => c.enabled && c.hasApiKey)?.displayName ?? null,
      updated_at: new Date().toISOString(),
    };
    void invoke("update_remote_status", { statusJson: JSON.stringify(status) }).catch(() => {});
  }, [remoteBridge?.enabled, jarvisState, micStatus, cameraStatus, isOnline, aiAvailable]);

  const handleStartRemoteControl = useCallback(async () => {
    const info = await invoke<RemoteBridgeInfo>("start_remote_control");
    setRemoteBridge(info);
    activityLogRef.current.record({ requestText: "Remote bridge started", interpretedIntent: "remote.bridge.start", providerName: null, toolName: "remote-control", status: "completed", errorMessage: null });
    return info;
  }, []);

  const handleStopRemoteControl = useCallback(async () => {
    await invoke("stop_remote_control");
    setRemoteBridge(null);
    activityLogRef.current.record({ requestText: "Remote bridge stopped", interpretedIntent: "remote.bridge.stop", providerName: null, toolName: "remote-control", status: "completed", errorMessage: null });
  }, []);

  /** Phase 7: lets the user invalidate whatever token they've already
   * shared/shown, without stopping the bridge (see `RemoteControl::
   * rotate_token` in remote.rs — it takes effect immediately for the
   * already-running listener). */
  const handleRotateRemoteToken = useCallback(async () => {
    const info = await invoke<RemoteBridgeInfo>("rotate_remote_control_token");
    setRemoteBridge(info);
    activityLogRef.current.record({ requestText: "Remote bridge token rotated", interpretedIntent: "remote.bridge.rotate", providerName: null, toolName: "remote-control", status: "completed", errorMessage: null });
    return info;
  }, []);

  // Phase 7: while the bridge is on, poll its real security state (token
  // expiry, recent failed-attempt count) so the Dashboard reflects what is
  // actually happening rather than only the snapshot taken at start time —
  // a lockout or an approaching expiry would otherwise be invisible until
  // the user happened to reopen the pairing panel.
  useEffect(() => {
    if (!remoteBridge?.enabled) return;
    const interval = window.setInterval(() => {
      invoke<RemoteBridgeInfo>("remote_control_info").then(setRemoteBridge).catch(() => {});
    }, 15_000);
    return () => window.clearInterval(interval);
  }, [remoteBridge?.enabled]);

  // ---------------------------------------------------------------------
  // Phase 3 — camera controls
  // ---------------------------------------------------------------------
  const handleStartCamera = useCallback(async () => {
    if (!appSettingsRef.current.privacy.cameraAllowed) {
      flashError();
      activityLogRef.current.record({ requestText: "Camera blocked by Privacy settings", interpretedIntent: "vision.camera.denied", providerName: null, toolName: "camera", status: "error", errorMessage: "Camera permission is disabled in Settings." });
      return;
    }
    try {
      await cameraRef.current.start();
      const stream = cameraRef.current.getPreviewStream();
      setCameraStream(stream);
      if (!stream) return;

      // Internal hidden video element used ONLY to feed MediaPipe frames —
      // separate from CameraPanel's own <video>, which is purely the
      // user-visible preview. Created once, reused across camera restarts.
      if (!hiddenVideoRef.current) {
        const v = document.createElement("video");
        v.style.display = "none";
        v.playsInline = true;
        document.body.appendChild(v);
        hiddenVideoRef.current = v;
      }
      const videoEl = hiddenVideoRef.current;

      await visionPipelineRef.current!.attachStream(stream, videoEl);
      visionPipelineRef.current!.start();
      // Fire-and-forget, deliberately not awaited: the camera preview and
      // frame loop must not block on a (potentially slow, first-run)
      // model download. VisionPipeline's own per-frame check already
      // means hand detection simply doesn't run yet if this hasn't
      // resolved — camera FPS still climbs, vision FPS truthfully stays 0
      // until real initialization actually completes.
      void ensureVisionInitialized();
    } catch {
      // status already reflects the failure via onStatusChange
    }
  }, [flashError, ensureVisionInitialized]);

  const handleStopCamera = useCallback(async () => {
    visionPipelineRef.current?.stop();
    await cameraRef.current.stop();
    setCameraStream(null);
    setHands([]);
    setFaceObservation(null);
    setPoseObservation(null);
    setVisionStats(null);
  }, []);

  useEffect(() => {
    return () => {
      // Cleanup on unmount: never leave the camera or mic running, never
      // leave MediaPipe models loaded, never leave the hidden video element
      // in the DOM.
      cameraRef.current.stop();
      visionPipelineRef.current?.dispose();
      hiddenVideoRef.current?.remove();
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close();
      screenRecorderRef.current?.stop();
      screenShareStream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // ---------------------------------------------------------------------
  // Phase 4 — Design Studio project persistence (spec sections 21, 25)
  // ---------------------------------------------------------------------
  const handleSaveDesignProject = useCallback(async (name: string, controller: DesignController) => {
    const projectId = crypto.randomUUID();
    const ser = serializeProject(controller.graph, projectId, name, new Date().toISOString());
    if (!ser.success || !ser.file) {
      console.warn("Failed to serialize design project:", ser.errors);
      return;
    }
    try {
      await invoke("save_design_project", { req: { project_id: projectId, name, design_json: JSON.stringify(ser.file) } });
      // Store a lightweight preference, not the design itself, in JARVIS's
      // existing memory system — the design bytes live in the `projects`
      // table (Rust side), not duplicated into `memories` (spec section 25:
      // "do not store every frame or every mouse movement," and by
      // extension, don't duplicate the whole design blob into memory too).
      setMessages((prev) => [...prev, { role: "assistant", content: `Project saved as "${name}".` }]);
    } catch (err) {
      console.warn("save_design_project failed:", err);
      setMessages((prev) => [...prev, { role: "assistant", content: "I couldn't save the project — the Rust backend reported an error." }]);
    }
  }, []);

  if (view === "diagnostics") {
    return <Diagnostics entries={activityEntries} onBack={() => setView("assistant")} onClear={() => activityLogRef.current.clear()} onSave={() => {
      const payload = activityEntries.map((e) => JSON.stringify(e)).join("\n");
      const blob = new Blob([payload], { type: "application/jsonl" });
      const url = URL.createObjectURL(blob); const a = document.createElement("a");
      a.href = url; a.download = `jarvis-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`; a.click(); URL.revokeObjectURL(url);
    }} />;
  }

  if (view === "dashboard") {
    return (
      <Dashboard
        onExit={() => setView("assistant")}
        onOpenDesignStudio={() => setView("design")}
        onOpenSettings={() => setView("settings")}
        cameraStatus={cameraStatus}
        onStartCamera={handleStartCamera}
        hands={hands}
        faceObservation={faceObservation}
        poseObservation={poseObservation}
        gesture={perceptionRef.current.snapshot().vision.gesture}
        jarvisState={jarvisState}
        stateEstimate={stateEstimate}
        activityEntries={activityEntries}
        isOnline={isOnline}
        aiAvailable={aiAvailable}
        activeProviderName={aiProviderRegistry.allConfigs().find((c) => c.enabled && c.hasApiKey)?.displayName ?? null}
        remoteBridge={remoteBridge}
        onStartRemoteControl={handleStartRemoteControl}
        onStopRemoteControl={handleStopRemoteControl}
        onRotateRemoteToken={handleRotateRemoteToken}
      />
    );
  }

  if (view === "settings") {
    return (
      <SettingsPage
        settings={appSettings}
        onChange={setAppSettings}
        onExit={() => setView("assistant")}
        onListVoices={() => voiceRef.current.tts.listAvailableVoices?.() ?? Promise.resolve([])}
        onTestVoice={async () => {
          const tts = voiceRef.current.tts as typeof voiceRef.current.tts & {
            prepareElevenLabsPlayback?: () => Promise<void>;
            prepareKokoro?: () => Promise<void>;
          };
          if (appSettings.voice.ttsProvider === "elevenlabs") await tts.prepareElevenLabsPlayback?.();
          if (appSettings.voice.ttsProvider === "kokoro") await tts.prepareKokoro?.();
          await tts.speak("This is how JARVIS sounds with your current voice settings.");
        }}
        wakeWordUnavailable={wakeWordUnavailable}
        visionSettings={settings}
        onVisionSettingsChange={setSettings}
        memories={memories}
        memoriesLoading={memoriesLoading}
        onRefreshMemories={refreshMemories}
        onDeleteMemory={async (id) => {
          await memoryRef.current.deleteMemory(id);
          await refreshMemories();
        }}
        onSave={async () => {
          // Persisted via the Phase 1 `preferences` table (extended with
          // a getter this phase) — no parallel storage mechanism, and
          // settings never contain API keys (see settings/types.ts).
          await invoke("save_settings", { settingsJson: JSON.stringify(appSettings) });
        }}
        onSaveProviderKey={async (name, key, extra) => {
          await invoke("save_provider_key", { providerName: name, apiKey: key });
          registerProviderWithRealKey(name, key, extra);
          if (name === "elevenlabs") {
            const next = {
              ...appSettings,
              voice: {
                ...appSettings.voice,
                // Saving an optional cloud key must not silently switch a
                // free/local user onto paid TTS. The user can explicitly
                // select ElevenLabs from the Voice settings engine control.
                elevenLabsVoiceId: extra?.voiceId?.trim() || appSettings.voice.elevenLabsVoiceId,
                elevenLabsModel: (extra?.modelId?.trim() || appSettings.voice.elevenLabsModel) as typeof appSettings.voice.elevenLabsModel,
              },
            };
            setAppSettings(next);
            await invoke("save_settings", { settingsJson: JSON.stringify(next) });
          }
          if (name === "openai_compatible" && extra) {
            const next = { ...appSettings, ai: { ...appSettings.ai, openAiCompatibleBaseUrl: extra.baseUrl ?? null, openAiCompatibleModel: extra.model ?? null } };
            setAppSettings(next);
            await invoke("save_settings", { settingsJson: JSON.stringify(next) });
          }
        }}
        onRemoveProviderKey={async (name) => {
          await invoke("remove_provider_key", { providerName: name });
          if (name === "elevenlabs") {
            const tts = voiceRef.current.tts as typeof voiceRef.current.tts & { clearElevenLabs?: () => void };
            tts.clearElevenLabs?.();
            const next = { ...appSettings, voice: { ...appSettings.voice, ttsProvider: "kokoro" } };
            setAppSettings(next);
            await invoke("save_settings", { settingsJson: JSON.stringify(next) });
          }
          // Replace the live provider instance with a fresh
          // placeholder — the previous instance's closure held the now-
          // removed key in memory for its lifetime; swapping the
          // registered instance (not just the config flag) means nothing
          // still holds that key once this returns. hasApiKey:false
          // ensures the router won't select it regardless.
          //
          // openai_compatible needs its OWN placeholder baseUrl/model
          // here (not undefined) — registerProviderWithRealKey correctly
          // refuses to construct a REAL instance without both (see its
          // comment), which would otherwise leave the just-removed key's
          // provider instance still registered and still holding that key
          // in its closure. Same fake-but-valid placeholder values
          // ensureProvider() uses for the initial unconfigured state.
          registerProviderWithRealKey(
            name, "placeholder-unconfigured",
            name === "openai_compatible" ? { baseUrl: "https://placeholder.invalid", model: "placeholder-model" } : undefined
          );
          aiProviderRegistry.updateConfig(name, { hasApiKey: false });
        }}
        onTestProviderKey={async (name) => {
          if (name === "elevenlabs") {
            try { await voiceRef.current.tts.speak("ElevenLabs voice test. Hello Sahil."); return true; } catch { return false; }
          }
          // Genuine connectivity test — makes a REAL minimal API call
          // through the actual registered provider instance, not just a
          // "does a key exist in the keychain" check. A key can exist and
          // still be invalid/revoked/wrong-format; only a real call tells
          // the difference, and this project's stated rule is "do not
          // claim a provider is connected if the real API request has not
          // succeeded."
          const provider = aiProviderRegistry.getProviderInstance(name);
          if (!provider) return false;
          try {
            await provider.chat([{ role: "user", content: "Reply with just the word OK." }]);
            aiProviderRegistry.recordOutcome(name, { success: true });
            return true;
          } catch (err) {
            aiProviderRegistry.recordOutcome(name, { success: false, error: err instanceof Error ? err.message : String(err) });
            return false;
          }
        }}
      />
    );
  }

  if (view === "design") {
    return (
      <DesignStudio
        onExit={() => setView("assistant")}
        onSaveProject={handleSaveDesignProject}
        visionPipeline={visionPipelineRef.current}
        cameraStream={cameraStream}
      />
    );
  }

  const latestActivity = activityEntries[activityEntries.length - 1] ?? null;

  return (
    <div className="jarvis-shell jarvis-home">
      <StatusBar
        online={isOnline}
        aiAvailable={aiAvailable}
        micStatus={micStatus}
        cameraStatus={cameraStatus}
        speaking={speaking}
        currentTask={pendingConfirmation ? "Awaiting confirmation" : pendingConflict ? "Awaiting decision" : undefined}
        activeProviderName={aiProviderRegistry.allConfigs().find((c) => c.enabled && c.hasApiKey)?.displayName}
        currentView="home"
        onOpenDashboard={() => setView("dashboard")}
        onOpenDesignStudio={() => setView("design")}
        onOpenSettings={() => setView("settings")}
        onOpenDiagnostics={() => setView("diagnostics")}
        onToggleDebug={() => setDebugMode((d) => !d)}
        debugActive={debugMode}
        onShareScreen={handleStartScreenShare}
        onAskScreen={async () => {
          const question = window.prompt("Ask JARVIS about what's on your screen:");
          if (!question) return;
          const activityEntry = activityLogRef.current.record({
            requestText: question, interpretedIntent: "screen_question", providerName: null, toolName: "screen.capture", status: "executing", errorMessage: null,
          });
          const result = await screenPerceptionRef.current.askAboutScreen(question);
          if (result.status === "answered") {
            activityLogRef.current.updateStatus(activityEntry.id, "completed");
            window.alert(`${result.providerName}: ${result.answer}`);
          } else {
            // Never fabricates an answer — surfaces exactly why, per spec
            // section 4's "Never fabricate screen contents."
            const messages: Record<string, string> = {
              permission_denied: "Screen capture permission was denied.",
              capture_cancelled: "Screen capture was cancelled.",
              capture_unavailable: "Screen capture is unavailable right now (check Settings > Screen).",
              no_vision_provider: "No vision-capable AI provider is configured — add one in Settings > AI.",
              provider_error: "The AI provider returned an error.",
            };
            activityLogRef.current.updateStatus(activityEntry.id, "error", messages[result.status] ?? result.status);
            window.alert(messages[result.status] ?? "Could not answer that.");
          }
        }}
        onCommandText={(text) => { void handleSend(text); }}
      />

      {/* Home: the orb is the entire point of this screen. No side rails,
          no telemetry, no module tiles — per this session's explicit
          "remove clutter rather than add another element" instruction.
          Everything that used to live in the two rails (Vision status,
          Activity feed, Core/System facts) still exists — it moved into
          DebugPanel below, which is already hidden until the existing
          debug toggle is used, instead of being deleted. */}
      <div className="home-main">
        <div className="home-core-stage">
          <div className="home-orb-frame">
            <JarvisVisualizerView state={jarvisState} quality={appSettings.appearance.animationQuality} analyser={micAnalyser} />
          </div>
          <div className={`home-state-label home-state-label--${jarvisState.toLowerCase()}`} aria-live="polite">
            <span>{seriousMode ? "SERIOUS MODE · " : ""}{STATE_LABELS[jarvisState]}</span>
          </div>

          <ConversationView messages={messages} isThinking={jarvisState === "THINKING"} />

          {currentPlan && (
            <TaskProgress plan={currentPlan} running={planRunning} onCancel={handleCancelPlan} />
          )}

          {commandWidget && (
            <CommandWidgets kind={commandWidget.kind} initialText={commandWidget.initialText} initialCity={commandWidget.initialCity} initialSeconds={commandWidget.initialSeconds} webSearch={webSearchRef.current} onClose={() => setCommandWidget(null)} />
          )}

          <div className="glass-panel input-bar">
            <button
              className={`ptt-button ${micStatus === "listening" ? "ptt-button--active" : ""}`}
              title="Hold to talk"
              onPointerDown={handleMicPointerDown}
              onPointerUp={handleMicPointerUp}
              onPointerCancel={handleMicPointerCancel}
            >
              <MicIcon />
            </button>
            {!cameraStream && (
              <button
                className="camera-btn"
                style={{ borderRadius: 20 }}
                title="Start camera"
                onClick={handleStartCamera}
              >
                <CameraIcon />
              </button>
            )}
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="Ask JARVIS anything, hold the mic to talk, or give a command..."
            />
            <AudioVisualizer analyser={micAnalyser} active={micStatus === "listening"} />
            {/* Matches the reference screenshots' "Listening…" text beside
                the input bar — real micStatus, not a decorative label. */}
            <span className="mic-state-label">
              {micStatus === "listening"
                ? "Listening…"
                : micStatus === "permission_denied"
                ? "Mic permission denied — tap to retry"
                : micStatus === "unavailable"
                ? "Mic unavailable"
                : micStatus === "error"
                ? "Mic error — tap to retry"
                : "Ready"}
            </span>
          </div>
        </div>
      </div>

      <ScreenShareOverlay
        stream={screenShareStream}
        recording={screenRecording}
        onStart={handleStartScreenShare}
        onStop={handleStopScreenShare}
        onRecord={handleToggleScreenRecording}
      />

      {cameraStatus !== "off" || cameraStream ? (
        <CameraPanel
          status={cameraStatus}
          stream={cameraStream}
          hands={hands}
          face={faceObservation}
          pose={poseObservation}
          cameraFps={visionStats?.cameraFps}
          visionFps={visionStats?.visionFps}
          visionAvailable={visionAvailable}
          onStart={handleStartCamera}
          onStop={handleStopCamera}
        />
      ) : null}

      <StateIndicator estimate={stateEstimate} enabled={settings.emotionDetectionEnabled} />

      {debugMode && (
        <DebugPanel
          stats={visionStats}
          handsCount={hands.length}
          faceDetected={faceObservation?.detected ?? false}
          poseDetected={poseObservation?.detected ?? false}
          gesture={perceptionRef.current.snapshot().vision.gesture}
          gestureConfidence={perceptionRef.current.snapshot().vision.gestureConfidence}
          state={stateEstimate}
          eventRate={eventRate}
          jarvisState={jarvisState}
          activeProviderName={aiProviderRegistry.allConfigs().find((c) => c.enabled && c.hasApiKey)?.displayName ?? null}
          isOnline={isOnline}
          latestActivity={latestActivity}
        />
      )}

      {pendingConfirmation && (
        <ConfirmationDialog
          explanation={pendingConfirmation.explanation}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}

      {pendingConflict && (
        <ConflictDialog
          destination={pendingConflict.destination}
          onReplace={handleConflictReplace}
          onCopy={handleConflictCopy}
          onCancel={handleConflictCancel}
        />
      )}
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}
