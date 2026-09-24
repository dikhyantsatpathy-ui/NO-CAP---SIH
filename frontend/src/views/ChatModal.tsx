import React, { useState, useRef, useEffect } from "react";
import { BotMessage, answerFor, SUGGESTED_QUESTIONS } from "../knowledge";
import { chatWithAssistant } from "../api";

interface ChatModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ChatModal({ isOpen, onClose }: ChatModalProps) {
  const [messages, setMessages] = useState<BotMessage[]>([
    {
      role: "bot",
      text: "👋 Welcome! I am your technical oracle for the **SSB Border Screening Console (SIH26188)**.\n\nI have full visibility over the entire project architecture, the 4-Module Forensic Pipeline, Zero-Storage DPDP Act compliance, BSA 2023 Section 65B legal admissibility, checkpoint operations, and source code.\n\nAsk me anything or tap one of the suggested topics below!",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  if (!isOpen) return null;

  const handleSend = async (textToSend?: string) => {
    const q = (textToSend || input).trim();
    if (!q || loading) return;

    const userMsg: BotMessage = { role: "user", text: q };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      // 1. Try online Gemini / Codebase RAG API
      const history = messages.map((m) => ({ role: m.role, text: m.text }));
      const res = await chatWithAssistant(q, history);
      if (res && res.ok && res.answer) {
        setMessages((prev) => [...prev, { role: "bot", text: res.answer! }]);
        setLoading(false);
        return;
      }
    } catch {
      // Fallback to offline curated knowledge base
    }

    // 2. Offline / Local fallback with 100% authoritative answers
    const localAnswer = answerFor(q);
    setMessages((prev) => [...prev, { role: "bot", text: localAnswer }]);
    setLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat-modal-overlay" onClick={onClose}>
      <div className="chat-modal-window" onClick={(e) => e.stopPropagation()}>
        <div className="chat-modal-header">
          <div className="chat-modal-header__brand">
            <div className="chat-modal-avatar">🤖</div>
            <div>
              <div className="chat-modal-title">AI Assistant · Border Tech Oracle</div>
              <div className="chat-modal-sub">SIH26188 Architecture &amp; System Knowledge Base</div>
            </div>
          </div>
          <button className="chat-modal-close" onClick={onClose} aria-label="Close Chat">
            ✕
          </button>
        </div>

        <div className="chat-modal-chips">
          {SUGGESTED_QUESTIONS.slice(0, 4).map((sq, i) => (
            <button key={i} className="chat-chip" onClick={() => handleSend(sq)}>
              {sq}
            </button>
          ))}
        </div>

        <div className="chat-modal-body" ref={scrollRef}>
          {messages.map((m, idx) => (
            <div key={idx} className={`chat-bubble chat-bubble--${m.role}`}>
              <div className="chat-bubble__avatar">{m.role === "bot" ? "🤖" : "👤"}</div>
              <div className="chat-bubble__content">
                <div className="chat-bubble__text" style={{ whiteSpace: "pre-wrap" }}>
                  {m.text}
                </div>
              </div>
            </div>
          ))}
          {loading && (
            <div className="chat-bubble chat-bubble--bot">
              <div className="chat-bubble__avatar">🤖</div>
              <div className="chat-bubble__content">
                <div className="chat-bubble__loading">
                  <span>●</span>
                  <span>●</span>
                  <span>●</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="chat-modal-footer">
          <input
            type="text"
            className="chat-modal-input"
            placeholder="Ask anything about the pipeline, forensics, zero-storage, or code..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          <button
            className="chat-modal-send btn btn--primary"
            onClick={() => handleSend()}
            disabled={!input.trim() || loading}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

export function FloatingChatTrigger({ onClick }: { onClick: () => void }) {
  return (
    <button className="floating-chat-trigger" onClick={onClick} title="Open AI Project Assistant">
      <span className="floating-chat-trigger__icon">💬</span>
      <span className="floating-chat-trigger__label">AI Assistant</span>
      <span className="floating-chat-trigger__badge">SIH Oracle</span>
    </button>
  );
}
