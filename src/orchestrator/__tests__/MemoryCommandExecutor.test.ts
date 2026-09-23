import { describe, it, expect } from "vitest";
import { executeMemoryCommand, buildMemoryContextBlock } from "../MemoryCommandExecutor";
import { MemoryOrchestrator, InMemoryMemoryStore } from "../MemoryOrchestrator";
import type { MemoryEntry } from "../MemoryGuard";

function entry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: "id",
    category: "conversation_fact",
    content: "content",
    createdAt: new Date().toISOString(),
    userApproved: true,
    ...overrides,
  };
}

describe("executeMemoryCommand — remember", () => {
  it("stores a new approved memory and reports success", async () => {
    const orchestrator = new MemoryOrchestrator(new InMemoryMemoryStore());
    const outcome = await executeMemoryCommand({ matched: true, action: "remember", content: "I like tea" }, orchestrator);
    expect(outcome.reply).toMatch(/remember/i);
    expect(outcome.added?.content).toBe("I like tea");
    expect(outcome.added?.userApproved).toBe(true);

    const approved = await orchestrator.retrieveApprovedMemories();
    expect(approved.map((m) => m.content)).toContain("I like tea");
  });

  it("is rejected by MemoryGuard for secret-shaped content, and nothing is stored", async () => {
    const orchestrator = new MemoryOrchestrator(new InMemoryMemoryStore());
    const outcome = await executeMemoryCommand(
      { matched: true, action: "remember", content: "sk-abcdefghijklmnopqrstuv" },
      orchestrator
    );
    expect(outcome.rejected).toBe(true);
    expect(outcome.added).toBeUndefined();
    expect(await orchestrator.retrieveApprovedMemories()).toHaveLength(0);
  });
});

describe("executeMemoryCommand — forget_last", () => {
  it("deletes the most recently created approved memory", async () => {
    const orchestrator = new MemoryOrchestrator(new InMemoryMemoryStore());
    await orchestrator.proposeMemory("older fact", "conversation_fact", "user_explicit");
    await new Promise((r) => setTimeout(r, 2));
    const second = await orchestrator.proposeMemory("newer fact", "conversation_fact", "user_explicit");

    const outcome = await executeMemoryCommand({ matched: true, action: "forget_last" }, orchestrator);
    expect(outcome.removedIds).toEqual([second.success ? second.entry.id : ""]);

    const remaining = await orchestrator.retrieveApprovedMemories();
    expect(remaining.map((m) => m.content)).toEqual(["older fact"]);
  });

  it("reports nothing to forget when there are no approved memories", async () => {
    const orchestrator = new MemoryOrchestrator(new InMemoryMemoryStore());
    const outcome = await executeMemoryCommand({ matched: true, action: "forget_last" }, orchestrator);
    expect(outcome.reply).toMatch(/anything recent/i);
    expect(outcome.removedIds).toBeUndefined();
  });
});

describe("executeMemoryCommand — forget with query", () => {
  it("deletes every approved memory matching the query substring, case-insensitively", async () => {
    const orchestrator = new MemoryOrchestrator(new InMemoryMemoryStore());
    await orchestrator.proposeMemory("likes Bubble Tea", "conversation_fact", "user_explicit");
    await orchestrator.proposeMemory("works as a nurse", "conversation_fact", "user_explicit");

    const outcome = await executeMemoryCommand({ matched: true, action: "forget", query: "bubble" }, orchestrator);
    expect(outcome.removedIds).toHaveLength(1);

    const remaining = await orchestrator.retrieveApprovedMemories();
    expect(remaining.map((m) => m.content)).toEqual(["works as a nurse"]);
  });

  it("deletes multiple matches and pluralizes the reply", async () => {
    const orchestrator = new MemoryOrchestrator(new InMemoryMemoryStore());
    await orchestrator.proposeMemory("loves pizza", "conversation_fact", "user_explicit");
    await orchestrator.proposeMemory("loves pasta", "conversation_fact", "user_explicit");

    const outcome = await executeMemoryCommand({ matched: true, action: "forget", query: "loves" }, orchestrator);
    expect(outcome.removedIds).toHaveLength(2);
    expect(outcome.reply).toMatch(/2 things/);
  });

  it("reports no match without deleting anything when the query matches nothing", async () => {
    const orchestrator = new MemoryOrchestrator(new InMemoryMemoryStore());
    await orchestrator.proposeMemory("likes tea", "conversation_fact", "user_explicit");
    const outcome = await executeMemoryCommand({ matched: true, action: "forget", query: "coffee" }, orchestrator);
    expect(outcome.removedIds).toBeUndefined();
    expect(await orchestrator.retrieveApprovedMemories()).toHaveLength(1);
  });

  it("never touches an unapproved (ai_inferred) memory", async () => {
    const orchestrator = new MemoryOrchestrator(new InMemoryMemoryStore());
    await orchestrator.proposeMemory("ai guessed this about tea", "conversation_fact", "ai_inferred");
    const outcome = await executeMemoryCommand({ matched: true, action: "forget", query: "tea" }, orchestrator);
    expect(outcome.reply).toMatch(/don't have anything/i);
  });
});

describe("buildMemoryContextBlock", () => {
  it("returns an empty string for no memories", () => {
    expect(buildMemoryContextBlock([])).toBe("");
  });

  it("includes each memory's content as a bullet", () => {
    const block = buildMemoryContextBlock([entry({ content: "likes tea" }), entry({ content: "works as a nurse" })]);
    expect(block).toContain("- likes tea");
    expect(block).toContain("- works as a nurse");
    expect(block).toContain("approved long-term memory");
  });

  it("caps the number of entries injected", () => {
    const many = Array.from({ length: 30 }, (_, i) => entry({ id: `id${i}`, content: `fact ${i}` }));
    const block = buildMemoryContextBlock(many, 5);
    expect((block.match(/^- /gm) ?? []).length).toBe(5);
  });

  it("truncates an overly long entry", () => {
    const block = buildMemoryContextBlock([entry({ content: "x".repeat(500) })], 20, 50);
    expect(block).toContain("…");
    expect(block.length).toBeLessThan(600);
  });
});
