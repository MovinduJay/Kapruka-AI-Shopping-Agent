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

export type AgentToolCall = {
  name: string;
  status: "called" | "skipped" | "failed";
  latencyMs?: number;
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
  tools: AgentToolCall[];
  memoryPatch?: AgentMemory;
  ranking?: ProductRankingSignal[];
  humanReviewRequired: boolean;
  observations: string[];
};

export type AgentChatResponse = {
  reply?: string;
  error?: string;
  products?: ProductCard[];
  agentState?: AgentState;
  debug?: unknown;
};
