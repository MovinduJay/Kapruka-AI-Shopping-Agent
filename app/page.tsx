"use client";

import { useState } from "react";
import {
  Send,
  ShoppingCart,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  LocationPrompt,
  type SharedLocation,
} from "@/components/chat/LocationPrompt";
import { WelcomeScreen } from "@/components/chat/WelcomeScreen";
import { DeliveryPanel } from "@/components/delivery/DeliveryPanel";
import { ProductCarousel } from "@/components/products/ProductCarousel";
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
        "Hi, I’m Kapruka AI Concierge. Tell me what you need, your budget, and any important preferences like brand, size, or delivery city.",
    },
  ]);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [cart, setCart] = useState<ProductCardType[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [deliveryPanelOpen, setDeliveryPanelOpen] = useState(false);
  const [sharedLocation, setSharedLocation] =
    useState<SharedLocation | null>(null);

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

  async function sendMessage(message?: string) {
    const userMessage = (message ?? input).trim();

    if (!userMessage || loading) return;

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
          location: sharedLocation,
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
  const isWelcome =
    !loading && !messages.some((message) => message.role === "user");

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="flex min-h-screen min-w-0 flex-col">
        <header className="border-b border-white/10 px-4 py-4 sm:px-6">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="shrink-0 rounded-2xl bg-emerald-500/20 p-3">
                <Sparkles className="text-emerald-300" size={24} />
              </div>

              <div className="min-w-0">
                <h1 className="text-xl font-bold sm:text-2xl">
                  Kapruka AI Concierge
                </h1>
                <p className="hidden text-sm text-slate-400 sm:block">
                  Electronics, groceries, fashion, home, gifts, and more
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setCartOpen(true)}
              aria-label={`Open cart with ${cart.length} items`}
              className="relative flex shrink-0 items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-3.5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              <ShoppingCart size={21} />
              <span className="hidden sm:inline">Cart</span>
              {cart.length > 0 && (
                <span className="absolute -right-2 -top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-xs font-bold text-white">
                  {cart.length}
                </span>
              )}
            </button>
          </div>
        </header>

        {isWelcome ? (
          <WelcomeScreen
            input={input}
            onInputChange={setInput}
            onSubmit={sendMessage}
          />
        ) : (
          <>
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 sm:px-6">
            {messages.map((message, index) => (
              <div
                key={index}
                className={`flex ${
                  message.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={
                    message.products && message.products.length > 0
                      ? "w-full min-w-0"
                      : "max-w-5xl"
                  }
                >
                  <div
                    className={`w-fit max-w-2xl whitespace-pre-wrap px-5 py-3 text-sm leading-6 shadow-sm ${
                      message.role === "user"
                        ? "ml-auto rounded-[28px] rounded-br-md bg-emerald-500 text-white"
                        : "rounded-[28px] rounded-bl-md border border-white/[0.06] bg-slate-800 text-slate-100"
                    }`}
                  >
                    {message.content}
                  </div>

                  {message.role === "assistant" &&
                    message.products &&
                    message.products.length > 0 && (
                      <ProductCarousel
                        products={message.products}
                        onAddToCart={addToCart}
                      />
                    )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="w-fit max-w-xl rounded-[28px] rounded-bl-md border border-white/[0.06] bg-slate-800 px-5 py-3 text-sm text-slate-300 shadow-sm">
                Searching Kapruka and finding the best options...
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-white/10 px-4 py-4 sm:px-6">
          <div className="mx-auto w-full max-w-3xl space-y-3">
            {!loading &&
              messages.some((message) => message.role === "user") && (
                <LocationPrompt
                  location={sharedLocation}
                  onLocationShared={setSharedLocation}
                />
              )}

            <div className="flex gap-2 rounded-2xl bg-white/10 p-2.5">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    sendMessage();
                  }
                }}
                placeholder="Search products, compare options, or describe what you need"
                className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-slate-500"
              />

              <button
                type="button"
                onClick={() => sendMessage()}
                disabled={loading}
                aria-label="Send message"
                className="rounded-xl bg-emerald-500 px-3.5 py-2.5 text-sm font-semibold hover:bg-emerald-400 disabled:opacity-50"
              >
                <Send size={18} />
              </button>
            </div>
          </div>
        </div>
          </>
        )}
      </section>

      {cartOpen && (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/75 backdrop-blur-sm">
          <button
            type="button"
            aria-label="Close cart"
            onClick={() => setCartOpen(false)}
            className="absolute inset-0 cursor-default"
          />

          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="cart-title"
            className="relative flex h-full w-full max-w-sm flex-col border-l border-white/10 bg-slate-950 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-white/10 p-6">
              <div className="flex items-center gap-3">
                <ShoppingCart size={22} />
                <h2 id="cart-title" className="text-lg font-semibold">
                  Live Cart
                </h2>
              </div>

              <button
                type="button"
                onClick={() => setCartOpen(false)}
                aria-label="Close cart"
                className="rounded-xl p-2 text-slate-400 transition hover:bg-white/10 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-6">
              {cart.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-sm text-slate-400">
                  Cart items will appear here after you add a product.
                </div>
              ) : (
                cart.map((item) => (
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
                        type="button"
                        onClick={() => removeFromCart(item.id)}
                        aria-label={`Remove ${item.name} from cart`}
                        className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {cart.length > 0 && (
              <div className="border-t border-white/10 p-6">
                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                  <p className="text-sm text-slate-300">Cart total</p>
                  <p className="mt-1 text-2xl font-bold text-emerald-300">
                    Rs. {cartTotal.toLocaleString()}
                  </p>

                  <button
                    type="button"
                    onClick={() => {
                      setCartOpen(false);
                      setDeliveryPanelOpen(true);
                    }}
                    className="mt-4 w-full rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-400"
                  >
                    Continue to delivery
                  </button>
                </div>
              </div>
            )}
          </aside>
        </div>
      )}

      <DeliveryPanel
        open={deliveryPanelOpen}
        productId={cart[0]?.id}
        onClose={() => setDeliveryPanelOpen(false)}
      />
    </main>
  );
}
