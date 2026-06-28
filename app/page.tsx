"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Check,
  Clock,
  Copy,
  History,
  ImageIcon,
  Menu,
  Minus,
  Pencil,
  Plus,
  Moon,
  Send,
  ShoppingCart,
  Sparkles,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { BrandLogo } from "@/components/brand/BrandLogo";
import {
  LocationPrompt,
  type SharedLocation,
} from "@/components/chat/LocationPrompt";
import { SearchProgress } from "@/components/chat/SearchProgress";
import { WelcomeScreen } from "@/components/chat/WelcomeScreen";
import {
  CheckoutPanel,
  type CheckoutProgressTarget,
  createInitialCheckoutState,
  type CheckoutState,
} from "@/components/checkout/CheckoutPanel";
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
import type {
  CartItem,
  ProductCard as ProductCardType,
} from "@/types/product";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  products?: ProductCardType[];
  agentState?: AgentState;
};

type SavedShoppingChat = {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
  cart: CartItem[];
  checkedDelivery: DeliveryResult | null;
  checkoutState: CheckoutState | null;
  shoppingFlowStep: ShoppingFlowStep;
};

type ShoppingFlowStep = "cart" | "delivery" | "date" | "checkout";

type ChatStreamPart = {
  type: string;
  delta?: string;
  data?: Pick<AgentChatResponse, "products" | "agentState"> & {
    content?: string;
  };
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

function getProductImageUrl(product: ProductCardType) {
  if (!product.imageUrl && !product.productUrl) return null;

  return `/api/product-image?${new URLSearchParams({
    ...(product.imageUrl ? { src: product.imageUrl } : {}),
    ...(product.productUrl ? { product: product.productUrl } : {}),
  }).toString()}`;
}

type CartItemRowProps = {
  item: CartItem;
  onChangeQuantity: (productId: string, change: number) => void;
  onRemove: (productId: string) => void;
};

function CartItemRow({ item, onChangeQuantity, onRemove }: CartItemRowProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = imageFailed ? null : getProductImageUrl(item);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-start gap-3">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-slate-900">
          {imageUrl ? (
            // Images are already normalized through the local product-image proxy.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={item.name}
              loading="lazy"
              onError={() => setImageFailed(true)}
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-slate-500">
              <ImageIcon size={24} aria-hidden="true" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              {(item.brand || item.category) && (
                <p className="truncate text-xs font-medium text-slate-400">
                  {item.brand || item.category}
                </p>
              )}
              <h3 className="mt-0.5 line-clamp-2 text-sm font-semibold leading-5 text-white">
                {item.name}
              </h3>
            </div>

            <button
              type="button"
              onClick={() => onRemove(item.id)}
              aria-label={`Remove ${item.name} from cart`}
              className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white"
            >
              <Trash2 size={15} />
            </button>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="flex w-fit items-center rounded-full border border-white/10 bg-white/[0.04]">
              <button
                type="button"
                onClick={() => onChangeQuantity(item.id, -1)}
                aria-label={`Decrease ${item.name} quantity`}
                className="flex h-8 w-8 items-center justify-center rounded-full text-slate-300 hover:bg-white/10 hover:text-white"
              >
                <Minus size={14} />
              </button>
              <span className="min-w-8 text-center text-sm font-semibold text-white">
                {item.quantity}
              </span>
              <button
                type="button"
                onClick={() => onChangeQuantity(item.id, 1)}
                disabled={item.quantity >= 99}
                aria-label={`Increase ${item.name} quantity`}
                className="flex h-8 w-8 items-center justify-center rounded-full text-slate-300 hover:bg-white/10 hover:text-white disabled:opacity-40"
              >
                <Plus size={14} />
              </button>
            </div>

            <p className="shrink-0 text-lg font-bold leading-none text-purple-300">
              Rs. {((item.price || 0) * item.quantity).toLocaleString()}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

type SavedChatCardProps = {
  chat: SavedShoppingChat;
  active: boolean;
  onOpen: (chat: SavedShoppingChat) => void;
};

function SavedChatCard({ chat, active, onOpen }: SavedChatCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageProduct = getSavedChatImageProduct(chat);
  const imageUrl =
    !imageFailed && imageProduct ? getProductImageUrl(imageProduct) : null;
  const cartQuantity = chat.cart.reduce((total, item) => total + item.quantity, 0);

  return (
    <button
      type="button"
      onClick={() => onOpen(chat)}
      className={`group w-full rounded-3xl border p-4 text-left shadow-sm transition hover:border-purple-300/70 hover:bg-purple-500/[0.08] hover:shadow-[0_16px_42px_-28px_rgba(64,41,112,0.7)] ${
        active
          ? "border-purple-300/60 bg-purple-500/10"
          : "border-white/10 bg-white/[0.045]"
      }`}
    >
      <div className="flex gap-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="line-clamp-3 text-sm font-bold leading-6 text-white">
            {chat.title}
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="inline-flex items-center gap-1">
              <Clock size={13} />
              {formatSavedChatAge(chat.updatedAt)}
            </span>
            {cartQuantity > 0 && (
              <span className="rounded-full bg-purple-500/15 px-2 py-0.5 font-semibold text-purple-300">
                {cartQuantity} in cart
              </span>
            )}
          </div>
        </div>

        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-slate-900">
          {imageUrl ? (
            // Images are already normalized through the local product-image proxy.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt=""
              loading="lazy"
              onError={() => setImageFailed(true)}
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-slate-500">
              <History size={24} />
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

const agentMemoryKey = "kapruka-agent-memory";
const agentRunsKey = "kapruka-agent-runs";
const savedChatsKey = "kapruka-saved-shopping-chats";

function createChatId() {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getSavedChatTitle(messages: ChatMessage[]) {
  const firstUserMessage = messages.find((message) => message.role === "user");
  const title = firstUserMessage?.content.trim();

  if (!title) return "New shopping chat";

  return title.length > 88 ? `${title.slice(0, 85)}...` : title;
}

function normalizeCheckoutState(value: unknown): CheckoutState {
  const fallback = createInitialCheckoutState();

  if (!value || typeof value !== "object") return fallback;

  const candidate = value as Partial<CheckoutState>;
  const form =
    candidate.form && typeof candidate.form === "object"
      ? {
          ...fallback.form,
          ...candidate.form,
        }
      : fallback.form;
  const step =
    candidate.step === "review" || candidate.step === "pay"
      ? candidate.step
      : "form";

  return {
    form,
    step,
    result: candidate.result || null,
  };
}

function normalizeShoppingFlowStep(
  value: unknown,
  chat: Pick<SavedShoppingChat, "cart" | "checkedDelivery"> & {
    checkoutState?: CheckoutState | null;
  }
): ShoppingFlowStep {
  if (value === "cart" || value === "delivery" || value === "checkout") {
    return value;
  }

  if (value === "date") return value;

  if (chat.checkoutState?.step !== "form" || chat.checkoutState?.result) {
    return "checkout";
  }

  if (chat.checkedDelivery?.available) {
    return "checkout";
  }

  return chat.cart.length > 0 ? "cart" : "cart";
}

function normalizeSavedShoppingChat(chat: SavedShoppingChat): SavedShoppingChat {
  const checkoutState = normalizeCheckoutState(chat.checkoutState);

  return {
    ...chat,
    updatedAt: typeof chat.updatedAt === "number" ? chat.updatedAt : 0,
    checkoutState,
    shoppingFlowStep: normalizeShoppingFlowStep(chat.shoppingFlowStep, {
      ...chat,
      checkoutState,
    }),
  };
}

function loadSavedChats(): SavedShoppingChat[] {
  try {
    const raw = window.localStorage.getItem(savedChatsKey);
    const parsed = raw ? (JSON.parse(raw) as SavedShoppingChat[]) : [];

    return Array.isArray(parsed)
      ? parsed
          .filter((chat) => chat && typeof chat.id === "string")
          .map(normalizeSavedShoppingChat)
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, 20)
      : [];
  } catch {
    return [];
  }
}

function saveShoppingChats(chats: SavedShoppingChat[]) {
  window.localStorage.setItem(savedChatsKey, JSON.stringify(chats.slice(0, 20)));
}

function updateSavedChatSnapshot(
  chatId: string,
  snapshot: Omit<SavedShoppingChat, "id" | "updatedAt">
) {
  const saved = loadSavedChats();
  const next = [
    {
      id: chatId,
      updatedAt: Date.now(),
      ...snapshot,
    },
    ...saved.filter((chat) => chat.id !== chatId),
  ].slice(0, 20);

  saveShoppingChats(next);
  postObservabilityEvent("/api/saved-chats", {
    id: chatId,
    ...snapshot,
  });
  return next;
}

function formatSavedChatAge(updatedAt: number) {
  const diff = Math.max(0, Date.now() - updatedAt);
  const second = 1_000;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < 10 * second) return "Just now";
  if (diff < minute) return `${Math.floor(diff / second)}s ago`;
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  return `${Math.floor(diff / day)}d ago`;
}

function getSavedChatImageProduct(chat: SavedShoppingChat) {
  const cartProduct = chat.cart.find((item) => item.imageUrl || item.productUrl);

  if (cartProduct) return cartProduct;

  for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
    const product = chat.messages[index].products?.find(
      (item) => item.imageUrl || item.productUrl
    );

    if (product) return product;
  }

  return null;
}

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
  const trimmed = content.trim();

  return trimmed ? [trimmed] : [];
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
  const sendingRef = useRef(false);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [chatStarted, setChatStarted] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [activeChatId, setActiveChatId] = useState(() => createChatId());
  const [savedChats, setSavedChats] = useState<SavedShoppingChat[]>([]);
  const [savedChatsLoaded, setSavedChatsLoaded] = useState(false);
  const [savedChatsOpen, setSavedChatsOpen] = useState(false);
  const [savedChatsClosing, setSavedChatsClosing] = useState(false);
  const [selectedProduct, setSelectedProduct] =
    useState<ProductCardType | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [deliveryPanelOpen, setDeliveryPanelOpen] = useState(false);
  const [checkoutPanelOpen, setCheckoutPanelOpen] = useState(false);
  const [checkedDelivery, setCheckedDelivery] =
    useState<DeliveryResult | null>(null);
  const [checkoutState, setCheckoutState] = useState<CheckoutState>(() =>
    createInitialCheckoutState()
  );
  const [shoppingFlowStep, setShoppingFlowStep] =
    useState<ShoppingFlowStep>("cart");
  const [sharedLocation, setSharedLocation] =
    useState<SharedLocation | null>(null);
  const [locationPromptDismissed, setLocationPromptDismissed] = useState(false);
  const [composerGlass, setComposerGlass] = useState(false);
  const [copiedMessageKey, setCopiedMessageKey] = useState<string | null>(null);
  const theme = useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    getServerThemeSnapshot
  );

  useEffect(() => {
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSavedChats(loadSavedChats());
      setSavedChatsLoaded(true);
    }, 0);

    return () => window.clearTimeout(timeout);
  }, []);

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

  function persistActiveChatSnapshot(
    nextMessages: ChatMessage[] = messages,
    nextCart: CartItem[] = cart,
    nextDelivery: DeliveryResult | null = checkedDelivery,
    nextCheckoutState: CheckoutState = checkoutState,
    nextShoppingFlowStep: ShoppingFlowStep = shoppingFlowStep
  ) {
    if (!chatStarted && nextMessages.length === 0 && nextCart.length === 0) {
      return;
    }

    setSavedChats(
      updateSavedChatSnapshot(activeChatId, {
        title: getSavedChatTitle(nextMessages),
        messages: nextMessages,
        cart: nextCart,
        checkedDelivery: nextDelivery,
        checkoutState: nextCheckoutState,
        shoppingFlowStep: nextShoppingFlowStep,
      })
    );
  }

  function addToCart(product: ProductCardType) {
    setShoppingFlowStep("cart");
    setCart((prev) => {
      const existing = prev.find((item) => item.id === product.id);
      const next = existing
        ? prev.map((item) =>
            item.id === product.id
              ? { ...item, quantity: Math.min(item.quantity + 1, 99) }
              : item
          )
        : [...prev, { ...product, quantity: 1 }];

      postObservabilityEvent("/api/observability/product-interaction", {
        product,
        action: "add_to_cart",
      });
      postObservabilityEvent("/api/observability/cart", { cart: next });
      persistActiveChatSnapshot(
        messages,
        next,
        checkedDelivery,
        checkoutState,
        "cart"
      );

      return next;
    });
  }

  function changeCartQuantity(productId: string, change: number) {
    setShoppingFlowStep("cart");
    setCart((prev) => {
      const next = prev
        .map((item) =>
          item.id === productId
            ? {
                ...item,
                quantity: Math.min(Math.max(item.quantity + change, 0), 99),
              }
            : item
        )
        .filter((item) => item.quantity > 0);

      postObservabilityEvent("/api/observability/cart", { cart: next });
      persistActiveChatSnapshot(
        messages,
        next,
        checkedDelivery,
        checkoutState,
        "cart"
      );
      return next;
    });
  }

  function removeFromCart(productId: string) {
    setShoppingFlowStep("cart");
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
      persistActiveChatSnapshot(
        messages,
        next,
        checkedDelivery,
        checkoutState,
        "cart"
      );

      return next;
    });
  }

  function handleCheckoutStateChange(nextCheckoutState: CheckoutState) {
    setCheckoutState(nextCheckoutState);
    setShoppingFlowStep("checkout");
    persistActiveChatSnapshot(
      messages,
      cart,
      checkedDelivery,
      nextCheckoutState,
      "checkout"
    );
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

  async function copyMessage(content: string, key: string) {
    await navigator.clipboard.writeText(content);
    setCopiedMessageKey(key);

    window.setTimeout(() => {
      setCopiedMessageKey((current) => (current === key ? null : current));
    }, 1400);
  }

  function editUserMessage(content: string) {
    setInput(content);
    setLoading(false);

    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }

  function openSavedChat(chat: SavedShoppingChat) {
    setActiveChatId(chat.id);
    setMessages(chat.messages || []);
    setCart(chat.cart || []);
    setCheckedDelivery(chat.checkedDelivery || null);
    setCheckoutState(normalizeCheckoutState(chat.checkoutState));
    setShoppingFlowStep(chat.shoppingFlowStep || "cart");
    setChatStarted((chat.messages || []).length > 0);
    setInput("");
    setLoading(false);
    setSavedChatsOpen(false);
    setSavedChatsClosing(false);
    setCartOpen(false);
    setDeliveryPanelOpen(false);
    setCheckoutPanelOpen(false);
    setSelectedProduct(null);
  }

  function restoreSavedCart(chat: SavedShoppingChat) {
    setActiveChatId(chat.id);
    setMessages(chat.messages || []);
    setCart(chat.cart || []);
    setCheckedDelivery(chat.checkedDelivery || null);
    setCheckoutState(normalizeCheckoutState(chat.checkoutState));
    setShoppingFlowStep("cart");
    setChatStarted((chat.messages || []).length > 0);
    setInput("");
    setLoading(false);
    setSavedChatsOpen(false);
    setSavedChatsClosing(false);
    setDeliveryPanelOpen(false);
    setCheckoutPanelOpen(false);
    setSelectedProduct(null);
    setCartOpen(true);
  }

  function startNewChat() {
    setActiveChatId(createChatId());
    setMessages([]);
    setCart([]);
    setCheckedDelivery(null);
    setCheckoutState(createInitialCheckoutState());
    setShoppingFlowStep("cart");
    setChatStarted(false);
    setInput("");
    setLoading(false);
    setSavedChatsOpen(false);
    setSavedChatsClosing(false);
    setCartOpen(false);
    setDeliveryPanelOpen(false);
    setCheckoutPanelOpen(false);
    setSelectedProduct(null);

    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }

  async function openSavedChatsDrawer() {
    setSavedChatsClosing(false);
    setSavedChats(loadSavedChats());
    setSavedChatsOpen(true);

    try {
      const response = await fetch("/api/saved-chats");
      const data = (await response.json()) as { chats?: SavedShoppingChat[] };

      if (response.ok && Array.isArray(data.chats)) {
        const next = data.chats
          .map(normalizeSavedShoppingChat)
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, 20);
        setSavedChats(next);
        saveShoppingChats(next);
      }
    } catch {
      // Local saved chats remain available when the database is unreachable.
    }
  }

  function closeSavedChatsDrawer() {
    setSavedChatsClosing(true);
    window.setTimeout(() => {
      setSavedChatsOpen(false);
      setSavedChatsClosing(false);
    }, 260);
  }

  function openCurrentShoppingStep() {
    if (shoppingFlowStep === "checkout") {
      setCartOpen(false);
      setDeliveryPanelOpen(false);
      setCheckoutPanelOpen(true);
      return;
    }

    if (shoppingFlowStep === "delivery" || shoppingFlowStep === "date") {
      setCartOpen(false);
      setCheckoutPanelOpen(false);
      setDeliveryPanelOpen(true);
      return;
    }

    setDeliveryPanelOpen(false);
    setCheckoutPanelOpen(false);
    setCartOpen(true);
  }

  function openShoppingFlowTarget(target: CheckoutProgressTarget) {
    setShoppingFlowStep(target);
    persistActiveChatSnapshot(
      messages,
      cart,
      checkedDelivery,
      checkoutState,
      target
    );

    setCartOpen(target === "cart");
    setDeliveryPanelOpen(target === "delivery" || target === "date");
    setCheckoutPanelOpen(target === "checkout");
  }

  async function sendMessage(message?: string) {
    const userMessage = (message ?? input).trim();

    if (!userMessage || loading || sendingRef.current) return;

    sendingRef.current = true;

    const requestHistory = messages.slice(-8).map(({ role, content }) => ({
      role,
      content,
    }));
    const nextMessages: ChatMessage[] = [
      ...messages,
      {
        role: "user",
        content: userMessage,
      },
      {
        role: "assistant",
        content: "",
        products: [],
      },
    ];

    setChatStarted(true);
    setMessages(nextMessages);
    setSavedChats(
      updateSavedChatSnapshot(activeChatId, {
        title: getSavedChatTitle(nextMessages),
        messages: nextMessages,
        cart,
        checkedDelivery,
        checkoutState,
        shoppingFlowStep,
      })
    );

    setInput("");
    setLoading(true);

    let currentMessages = nextMessages;

    const updateStreamingMessages = (
      updater: (prev: ChatMessage[]) => ChatMessage[]
    ) => {
      currentMessages = updater(currentMessages);
      setMessages(currentMessages);
    };

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
          updateStreamingMessages((prev) => {
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

          updateStreamingMessages((prev) => {
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

        if (part.type === "data-message-part" && part.data?.content) {
          updateStreamingMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: part.data!.content!,
              products: [],
            },
          ]);
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

      setSavedChats(
        updateSavedChatSnapshot(activeChatId, {
          title: getSavedChatTitle(currentMessages),
          messages: currentMessages,
          cart,
          checkedDelivery,
          checkoutState,
          shoppingFlowStep,
        })
      );
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "That connection dropped on me. Try once more and I'll get back to the shortlist.";

      updateStreamingMessages((prev) => {
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

      setSavedChats(
        updateSavedChatSnapshot(activeChatId, {
          title: getSavedChatTitle(currentMessages),
          messages: currentMessages,
          cart,
          checkedDelivery,
          checkoutState,
          shoppingFlowStep,
        })
      );
    } finally {
      sendingRef.current = false;
      setLoading(false);
    }
  }

  const cartTotal = cart.reduce(
    (total, item) => total + (item.price || 0) * item.quantity,
    0
  );
  const cartQuantity = cart.reduce((total, item) => total + item.quantity, 0);
  const savedCartChats = savedChats
    .filter((chat) => chat.cart.length > 0 && chat.id !== activeChatId)
    .slice(0, 3);
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

  function productSearchContextBefore(messageIndex: number) {
    for (let index = messageIndex - 1; index >= 0; index -= 1) {
      const message = messages[index];

      if (message.role !== "user") continue;

      const content = message.content
        .replace(/\s*\bexclude(?: these products?)?:\s*[\s\S]+$/i, "")
        .trim();

      if (
        /^(?:\?+|more|more please|show\s+(?:me\s+)?(?:\d+\s+)?more|load\s+(?:\d+\s+)?more|another|another 8|others?|other options?|alternatives?|more options?|anything else|more like that|similar|different|cheaper|premium)\b/i.test(
          content
        )
      ) {
        continue;
      }

      return content;
    }

    return userMessageBefore(messageIndex);
  }

  function assistantGroupContent(messageIndex: number) {
    let startIndex = messageIndex;

    while (
      startIndex > 0 &&
      messages[startIndex - 1]?.role === "assistant"
    ) {
      startIndex -= 1;
    }

    const parts: string[] = [];

    for (let index = startIndex; index < messages.length; index += 1) {
      const message = messages[index];

      if (message.role !== "assistant") break;

      if (message.content.trim()) {
        parts.push(message.content.trim());
      }

      if (index >= messageIndex) break;
    }

    return parts.join("\n\n");
  }

  function assistantGroupProducts(messageIndex: number) {
    let startIndex = messageIndex;

    while (
      startIndex > 0 &&
      messages[startIndex - 1]?.role === "assistant"
    ) {
      startIndex -= 1;
    }

    let products: ProductCardType[] = [];

    for (let index = startIndex; index < messages.length; index += 1) {
      const message = messages[index];

      if (message.role !== "assistant") break;

      if (message.products?.length) {
        products = message.products;
      }

      if (index >= messageIndex) break;
    }

    return products;
  }

  function displayedProductNamesUntil(messageIndex: number) {
    return [
      ...new Set(
        messages
          .slice(0, messageIndex + 1)
          .flatMap((message) => message.products || [])
          .map((product) => product.name)
          .filter(Boolean)
      ),
    ];
  }

  return (
    <main
      data-theme={theme}
      className="app-theme min-h-screen bg-slate-950 text-white"
    >
      <section className="relative flex h-screen min-w-0 flex-col overflow-hidden">
        <header
          className={`px-4 py-4 sm:px-6 ${
            isWelcome ? "" : "border-b border-white/10"
          }`}
        >
          <button
            type="button"
            onClick={openSavedChatsDrawer}
            aria-label="Open saved chats"
            className="absolute left-3 top-6 z-10 flex h-10 w-10 items-center justify-center text-slate-400 transition hover:text-purple-300 sm:left-4"
          >
            <Menu size={28} strokeWidth={2.25} />
            {savedChatsLoaded && savedChats.length > 0 && (
              <span className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-purple-500 px-1 text-[10px] font-bold text-white">
                {savedChats.length}
              </span>
            )}
          </button>

          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3 pl-10 sm:pl-11">
              {!isWelcome && (
                <>
                  <button
                    type="button"
                    onClick={startNewChat}
                    aria-label="Go to welcome page"
                    title="Go to welcome page"
                    className="shrink-0 rounded-2xl transition hover:scale-105 focus:outline-none focus:ring-2 focus:ring-purple-300 focus:ring-offset-2 focus:ring-offset-slate-950 active:scale-95"
                  >
                    <BrandLogo size={64} priority />
                  </button>

                  <div className="min-w-0">
                    <h1 className="text-xl font-bold sm:text-2xl">
                      Kapruka Shopping Buddy
                    </h1>
                    <p className="hidden text-sm text-slate-400 sm:block">
                      Electronics, groceries, fashion, home, gifts, and more
                    </p>
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => saveTheme(theme === "light" ? "dark" : "light")}
                aria-label={`Switch to ${
                  theme === "light" ? "dark" : "light"
                } mode`}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] text-slate-300 transition hover:border-purple-400/60 hover:bg-purple-500/15 hover:text-purple-300"
              >
                {theme === "light" ? <Moon size={20} /> : <Sun size={20} />}
              </button>

              <button
                type="button"
                onClick={openCurrentShoppingStep}
                aria-label={`Open cart with ${cartQuantity} items`}
                className="group relative flex shrink-0 items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-3.5 py-3 text-sm font-semibold text-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-purple-400/60 hover:bg-purple-500/15 hover:shadow-[0_12px_30px_-14px_rgba(64,41,112,0.55)] active:translate-y-0 active:scale-95"
              >
                <ShoppingCart
                  size={21}
                  className="transition-transform duration-200 group-hover:scale-110"
                />
                <span className="hidden sm:inline">Cart</span>
                {cartQuantity > 0 && (
                  <span className="absolute -right-2 -top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-purple-500 px-1.5 text-xs font-bold text-white">
                    {cartQuantity}
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
          <div className="mx-auto w-full max-w-6xl px-4 pb-40 pt-6 sm:px-6 sm:pb-44">
            {messages.map((message, index) => {
              const previousMessage = messages[index - 1];
              const nextMessage = messages[index + 1];
              const isGroupedAssistant =
                message.role === "assistant" &&
                previousMessage?.role === "assistant" &&
                !previousMessage.products?.length;
              const isLastAssistantInGroup =
                message.role === "assistant" &&
                nextMessage?.role !== "assistant";
              const groupProducts =
                message.role === "assistant" && isLastAssistantInGroup
                  ? assistantGroupProducts(index)
                  : [];
              const shouldShowMessageActions =
                (message.role === "user" || isLastAssistantInGroup) &&
                message.content.trim().length > 0;
              const hasVisibleProducts =
                message.products?.length || groupProducts.length;
              const copyKey = `${message.role}-${index}`;
              const isCopied = copiedMessageKey === copyKey;

              if (
                message.role === "assistant" &&
                !message.content.trim() &&
                !hasVisibleProducts
              ) {
                return null;
              }

              return (
              <div
                key={index}
                className={`flex ${
                  message.role === "user" ? "justify-end" : "justify-start"
                } ${
                  index === 0 ? "" : isGroupedAssistant ? "mt-1" : "mt-4"
                }`}
              >
                <div
                  className={
                    hasVisibleProducts
                      ? "group/message w-full min-w-0"
                      : "group/message max-w-5xl"
                  }
                >
                  {message.role === "assistant" ? (
                    <div className="space-y-1">
                      {splitAssistantContent(message.content).map(
                        (part, partIndex) => (
                          <div
                            key={`${index}-${partIndex}`}
                            className="w-fit max-w-2xl whitespace-pre-wrap rounded-[28px] rounded-bl-md border border-white/[0.06] bg-slate-800 px-5 py-2.5 text-lg leading-7 text-slate-100 shadow-sm"
                          >
                            {part}
                          </div>
                        )
                      )}
                    </div>
                  ) : (
                    <div className="ml-auto w-fit max-w-2xl whitespace-pre-wrap rounded-[28px] rounded-br-md bg-purple-500 px-5 py-2.5 text-lg leading-7 text-white shadow-sm">
                      {message.content}
                    </div>
                  )}

                  {shouldShowMessageActions && (
                    <div
                      className={`pointer-events-none mt-0.5 flex h-5 gap-1.5 opacity-0 transition-opacity duration-150 group-hover/message:pointer-events-auto group-hover/message:opacity-100 group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100 ${
                        message.role === "user"
                          ? "justify-end"
                          : "justify-start"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          copyMessage(
                            message.role === "assistant"
                              ? assistantGroupContent(index)
                              : message.content,
                            copyKey
                          )
                        }
                        aria-label={isCopied ? "Copied" : "Copy message"}
                        className={`rounded-lg p-1.5 transition hover:bg-white/10 ${
                          isCopied
                            ? "text-emerald-400"
                            : "text-slate-500 hover:text-slate-200"
                        }`}
                      >
                        {isCopied ? <Check size={18} /> : <Copy size={18} />}
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
                  )}

                  {message.role === "assistant" &&
                    isLastAssistantInGroup &&
                    groupProducts.length > 0 && (
                      <ProductCarousel
                        products={groupProducts}
                        cartProductIds={cart.map((item) => item.id)}
                        onAddToCart={addToCart}
                        onViewDetails={viewProductDetails}
                        onFollowUp={sendMessage}
                        searchContext={productSearchContextBefore(index)}
                        excludedProductNames={displayedProductNamesUntil(index)}
                        disabled={loading}
                      />
                    )}
                </div>
              </div>
              );
            })}

            {loading && (
              <SearchProgress />
            )}
          </div>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-4 pb-6 sm:px-6 sm:pb-8">
          <div className="mx-auto w-full max-w-2xl space-y-3">
            {!loading &&
              !locationPromptDismissed &&
              !sharedLocation &&
              (selectedProduct !== null ||
                cart.length > 0 ||
                messages[messages.length - 1]?.agentState?.intent ===
                  "delivery" ||
                messages[messages.length - 1]?.agentState?.intent ===
                  "checkout") && (
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
              className={`shopping-composer pointer-events-auto flex gap-2 rounded-[28px] border p-2.5 ${
                composerGlass
                  ? "backdrop-blur-2xl backdrop-saturate-150"
                  : ""
              }`}
            >
              <div className="shopping-composer-icon flex items-center pl-1">
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
                className="shopping-composer-input min-w-0 flex-1 bg-transparent px-3 text-lg outline-none"
              />

              <button
                type="button"
                onClick={() => sendMessage()}
                disabled={loading}
                aria-label="Send message"
                className="shopping-composer-send flex h-11 w-11 shrink-0 items-center justify-center rounded-full disabled:opacity-50"
              >
                <Send size={18} />
              </button>
            </div>
          </div>
        </div>
          </>
        )}
      </section>

      {savedChatsOpen && (
        <div
          data-closing={savedChatsClosing}
          className="saved-chats-backdrop fixed inset-0 z-40 flex justify-start bg-slate-950/70 backdrop-blur-sm"
        >
          <button
            type="button"
            aria-label="Close saved chats"
            onClick={closeSavedChatsDrawer}
            className="absolute inset-0 cursor-default"
          />

          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="saved-chats-title"
            data-closing={savedChatsClosing}
            className="saved-chats-drawer relative flex h-full w-full max-w-md flex-col border-r border-white/10 bg-slate-950 shadow-2xl"
          >
            <div className="flex items-start justify-between border-b border-white/10 p-6">
              <div>
                <div
                  id="saved-chats-title"
                  className="mb-2 flex items-center gap-2 text-2xl font-bold"
                >
                  <History size={18} />
                  Recent Searches
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Reopen a chat to restore its conversation and cart.
                </p>
              </div>

              <button
                type="button"
                onClick={closeSavedChatsDrawer}
                aria-label="Close saved chats"
                className="panel-close-button rounded-xl p-2 transition"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-6">
              <button
                type="button"
                onClick={startNewChat}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-purple-500 px-4 py-3 text-sm font-bold text-white transition hover:bg-purple-400"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/15">
                  <Plus size={16} strokeWidth={2.5} />
                </span>
                Start new shopping chat
              </button>

              {savedChats.length === 0 ? (
                <div className="rounded-3xl border border-white/10 bg-white/[0.045] p-5 text-sm leading-6 text-slate-400">
                  Your saved chats will appear here after you search or add
                  items to a cart.
                </div>
              ) : (
                savedChats.map((chat) => (
                  <SavedChatCard
                    key={chat.id}
                    chat={chat}
                    active={chat.id === activeChatId}
                    onOpen={openSavedChat}
                  />
                ))
              )}
            </div>
          </aside>
        </div>
      )}

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
            className="cart-drawer relative flex h-full w-full max-w-xl flex-col border-l border-white/10 bg-slate-950 shadow-2xl"
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
                className="panel-close-button rounded-xl p-2 transition"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-6">
              {cart.length === 0 ? (
                <>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-sm text-slate-400">
                    Cart items will appear here after you add a product.
                  </div>

                  {savedCartChats.length > 0 && (
                    <section className="rounded-3xl border border-purple-400/20 bg-purple-500/10 p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <History size={17} className="text-purple-300" />
                        <h3 className="text-sm font-bold text-white">
                          Buy again
                        </h3>
                      </div>

                      <div className="space-y-2">
                        {savedCartChats.map((chat) => {
                          const quantity = chat.cart.reduce(
                            (total, item) => total + item.quantity,
                            0
                          );
                          const total = chat.cart.reduce(
                            (sum, item) => sum + (item.price || 0) * item.quantity,
                            0
                          );

                          return (
                            <button
                              key={chat.id}
                              type="button"
                              onClick={() => restoreSavedCart(chat)}
                              className="flex w-full items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.045] p-3 text-left transition hover:border-purple-300/60 hover:bg-white/[0.08]"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-white">
                                  {chat.title}
                                </p>
                                <p className="mt-1 text-xs text-slate-400">
                                  {quantity} item{quantity === 1 ? "" : "s"} in
                                  cart
                                </p>
                              </div>
                              <span className="shrink-0 text-sm font-bold text-purple-300">
                                Rs. {total.toLocaleString()}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  )}
                </>
              ) : (
                cart.map((item) => (
                  <CartItemRow
                    key={item.id}
                    item={item}
                    onChangeQuantity={changeCartQuantity}
                    onRemove={removeFromCart}
                  />
                ))
              )}
            </div>

            {cart.length > 0 && (
              <div className="border-t border-white/10 p-6">
                <div className="rounded-2xl border border-purple-500/30 bg-purple-500/10 p-4">
                  <p className="text-sm text-slate-300">Cart total</p>
                  <p className="mt-1 text-2xl font-bold text-purple-300">
                    Rs. {cartTotal.toLocaleString()}
                  </p>

                  <button
                    type="button"
                    onClick={() => {
                      setShoppingFlowStep("delivery");
                      persistActiveChatSnapshot(
                        messages,
                        cart,
                        checkedDelivery,
                        checkoutState,
                        "delivery"
                      );
                      setCartOpen(false);
                      setDeliveryPanelOpen(true);
                    }}
                    className="mt-4 w-full rounded-xl bg-purple-500 px-4 py-3 text-sm font-semibold text-white hover:bg-purple-400"
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
        onProgressStepClick={openShoppingFlowTarget}
        onContinueToCheckout={(result) => {
          setCheckedDelivery(result);
          setShoppingFlowStep("checkout");
          persistActiveChatSnapshot(
            messages,
            cart,
            result,
            checkoutState,
            "checkout"
          );
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
        checkoutState={checkoutState}
        onCheckoutStateChange={handleCheckoutStateChange}
        onProgressStepClick={openShoppingFlowTarget}
        onClose={() => setCheckoutPanelOpen(false)}
      />
    </main>
  );
}
