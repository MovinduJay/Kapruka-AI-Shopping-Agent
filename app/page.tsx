"use client";

import { useState } from "react";
import { Send, ShoppingCart, Sparkles } from "lucide-react";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Hi, I’m Kapruka Gift Genius. Tell me who you’re shopping for, your budget, delivery city, and date.",
    },
  ]);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function sendMessage() {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();

    setMessages((prev) => [
      ...prev,
      { role: "user", content: userMessage },
    ]);

    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: userMessage }),
      });

      const data = await res.json();

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            data.reply ||
            data.error ||
            "Sorry, I could not find a good response.",
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Something went wrong. Please try again.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[1fr_380px]">
        <section className="flex flex-col">
          <header className="border-b border-white/10 px-6 py-5">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-emerald-500/20 p-3">
                <Sparkles className="text-emerald-300" size={24} />
              </div>

              <div>
                <h1 className="text-2xl font-bold">Kapruka Gift Genius</h1>
                <p className="text-sm text-slate-400">
                  AI shopping assistant for gifts, cakes, flowers, and delivery in Sri Lanka
                </p>
              </div>
            </div>
          </header>

          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-6">
            {messages.map((message, index) => (
              <div
                key={index}
                className={`flex ${
                  message.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-2xl rounded-2xl px-5 py-4 text-sm leading-6 whitespace-pre-wrap ${
                    message.role === "user"
                      ? "bg-emerald-500 text-white"
                      : "bg-white/10 text-slate-100"
                  }`}
                >
                  {message.content}
                </div>
              </div>
            ))}

            {loading && (
              <div className="max-w-xl rounded-2xl bg-white/10 px-5 py-4 text-sm text-slate-300">
                Searching Kapruka and thinking of the best options...
              </div>
            )}
          </div>

          <div className="border-t border-white/10 p-5">
            <div className="flex gap-3 rounded-2xl bg-white/10 p-3">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") sendMessage();
                }}
                placeholder="Example: Find a birthday gift for my mother under Rs. 8000 deliverable to Kandy tomorrow"
                className="flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-slate-500"
              />

              <button
                onClick={sendMessage}
                disabled={loading}
                className="rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold hover:bg-emerald-400 disabled:opacity-50"
              >
                <Send size={18} />
              </button>
            </div>
          </div>
        </section>

        <aside className="border-l border-white/10 bg-white/[0.03] p-6">
          <div className="flex items-center gap-3">
            <ShoppingCart size={22} />
            <h2 className="text-lg font-semibold">Live Cart</h2>
          </div>

          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5 text-sm text-slate-400">
            Cart items will appear here after we add product cards.
          </div>

          <div className="mt-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5">
            <h3 className="font-semibold text-emerald-300">Try this</h3>
            <p className="mt-2 text-sm text-slate-300">
              Find flowers and cake for an anniversary in Colombo under Rs. 10000.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}