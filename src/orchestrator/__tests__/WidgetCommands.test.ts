import { describe, it, expect } from "vitest";
import { detectCommandWidget } from "../WidgetCommands";

describe("detectCommandWidget — Phase 9 deterministic widget routing", () => {
  it("opens notepad", () => {
    expect(detectCommandWidget("open notepad")).toEqual({ kind: "notepad" });
    expect(detectCommandWidget("Open the notepad.")).toEqual({ kind: "notepad" });
    expect(detectCommandWidget("show notes")).toEqual({ kind: "notepad" });
  });

  it("opens calculator", () => {
    expect(detectCommandWidget("open calculator")).toEqual({ kind: "calculator" });
    expect(detectCommandWidget("open calc")).toEqual({ kind: "calculator" });
  });

  it("opens calendar", () => {
    expect(detectCommandWidget("open calendar")).toEqual({ kind: "calendar" });
  });

  it("opens the weather widget, with an optional city", () => {
    expect(detectCommandWidget("what's the weather")).toEqual({ kind: "weather", initialCity: undefined });
    expect(detectCommandWidget("what's the weather in Saharsa, Bihar")).toEqual({ kind: "weather", initialCity: "Saharsa, Bihar" });
  });

  it("opens news and search", () => {
    expect(detectCommandWidget("open news")).toEqual({ kind: "news" });
    expect(detectCommandWidget("what's the latest news")).toEqual({ kind: "news" });
    expect(detectCommandWidget("open search")).toEqual({ kind: "search" });
  });

  it("does not match ordinary conversation that merely mentions these words", () => {
    expect(detectCommandWidget("I opened the calculator app yesterday and it crashed")).toBeNull();
    expect(detectCommandWidget("what's the weather like on Mars scientifically speaking")).not.toEqual({ kind: "weather", initialCity: undefined });
  });

  describe("REGRESSION: 'take a note' family (real bug — a literal raw backspace byte had corrupted this pattern in place of \\b, confirmed by reading the file's raw bytes)", () => {
    it("matches take/make/write/create/save a note and captures the note content", () => {
      expect(detectCommandWidget("take a note: buy milk")).toEqual({ kind: "notepad", initialText: "buy milk" });
      expect(detectCommandWidget("make a note remember the meeting")).toEqual({ kind: "notepad", initialText: "remember the meeting" });
      expect(detectCommandWidget("write a note - call mom")).toEqual({ kind: "notepad", initialText: "call mom" });
      expect(detectCommandWidget("create a note")).toEqual({ kind: "notepad", initialText: "" });
      expect(detectCommandWidget("save a note, finish the report")).toEqual({ kind: "notepad", initialText: "finish the report" });
    });

    it("also matches without the article 'a'", () => {
      expect(detectCommandWidget("take note: buy milk")).toEqual({ kind: "notepad", initialText: "buy milk" });
    });
  });

  describe("REGRESSION: timer phrasing with 'for' and bare unit abbreviations (real bug — reproduced with node before the fix: 'set the timer for 10s' did not match at all)", () => {
    it("matches the exact phrase that was confirmed broken", () => {
      expect(detectCommandWidget("set the timer for 10s")).toEqual({ kind: "timer", initialSeconds: 10 });
    });

    it("matches common variants with 'for' and articles", () => {
      expect(detectCommandWidget("set a timer for 10 seconds")).toEqual({ kind: "timer", initialSeconds: 10 });
      expect(detectCommandWidget("start a timer for 5 minutes")).toEqual({ kind: "timer", initialSeconds: 300 });
      expect(detectCommandWidget("set timer for 30 secs")).toEqual({ kind: "timer", initialSeconds: 30 });
      expect(detectCommandWidget("set timer for 2m")).toEqual({ kind: "timer", initialSeconds: 120 });
    });

    it("still matches the original supported phrasing (no 'for')", () => {
      expect(detectCommandWidget("set timer 10 seconds")).toEqual({ kind: "timer", initialSeconds: 10 });
      expect(detectCommandWidget("start timer 2 minutes")).toEqual({ kind: "timer", initialSeconds: 120 });
    });

    it("opens a bare timer widget with no duration when none is given", () => {
      expect(detectCommandWidget("open timer")).toEqual({ kind: "timer", initialSeconds: undefined });
    });
  });

  it("returns null for input matching nothing", () => {
    expect(detectCommandWidget("tell me a joke")).toBeNull();
    expect(detectCommandWidget("")).toBeNull();
  });
});
