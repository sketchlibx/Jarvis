import type {
  BehaviorSignal, FaceSignal, GestureSignal, StateEstimate, StateLabel, StateSignalSource, VoiceSignal,
} from "../types/perception";

interface StateVote {
  state: StateLabel;
  weight: number; // 0..1, this signal's confidence in this vote
  source: StateSignalSource;
}

/**
 * Combines independent signals into ONE StateEstimate. Core rule (spec
 * section 17): no single weak/isolated signal should produce a confident
 * label, and CONFLICTING signals must lower confidence rather than let one
 * "win" silently. This is a heuristic voting system, explicitly not a
 * trained classifier — it's honest about being a starting point, not a
 * clinical or even reliable emotion detector.
 */
export class StateFusionEngine {
  /**
   * Enabled flags per spec section 18 (privacy) — each modality can be
   * independently disabled, and a disabled modality contributes NO vote,
   * not a neutral one (a neutral vote would still subtly influence fusion).
   */
  constructor(
    private settings: { voiceEnabled: boolean; faceEnabled: boolean; behaviorEnabled: boolean } = {
      voiceEnabled: true,
      faceEnabled: true,
      behaviorEnabled: true,
    }
  ) {}

  estimate(
    voice: VoiceSignal | null,
    face: FaceSignal | null,
    behavior: BehaviorSignal | null,
    _gesture: GestureSignal | null
  ): StateEstimate {
    const votesBySource = new Map<StateSignalSource, StateVote[]>();
    if (this.settings.voiceEnabled && voice) votesBySource.set("voice", this.voiceVotes(voice));
    if (this.settings.faceEnabled && face) votesBySource.set("face", this.faceVotes(face));
    if (this.settings.behaviorEnabled && behavior) votesBySource.set("behavior", this.behaviorVotes(behavior));

    const votes = [...votesBySource.values()].flat();

    if (votes.length === 0) {
      return { state: "neutral", confidence: 0, signals: [], timestamp: new Date().toISOString() };
    }

    // Tally weighted votes per label (used for the reported label/confidence
    // magnitude when sources agree, and for the confidence magnitude even
    // when they don't).
    const tally = new Map<StateLabel, number>();
    for (const v of votes) {
      tally.set(v.state, (tally.get(v.state) ?? 0) + v.weight);
    }

    const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]);
    const [topLabel, topWeight] = sorted[0];
    const totalWeight = votes.reduce((sum, v) => sum + v.weight, 0);

    // Conflict detection operates on each SOURCE's own dominant opinion,
    // not on the pooled per-label tally above. This matters concretely:
    // voice alone can cast several votes for the SAME label (e.g.
    // `interruptionCount` AND `sentimentHint` both voting "frustrated"),
    // and pooling those together before comparing against a single vote
    // from face would make voice's combined weight dwarf face's — even
    // though the actual disagreement ("voice says frustrated, face says
    // calm") is exactly the two-source conflict spec section 17 requires
    // resolving to "uncertain." Comparing each source's OWN top opinion
    // sidesteps that entirely: it doesn't matter how many sub-votes
    // produced a source's opinion, only what that source's single verdict
    // is, so two disagreeing sources are detected regardless of how many
    // internal signals fed into either one.
    const sourceOpinions = [...votesBySource.entries()]
      .filter(([, sourceVotes]) => sourceVotes.length > 0)
      .map(([source, sourceVotes]) => {
        const sourceTally = new Map<StateLabel, number>();
        for (const v of sourceVotes) sourceTally.set(v.state, (sourceTally.get(v.state) ?? 0) + v.weight);
        const [dominantLabel] = [...sourceTally.entries()].sort((a, b) => b[1] - a[1])[0];
        return { source, dominantLabel };
      });

    const distinctDominantLabels = new Set(sourceOpinions.map((o) => o.dominantLabel));
    const isConflicted = sourceOpinions.length >= 2 && distinctDominantLabels.size > 1;

    const sourcesUsed = [...new Set(votes.map((v) => v.source))];
    const rawConfidence = totalWeight > 0 ? topWeight / totalWeight : 0;
    // Single-signal estimates are capped — spec section 17 explicitly forbids
    // one weak signal from determining a confident state.
    const singleSignalCap = sourcesUsed.length === 1 ? 0.6 : 1.0;

    const finalConfidence = isConflicted
      ? Math.min(rawConfidence * 0.5, 0.4)
      : Math.min(rawConfidence * singleSignalCap, 0.95);

    return {
      state: isConflicted ? "uncertain" : topLabel,
      confidence: Math.round(finalConfidence * 100) / 100,
      signals: sourcesUsed,
      timestamp: new Date().toISOString(),
    };
  }

  private voiceVotes(v: VoiceSignal): StateVote[] {
    const votes: StateVote[] = [];
    if (v.speechRatePerMinute !== null) {
      if (v.speechRatePerMinute > 180) votes.push({ state: "excited", weight: 0.4, source: "voice" });
      if (v.speechRatePerMinute < 90) votes.push({ state: "confused", weight: 0.3, source: "voice" });
    }
    if (v.interruptionCount >= 2) votes.push({ state: "frustrated", weight: 0.4, source: "voice" });
    if (v.pauseCount >= 3) votes.push({ state: "uncertain", weight: 0.3, source: "voice" });
    if (v.sentimentHint === "negative") votes.push({ state: "frustrated", weight: 0.35, source: "voice" });
    if (v.sentimentHint === "positive") votes.push({ state: "excited", weight: 0.25, source: "voice" });
    if (votes.length === 0) votes.push({ state: "calm", weight: 0.2, source: "voice" });
    return votes;
  }

  private faceVotes(f: FaceSignal): StateVote[] {
    if (!f.present) return [];
    const votes: StateVote[] = [];
    // Expression features are raw geometric ratios (e.g. "browFurrow":0..1),
    // never named emotions themselves — the mapping to a label happens only
    // here, still capped by singleSignalCap upstream, and always alongside
    // a confidence number.
    const browFurrow = f.expressionFeatures["browFurrow"] ?? 0;
    const mouthOpen = f.expressionFeatures["mouthOpen"] ?? 0;
    const smileRatio = f.expressionFeatures["smileRatio"] ?? 0;

    if (browFurrow > 0.5) votes.push({ state: "frustrated", weight: 0.4 * f.confidence, source: "face" });
    if (smileRatio > 0.5) votes.push({ state: "calm", weight: 0.3 * f.confidence, source: "face" });
    if (mouthOpen > 0.6) votes.push({ state: "excited", weight: 0.25 * f.confidence, source: "face" });
    if (votes.length === 0) votes.push({ state: "neutral", weight: 0.2 * f.confidence, source: "face" });
    return votes;
  }

  private behaviorVotes(b: BehaviorSignal): StateVote[] {
    const votes: StateVote[] = [];
    if (b.repeatedCorrections >= 2) votes.push({ state: "frustrated", weight: 0.45, source: "behavior" });
    if (b.rapidCommandCount >= 3) votes.push({ state: "focused", weight: 0.3, source: "behavior" });
    if (b.hesitationCount >= 2) votes.push({ state: "confused", weight: 0.35, source: "behavior" });
    if (votes.length === 0) votes.push({ state: "neutral", weight: 0.15, source: "behavior" });
    return votes;
  }
}
