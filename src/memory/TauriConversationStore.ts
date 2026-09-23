import type { AIMessage } from "../types/ai";
import type { InvokeFn } from "../orchestrator/TauriMemoryStore";

// ---------------------------------------------------------------------
// Phase 2, items 1/2: real conversation persistence across app restarts.
// Deliberately its OWN class talking to its OWN Rust commands
// (create_conversation/save_message/get_conversation_messages/
// list_conversations/end_conversation) and its OWN `conversations`/
// `messages` tables — never `TauriMemoryStore`'s `memories` table.
// Conversation history (every raw message, for continuity) and
// long-term memory (curated, user-approved facts) are different systems
// with different lifecycles; merging them for convenience was
// explicitly ruled out (item 6).
//
// STATUS: ENVIRONMENT-UNVERIFIED in the same sense every Tauri-dependent
// module in this project is — written against the real Rust command
// signatures in commands.rs/db.rs (verified by reading them, and the
// underlying db.rs logic is compiler-and-test-verified in isolation; see
// PHASE-CONTINUITY.md), but no cargo/Tauri runtime exists in this sandbox
// to execute the actual invoke() round-trip.
// ---------------------------------------------------------------------

export interface ConversationSummary {
  id: string;
  title: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface StoredMessage {
  id: string;
  conversationId: string;
  role: AIMessage["role"];
  content: string;
  createdAt: string;
}

interface RustConversationSummary {
  id: string;
  title: string | null;
  started_at: string;
  ended_at: string | null;
}

interface RustMessageRecord {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  created_at: string;
}

function toConversationSummary(raw: RustConversationSummary): ConversationSummary {
  return { id: raw.id, title: raw.title, startedAt: raw.started_at, endedAt: raw.ended_at };
}

function toStoredMessage(raw: RustMessageRecord): StoredMessage {
  return {
    id: raw.id,
    conversationId: raw.conversation_id,
    role: raw.role as AIMessage["role"],
    content: raw.content,
    createdAt: raw.created_at,
  };
}

export class TauriConversationStore {
  constructor(private invoke: InvokeFn) {}

  async createConversation(title?: string): Promise<string> {
    return this.invoke<string>("create_conversation", { title: title ?? null });
  }

  async saveMessage(conversationId: string, role: AIMessage["role"], content: string): Promise<string> {
    return this.invoke<string>("save_message", { conversationId, role, content });
  }

  async getMessages(conversationId: string): Promise<StoredMessage[]> {
    const raw = await this.invoke<RustMessageRecord[]>("get_conversation_messages", { conversationId });
    return raw.map(toStoredMessage);
  }

  async listConversations(limit = 20): Promise<ConversationSummary[]> {
    const raw = await this.invoke<RustConversationSummary[]>("list_conversations", { limit });
    return raw.map(toConversationSummary);
  }

  async endConversation(conversationId: string): Promise<void> {
    await this.invoke<void>("end_conversation", { conversationId });
  }

  /**
   * Startup convenience: resume the most recently started conversation if
   * one exists (so a restart continues the same thread rather than
   * silently starting a new one every launch), otherwise create a fresh
   * conversation. Never mutates/ends the resumed conversation itself —
   * that decision belongs to the caller.
   */
  async resumeOrCreate(): Promise<{ conversationId: string; messages: StoredMessage[] }> {
    const recent = await this.listConversations(1);
    if (recent.length > 0) {
      const messages = await this.getMessages(recent[0].id);
      return { conversationId: recent[0].id, messages };
    }
    const conversationId = await this.createConversation();
    return { conversationId, messages: [] };
  }
}
