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
    <section className={`rounded-lg border border-border bg-card ${className}`}>
      <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
        <AumoMark className="size-4 text-primary" />
        <span className="text-sm font-medium">Ask Aumo</span>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="size-1.5 rounded-full bg-primary" /> Agent
        </span>
      </div>

      <div ref={threadRef} className="flex max-h-[22rem] flex-col gap-4 overflow-y-auto px-5 py-5">
        {messages.length === 0 ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              I&apos;m the agent managing this vault. Ask me why I made a move, how I score a venue, or
              what would change my mind.
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
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
                {m.role === "agent" ? <AumoMark className="mt-0.5 size-4 shrink-0 text-primary" /> : null}
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
            <Orb className="size-4 text-primary" /> Aumo is thinking…
          </div>
        ) : null}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex items-center gap-2 border-t border-border p-2.5"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the agent anything…"
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
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
    </section>
  );
}
