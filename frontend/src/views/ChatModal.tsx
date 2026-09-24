import React, { useState, useRef, useEffect } from "react";
import { BotMessage, answerFor, SUGGESTED_QUESTIONS } from "../knowledge";
import { chatWithAssistant } from "../api";

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(<strong key={`b-${match.index}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`") && token.endsWith("`")) {
      parts.push(<code key={`c-${match.index}`} className="chat-inline-code">{token.slice(1, -1)}</code>);
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }
  return parts.length > 0 ? parts : [text];
}

function renderFormattedText(text: string) {
  if (!text) return null;
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];

  lines.forEach((line, i) => {
    if (line.trim().startsWith("```")) {
      if (inCodeBlock) {
        elements.push(
          <pre key={`code-${i}`} className="chat-code-block">
            <code>{codeBlockLines.join("\n")}</code>
          </pre>
        );
        codeBlockLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      return;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      return;
    }

    if (line.startsWith("### ")) {
      elements.push(<h4 key={`h3-${i}`} className="chat-heading chat-heading--3">{renderInline(line.slice(4))}</h4>);
    } else if (line.startsWith("#### ")) {
      elements.push(<h5 key={`h4-${i}`} className="chat-heading chat-heading--4">{renderInline(line.slice(5))}</h5>);
    } else if (line.startsWith("## ")) {
      elements.push(<h3 key={`h2-${i}`} className="chat-heading chat-heading--2">{renderInline(line.slice(3))}</h3>);
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <div key={`li-${i}`} className="chat-list-item">
          <span className="chat-list-bullet">•</span>
          <span>{renderInline(line.slice(2))}</span>
        </div>
      );
    } else if (/^\d+\.\s/.test(line)) {
      const match = line.match(/^(\d+\.)\s(.*)$/);
      if (match) {
        elements.push(
          <div key={`nli-${i}`} className="chat-list-item">
            <span className="chat-list-number">{match[1]}</span>
            <span>{renderInline(match[2])}</span>
          </div>
        );
      } else {
        elements.push(<p key={`p-${i}`} className="chat-paragraph">{renderInline(line)}</p>);
      }
    } else if (line.trim() === "---") {
      elements.push(<hr key={`hr-${i}`} className="chat-divider" />);
    } else if (line.trim() === "") {
      elements.push(<div key={`sp-${i}`} style={{ height: "6px" }} />);
    } else {
      elements.push(<p key={`p-${i}`} className="chat-paragraph">{renderInline(line)}</p>);
    }
  });

  if (inCodeBlock && codeBlockLines.length > 0) {
    elements.push(
      <pre key="code-end" className="chat-code-block">
        <code>{codeBlockLines.join("\n")}</code>
      </pre>
    );
  }

  return elements;
}

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
                <div className="chat-bubble__text">
                  {renderFormattedText(m.text)}
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
    <button
      type="button"
      className="floating-chat-trigger"
      onClick={onClick}
      title="Ask AI Assistant"
      aria-label="Open AI Assistant Chat"
    >
      <svg
        className="floating-chat-trigger__svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" fill="currentColor" fillOpacity="0.16" />
        <line x1="8" y1="9" x2="16" y2="9" />
        <line x1="8" y1="13" x2="13" y2="13" />
      </svg>
      <span className="floating-chat-trigger__dot" aria-hidden="true" />
    </button>
  );
}
