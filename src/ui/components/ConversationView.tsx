import React, { useEffect, useRef } from "react";
import type { AIMessage } from "../../types/ai";

export function ConversationView({ messages }: { messages: AIMessage[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  return (
    <div className="glass-panel conversation">
      {messages.length === 0 && (
        <div style={{ color: "var(--text-muted)", fontSize: 13, margin: "auto" }}>
          Say something, or type below to begin.
        </div>
      )}
      {messages
        .filter((m) => m.role !== "system")
        .map((m, i) => (
          <div key={i} className={`bubble bubble--${m.role === "user" ? "user" : "assistant"}`}>
            {m.content}
          </div>
        ))}
      <div ref={bottomRef} />
    </div>
  );
}
