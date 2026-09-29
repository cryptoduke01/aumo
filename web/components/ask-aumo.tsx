"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { AnimatePresence, motion } from "motion/react";
import { ask } from "@/lib/agent";
import { AumoMark } from "./mark";
import { Orb } from "./orb";

type Msg = { role: "user" | "agent"; text: string };

const SUGGESTIONS = [
  "Why this allocation?",
  "What's your read on the venues?",
  "What would make you go defensive?",
  "How do the guardrails protect me?",
];

// The agent answers in light markdown (**bold**). Render the bold and drop the raw asterisks so
// the chat reads clean instead of showing literal ** around venue names.
function renderRich(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} className="font-medium text-foreground">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

// Ask Aumo as its own surface: a panel that slides in from the right over whatever page you are on,
// so a question never costs you your place. It stays mounted while closed, so the conversation is
// still there when you open it again.
export function AskAumoPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const { address } = useAccount();
  const threadRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => inputRef.current?.focus(), 120);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      clearTimeout(t);
    };
  }, [open, onClose]);

  const send = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: question }]);
    setBusy(true);
    const toEnd = () =>
      requestAnimationFrame(() => threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" }));
    toEnd();
    try {
      const answer = await ask(question, address);
      setOffline(false);
      setMessages((m) => [...m, { role: "agent", text: answer || "I don't have an answer for that from my current state." }]);
    } catch {
      setOffline(true);
      setMessages((m) => [...m, { role: "agent", text: "My reasoning layer is offline right now. Try again in a moment." }]);
    } finally {
      setBusy(false);
      toEnd();
    }
  };

  const suggestions = address ? ["What's my position?", ...SUGGESTIONS] : SUGGESTIONS;

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="ask"
          className="fixed inset-0 z-[60]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <div className="absolute inset-0 bg-black/55 backdrop-blur-[3px]" onClick={onClose} aria-hidden />

          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label="Ask Aumo"
            className="absolute inset-y-0 right-0 flex w-full flex-col border-l border-border bg-card sm:w-[28rem]"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 340, damping: 36 }}
          >
            {/* header */}
            <div className="flex items-center gap-3 border-b border-border px-5 py-4">
              <span className="relative inline-flex size-9 items-center justify-center">
                <Orb className="size-9 text-primary/30" />
                <AumoMark className="absolute size-4 text-primary" />
              </span>
              <div className="flex flex-col">
                <span className="text-[0.95rem] font-medium leading-none">Ask Aumo</span>
                <span className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className={`size-1.5 rounded-full ${offline ? "bg-faint" : "bg-primary"}`} />
                  {offline ? "Agent offline" : "The agent managing the treasury"}
                </span>
              </div>
              <div className="ml-auto flex items-center gap-1">
                {messages.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setMessages([])}
                    className="rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                  >
                    New chat
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                >
                  <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
                    <path d="m5 5 10 10M15 5 5 15" />
                  </svg>
                </button>
              </div>
            </div>

            {/* thread */}
            <div ref={threadRef} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-6">
              {messages.length === 0 ? (
                <div className="flex flex-1 flex-col justify-end gap-6">
                  <div className="flex flex-col gap-2">
                    <span className="text-[1.6rem] font-medium leading-[1.05] tracking-[-0.02em]">
                      Ask me why I did what I did.
                    </span>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      I read the venues every cycle and decide whether to move or hold. Ask about a move, how I
                      score a venue, or what would change my mind.
                    </p>
                  </div>
                  <div className="flex flex-col overflow-hidden rounded-xl border border-border">
                    {suggestions.map((s) => (
                      <button
                        key={s}
                        onClick={() => send(s)}
                        className="group flex items-center justify-between gap-3 border-b border-border px-4 py-3 text-left text-sm text-muted-foreground transition-colors last:border-b-0 hover:bg-surface-2 hover:text-foreground"
                      >
                        {s}
                        <svg viewBox="0 0 16 16" className="size-3.5 shrink-0 text-faint transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-primary" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M3 8h10M9 4l4 4-4 4" />
                        </svg>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <AnimatePresence initial={false}>
                  {messages.map((m, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, ease: [0.2, 0.7, 0.2, 1] }}
                      className={m.role === "user" ? "flex justify-end" : "flex items-start gap-3"}
                    >
                      {m.role === "agent" ? (
                        <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center">
                          <AumoMark className="size-4 text-primary" />
                        </span>
                      ) : null}
                      <p
                        className={
                          m.role === "user"
                            ? "max-w-[85%] rounded-xl rounded-br-sm bg-surface-2 px-3.5 py-2 text-sm text-foreground"
                            : "max-w-[90%] whitespace-pre-line text-sm leading-relaxed text-foreground/90"
                        }
                      >
                        {m.role === "agent" ? renderRich(m.text) : m.text}
                      </p>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
              {busy ? (
                <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
                  <Orb className="size-5 text-primary" /> Aumo is thinking…
                </div>
              ) : null}
            </div>

            {/* input */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
              className="flex items-center gap-2 border-t border-border p-3"
            >
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask the agent anything"
                className="field-input min-w-0 flex-1 bg-transparent px-2.5 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
                aria-label="Ask Aumo a question"
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                className="chamfer inline-flex items-center bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-[transform,opacity] hover:opacity-90 active:scale-[0.98] disabled:opacity-40"
                style={{ ["--cut" as string]: "8px" }}
              >
                Ask
              </button>
            </form>
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
