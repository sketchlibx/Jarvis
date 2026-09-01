import type { AIMessage } from "../types/ai";

interface TrackedEntity {
  name: string;
  type: string; // e.g. "project", "file", "application"
  mentionedAt: number; // message index
}

/**
 * Session-scoped context that sits between the raw LLM message history and
 * the UI. Solves "make it red" referring to the project just created,
 * without relying purely on the model inferring it from raw context —
 * we track the last-mentioned entity of each type explicitly.
 */
export class ContextManager {
  private messages: AIMessage[] = [];
  private entities: TrackedEntity[] = [];

  addMessage(msg: AIMessage) {
    this.messages.push(msg);
  }

  /** Call when an action created/referenced a named entity, e.g. a new project. */
  trackEntity(name: string, type: string) {
    this.entities.push({ name, type, mentionedAt: this.messages.length });
  }

  /** Returns the most recently mentioned entity of a given type, if any. */
  lastEntityOfType(type: string): TrackedEntity | undefined {
    for (let i = this.entities.length - 1; i >= 0; i--) {
      if (this.entities[i].type === type) return this.entities[i];
    }
    return undefined;
  }

  /** Returns the single most recently mentioned entity of any type. */
  lastEntity(): TrackedEntity | undefined {
    return this.entities[this.entities.length - 1];
  }

  /**
   * Naive pronoun resolution: if userText contains a bare "it"/"that"/"this"
   * and we have a tracked entity, substitute it in. This runs BEFORE the
   * text goes to the AI, so the AI never has to guess.
   */
  resolvePronouns(userText: string): string {
    const entity = this.lastEntity();
    if (!entity) return userText;
    return userText.replace(/\b(it|that|this)\b/gi, entity.name);
  }

  getHistory(maxMessages = 20): AIMessage[] {
    return this.messages.slice(-maxMessages);
  }

  clear() {
    this.messages = [];
    this.entities = [];
  }
}
