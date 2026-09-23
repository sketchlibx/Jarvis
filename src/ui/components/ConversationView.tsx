import { useEffect, useRef } from "react";
import type { AIMessage } from "../../types/ai";

interface Props {
  messages: AIMessage[];
  /** Real JarvisState-derived flag (state === "THINKING") — not a fake
   * "typing…" simulation. See App.tsx's stateMachine wiring. */
  isThinking?: boolean;
}

export function ConversationView({ messages, isThinking }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isThinking]);

  return (
    <div className="glass-panel conversation">
      {messages.length === 0 && !isThinking && (
        <div className="conversation__empty">Say something, or type below to begin.</div>
      )}
      {messages
        .filter((m) => m.role !== "system")
        .map((m, i) => (
          <div key={i} className={`bubble bubble--${m.role === "user" ? "user" : "assistant"}`}>
            {m.content}
          </div>
        ))}
      {isThinking && (
        <div className="bubble bubble--assistant bubble--thinking" aria-live="polite">
          <span className="thinking-dot" /><span className="thinking-dot" /><span className="thinking-dot" />
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
