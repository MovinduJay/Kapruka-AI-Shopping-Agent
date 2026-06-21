import type { Prisma } from "@prisma/client";
import { hasDatabaseUrl, prisma } from "@/lib/prisma";
import type { AgentMemory, AgentState, AgentToolCall } from "@/types/agent";
import type { ProductCard } from "@/types/product";

export const sessionCookieName = "kapruka_session";

type PersistAgentRunInput = {
  sessionId?: string | null;
  userMessage: string;
  assistantReply?: string | null;
  agentState: AgentState;
  products: ProductCard[];
  latencyMs?: number | null;
  error?: string | null;
};

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function mergeUnique(existing: string[] = [], additions: string[] = []) {
  return [...new Set([...additions, ...existing])].filter(Boolean).slice(0, 12);
}

export function mergeAgentMemoryForPersistence(
  current: AgentMemory = {},
  patch: AgentMemory = {}
): AgentMemory {
  return {
    preferredBudget: patch.preferredBudget ?? current.preferredBudget ?? null,
    deliveryCity: patch.deliveryCity ?? current.deliveryCity ?? null,
    giftRecipients: mergeUnique(current.giftRecipients, patch.giftRecipients),
    favoriteCategories: mergeUnique(
      current.favoriteCategories,
      patch.favoriteCategories
    ),
    recentSearches: mergeUnique(current.recentSearches, patch.recentSearches),
  };
}

export async function upsertUserSession(
  sessionToken: string,
  userAgent?: string | null
) {
  if (!hasDatabaseUrl()) return null;

  try {
    return await prisma.userSession.upsert({
      where: { sessionToken },
      create: {
        sessionToken,
        userAgent: userAgent || null,
        lastSeenAt: new Date(),
      },
      update: {
        userAgent: userAgent || undefined,
        lastSeenAt: new Date(),
      },
    });
  } catch (error) {
    console.warn("Could not persist user session:", error);
    return null;
  }
}

export async function getAgentMemoryForSession(sessionId?: string | null) {
  if (!sessionId || !hasDatabaseUrl()) return {};

  try {
    const preference = await prisma.userPreference.findUnique({
      where: { sessionId },
    });

    if (!preference) return {};

    return {
      preferredBudget: preference.preferredBudget,
      deliveryCity: preference.deliveryCity,
      giftRecipients: preference.giftRecipients,
      favoriteCategories: preference.favoriteCategories,
      recentSearches: preference.recentSearches,
    } satisfies AgentMemory;
  } catch (error) {
    console.warn("Could not read user preferences:", error);
    return {};
  }
}

export async function persistAgentMemory(
  sessionId: string | null | undefined,
  patch: AgentMemory
) {
  if (!sessionId || !hasDatabaseUrl()) return;

  try {
    const current = await getAgentMemoryForSession(sessionId);
    const next = mergeAgentMemoryForPersistence(current, patch);

    await prisma.userPreference.upsert({
      where: { sessionId },
      create: {
        sessionId,
        preferredBudget: next.preferredBudget ?? null,
        deliveryCity: next.deliveryCity ?? null,
        giftRecipients: next.giftRecipients || [],
        favoriteCategories: next.favoriteCategories || [],
        recentSearches: next.recentSearches || [],
      },
      update: {
        preferredBudget: next.preferredBudget ?? null,
        deliveryCity: next.deliveryCity ?? null,
        giftRecipients: next.giftRecipients || [],
        favoriteCategories: next.favoriteCategories || [],
        recentSearches: next.recentSearches || [],
      },
    });
  } catch (error) {
    console.warn("Could not persist user preferences:", error);
  }
}

export async function persistAgentRun({
  sessionId,
  userMessage,
  assistantReply,
  agentState,
  products,
  latencyMs,
  error,
}: PersistAgentRunInput) {
  if (!hasDatabaseUrl()) return;

  try {
    await prisma.agentRun.upsert({
      where: { traceId: agentState.traceId },
      create: {
        traceId: agentState.traceId,
        sessionId: sessionId || null,
        userMessage,
        assistantReply: assistantReply || null,
        intent: agentState.intent,
        goal: agentState.goal,
        currentStep: agentState.currentStep,
        humanReviewRequired: agentState.humanReviewRequired,
        latencyMs: latencyMs ?? null,
        productCount: products.length,
        productsJson: json(products),
        rankingJson: json(agentState.ranking || []),
        observationsJson: json(agentState.observations || []),
        error: error || null,
        toolCalls: {
          create: agentState.tools.map((tool) => toolCallToCreate(tool)),
        },
      },
      update: {
        assistantReply: assistantReply || null,
        latencyMs: latencyMs ?? null,
        productCount: products.length,
        productsJson: json(products),
        rankingJson: json(agentState.ranking || []),
        observationsJson: json(agentState.observations || []),
        error: error || null,
      },
    });

    if (agentState.memoryPatch) {
      await persistAgentMemory(sessionId, agentState.memoryPatch);
    }
  } catch (persistError) {
    console.warn("Could not persist agent run:", persistError);
  }
}

function toolCallToCreate(tool: AgentToolCall) {
  return {
    name: tool.name,
    status: tool.status,
    latencyMs: tool.latencyMs ?? null,
    argumentsJson: json(tool.arguments || null),
  };
}

export async function persistCartSnapshot(
  sessionId: string | null | undefined,
  cart: ProductCard[]
) {
  if (!sessionId || !hasDatabaseUrl()) return;

  try {
    await prisma.cartSnapshot.create({
      data: {
        sessionId,
        itemsJson: json(cart),
        total: cart.reduce((sum, item) => sum + (item.price || 0), 0),
      },
    });
  } catch (error) {
    console.warn("Could not persist cart snapshot:", error);
  }
}

export async function persistProductInteraction({
  sessionId,
  product,
  action,
  metadata,
}: {
  sessionId?: string | null;
  product: Pick<ProductCard, "id" | "name">;
  action: string;
  metadata?: unknown;
}) {
  if (!sessionId || !hasDatabaseUrl()) return;

  try {
    await prisma.productInteraction.create({
      data: {
        sessionId,
        productId: product.id,
        productName: product.name,
        action,
        metadata: metadata ? json(metadata) : undefined,
      },
    });
  } catch (error) {
    console.warn("Could not persist product interaction:", error);
  }
}
