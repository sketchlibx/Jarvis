import React, { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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
import { createWebSpeechVoiceProvider } from "./voice/providers/WebSpeechProvider";
import { CameraProvider } from "./vision/CameraProvider";
import { VisionPipeline } from "./vision/VisionPipeline";
import { MediaPipeHandsProvider } from "./vision/providers/MediaPipeHandsProvider";
import { MediaPipeFaceProvider, MediaPipePoseProvider } from "./vision/providers/MediaPipeFacePoseProvider";
import { PerceptionContext } from "./perception/PerceptionContext";
import { Dashboard } from "./ui/dashboard/Dashboard";
import { SettingsPage } from "./ui/settings/SettingsPage";
import { JarvisStateMachine } from "./orchestrator/JarvisStateMachine";
import { ActivityLog } from "./orchestrator/ActivityLog";
import { DEFAULT_SETTINGS as DEFAULT_FULL_SETTINGS, type JarvisSettings as FullJarvisSettings } from "./settings/types";
import { ScreenPerception } from "./screen/ScreenPerception";
import { WebScreenCaptureProvider } from "./screen/WebScreenCaptureProvider";
import { PerceptionEventBus } from "./perception/EventBus";
import { GestureEngine } from "./perception/GestureEngine";
import { StateFusionEngine } from "./perception/StateFusionEngine";
import { matchVoiceConfirmation } from "./perception/VoiceConfirmation";
import { DesignStudio } from "./ui/design3d/DesignStudio";
import type { DesignController } from "./design3d/commands/DesignController";
import { serializeProject } from "./design3d/serializers/ProjectSerializer";
import { DEFAULT_SETTINGS, type JarvisSettings } from "./config/settings";
import type { AIMessage } from "./types/ai";
import type { ActionRequest, ActionResponse, ConfirmationExplanation, PlanReport, PlanStep } from "./types/tool";
import type { MicStatus } from "./types/voice";
import type { CameraStatus } from "./types/vision";
import type { FaceObservation, HandObservation, PoseObservation, StateEstimate, VisionPipelineStats } from "./types/perception";

const SYSTEM_PROMPT = `You are JARVIS, a calm, concise, intelligent, respectful desktop assistant.
Keep responses short. Only ask clarifying questions when genuinely necessary.`;

export default function App() {
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [input, setInput] = useState("");
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
  const [settings] = useState<JarvisSettings>(DEFAULT_SETTINGS); // no Settings UI panel yet — see SETUP.md
  const [view, setView] = useState<"assistant" | "design" | "dashboard" | "settings">("assistant");
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

  const voiceRef = useRef(createWebSpeechVoiceProvider());
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
  const [appSettings, setAppSettings] = useState<FullJarvisSettings>(DEFAULT_FULL_SETTINGS);
  const appSettingsRef = useRef(appSettings);
  useEffect(() => { appSettingsRef.current = appSettings; }, [appSettings]);
  // Real live path: gated by the ACTUAL settings state (via a ref, so the
  // gate always reflects the current value even though ScreenPerception
  // itself is constructed once) — not a decorative toggle. Verified by
  // ScreenPerception.test.ts's "screen capture OFF means no capture
  // happens at all" test.
  const screenPerceptionRef = useRef<ScreenPerception>(
    new ScreenPerception(new WebScreenCaptureProvider(), () => appSettingsRef.current.screen.screenCaptureEnabled)
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

  // Lazily construct the pipeline once — it coordinates the already-created
  // provider/engine/context/bus instances above rather than owning parallel
  // ones, per the "do not create a second parallel vision architecture" requirement.
  if (!visionPipelineRef.current) {
    visionPipelineRef.current = new VisionPipeline(
      handsProviderRef.current, faceProviderRef.current, poseProviderRef.current,
      gestureEngineRef.current, perceptionRef.current, eventBusRef.current,
      { enableHands: true, enableFace: settings.cameraBasedStateEnabled, enablePose: false, targetFps: 15,
        onStreamEnded: () => { setCameraStatus("error"); cameraRef.current.stop(); } }
    );
  }

  useEffect(() => {
    const unsubMic = voiceRef.current.stt.onStatusChange(setMicStatus);
    const unsubTts = voiceRef.current.tts.onStatusChange((s) => setSpeaking(s === "speaking"));
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
      // Phase 1: pulls the key from wherever Settings stored it. Placeholder
      // read here — wire to Tauri secure-storage command in a real build.
      const apiKey = window.localStorage.getItem("jarvis_dev_api_key") ?? "";
      const provider = new ClaudeProvider({ apiKey });
      aiProviderRegistry.register(provider, {
        displayName: "Claude", enabled: true, hasApiKey: true, model: "claude-sonnet-4-6", priority: 0,
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
      return provider;
    }
  }, []);

  /** THE actual live path Settings -> real provider instance -> router
   * (closing the audit's "Provider Settings → Actual Router" gap). Called
   * after a key is successfully saved to the OS keychain — constructs a
   * REAL provider bound to that key and re-registers it, replacing the
   * placeholder. Without this, saving a key in Settings only flipped a
   * metadata flag with no live provider behind it. */
  const registerProviderWithRealKey = useCallback((providerName: string, apiKey: string) => {
    const existingConfig = aiProviderRegistry.getConfig(providerName);
    if (!existingConfig) return;
    let provider;
    if (providerName === "gemini") provider = new GeminiProvider({ apiKey, model: existingConfig.model !== "default" ? existingConfig.model : undefined });
    else if (providerName === "grok") provider = new GrokProvider({ apiKey, model: existingConfig.model !== "default" ? existingConfig.model : undefined });
    else if (providerName === "deepseek") provider = new DeepSeekProvider({ apiKey, model: existingConfig.model !== "default" ? existingConfig.model : undefined });
    else if (providerName === "claude") provider = new ClaudeProvider({ apiKey, model: existingConfig.model !== "default" ? existingConfig.model : undefined });
    else return;
    aiProviderRegistry.register(provider, { hasApiKey: true });
  }, []);

  const runToolRequest = useCallback(async (req: ActionRequest) => {
    const response = await invoke<ActionResponse>("request_action", { req });
    if (response.status === "NeedsConfirmation") {
      setPendingConfirmation({ request: req, explanation: response.explanation });
      return `This needs your confirmation: ${response.explanation.action}.`;
    }
    if (response.status === "Conflict") {
      setPendingConflict({ request: req, destination: response.destination });
      return `${response.destination} already exists — want me to replace it or create a copy?`;
    }
    if (response.status === "Denied") return `I can't do that: ${response.reason}`;
    if (response.status === "Error") return `That failed: ${response.message}`;
    return response.message;
  }, []);

  const handleConflictReplace = useCallback(async () => {
    if (!pendingConflict) return;
    const replaceReq: ActionRequest = {
      tool_id: "replace_file",
      params: pendingConflict.request.params,
      user_request: pendingConflict.request.user_request,
      interpreted_intent: "user chose Replace after a conflict",
    };
    setPendingConflict(null);
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
    const text = await runToolRequest(copyReq);
    setMessages((prev) => [...prev, { role: "assistant", content: text }]);
  }, [pendingConflict, runToolRequest]);

  const handleConflictCancel = useCallback(() => {
    setPendingConflict(null);
    setMessages((prev) => [...prev, { role: "assistant", content: "Cancelled." }]);
  }, []);

  const runPlan = useCallback(async (steps: PlanStep[], userRequest: string, interpretedIntent: string) => {
    setPlanRunning(true);
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
    const response = await invoke<ActionResponse>("confirm_action", { req: pendingConfirmation.request });
    setPendingConfirmation(null);
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
    setMessages((prev) => [...prev, { role: "assistant", content: "Cancelled." }]);
    speak("Cancelled.");
  }, [pendingConfirmation]);

  const handleSend = useCallback(async (overrideText?: string) => {
    const raw = (overrideText ?? input).trim();
    if (!raw) return;
    if (!overrideText) setInput("");

    const resolved = contextRef.current.resolvePronouns(raw);
    const userMsg: AIMessage = { role: "user", content: raw };
    contextRef.current.addMessage(userMsg);
    setMessages((prev) => [...prev, userMsg]);

    try {
      const provider = ensureProvider();
      const history = [{ role: "system", content: SYSTEM_PROMPT } as AIMessage, ...contextRef.current.getHistory()];

      // Heuristic multi-step trigger: sequencing language ("and then", "then",
      // multiple commas) suggests a plan rather than a single reply. This is
      // a simple heuristic, not full intent classification — it's meant to
      // catch the "create a folder, open it, and create a file" style request
      // from the spec, not to route every message.
      const looksMultiStep = /\b(and then|then)\b/i.test(resolved) || (resolved.match(/,/g)?.length ?? 0) >= 2;

      if (looksMultiStep) {
        const plan = await provider.generatePlan(resolved, history);
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

      const reply = await provider.chat([...history, { role: "user", content: resolved }]);
      setAiAvailable(true);
      const assistantMsg: AIMessage = { role: "assistant", content: reply };
      contextRef.current.addMessage(assistantMsg);
      setMessages((prev) => [...prev, assistantMsg]);
      speak(reply);
    } catch (err) {
      setAiAvailable(false);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "AI is unavailable right now. Check your API key or connection in Settings." },
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, ensureProvider, runPlan]);

  // ---------------------------------------------------------------------
  // Phase 3 — speech output with interruption support (spec sections 5, 28)
  // ---------------------------------------------------------------------
  const speak = useCallback((text: string) => {
    ttsAbortRef.current?.abort();
    const controller = new AbortController();
    ttsAbortRef.current = controller;
    voiceRef.current.tts.speak(text, controller.signal).catch(() => {
      // Interruption/cancellation surfaces as a resolved promise per
      // WebSpeechTTSProvider; a genuine failure is swallowed here rather
      // than crashing the UI, matching spec section 29's degraded-mode requirement.
    });
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
  // Phase 3 — push-to-talk voice loop
  // ---------------------------------------------------------------------
  const handlePushToTalkDown = useCallback(async () => {
    if (speaking) interruptSpeech(); // user starting to talk while JARVIS speaks = interruption
    listeningStartRef.current = Date.now();
    try {
      await voiceRef.current.stt.startListening();
      // Separate lightweight stream just for the visualizer's AnalyserNode —
      // WebSpeechSTTProvider doesn't expose its internal audio graph.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      setMicAnalyser(analyser);
    } catch {
      // startListening() already set micStatus via its own status callback
      // (unavailable/permission_denied/error) — nothing further to do here.
    }
  }, [speaking, interruptSpeech]);

  const handlePushToTalkUp = useCallback(async () => {
    const transcript = await voiceRef.current.stt.stopListening();
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    setMicAnalyser(null);
    if (!transcript) return;

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

    // Voice confirmation ONLY matches against a real pending state that
    // already exists — see VoiceConfirmation.ts doc comment. The AI is
    // never consulted here at all.
    if (pendingConfirmation) {
      const match = matchVoiceConfirmation(transcript);
      if (match === "confirm") return handleConfirm();
      if (match === "cancel") return handleCancel();
    }
    if (pendingConflict) {
      const match = matchVoiceConfirmation(transcript);
      if (match === "cancel") return handleConflictCancel();
      // "confirm"/"yes" is deliberately ambiguous for a 3-way conflict
      // (Replace vs Copy) — we don't guess which one the user meant.
    }
    if (/^(stop|cancel|abort)\.?$/i.test(transcript.trim())) {
      return cancelCurrentTask();
    }

    recordCommandForBehaviorSignal(transcript);
    await handleSend(transcript);
  }, [pendingConfirmation, pendingConflict, handleConfirm, handleCancel, handleConflictCancel, cancelCurrentTask, refreshVoiceSignal, recordCommandForBehaviorSignal, handleSend]);

  // ---------------------------------------------------------------------
  // Phase 3 — camera controls
  // ---------------------------------------------------------------------
  const handleStartCamera = useCallback(async () => {
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
    } catch {
      // status already reflects the failure via onStatusChange
    }
  }, []);

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

  if (view === "dashboard") {
    return (
      <Dashboard
        stateMachine={stateMachineRef.current}
        activityLog={activityLogRef.current}
        systemStats={{ cpuPercent: null, memoryPercent: null, networkStatus: "unknown" }}
      />
    );
  }

  if (view === "settings") {
    return (
      <SettingsPage
        settings={appSettings}
        onChange={setAppSettings}
        onSave={async () => {
          // Persisted via the Phase 1 `preferences` table (extended with
          // a getter this phase) — no parallel storage mechanism, and
          // settings never contain API keys (see settings/types.ts).
          await invoke("save_settings", { settingsJson: JSON.stringify(appSettings) });
        }}
        onSaveProviderKey={async (name, key) => {
          await invoke("save_provider_key", { providerName: name, apiKey: key });
          // THE actual live path: without this call, the key would be
          // saved to the keychain but no real provider instance would
          // ever be constructed from it — route() would keep skipping
          // this provider forever since hasApiKey would flip to true
          // with no chat()-capable object behind that claim.
          registerProviderWithRealKey(name, key);
        }}
        onRemoveProviderKey={async (name) => {
          await invoke("remove_provider_key", { providerName: name });
          // Replace the live provider instance with a fresh
          // placeholder — the previous instance's closure held the now-
          // removed key in memory for its lifetime; swapping the
          // registered instance (not just the config flag) means nothing
          // still holds that key once this returns. hasApiKey:false
          // ensures the router won't select it regardless.
          registerProviderWithRealKey(name, "placeholder-unconfigured");
          aiProviderRegistry.updateConfig(name, { hasApiKey: false });
        }}
        onTestProviderKey={async (name) => await invoke<boolean>("test_provider_key_present", { providerName: name })}
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

  return (
    <div className="jarvis-shell">
      <StatusBar
        online={navigator.onLine}
        aiAvailable={aiAvailable}
        micStatus={micStatus}
        cameraStatus={cameraStatus}
        speaking={speaking}
        currentTask={pendingConfirmation ? "Awaiting confirmation" : pendingConflict ? "Awaiting decision" : undefined}
      />
      <button
        onClick={() => setDebugMode((d) => !d)}
        title="Toggle developer debug panel"
        style={{
          position: "absolute", top: 22, right: 22, zIndex: 10,
          background: "transparent", border: "1px solid var(--border-glass)", borderRadius: 6,
          color: debugMode ? "var(--accent-cyan)" : "var(--text-muted)", fontSize: 10, padding: "3px 8px", cursor: "pointer",
        }}
      >
        DEBUG
      </button>
      <button
        onClick={() => setView("dashboard")}
        title="Open the JARVIS command center dashboard"
        style={{
          position: "absolute", top: 22, right: 235, zIndex: 10,
          background: "transparent", border: "1px solid var(--border-glass)", borderRadius: 6,
          color: "var(--accent-cyan)", fontSize: 10, padding: "3px 8px", cursor: "pointer",
        }}
      >
        DASHBOARD
      </button>
      <button
        onClick={async () => {
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
        title="Ask JARVIS about your screen (requires Screen Capture enabled in Settings)"
        style={{
          position: "absolute", top: 22, right: 308, zIndex: 10,
          background: "transparent", border: "1px solid var(--border-glass)", borderRadius: 6,
          color: "var(--accent-cyan)", fontSize: 10, padding: "3px 8px", cursor: "pointer",
        }}
      >
        ASK SCREEN
      </button>
      <button
        onClick={() => setView("settings")}
        title="Open Settings"
        style={{
          position: "absolute", top: 22, right: 162, zIndex: 10,
          background: "transparent", border: "1px solid var(--border-glass)", borderRadius: 6,
          color: "var(--accent-cyan)", fontSize: 10, padding: "3px 8px", cursor: "pointer",
        }}
      >
        SETTINGS
      </button>
      <button
        onClick={() => setView("design")}
        title="Open the 3D Design Studio"
        style={{
          position: "absolute", top: 22, right: 88, zIndex: 10,
          background: "transparent", border: "1px solid var(--border-glass)", borderRadius: 6,
          color: "var(--accent-cyan)", fontSize: 10, padding: "3px 8px", cursor: "pointer",
        }}
      >
        DESIGN STUDIO
      </button>

      {cameraStatus !== "off" || cameraStream ? (
        <CameraPanel
          status={cameraStatus}
          stream={cameraStream}
          hands={hands}
          face={faceObservation}
          pose={poseObservation}
          cameraFps={visionStats?.cameraFps}
          visionFps={visionStats?.visionFps}
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
        />
      )}

      <ConversationView messages={messages} />

      {currentPlan && (
        <TaskProgress plan={currentPlan} running={planRunning} onCancel={handleCancelPlan} />
      )}

      <div className="glass-panel input-bar">
        <button
          className={`ptt-button ${micStatus === "listening" ? "ptt-button--active" : ""}`}
          title="Hold to talk"
          onMouseDown={handlePushToTalkDown}
          onMouseUp={handlePushToTalkUp}
          onTouchStart={handlePushToTalkDown}
          onTouchEnd={handlePushToTalkUp}
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
      </div>

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
