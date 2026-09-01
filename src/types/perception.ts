// ---------------------------------------------------------------------
// Structured perception observations — spec sections 10, 12, 13
// ---------------------------------------------------------------------

export interface Landmark {
  x: number; // normalized 0..1
  y: number;
  z: number; // relative depth, MediaPipe convention
}

export type Handedness = "Left" | "Right" | "Unknown";

export interface HandObservation {
  id: string;
  handedness: Handedness;
  confidence: number; // 0..1
  landmarks: Landmark[]; // 21 when the underlying model supports it
  timestamp: string;
}

export interface HeadPose {
  yaw: number;   // degrees, approximate
  pitch: number;
  roll: number;
}

export interface FaceObservation {
  detected: boolean;
  confidence: number;
  landmarks: Landmark[];
  headPose: HeadPose | null;
  /** Raw geometric features only (e.g. mouth-open ratio, brow-raise ratio) —
   * never a named emotion. Emotion inference happens later, in
   * StateFusionEngine, and always carries a confidence + "estimate" framing. */
  expressionFeatures: Record<string, number>;
  timestamp: string;
}

export interface PoseObservation {
  detected: boolean;
  confidence: number;
  landmarks: Partial<Record<
    "leftShoulder" | "rightShoulder" | "leftElbow" | "rightElbow" | "leftWrist" | "rightWrist",
    Landmark
  >>;
  timestamp: string;
}

export type GestureLabel =
  | "open_hand" | "fist" | "pinch" | "point"
  | "thumbs_up" | "thumbs_down" | "victory"
  | "swipe_left" | "swipe_right" | "none";

export interface GestureObservation {
  gesture: GestureLabel;
  confidence: number;
  handId: string;
  timestamp: string;
}

// ---------------------------------------------------------------------
// Perception event bus — spec section 14
// ---------------------------------------------------------------------

export type PerceptionEventType =
  | "hand.detected" | "hand.lost"
  | "gesture.detected"
  | "face.detected" | "face.lost"
  | "pose.detected" | "pose.lost"
  | "camera.started" | "camera.stopped"
  | "voice.started" | "voice.stopped"
  | "speech.detected";

export interface PerceptionEvent<TPayload = unknown> {
  type: PerceptionEventType;
  timestamp: string;
  confidence: number;
  source: "voice" | "vision" | "gesture" | "face" | "pose" | "camera";
  payload: TPayload;
}

// ---------------------------------------------------------------------
// Emotion/state estimation — spec sections 16, 17
// ---------------------------------------------------------------------

/** Probabilistic labels only — never a diagnosis. See StateFusionEngine. */
export type StateLabel =
  | "calm" | "focused" | "confused" | "frustrated"
  | "excited" | "uncertain" | "neutral";

export type StateSignalSource = "voice" | "face" | "behavior" | "gesture";

export interface StateEstimate {
  state: StateLabel;
  confidence: number; // 0..1 — UI/AI must always show this, never drop it
  signals: StateSignalSource[];
  timestamp: string;
}

export interface VoiceSignal {
  speechRatePerMinute: number | null;
  pauseCount: number;
  interruptionCount: number; // times the user talked over JARVIS in this session
  sentimentHint: "positive" | "neutral" | "negative" | null; // from transcript text only, not tone
}

export interface FaceSignal {
  present: boolean;
  expressionFeatures: Record<string, number>;
  confidence: number;
}

export interface BehaviorSignal {
  repeatedCorrections: number; // "no, I meant..." style follow-ups in this session
  rapidCommandCount: number;   // commands within a short window
  hesitationCount: number;     // long pauses before completing a command
}

export interface GestureSignal {
  recentGestures: GestureLabel[];
}

// ---------------------------------------------------------------------
// Multimodal context — spec sections 15, 19, 20, 21
// ---------------------------------------------------------------------

export interface TargetReference {
  type: "hand_point" | "gaze_approx" | "none";
  screenPosition: { x: number; y: number } | null;
  confidence: number;
  timestamp: string;
}

/** The structured, privacy-conscious payload sent to the AI provider —
 * never raw frames/audio, per spec section 21. */
export interface PerceptionContextSnapshot {
  voice: { transcript: string; confidence: number } | null;
  vision: { hands: number; gesture: GestureLabel | null; gestureConfidence: number | null };
  face: { present: boolean };
  state: { label: StateLabel; confidence: number } | null;
  target: TargetReference | null;
}

// ---------------------------------------------------------------------
// Vision pipeline coordination — Phase 3 completion task
// ---------------------------------------------------------------------

/**
 * One combined result from a single camera frame passing through whichever
 * detectors are enabled. This is the "VisionPipeline" coordination layer's
 * output type — distinct from `PerceptionContextSnapshot` above, which is
 * the smaller, privacy-filtered payload sent to the AI. `PerceptionSnapshot`
 * is the internal, fuller structure the frontend/UI consumes.
 */
export interface PerceptionSnapshot {
  timestamp: string;
  hands: HandObservation[];
  face: FaceObservation | null;
  pose: PoseObservation | null;
  gestures: GestureObservation[];
}

export interface VisionPipelineStats {
  cameraFps: number;   // measured from actual video frame arrivals
  visionFps: number;   // measured from actual detector invocations that completed
  handsInitialized: boolean;
  faceInitialized: boolean;
  poseInitialized: boolean;
}
