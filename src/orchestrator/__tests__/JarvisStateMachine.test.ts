import { describe, it, expect, vi } from "vitest";
import { JarvisStateMachine } from "../JarvisStateMachine";

describe("JarvisStateMachine — spec sections 9-10", () => {
  it("starts IDLE", () => {
    expect(new JarvisStateMachine().state).toBe("IDLE");
  });

  it("allows the normal happy-path sequence", () => {
    const sm = new JarvisStateMachine();
    expect(sm.transition("LISTENING")).toBe(true);
    expect(sm.transition("THINKING")).toBe(true);
    expect(sm.transition("SPEAKING")).toBe(true);
    expect(sm.transition("IDLE")).toBe(true);
  });

  it("rejects a transition that skips required intermediate states", () => {
    const sm = new JarvisStateMachine();
    sm.transition("LISTENING");
    sm.transition("THINKING");
    sm.transition("SPEAKING");
    expect(sm.transition("WAITING_CONFIRMATION")).toBe(false);
    expect(sm.state).toBe("SPEAKING"); // state unchanged after a rejected transition
  });

  it("allows the confirmation flow: THINKING -> WAITING_CONFIRMATION -> EXECUTING", () => {
    const sm = new JarvisStateMachine();
    sm.transition("THINKING");
    expect(sm.transition("WAITING_CONFIRMATION")).toBe(true);
    expect(sm.transition("EXECUTING")).toBe(true);
  });

  it("makes OFFLINE/ERROR reachable from any state via forceState, bypassing the normal graph", () => {
    const sm = new JarvisStateMachine();
    sm.transition("THINKING");
    sm.transition("EXECUTING");
    sm.forceState("ERROR", "network lost");
    expect(sm.state).toBe("ERROR");
  });

  it("requires OFFLINE to recover through IDLE, not directly into an active state", () => {
    const sm = new JarvisStateMachine();
    sm.forceState("OFFLINE");
    expect(sm.transition("THINKING")).toBe(false);
    expect(sm.transition("IDLE")).toBe(true);
  });

  it("notifies subscribed listeners with state and detail, and stops after unsubscribe", () => {
    const sm = new JarvisStateMachine();
    const listener = vi.fn();
    const unsubscribe = sm.onTransition(listener);
    sm.transition("LISTENING", "mic active");
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ state: "LISTENING", detail: "mic active" }));

    unsubscribe();
    sm.transition("THINKING");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("caps history at the configured maximum", () => {
    const sm = new JarvisStateMachine(3);
    sm.transition("LISTENING");
    sm.transition("THINKING");
    sm.transition("SPEAKING");
    sm.transition("IDLE");
    expect(sm.getHistory()).toHaveLength(3);
  });
});
