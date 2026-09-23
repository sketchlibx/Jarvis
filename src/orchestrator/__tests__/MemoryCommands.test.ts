import { describe, it, expect } from "vitest";
import { parseMemoryCommand } from "../MemoryCommands";

describe("parseMemoryCommand", () => {
  it("parses a plain remember command", () => {
    expect(parseMemoryCommand("remember I like tea")).toEqual({
      matched: true,
      action: "remember",
      content: "I like tea",
    });
  });

  it("parses 'remember that ...'", () => {
    expect(parseMemoryCommand("remember that my favorite color is blue")).toEqual({
      matched: true,
      action: "remember",
      content: "my favorite color is blue",
    });
  });

  it("parses 'remember this: ...'", () => {
    expect(parseMemoryCommand("remember this: I work at Acme Corp")).toEqual({
      matched: true,
      action: "remember",
      content: "I work at Acme Corp",
    });
  });

  it("parses 'please remember ...'", () => {
    expect(parseMemoryCommand("please remember I have a meeting at 5pm")).toEqual({
      matched: true,
      action: "remember",
      content: "I have a meeting at 5pm",
    });
  });

  it("strips a trailing period", () => {
    expect(parseMemoryCommand("remember I like tea.")).toEqual({
      matched: true,
      action: "remember",
      content: "I like tea",
    });
  });

  it("does not match a bare 'remember this' with no content", () => {
    expect(parseMemoryCommand("remember this")).toEqual({ matched: false });
    expect(parseMemoryCommand("remember that")).toEqual({ matched: false });
  });

  it("parses 'forget this'/'forget that'/'forget it' as forget_last", () => {
    expect(parseMemoryCommand("forget this")).toEqual({ matched: true, action: "forget_last" });
    expect(parseMemoryCommand("forget that")).toEqual({ matched: true, action: "forget_last" });
    expect(parseMemoryCommand("forget it")).toEqual({ matched: true, action: "forget_last" });
    expect(parseMemoryCommand("please forget that.")).toEqual({ matched: true, action: "forget_last" });
  });

  it("parses 'forget <query>' with specific content", () => {
    expect(parseMemoryCommand("forget my favorite color")).toEqual({
      matched: true,
      action: "forget",
      query: "my favorite color",
    });
  });

  it("parses 'forget about <query>'", () => {
    expect(parseMemoryCommand("forget about the meeting")).toEqual({
      matched: true,
      action: "forget",
      query: "the meeting",
    });
  });

  it("does not match ordinary conversation containing the word remember/forget mid-sentence", () => {
    expect(parseMemoryCommand("do you remember what we talked about yesterday?")).toEqual({ matched: false });
    expect(parseMemoryCommand("I always forget where I put my keys")).toEqual({ matched: false });
  });

  it("does not match empty or whitespace-only input", () => {
    expect(parseMemoryCommand("")).toEqual({ matched: false });
    expect(parseMemoryCommand("   ")).toEqual({ matched: false });
  });

  it("does not match unrelated commands", () => {
    expect(parseMemoryCommand("what's the weather today")).toEqual({ matched: false });
    expect(parseMemoryCommand("open settings")).toEqual({ matched: false });
  });
});
