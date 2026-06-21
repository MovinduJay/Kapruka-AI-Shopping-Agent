"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Copy,
  Pencil,
  Moon,
  Send,
  ShoppingCart,
  Sparkles,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import {
  LocationPrompt,
  type SharedLocation,
} from "@/components/chat/LocationPrompt";
import { SearchProgress } from "@/components/chat/SearchProgress";
import { WelcomeScreen } from "@/components/chat/WelcomeScreen";
import { CheckoutPanel } from "@/components/checkout/CheckoutPanel";
import {
  DeliveryPanel,
  type DeliveryResult,
} from "@/components/delivery/DeliveryPanel";
import { ProductCarousel } from "@/components/products/ProductCarousel";
import { ProductDetailPanel } from "@/components/products/ProductDetailPanel";
import type {
  AgentChatResponse,
  AgentMemory,
  AgentState,
} from "@/types/agent";
import type { ProductCard as ProductCardType } from "@/types/product";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  products?: ProductCardType[];
  agentState?: AgentState;
};

type ChatStreamPart = {
  type: string;
  delta?: string;
  data?: Pick<AgentChatResponse, "products" | "agentState">;
  errorText?: string;
};

type Theme = "light" | "dark";

function subscribeToTheme(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener("kapruka-theme-change", onStoreChange);

  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener("kapruka-theme-change", onStoreChange);
  };
}

function getThemeSnapshot(): Theme {
  return window.localStorage.getItem("kapruka-theme") === "dark"
    ? "dark"
    : "light";
}

function getServerThemeSnapshot(): Theme {
  return "light";
}

function saveTheme(theme: Theme) {
  window.localStorage.setItem("kapruka-theme", theme);
  window.dispatchEvent(new Event("kapruka-theme-change"));
}

const agentMemoryKey = "kapruka-agent-memory";
const agentRunsKey = "kapruka-agent-runs";

function loadAgentMemory(): AgentMemory {
  try {
    const raw = window.localStorage.getItem(agentMemoryKey);

    if (!raw) return {};

    const parsed = JSON.parse(raw) as AgentMemory;

    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveAgentMemory(memory: AgentMemory) {
  window.localStorage.setItem(agentMemoryKey, JSON.stringify(memory));
}

function saveAgentRun(agentState: AgentState) {
  try {
    const raw = window.localStorage.getItem(agentRunsKey);
    const previous = raw ? (JSON.parse(raw) as AgentState[]) : [];
    const next = [agentState, ...previous].slice(0, 30);

    window.localStorage.setItem(agentRunsKey, JSON.stringify(next));
  } catch {
    window.localStorage.setItem(agentRunsKey, JSON.stringify([agentState]));
  }
}

function mergeAgentMemory(
  current: AgentMemory,
  patch: AgentMemory = {}
): AgentMemory {
  return {
    preferredBudget: patch.preferredBudget ?? current.preferredBudget ?? null,
    deliveryCity: patch.deliveryCity ?? current.deliveryCity ?? null,
    giftRecipients: [
      ...new Set([...(current.giftRecipients || []), ...(patch.giftRecipients || [])]),
    ].slice(0, 8),
    favoriteCategories: [
      ...new Set([
        ...(current.favoriteCategories || []),
        ...(patch.favoriteCategories || []),
      ]),
    ].slice(0, 8),
    recentSearches: [
      ...new Set([...(patch.recentSearches || []), ...(current.recentSearches || [])]),
    ].slice(0, 8),
  };
}

function splitAssistantContent(content: string) {
  return content
    .split(/\n+|(?<=[.!?])\s+(?=[\p{Lu}\p{Lt}\p{Lo}"'(])/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseSseEvents(buffer: string) {
  const events = buffer.split(/\n\n/);
  const remainder = events.pop() || "";
  const payloads = events
    .flatMap((event) =>
      event
        .split(/\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
    )
    .filter(Boolean);

  return { payloads, remainder };
}

function postObservabilityEvent(path: string, body: unknown) {
  fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {
    // Observability must never block the shopping flow.
  });
}

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [chatStarted, setChatStarted] = useState(false);
  const [cart, setCart] = useState<ProductCardType[]>([]);
  const [selectedProduct, setSelectedProduct] =
    useState<ProductCardType | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [deliveryPanelOpen, setDeliveryPanelOpen] = useState(false);
  const [checkoutPanelOpen, setCheckoutPanelOpen] = useState(false);
  const [checkedDelivery, setCheckedDelivery] =
    useState<DeliveryResult | null>(null);
  const [sharedLocation, setSharedLocation] =
    useState<SharedLocation | null>(null);
  const [locationPromptDismissed, setLocationPromptDismissed] = useState(false);
  const [composerGlass, setComposerGlass] = useState(false);
  const theme = useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    getServerThemeSnapshot
  );

  useEffect(() => {
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  useEffect(() => {
    const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
      const scrollElement = chatScrollRef.current;

      if (!scrollElement) return;

      scrollElement.scrollTo({
        top: scrollElement.scrollHeight,
        behavior,
      });
    };

    const frame = requestAnimationFrame(() => scrollToBottom("smooth"));
    const shortDelay = window.setTimeout(() => scrollToBottom("smooth"), 120);
    const layoutDelay = window.setTimeout(() => scrollToBottom("auto"), 420);

    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(shortDelay);
      window.clearTimeout(layoutDelay);
    };
  }, [messages, loading]);

  function addToCart(product: ProductCardType) {
    setCart((prev) => {
      const exists = prev.some((item) => item.id === product.id);

      if (exists) return prev;

      const next = [...prev, product];

      postObservabilityEvent("/api/observability/product-interaction", {
        product,
        action: "add_to_cart",
      });
      postObservabilityEvent("/api/observability/cart", { cart: next });

      return next;
    });
  }

  function removeFromCart(productId: string) {
    setCart((prev) => {
      const product = prev.find((item) => item.id === productId);
      const next = prev.filter((item) => item.id !== productId);

      if (product) {
        postObservabilityEvent("/api/observability/product-interaction", {
          product,
          action: "remove_from_cart",
        });
      }

      postObservabilityEvent("/api/observability/cart", { cart: next });

      return next;
    });
  }

  function viewProductDetails(product: ProductCardType) {
    setSelectedProduct(product);
    postObservabilityEvent("/api/observability/product-interaction", {
      product,
      action: "view_details",
    });
  }

  function updateComposerGlass(element: HTMLDivElement) {
    const distanceFromBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight;

    setComposerGlass(distanceFromBottom > 120);
  }

  async function copyMessage(content: string) {
    await navigator.clipboard.writeText(content);
  }

  function editUserMessage(content: string) {
    setInput(content);
    setLoading(false);

    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }

  async function sendMessage(message?: string) {
    const userMessage = (message ?? input).trim();

    if (!userMessage || loading) return;

    const requestHistory = messages.slice(-8).map(({ role, content }) => ({
      role,
      content,
    }));

    setChatStarted(true);
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: userMessage,
      },
      {
        role: "assistant",
        content: "",
        products: [],
      },
    ]);

    setInput("");
    setLoading(true);

    try {
      const memory = loadAgentMemory();
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: userMessage,
          location: sharedLocation,
          history: requestHistory,
          memory,
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error("Chat stream failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      async function handleStreamPart(part: ChatStreamPart) {
        if (part.type === "text-delta" && part.delta) {
          setMessages((prev) => {
            const next = [...prev];
            const lastIndex = next.length - 1;
            const last = next[lastIndex];

            if (last?.role !== "assistant") return prev;

            next[lastIndex] = {
              ...last,
              content: `${last.content}${part.delta}`,
            };

            return next;
          });
        }

        if (part.type === "data-result") {
          const data = part.data;

          if (data?.agentState?.memoryPatch) {
            saveAgentMemory(
              mergeAgentMemory(memory, data.agentState.memoryPatch)
            );
          }

          if (data?.agentState) {
            saveAgentRun(data.agentState);
          }

          setMessages((prev) => {
            const next = [...prev];
            const lastIndex = next.length - 1;
            const last = next[lastIndex];

            if (last?.role !== "assistant") return prev;

            next[lastIndex] = {
              ...last,
              products: data?.products || [],
              agentState: data?.agentState,
            };

            return next;
          });
        }

        if (part.type === "error") {
          throw new Error(part.errorText || "Chat stream failed");
        }
      }

      while (true) {
        const { value, done } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const parsed = parseSseEvents(buffer);
        buffer = parsed.remainder;

        for (const payload of parsed.payloads) {
          if (payload === "[DONE]") continue;

          await handleStreamPart(JSON.parse(payload) as ChatStreamPart);
        }
      }

      if (buffer.trim()) {
        const parsed = parseSseEvents(`${buffer}\n\n`);

        for (const payload of parsed.payloads) {
          if (payload === "[DONE]") continue;

          await handleStreamPart(JSON.parse(payload) as ChatStreamPart);
        }
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "That connection dropped on me. Try once more and I'll get back to the shortlist.";

      setMessages((prev) => {
        const next = [...prev];
        const lastIndex = next.length - 1;
        const last = next[lastIndex];

        if (last?.role === "assistant") {
          next[lastIndex] = {
            ...last,
            content: last.content || message,
          };

          return next;
        }

        return [
          ...prev,
          {
            role: "assistant",
            content: message,
          },
        ];
      });
    } finally {
      setLoading(false);
    }
  }

  const cartTotal = cart.reduce(
    (total, item) => total + (item.price || 0),
    0
  );
  const isWelcome = !chatStarted && !loading;
  const latestUserMessage =
    [...messages].reverse().find((message) => message.role === "user")
      ?.content || "";

  function userMessageBefore(messageIndex: number) {
    for (let index = messageIndex - 1; index >= 0; index -= 1) {
      const message = messages[index];

      if (message.role === "user") return message.content;
    }

    return latestUserMessage;
  }

  return (
    <main
      data-theme={theme}
      className="app-theme min-h-screen bg-slate-950 text-white"
    >
      <section className="relative flex h-screen min-w-0 flex-col overflow-hidden">
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

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => saveTheme(theme === "light" ? "dark" : "light")}
                aria-label={`Switch to ${
                  theme === "light" ? "dark" : "light"
                } mode`}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] text-slate-300 transition hover:border-emerald-400/60 hover:bg-emerald-500/15 hover:text-emerald-300"
              >
                {theme === "light" ? <Moon size={20} /> : <Sun size={20} />}
              </button>

              <button
                type="button"
                onClick={() => setCartOpen(true)}
                aria-label={`Open cart with ${cart.length} items`}
                className="group relative flex shrink-0 items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-3.5 py-3 text-sm font-semibold text-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-emerald-400/60 hover:bg-emerald-500/15 hover:shadow-[0_12px_30px_-14px_rgba(16,185,129,0.8)] active:translate-y-0 active:scale-95"
              >
                <ShoppingCart
                  size={21}
                  className="transition-transform duration-200 group-hover:scale-110"
                />
                <span className="hidden sm:inline">Cart</span>
                {cart.length > 0 && (
                  <span className="absolute -right-2 -top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-xs font-bold text-white">
                    {cart.length}
                  </span>
                )}
              </button>
            </div>
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
        <div
          ref={chatScrollRef}
          className="flex-1 overflow-y-auto"
          onScroll={(event) => updateComposerGlass(event.currentTarget)}
        >
          <div className="mx-auto w-full max-w-6xl space-y-5 px-4 pb-40 pt-6 sm:px-6 sm:pb-44">
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
                      ? "group/message w-full min-w-0"
                      : "group/message max-w-5xl"
                  }
                >
                  {message.role === "assistant" ? (
                    <div className="space-y-2">
                      {splitAssistantContent(message.content).map(
                        (part, partIndex) => (
                          <div
                            key={`${index}-${partIndex}`}
                            className="w-fit max-w-2xl whitespace-pre-wrap rounded-[28px] rounded-bl-md border border-white/[0.06] bg-slate-800 px-5 py-3 text-lg leading-7 text-slate-100 shadow-sm"
                          >
                            {part}
                          </div>
                        )
                      )}
                    </div>
                  ) : (
                    <div className="ml-auto w-fit max-w-2xl whitespace-pre-wrap rounded-[28px] rounded-br-md bg-emerald-500 px-5 py-3 text-lg leading-7 text-white shadow-sm">
                      {message.content}
                    </div>
                  )}

                  <div
                    className={`pointer-events-none mt-1 flex h-7 gap-1.5 opacity-0 transition-opacity duration-150 group-hover/message:pointer-events-auto group-hover/message:opacity-100 group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100 ${
                      message.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => copyMessage(message.content)}
                      aria-label="Copy message"
                      className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white/10 hover:text-slate-200"
                    >
                      <Copy size={18} />
                    </button>

                    {message.role === "user" && (
                      <button
                        type="button"
                        onClick={() => editUserMessage(message.content)}
                        aria-label="Edit and resend message"
                        className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white/10 hover:text-slate-200"
                      >
                        <Pencil size={18} />
                      </button>
                    )}
                  </div>

                  {message.role === "assistant" &&
                    message.products &&
                    message.products.length > 0 && (
                      <ProductCarousel
                        products={message.products}
                        cartProductIds={cart.map((item) => item.id)}
                        onAddToCart={addToCart}
                        onViewDetails={viewProductDetails}
                        onSearchRevision={sendMessage}
                        searchQuery={userMessageBefore(index)}
                        disabled={loading}
                      />
                    )}
                </div>
              </div>
            ))}

            {loading && (
              <SearchProgress query={latestUserMessage} />
            )}
          </div>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-4 pb-6 sm:px-6 sm:pb-8">
          <div className="mx-auto w-full max-w-2xl space-y-3">
            {!loading &&
              !locationPromptDismissed &&
              !sharedLocation &&
              messages.some((message) => message.role === "user") && (
                <div className="pointer-events-auto">
                  <LocationPrompt
                    location={sharedLocation}
                    onLocationShared={(location) => {
                      setSharedLocation(location);
                      setLocationPromptDismissed(true);
                    }}
                    onDismiss={() => setLocationPromptDismissed(true)}
                  />
                </div>
              )}

            <div
              className={`pointer-events-auto flex gap-2 rounded-[28px] border border-white/15 p-2.5 transition duration-200 ${
                composerGlass
                  ? "bg-slate-900/35 shadow-[0_16px_45px_-22px_rgba(0,0,0,0.95)] backdrop-blur-2xl backdrop-saturate-150"
                  : "bg-slate-900"
              }`}
            >
              <div className="flex items-center pl-2 text-emerald-300">
                <Sparkles size={19} />
              </div>

              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    sendMessage();
                  }
                }}
                placeholder="Search products, compare options, or describe what you need"
                className="min-w-0 flex-1 bg-transparent px-3 text-md outline-none placeholder:text-slate-500"
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
        <div className="cart-backdrop fixed inset-0 z-40 flex justify-end bg-slate-950/75 backdrop-blur-sm">
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
            className="cart-drawer relative flex h-full w-full max-w-md flex-col border-l border-white/10 bg-slate-950 shadow-2xl"
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
        onContinueToCheckout={(result) => {
          setCheckedDelivery(result);
          setDeliveryPanelOpen(false);
          setCheckoutPanelOpen(true);
        }}
      />

      <ProductDetailPanel
        product={selectedProduct}
        isInCart={
          selectedProduct
            ? cart.some((item) => item.id === selectedProduct.id)
            : false
        }
        onAddToCart={addToCart}
        onClose={() => setSelectedProduct(null)}
      />

      <CheckoutPanel
        open={checkoutPanelOpen}
        cart={cart}
        delivery={checkedDelivery}
        onClose={() => setCheckoutPanelOpen(false)}
      />
    </main>
  );
}
