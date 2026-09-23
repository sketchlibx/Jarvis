import { describe, it, expect } from "vitest";
import { TauriConversationStore } from "../TauriConversationStore";
import type { InvokeFn } from "../../orchestrator/TauriMemoryStore";

function mockInvoke(responses: Record<string, unknown>, calls: Array<{ cmd: string; args: unknown }>): InvokeFn {
  return async <T,>(cmd: string, args?: Record<string, unknown>) => {
    calls.push({ cmd, args });
    return responses[cmd] as T;
  };
}

describe("TauriConversationStore — Phase 2 conversation persistence", () => {
  it("createConversation passes title (or null) and returns the real id", async () => {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    const invoke = mockInvoke({ create_conversation: "conv-1" }, calls);
    const store = new TauriConversationStore(invoke);

    const id = await store.createConversation("My chat");
    expect(id).toBe("conv-1");
    expect(calls).toContainEqual({ cmd: "create_conversation", args: { title: "My chat" } });
  });

  it("createConversation with no title sends null, not undefined", async () => {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    const invoke = mockInvoke({ create_conversation: "conv-2" }, calls);
    const store = new TauriConversationStore(invoke);
    await store.createConversation();
    expect(calls).toContainEqual({ cmd: "create_conversation", args: { title: null } });
  });

  it("saveMessage sends conversationId/role/content and returns the message id", async () => {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    const invoke = mockInvoke({ save_message: "msg-1" }, calls);
    const store = new TauriConversationStore(invoke);

    const id = await store.saveMessage("conv-1", "user", "hello there");
    expect(id).toBe("msg-1");
    expect(calls).toContainEqual({
      cmd: "save_message",
      args: { conversationId: "conv-1", role: "user", content: "hello there" },
    });
  });

  it("getMessages maps Rust's snake_case MessageRecord shape to StoredMessage", async () => {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    const invoke = mockInvoke(
      {
        get_conversation_messages: [
          { id: "m1", conversation_id: "conv-1", role: "user", content: "hi", created_at: "2026-01-01T00:00:00Z" },
          { id: "m2", conversation_id: "conv-1", role: "assistant", content: "hello!", created_at: "2026-01-01T00:00:01Z" },
        ],
      },
      calls
    );
    const store = new TauriConversationStore(invoke);

    const messages = await store.getMessages("conv-1");
    expect(messages).toEqual([
      { id: "m1", conversationId: "conv-1", role: "user", content: "hi", createdAt: "2026-01-01T00:00:00Z" },
      { id: "m2", conversationId: "conv-1", role: "assistant", content: "hello!", createdAt: "2026-01-01T00:00:01Z" },
    ]);
  });

  it("listConversations maps Rust's snake_case ConversationSummary shape", async () => {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    const invoke = mockInvoke(
      {
        list_conversations: [
          { id: "conv-1", title: "First", started_at: "2026-01-01T00:00:00Z", ended_at: null },
        ],
      },
      calls
    );
    const store = new TauriConversationStore(invoke);

    const list = await store.listConversations(5);
    expect(list).toEqual([{ id: "conv-1", title: "First", startedAt: "2026-01-01T00:00:00Z", endedAt: null }]);
    expect(calls).toContainEqual({ cmd: "list_conversations", args: { limit: 5 } });
  });

  it("endConversation calls end_conversation with the id", async () => {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    const invoke = mockInvoke({}, calls);
    const store = new TauriConversationStore(invoke);
    await store.endConversation("conv-1");
    expect(calls).toContainEqual({ cmd: "end_conversation", args: { conversationId: "conv-1" } });
  });

  it("resumeOrCreate resumes the most recent conversation with its messages when one exists", async () => {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    const invoke = mockInvoke(
      {
        list_conversations: [{ id: "conv-old", title: null, started_at: "2026-01-01T00:00:00Z", ended_at: null }],
        get_conversation_messages: [
          { id: "m1", conversation_id: "conv-old", role: "user", content: "hi", created_at: "2026-01-01T00:00:00Z" },
        ],
      },
      calls
    );
    const store = new TauriConversationStore(invoke);

    const result = await store.resumeOrCreate();
    expect(result.conversationId).toBe("conv-old");
    expect(result.messages).toHaveLength(1);
    expect(calls.some((c) => c.cmd === "create_conversation")).toBe(false);
  });

  it("resumeOrCreate creates a fresh conversation when none exist", async () => {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    const invoke = mockInvoke({ list_conversations: [], create_conversation: "conv-new" }, calls);
    const store = new TauriConversationStore(invoke);

    const result = await store.resumeOrCreate();
    expect(result.conversationId).toBe("conv-new");
    expect(result.messages).toEqual([]);
    expect(calls.some((c) => c.cmd === "get_conversation_messages")).toBe(false);
  });

  it("propagates a save failure rather than swallowing it — callers rely on this to detect persistence failure and fall back to session-only behavior", async () => {
    const invoke: InvokeFn = async () => {
      throw new Error("disk full");
    };
    const store = new TauriConversationStore(invoke);
    await expect(store.saveMessage("conv-1", "user", "hi")).rejects.toThrow("disk full");
  });

  it("propagates a resumeOrCreate failure so a startup caller can fall back to an in-memory-only session", async () => {
    const invoke: InvokeFn = async () => {
      throw new Error("keychain unavailable");
    };
    const store = new TauriConversationStore(invoke);
    await expect(store.resumeOrCreate()).rejects.toThrow("keychain unavailable");
  });
});
