"use client";

import { useRef, useState } from "react";
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

function MicIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
      <rect x="7.5" y="2.5" width="5" height="9" rx="2.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4.5 9a5.5 5.5 0 0 0 11 0M10 14.5V17M7.5 17h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function WaveIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
      <path d="M4 8v4M7 6v8M10 4v12M13 7v6M16 9v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function AskAumo({ className = "" }: { className?: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const threadRef = useRef<HTMLDivElement | null>(null);

  const send = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: question }]);
    setBusy(true);
    try {
      const answer = await ask(question);
      setMessages((m) => [...m, { role: "agent", text: answer || "I don't have an answer for that from my current state." }]);
    } catch {
      setMessages((m) => [...m, { role: "agent", text: "My reasoning layer is offline right now. Try again in a moment." }]);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" }));
    }
  };

  return (
    <section className={`chamfer-edge ${className}`}>
      <div className="chamfer bg-card">
        {/* header */}
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <span className="relative inline-flex size-8 items-center justify-center">
            <Orb className="size-8 text-primary/30" />
            <AumoMark className="absolute size-3.5 text-primary" />
          </span>
          <div className="flex flex-col">
            <span className="text-sm font-medium leading-none">Ask Aumo</span>
            <span className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="size-1.5 rounded-full bg-primary" /> Agent online
            </span>
          </div>
          <button
            type="button"
            disabled
            title="Voice replies coming soon"
            className="ml-auto inline-flex size-8 cursor-not-allowed items-center justify-center rounded-lg border border-border text-faint opacity-60"
          >
            <WaveIcon className="size-4" />
          </button>
        </div>

        {/* thread */}
        <div ref={threadRef} className="flex max-h-[22rem] flex-col gap-4 overflow-y-auto px-5 py-5">
          {messages.length === 0 ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                I&apos;m the agent managing this vault. Ask me why I made a move, how I score a venue,
                or what would change my mind.
              </p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                  >
                    {s}
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
                  className={m.role === "user" ? "flex justify-end" : "flex items-start gap-2.5"}
                >
                  {m.role === "agent" ? (
                    <span className="relative mt-0.5 inline-flex size-5 shrink-0 items-center justify-center">
                      <AumoMark className="size-4 text-primary" />
                    </span>
                  ) : null}
                  <p
                    className={
                      m.role === "user"
                        ? "max-w-[85%] rounded-lg rounded-br-sm bg-surface-2 px-3.5 py-2 text-sm text-foreground"
                        : "max-w-[85%] text-sm leading-relaxed text-foreground/90"
                    }
                  >
                    {m.text}
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
          className="flex items-center gap-2 border-t border-border p-2.5"
        >
          <button
            type="button"
            disabled
            title="Voice input coming soon"
            className="inline-flex size-9 shrink-0 cursor-not-allowed items-center justify-center rounded-lg border border-border text-faint opacity-60"
          >
            <MicIcon className="size-4" />
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask the agent anything…"
            className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground"
            aria-label="Ask Aumo a question"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="chamfer inline-flex items-center bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-[transform,opacity] hover:opacity-90 active:scale-[0.98] disabled:opacity-40"
            style={{ ["--cut" as string]: "8px" }}
          >
            Ask
          </button>
        </form>
      </div>
    </section>
  );
}
