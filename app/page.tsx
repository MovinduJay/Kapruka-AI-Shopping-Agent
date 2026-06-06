"use client";

import { useState } from "react";
import { Send, ShoppingCart, Sparkles, Trash2 } from "lucide-react";
import { ProductCard } from "@/components/products/ProductCard";
import type { ProductCard as ProductCardType } from "@/types/product";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  products?: ProductCardType[];
};

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Hi, I’m Kapruka AI Concierge. Tell me who you’re shopping for, your budget, delivery city, and date.",
    },
  ]);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [cart, setCart] = useState<ProductCardType[]>([]);

  function addToCart(product: ProductCardType) {
    setCart((prev) => {
      const exists = prev.some((item) => item.id === product.id);

      if (exists) return prev;

      return [...prev, product];
    });
  }

  function removeFromCart(productId: string) {
    setCart((prev) => prev.filter((item) => item.id !== productId));
  }

  async function sendMessage() {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();

    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: userMessage,
      },
    ]);

    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: userMessage,
        }),
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
          products: data.products || [],
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

  const cartTotal = cart.reduce(
    (total, item) => total + (item.price || 0),
    0
  );

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[1fr_390px]">
        <section className="flex flex-col">
          <header className="border-b border-white/10 px-6 py-5">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-emerald-500/20 p-3">
                <Sparkles className="text-emerald-300" size={24} />
              </div>

              <div>
                <h1 className="text-2xl font-bold">
                  Kapruka AI Concierge
                </h1>
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
                <div className="max-w-5xl">
                  <div
                    className={`max-w-2xl whitespace-pre-wrap rounded-2xl px-5 py-4 text-sm leading-6 ${
                      message.role === "user"
                        ? "bg-emerald-500 text-white"
                        : "bg-white/10 text-slate-100"
                    }`}
                  >
                    {message.content}
                  </div>

                  {message.role === "assistant" &&
                    message.products &&
                    message.products.length > 0 && (
                      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        {message.products.map((product) => (
                          <ProductCard
                            key={product.id}
                            product={product}
                            onAddToCart={addToCart}
                          />
                        ))}
                      </div>
                    )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="max-w-xl rounded-2xl bg-white/10 px-5 py-4 text-sm text-slate-300">
                Searching Kapruka and finding the best options...
              </div>
            )}
          </div>

          <div className="border-t border-white/10 p-5">
            <div className="flex gap-3 rounded-2xl bg-white/10 p-3">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    sendMessage();
                  }
                }}
                placeholder="Example: Amma ge birthday ekata Rs 8000ta gift ekak one Kandy walata"
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

          <div className="mt-6 space-y-3">
            {cart.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-sm text-slate-400">
                Cart items will appear here after you add a product.
              </div>
            ) : (
              <>
                {cart.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-white/10 bg-white/5 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-white">
                          {item.name}
                        </h3>
                        <p className="mt-1 text-sm font-bold text-emerald-300">
                          Rs. {item.price?.toLocaleString() ?? "N/A"}
                        </p>
                      </div>

                      <button
                        onClick={() => removeFromCart(item.id)}
                        className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))}

                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                  <p className="text-sm text-slate-300">Cart total</p>
                  <p className="mt-1 text-2xl font-bold text-emerald-300">
                    Rs. {cartTotal.toLocaleString()}
                  </p>

                  <button className="mt-4 w-full rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-400">
                    Continue to delivery
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="mt-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5">
            <h3 className="font-semibold text-emerald-300">Try this</h3>
            <p className="mt-2 text-sm text-slate-300">
              Amma ge birthday ekata Rs 8000ta gift ekak one Kandy walata
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}