import { describe, it, expect } from "vitest";
import { TauriMemoryStore, type InvokeFn } from "../TauriMemoryStore";
import { MemoryOrchestrator } from "../MemoryOrchestrator";

function mockInvoke(responses: Record<string, unknown>, calls: Array<{ cmd: string; args: unknown }>): InvokeFn {
  return async <T,>(cmd: string, args?: Record<string, unknown>) => {
    calls.push({ cmd, args });
    return responses[cmd] as T;
  };
}

describe("TauriMemoryStore — closes PHASE-CONTINUITY.md gap #1", () => {
  it("propose returns the REAL Rust-assigned id, not a locally-generated one", async () => {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    const invoke = mockInvoke({ add_memory: "rust-generated-uuid-123" }, calls);
    const orchestrator = new MemoryOrchestrator(new TauriMemoryStore(invoke));

    const result = await orchestrator.proposeMemory("User likes coffee", "preference", "user_explicit");
    expect(result.success).toBe(true);
    if (result.success) expect(result.entry.id).toBe("rust-generated-uuid-123");

    const addCall = calls.find((c) => c.cmd === "add_memory");
    expect((addCall?.args as Record<string, unknown>).kind).toBe("preference");
  });

  it("maps category preference/project_context/task_history/conversation_fact to Rust's type values correctly", async () => {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    const invoke = mockInvoke({ add_memory: "id1" }, calls);
    const orchestrator = new MemoryOrchestrator(new TauriMemoryStore(invoke));

    await orchestrator.proposeMemory("a", "project_context", "user_explicit");
    await orchestrator.proposeMemory("b", "task_history", "user_explicit");
    await orchestrator.proposeMemory("c", "conversation_fact", "user_explicit");

    const kinds = calls.filter((c) => c.cmd === "add_memory").map((c) => (c.args as Record<string, unknown>).kind);
    expect(kinds).toEqual(["project", "other", "fact"]);
  });

  it("ai_inferred source maps to unapproved and the correct Rust source string", async () => {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    const invoke = mockInvoke({ add_memory: "id1" }, calls);
    const orchestrator = new MemoryOrchestrator(new TauriMemoryStore(invoke));

    await orchestrator.proposeMemory("User seems interested in Rust", "conversation_fact", "ai_inferred");
    const addCall = calls.find((c) => c.cmd === "add_memory");
    const args = addCall?.args as Record<string, unknown>;
    expect(args.userApproved).toBe(false);
    expect(args.source).toBe("ai_inferred");
  });

  it("maps Rust's Memory shape back to MemoryEntry correctly on retrieval", async () => {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    const invoke = mockInvoke(
      {
        list_memories: [
          { id: "id1", user_id: "default", content: "User likes coffee", type: "preference", source: "user_explicit", confidence: 1.0, importance: 1, created_at: "2026-01-01T00:00:00Z", updated_at: null, user_approved: true },
        ],
      },
      calls
    );
    const orchestrator = new MemoryOrchestrator(new TauriMemoryStore(invoke));

    const results = await orchestrator.retrieveApprovedMemories();
    expect(results).toHaveLength(1);
    expect(results[0].category).toBe("preference");
    expect(results[0].userApproved).toBe(true);
    expect(results[0].content).toBe("User likes coffee");
  });

  it("delete calls forget_memory with the correct id", async () => {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    const invoke = mockInvoke({}, calls);
    const store = new TauriMemoryStore(invoke);
    await store.softDelete("some-id");
    expect(calls).toContainEqual({ cmd: "forget_memory", args: { memoryId: "some-id" } });
  });

  it("adversarial content is still blocked before any invoke call happens", async () => {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    const invoke = mockInvoke({}, calls);
    const orchestrator = new MemoryOrchestrator(new TauriMemoryStore(invoke));

    const result = await orchestrator.proposeMemory("sk-abcdefghijklmnopqrstuv", "preference", "user_explicit");
    expect(result.success).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
