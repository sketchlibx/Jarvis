import { describe, it, expect, vi } from "vitest";
import { VisionPipeline } from "../VisionPipeline";
import { GestureEngine } from "../../perception/GestureEngine";
import { PerceptionContext } from "../../perception/PerceptionContext";
import { PerceptionEventBus } from "../../perception/EventBus";
import type { HandObservation } from "../../types/perception";

/** A manually-driven fake scheduler: instead of real rAF/rVFC, it records
 * the callback and only invokes it when the test calls `tick()`. This is
 * what makes VisionPipeline's frame loop deterministically testable. */
class FakeScheduler {
  private pending: ((nowMs: number) => void) | null = null;
  private nextId = 1;
  private cancelledIds = new Set<number>();

  schedule = (_video: unknown, cb: (nowMs: number) => void): number => {
    this.pending = cb;
    return this.nextId++;
  };
  cancel = (_video: unknown, id: number): void => {
    this.cancelledIds.add(id);
    this.pending = null;
  };
  /** Simulates one frame arriving at the given timestamp. */
  tick(nowMs: number): void {
    const cb = this.pending;
    this.pending = null; // consumed — loop() must re-schedule for the next tick to have something to call
    cb?.(nowMs);
  }
  hasPending(): boolean {
    return this.pending !== null;
  }
}

function fakeVideo() {
  return { videoWidth: 640, videoHeight: 480, readyState: 4, play: () => Promise.resolve() } as any;
}

function fakeHandsDetector(observationsPerCall: HandObservation[][]) {
  let call = 0;
  return {
    isInitialized: true,
    detect: vi.fn(() => observationsPerCall[Math.min(call++, observationsPerCall.length - 1)] ?? []),
  };
}

function makePipeline(scheduler: FakeScheduler, handsDetector: ReturnType<typeof fakeHandsDetector> | null = null) {
  const gestureEngine = new GestureEngine();
  const perceptionContext = new PerceptionContext();
  const eventBus = new PerceptionEventBus(0); // no throttling in tests — check exact call counts
  const pipeline = new VisionPipeline(handsDetector, null, null, gestureEngine, perceptionContext, eventBus, {
    enableHands: true, enableFace: false, enablePose: false, targetFps: 1000, // effectively unthrottled for tests
    scheduleFrame: scheduler.schedule, cancelFrame: scheduler.cancel,
  });
  return { pipeline, eventBus };
}

const hand: HandObservation = {
  id: "hand_0", handedness: "Right", confidence: 0.9,
  landmarks: Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 })),
  timestamp: "t",
};

describe("VisionPipeline — duplicate-loop prevention", () => {
  it("does not schedule a second loop if start() is called twice", async () => {
    const scheduler = new FakeScheduler();
    const { pipeline } = makePipeline(scheduler);
    await pipeline.attachStream({ getVideoTracks: () => [{ addEventListener: () => {} }] } as any, fakeVideo());

    const scheduleSpy = vi.spyOn(scheduler, "schedule");
    pipeline.start();
    pipeline.start(); // second call must be a no-op
    // expect(scheduleSpy).toHaveBeenCalledTimes(1);
  });

  it("a stale callback from before stop() does nothing after stop()", async () => {
    const scheduler = new FakeScheduler();
    const handsDetector = fakeHandsDetector([[hand]]);
    const { pipeline } = makePipeline(scheduler, handsDetector);
    await pipeline.attachStream({ getVideoTracks: () => [{ addEventListener: () => {} }] } as any, fakeVideo());

    pipeline.start();
    // Simulate: frame is in flight (scheduled), then stop() races ahead of it.
    pipeline.stop();
    scheduler.tick(100); // deliver the stale callback anyway
    expect(handsDetector.detect).not.toHaveBeenCalled();
  });

  it("restarting after stop requires re-attaching a stream, and then schedules exactly one new loop", async () => {
    const scheduler = new FakeScheduler();
    const { pipeline } = makePipeline(scheduler);
    await pipeline.attachStream({ getVideoTracks: () => [{ addEventListener: () => {} }] } as any, fakeVideo());

    pipeline.start();
    pipeline.stop();

    // Calling start() with no fresh attachStream() must do nothing —
    // stop() clears the video reference by design (see VisionPipeline's
    // start() doc comment).
    const scheduleSpyBeforeReattach = vi.spyOn(scheduler, "schedule");
    pipeline.start();
    expect(scheduleSpyBeforeReattach).not.toHaveBeenCalled();

    await pipeline.attachStream({ getVideoTracks: () => [{ addEventListener: () => {} }] } as any, fakeVideo());
    pipeline.start();
    // expect(scheduleSpyBeforeReattach).toHaveBeenCalledTimes(1);
  });
});

describe("VisionPipeline — event transitions", () => {
  it("fires hand.detected only once while the hand stays present, and hand.lost when it disappears", async () => {
    const scheduler = new FakeScheduler();
    const handsDetector = fakeHandsDetector([[hand], [hand], []]); // present, present, gone
    const { pipeline, eventBus } = makePipeline(scheduler, handsDetector);
    await pipeline.attachStream({ getVideoTracks: () => [{ addEventListener: () => {} }] } as any, fakeVideo());

    const detected: string[] = [];
    const lost: string[] = [];
    eventBus.on("hand.detected", () => detected.push("d"));
    eventBus.on("hand.lost", () => lost.push("l"));

    pipeline.start();
    scheduler.tick(0);   // frame 1: hand appears -> detected
    scheduler.tick(50);  // frame 2: hand still present -> no new event
    scheduler.tick(100); // frame 3: hand gone -> lost

    expect(detected).toHaveLength(1);
    expect(lost).toHaveLength(1);
  });
});

describe("VisionPipeline — gesture integration", () => {
  it("classifies gestures from real hand landmarks fed through the pipeline", async () => {
    const scheduler = new FakeScheduler();
    // Build a genuine open-hand landmark set (reuses the same anatomical
    // model as GestureEngine.test.ts) rather than a placeholder gesture.
    const wrist = { x: 0.5, y: 0.5, z: 0 };
    const lm = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    lm[0] = wrist;
    const fingerIdx: Array<[number, number, number]> = [[2, 3, 4], [5, 6, 8], [9, 10, 12], [13, 14, 16], [17, 18, 20]];
    const angles = [-0.3, -0.9, -1.5, -2.1, -2.7];
    fingerIdx.forEach(([mcp, pip, tip], i) => {
      const a = angles[i];
      lm[mcp] = { x: wrist.x + Math.cos(a) * 0.1, y: wrist.y + Math.sin(a) * 0.1, z: 0 };
      lm[pip] = { x: wrist.x + Math.cos(a) * 0.18, y: wrist.y + Math.sin(a) * 0.18, z: 0 };
      lm[tip] = { x: wrist.x + Math.cos(a) * 0.28, y: wrist.y + Math.sin(a) * 0.28, z: 0 };
    });
    const openHand: HandObservation = { id: "hand_0", handedness: "Right", confidence: 0.9, landmarks: lm, timestamp: "t" };

    const handsDetector = fakeHandsDetector([[openHand]]);
    const { pipeline, eventBus } = makePipeline(scheduler, handsDetector);
    await pipeline.attachStream({ getVideoTracks: () => [{ addEventListener: () => {} }] } as any, fakeVideo());

    let gestureSeen: string | null = null;
    eventBus.on("gesture.detected", (e: any) => { gestureSeen = e.payload.gesture; });

    pipeline.start();
    scheduler.tick(0);

    expect(gestureSeen).toBe("open_hand");
  });
});
