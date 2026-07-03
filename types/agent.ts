import type { ProductCard } from "@/types/product";

export type AgentStepStatus = "pending" | "running" | "completed" | "blocked";

export type AgentStep = {
  id:
    | "understand"
    | "search_products"
    | "compare_products"
    | "check_delivery"
    | "recommend"
    | "cart"
    | "checkout";
  label: string;
  status: AgentStepStatus;
};

export type AgentAction = {
  id:
    | "reply"
    | "searchProducts"
    | "getProductDetails"
    | "compareProducts"
    | "checkDelivery"
    | "prepareCart"
    | "prepareCheckout"
    | "trackOrder";
  label: string;
  toolName?: string;
  needsConfirmation?: boolean;
};

export type AgentToolCall = {
  name: string;
  status: "called" | "skipped" | "failed";
  latencyMs?: number;
  arguments?: unknown;
};

export type AgentMemory = {
  preferredBudget?: number | null;
  deliveryCity?: string | null;
  giftRecipients?: string[];
  favoriteCategories?: string[];
  recentSearches?: string[];
};

export type ProductRankingSignal = {
  productId: string;
  score: number;
  reasons: string[];
};

export type AgentState = {
  traceId: string;
  goal: string;
  intent:
    | "small_talk"
    | "product_search"
    | "compare"
    | "delivery"
    | "cart"
    | "checkout"
    | "order_tracking";
  currentStep: AgentStep["id"];
  steps: AgentStep[];
  plannedActions?: AgentAction[];
  tools: AgentToolCall[];
  memoryPatch?: AgentMemory;
  memoryNotes?: string[];
  ranking?: ProductRankingSignal[];
  humanReviewRequired: boolean;
  observations: string[];
};

export type OrderTrackingResult = {
  orderNumber: string;
  status: string;
  statusDisplay: string;
  orderDate?: string | null;
  deliveryDate?: string | null;
  shippedDate?: string | null;
  amount?: {
    value: string;
    currency: string;
  } | null;
  comments?: string | null;
  recipientCity?: string | null;
  progress: Array<{
    step: string;
    timestamp: string;
  }>;
  liveTrackingAvailable: boolean;
  hasDeliveryVideo: boolean;
  hasDeliveryPhoto: boolean;
};

export type AgentChatResponse = {
  reply?: string;
  error?: string;
  products?: ProductCard[];
  agentState?: AgentState;
  tracking?: OrderTrackingResult;
  debug?: unknown;
};
