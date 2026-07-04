import type {
  AgentMemory,
  AgentAction,
  AgentState,
  AgentStep,
  AgentStepStatus,
  AgentToolCall,
  OrderTrackingResult,
  ProductRankingSignal,
} from "@/types/agent";
import { generateText } from "ai";
import { groq } from "@ai-sdk/groq";
import { google } from "@ai-sdk/google";
import {
  getAgentMemoryForSession,
  mergeAgentMemoryForPersistence,
  persistAgentRun,
} from "@/lib/agent-persistence";
import {
  extractKaprukaProductImages,
  normalizeKaprukaImageUrl,
} from "@/lib/kapruka-images";

type GroqOutputContent = {
  type?: string;
  text?: string;
};

type GroqOutputItem = {
  type?: string;
  role?: string;
  name?: string;
  arguments?: string;
  output?: unknown;
  content?: GroqOutputContent[];
};

type GroqResponse = {
  id?: string;
  status?: string;
  output?: GroqOutputItem[];
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
};

type AnyRecord = Record<string, unknown>;

type LocationContext = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
};

type ChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

type ProductLike = {
  id: string;
  name: string;
  price: number | null;
  currency: "LKR";
  compareAtPrice?: number | null;
  imageUrl?: string | null;
  productUrl?: string | null;
  inStock?: boolean | null;
  stockLevel?: "low" | "medium" | "high" | null;
  description?: string | null;
  reason?: string;
  rating?: number | null;
  reviewCount?: number | null;
  brand?: string | null;
  category?: string | null;
  shipsInternationally?: boolean | null;
  freeShipping?: boolean | null;
  priceValidUntil?: string | null;
  agentScore?: number;
  rankingReason?: string;
};

type ProductPageMetadata = Pick<
  ProductLike,
  | "imageUrl"
  | "price"
  | "compareAtPrice"
  | "inStock"
  | "description"
  | "rating"
  | "reviewCount"
  | "brand"
  | "category"
  | "freeShipping"
  | "priceValidUntil"
>;

type JsonRpcResponse<T> = {
  result?: T;
  error?: {
    code?: number;
    message?: string;
  };
};

type McpToolResult = {
  content?: Array<{
    type?: string;
    text?: string;
  }>;
  structuredContent?: {
    result?: string;
  };
  isError?: boolean;
};

type DeliveryCity = {
  name: string;
  aliases?: string[];
};

type DeliveryCheckResult = {
  city?: string;
  checked_date?: string;
  available?: boolean;
  rate?: number;
  currency?: string;
  reason?: string | null;
  next_available_date?: string | null;
  perishable_warning?: string | null;
};

type TrackOrderResult = {
  order_number?: string;
  status?: string;
  status_display?: string;
  order_date?: string;
  delivery_date?: string;
  shipped_date?: string | null;
  amount?: string | { value?: string; currency?: string };
  comments?: string | null;
  recipient?: {
    name?: string;
    phone?: string;
    address?: string;
    city?: string;
  };
  progress?: Array<{
    step?: string;
    timestamp?: string;
  }>;
  live_tracking_available?: boolean;
  has_delivery_video?: boolean;
  has_delivery_photo?: boolean;
  items?: Array<{
    product_id?: string;
    name?: string;
    quantity?: number;
    selling_price?: number;
  }>;
};

const productMetadataCache = new Map<string, ProductPageMetadata | null>();
const productMcpMetadataCache = new Map<string, ProductPageMetadata | null>();
const PRODUCT_CARD_LIMIT = 8;
const SEARCH_RESULT_LIMIT = 20;
const TRACKING_EXAMPLE_ORDER_NUMBER = "VPAY827982BA";
const MCP_URL =
  process.env.KAPRUKA_MCP_URL || "https://mcp.kapruka.com/mcp";
const MCP_HEADERS = {
  Accept: "application/json, text/event-stream",
  "Content-Type": "application/json",
};

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMcpResponse<T>(text: string): JsonRpcResponse<T> {
  const dataLines = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);

  return JSON.parse(
    dataLines.length > 0 ? dataLines.join("\n") : text
  ) as JsonRpcResponse<T>;
}

function parseMcpToolJson(value: McpToolResult) {
  const text =
    value.structuredContent?.result ||
    value.content?.find((item) => item.type === "text")?.text;

  if (!text || value.isError) return null;

  return parsePossibleJson(text);
}

function mcpToolErrorText(value: McpToolResult) {
  const text =
    value.structuredContent?.result ||
    value.content?.find((item) => item.type === "text")?.text ||
    "";
  const trimmed = text.trim();

  return value.isError || /^error\s*:/i.test(trimmed) ? trimmed : null;
}

async function startDirectMcpSession() {
  const response = await fetch(MCP_URL, {
    method: "POST",
    headers: MCP_HEADERS,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: {
          name: "kapruka-ai-shopping-agent",
          version: "1.0.0",
        },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = parseMcpResponse<unknown>(await response.text());
  const sessionId = response.headers.get("mcp-session-id");

  if (!response.ok || payload.error || !sessionId) {
    throw new Error(payload.error?.message || "Could not connect to Kapruka.");
  }

  const headers = {
    ...MCP_HEADERS,
    "mcp-session-id": sessionId,
  };

  await fetch(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
    signal: AbortSignal.timeout(15_000),
  });

  return headers;
}

async function callDirectMcpTool(
  headers: Record<string, string>,
  id: number,
  name: string,
  params: Record<string, unknown>
) {
  const response = await fetch(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: {
        name,
        arguments: {
          params,
        },
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = parseMcpResponse<McpToolResult>(await response.text());

  if (!response.ok || payload.error || !payload.result) {
    throw new Error(payload.error?.message || `${name} failed.`);
  }

  return payload.result;
}

function extractText(response: GroqResponse): string {
  const output = response.output || [];

  for (let i = output.length - 1; i >= 0; i--) {
    const item = output[i];

    if (item.type === "message" && Array.isArray(item.content)) {
      const text = item.content
        .filter((content) => content.type === "output_text")
        .map((content) => content.text)
        .filter(Boolean)
        .join("\n")
        .trim();

      if (text) return text;
    }
  }

  return "I couldn't pull together a useful answer that time. Try me once more.";
}

function cleanProductName(name: string) {
  const decodedNumericRuns = name.replace(
    /(?:(?:&|n)?#\d+;){2,}/gi,
    (run) => {
      const bytes = [...run.matchAll(/#(\d+);/g)].map((match) =>
        Number(match[1])
      );

      return bytes.every((byte) => byte >= 0 && byte <= 255)
        ? new TextDecoder().decode(Uint8Array.from(bytes))
        : run;
    }
  );

  return decodedNumericRuns
    .replace(/\*\*/g, "")
    .replace(/(?:&|n)?#(\d+);/gi, (_, code: string) =>
      String.fromCodePoint(Number(code))
    )
    .replace(/#226;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isBadProductName(name: string) {
  const cleaned = name.trim().toLowerCase();

  return (
    cleaned.startsWith("{") ||
    cleaned.startsWith("[") ||
    cleaned.includes('"result"') ||
    cleaned.includes("kapruka search") ||
    cleaned.includes("delivery available") ||
    cleaned.includes("delivery fee") ||
    cleaned.includes("no products found") ||
    cleaned.length > 150
  );
}

function removeRoboticLines(reply: string) {
  const bannedPatterns = [
    /gifts that come from the heart/i,
    /always the most precious/i,
    /resonates with/i,
    /truly memorable birthday celebration/i,
    /delightful experience/i,
    /perfect choice for your loved one/i,
  ];

  return reply
    .split("\n")
    .filter((line) => !bannedPatterns.some((pattern) => pattern.test(line)))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeUrl(url: string | null | undefined) {
  if (!url) return null;

  const cleaned = url.trim().replace(/[),.]+$/g, "");

  if (!cleaned) return null;

  if (cleaned.startsWith("http://") || cleaned.startsWith("https://")) {
    return cleaned;
  }

  if (cleaned.startsWith("//")) {
    return `https:${cleaned}`;
  }

  if (cleaned.startsWith("/")) {
    return `https://www.kapruka.com${cleaned}`;
  }

  return cleaned;
}

function pickString(obj: AnyRecord, keys: string[]) {
  for (const key of keys) {
    const value = obj[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function pickNumber(obj: AnyRecord, keys: string[]) {
  for (const key of keys) {
    const value = obj[key];

    if (typeof value === "number") {
      return value;
    }

    if (typeof value === "string") {
      const match = value.replace(/,/g, "").match(/(\d+(\.\d+)?)/);

      if (match) {
        return Number(match[1]);
      }
    }

    if (isRecord(value)) {
      const amount = value.amount;

      if (typeof amount === "number") {
        return amount;
      }

      if (typeof amount === "string") {
        const match = amount.replace(/,/g, "").match(/(\d+(\.\d+)?)/);

        if (match) {
          return Number(match[1]);
        }
      }
    }
  }

  return null;
}

function isImplausiblySmallLivePrice(
  livePrice: number | null,
  catalogPrice: number | null
) {
  if (livePrice === null || catalogPrice === null) return false;
  if (livePrice >= catalogPrice) return false;

  return catalogPrice >= 1000 && livePrice < catalogPrice * 0.05;
}

function pickBoolean(obj: AnyRecord, keys: string[]) {
  for (const key of keys) {
    const value = obj[key];

    if (typeof value === "boolean") return value;

    if (typeof value === "string") {
      if (value.toLowerCase() === "true") return true;
      if (value.toLowerCase() === "false") return false;
    }
  }

  return null;
}

function pickStockLevel(obj: AnyRecord) {
  const value = pickString(obj, ["stock_level", "stockLevel"]);

  return value === "low" || value === "medium" || value === "high"
    ? value
    : null;
}

function pickCategoryName(obj: AnyRecord) {
  const category = obj.category;

  if (typeof category === "string" && category.trim()) {
    return category.trim();
  }

  if (isRecord(category)) {
    return pickString(category, ["name", "title", "slug"]);
  }

  return null;
}

function pickBrandName(obj: AnyRecord) {
  const direct = pickString(obj, ["brand", "vendor", "manufacturer"]);

  if (direct) return direct;

  for (const key of ["brand", "vendor", "manufacturer", "attributes"]) {
    const value = obj[key];

    if (isRecord(value)) {
      const nested = pickString(value, ["name", "brand", "vendor"]);
      if (nested) return nested;
    }
  }

  return null;
}

function pickNestedImageUrl(obj: AnyRecord) {
  const direct = pickString(obj, [
    "image",
    "image_url",
    "imageUrl",
    "imageURL",
    "thumbnail",
    "thumbnail_url",
    "thumbnailUrl",
    "main_image",
    "mainImage",
    "img",
    "img_url",
    "photo",
    "photo_url",
    "picture",
    "picture_url",
  ]);

  if (direct) return normalizeKaprukaImageUrl(direct);

  const images = obj.images;

  if (Array.isArray(images)) {
    for (const image of images) {
      if (typeof image === "string") {
        const url = normalizeKaprukaImageUrl(image);
        if (url) return url;
      }

      if (isRecord(image)) {
        const nested = pickString(image, [
          "url",
          "src",
          "image",
          "image_url",
          "thumbnail",
          "large",
          "medium",
          "small",
        ]);

        if (nested) return normalizeKaprukaImageUrl(nested);
      }
    }
  }

  return null;
}

function pickNestedProductUrl(obj: AnyRecord) {
  const direct = pickString(obj, [
    "url",
    "product_url",
    "productUrl",
    "productURL",
    "link",
    "href",
    "web_url",
    "webUrl",
    "details_url",
    "detailsUrl",
    "kapruka_url",
    "kaprukaUrl",
  ]);

  return normalizeUrl(direct);
}

function parsePossibleJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function looksLikeProduct(obj: AnyRecord) {
  const name = pickString(obj, [
    "name",
    "title",
    "product_name",
    "productName",
    "display_name",
    "displayName",
  ]);

  const price = pickNumber(obj, [
    "price",
    "price_lkr",
    "lkr_price",
    "selling_price",
    "sellingPrice",
    "amount",
    "unit_price",
    "unitPrice",
  ]);

  const id = pickString(obj, [
    "id",
    "product_id",
    "productId",
    "product_code",
    "productCode",
    "code",
    "item_code",
    "itemCode",
    "sku",
  ]);

  const imageUrl = pickNestedImageUrl(obj);
  const productUrl = pickNestedProductUrl(obj);

  return Boolean(name && (price !== null || id || imageUrl || productUrl));
}

function collectProductObjects(value: unknown, output: AnyRecord[] = []) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectProductObjects(item, output);
    }

    return output;
  }

  if (!isRecord(value)) {
    return output;
  }

  if (looksLikeProduct(value)) {
    output.push(value);
    return output;
  }

  for (const nestedValue of Object.values(value)) {
    collectProductObjects(nestedValue, output);
  }

  return output;
}

function productFromObject(obj: AnyRecord, index: number): ProductLike | null {
  const rawName = pickString(obj, [
    "name",
    "title",
    "product_name",
    "productName",
    "display_name",
    "displayName",
  ]);

  if (!rawName) return null;

  const name = cleanProductName(rawName);

  if (isBadProductName(name)) return null;

  const price = pickNumber(obj, [
    "price",
    "price_lkr",
    "lkr_price",
    "selling_price",
    "sellingPrice",
    "amount",
    "unit_price",
    "unitPrice",
  ]);

  const rawId = pickString(obj, [
      "id",
      "product_id",
      "productId",
      "product_code",
      "productCode",
      "code",
      "item_code",
      "itemCode",
      "sku",
    ]) ?? `${index}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  const imageUrl = pickNestedImageUrl(obj);
  const productUrl = pickNestedProductUrl(obj);
  const description = pickString(obj, [
    "summary",
    "description",
    "short_description",
    "shortDescription",
  ]);

  const inStock = pickBoolean(obj, [
    "in_stock",
    "inStock",
    "available",
    "is_available",
    "isAvailable",
    "stock",
  ]);
  const stockLevel = pickStockLevel(obj);
  const compareAtPrice = pickNumber(obj, [
    "compare_at_price",
    "compareAtPrice",
    "original_price",
    "originalPrice",
    "list_price",
    "listPrice",
  ]);
  const rating = pickNumber(obj, [
    "rating",
    "rating_value",
    "ratingValue",
    "average_rating",
    "averageRating",
  ]);
  const reviewCount = pickNumber(obj, [
    "review_count",
    "reviewCount",
    "reviews_count",
    "ratings_count",
  ]);
  const shipsInternationally = pickBoolean(obj, [
    "ships_internationally",
    "shipsInternationally",
  ]);

  return {
    id: String(rawId),
    name,
    price,
    currency: "LKR",
    imageUrl,
    productUrl,
    inStock,
    stockLevel,
    compareAtPrice,
    description,
    rating,
    reviewCount,
    brand: pickBrandName(obj),
    category: pickCategoryName(obj),
    shipsInternationally,
  };
}

function cleanSearchQuery(message: string) {
  return message
    .toLowerCase()
    .replace(
      /\b(?:under|nder|below|less than|up to|max(?:imum)?|budget(?: of)?|around|about)\s*(?:rs\.?|lkr)?\s*[\d,]+(?:\.\d+)?\s*k?\b/gi,
      " "
    )
    .replace(/\b(?:rs\.?|lkr)\s*[\d,]+(?:\.\d+)?\s*k?\b/gi, " ")
    .replace(
      /\b(?:please|pls|just|show\s*me|show|find me|find|get me|give me|give|search for|search|browse for|browse|shop for|shop|looking for|look for|i need|i want|n+e{2,}d|need|want|recommend me|recommend|suggest me|suggest|choose from|to choose|within|best[ -]value|more|may be|maybe)\b/gi,
      " "
    )
    .replace(
      /\b(?:do+\s*y?ou\s+have|have you got|have any|are there any|is there any|is there|do you sell|can i get|can i buy|available|really|actually|what)\b/gi,
      " "
    )
    .replace(/\b(?:deliver|delivered|delivery|shipping|islandwide)\b/gi, " ")
    .replace(
      /\b(?:for me|a|an|the|for|to|some|any|options?|choices?|products?|items?)\b/gi,
      " "
    )
    .replace(/[^\p{L}\p{N}\s.'+-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function searchTokens(value: string) {
  const weakTerms = new Set([
    "help",
    "advice",
    "idea",
    "ideas",
    "thing",
    "things",
    "something",
    "anything",
    "stuff",
    "one",
    "ones",
    "kapruka",
    "please",
    "pls",
    "plz",
    "yeah",
    "yes",
    "yep",
    "sure",
    "okay",
    "ok",
    "bad",
    "day",
    "mood",
    "vibe",
    "fun",
    "cool",
  ]);

  return cleanSearchQuery(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !weakTerms.has(token));
}

function hasSearchableProductPhrase(message: string) {
  if (isEmotionalSmallTalk(message) && !extractBudget(message, {})) {
    return false;
  }

  return searchTokens(message).length > 0;
}

function isSearchConfirmation(message: string) {
  return /^(?:\?+|yes(?: please| pls| plz|\s*show\s*me)?|yeah(?: please| pls| plz|\s*show\s*me)?|yep(?: please| pls| plz|\s*show\s*me)?|sure(?: please| pls| plz|\s*show\s*me)?|okay|ok|please|pls|plz|please do|do it|go ahead|sounds good|show\s*me|show them|send them)$/i.test(
    message.trim()
  );
}

function isMoreProductFollowUp(message: string) {
  const normalized = stripExcludedProductsInstruction(message)
    .toLowerCase()
    .trim();

  return /^(?:\?+|more|more please|show\s+(?:me\s+)?(?:\d+\s+)?more|load\s+(?:\d+\s+)?more|another|another 8|others?|other options?|alternatives?|more options?|anything else|more like that|similar|different|cheaper|premium)\b/i.test(
    normalized
  );
}

function recentAssistantSuggestedShopping(history: ChatHistoryMessage[]) {
  return history
    .slice()
    .reverse()
    .find(
      (item) =>
        item.role === "assistant" &&
        /\b(?:kapruka|shop|shopping|browse|search|look up|find|found|show|options?|latest options|pull the latest|find something|find out|products?|picks?|recommend|suggest|what kind|what vibe|mood-boosting|give me a sec|running the search)\b/i.test(
          item.content
        )
    )?.content;
}

function recentSearchableUserContext(history: ChatHistoryMessage[]) {
  return history
    .slice()
    .reverse()
    .find(
      (item) => {
        if (item.role !== "user") return false;

        const tokens = searchTokens(item.content);
        const styleOnly =
          tokens.length > 0 &&
          tokens.length <= 2 &&
          tokens.every((token) =>
            /^(?:casual|basic|basics|plain|graphic|print|prints|sporty|sportier|formal|office|cotton|crew|crewneck|white|black|grey|gray|navy)$/.test(
              token
            )
          );

        return (
          extractBudget(item.content, {}) !== null ||
          hasConcreteShoppingSubject(item.content) ||
          (hasSearchableProductPhrase(item.content) && !styleOnly)
        );
      }
    )?.content;
}

function recentShoppingContext(history: ChatHistoryMessage[]) {
  return history
    .slice()
    .reverse()
    .find(
      (item) =>
        item.role === "user" &&
        /\b(?:gift|birthday|anniversary|mother|mom|mum|amma|father|dad|wife|husband|girlfriend|boyfriend|friend|flowers?|cakes?|hampers?|gadgets?|electronics?|devices?|accessories|speakers?|chargers?|powerbanks?|headphones?|earbuds?|watches?|phones?|laptops?|toys?|bags?|shoes?|dress|shirts?|t-?shirts?|tee\s*shirts?|tees?|groceries|rice cooker)\b/i.test(
          item.content
        )
    )?.content;
}

function recentConcreteProductContext(history: ChatHistoryMessage[]) {
  return history
    .slice()
    .reverse()
    .find((item) => item.role === "user" && hasConcreteShoppingSubject(item.content))
    ?.content;
}

function isPronounProductCardFollowUp(message: string) {
  const normalized = stripExcludedProductsInstruction(message)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  return /\b(?:show|send|pull|display)\b[\s\S]{0,35}\b(?:cards?|them|those)\b|\b(?:cards?|them|those)\b[\s\S]{0,25}\b(?:show|send|pull|display)\b/i.test(
    normalized
  );
}

function isSendBunchFollowUp(message: string) {
  const normalized = stripExcludedProductsInstruction(message)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  return /\b(?:send|show|give)\b[\s\S]{0,20}\b(?:bunch|batch|lot|few|some)\b|\bno\s+just\s+send\b/i.test(
    normalized
  );
}

function isBudgetOnlyFollowUp(message: string) {
  const normalized = stripExcludedProductsInstruction(message)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  return (
    extractBudget(normalized, {}) !== null &&
    searchTokens(normalized).length === 0
  );
}

function isShortSearchRefinement(
  message: string,
  history: ChatHistoryMessage[]
) {
  const normalized = stripExcludedProductsInstruction(message)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized || normalized.split(/\s+/).length > 5) return false;

  const recentProductRequest = recentSearchableUserContext(history);
  const recentAssistantQuestion = history
    .slice()
    .reverse()
    .find(
      (item) =>
        item.role === "assistant" &&
        /\b(?:what kind|what style|what vibe|casual basics|graphic prints|sportier|plain|cotton|crew-neck|crew neck|white|navy|grey|gray|line up|pull together|show|options?)\b/i.test(
          item.content
        )
    );

  return (
    Boolean(recentProductRequest && recentAssistantQuestion) &&
    /\b(?:casual|basic|basics|plain|graphic|print|prints|sporty|sportier|formal|office|cotton|crew|crewneck|crew-neck|white|black|grey|gray|navy|bunch|batch|lot|few|some)\b/i.test(
      normalized
    )
  );
}

function effectiveProductSearchContext(
  message: string,
  history: ChatHistoryMessage[]
) {
  const cleanedMessage = stripExcludedProductsInstruction(message) || message;
  const previousSearch = recentSearchableUserContext(history);
  const previousConcreteSearch =
    recentConcreteProductContext(history) || previousSearch;

  if (
    previousConcreteSearch &&
    (isPronounProductCardFollowUp(cleanedMessage) ||
      isSendBunchFollowUp(cleanedMessage) ||
      isBudgetOnlyFollowUp(cleanedMessage))
  ) {
    return `${previousConcreteSearch} ${cleanedMessage}`;
  }

  if (
    previousSearch &&
    (isMoreProductFollowUp(cleanedMessage) ||
      isSearchConfirmation(cleanedMessage) ||
      isShortSearchRefinement(cleanedMessage, history))
  ) {
    return `${previousSearch} ${cleanedMessage}`;
  }

  return cleanedMessage;
}

function productRankingContext(message: string, history: ChatHistoryMessage[]) {
  const effectiveContext = effectiveProductSearchContext(message, history);
  const excludedNames = excludedProductNamesFromMessage(message);

  if (excludedNames.length === 0) return effectiveContext;

  return `${effectiveContext} Exclude these products: ${excludedNames.join("; ")}`;
}

function buildSearchQueries(
  message: string,
  memory: AgentMemory,
  history: ChatHistoryMessage[] = [],
  categoryNames: string[] = []
) {
  const normalized = message.toLowerCase();
  const assistantShoppingSuggestion = recentAssistantSuggestedShopping(history);
  const isFollowUp =
    /^(?:more|others?|another|alternatives?|cheaper|premium|similar|different|anything else|more like that)\b/i.test(
      normalized.trim()
    ) ||
    (isSearchConfirmation(message) && Boolean(assistantShoppingSuggestion)) ||
    /\b(?:options?|choices?)\b[\s\S]{0,35}\b(?:choose|within|under|below|budget|rs\.?|lkr|\d+\s*k)\b/i.test(
      normalized
    ) ||
    /\b(?:just\s+)?(?:give|show)\b[\s\S]{0,20}\b(?:options?|choices?)\b/i.test(
      normalized
    );
  const priorSearch = isFollowUp
    ? recentSearchableUserContext(history) ||
      memory.recentSearches?.[0] ||
      recentShoppingContext(history) ||
      assistantShoppingSuggestion
    : null;
  const searchContext = priorSearch || message;
  const combinedContext = `${searchContext} ${message}`.toLowerCase();
  const cleaned = cleanSearchQuery(searchContext);
  const queries = [cleaned];

  const asksForGift =
    /\b(?:gift|gifts|thagi|present|birthday|anniversary|wedding|housewarming|new baby|baby shower|get well|sympathy|mother|mom|mum|amma|father|dad|thaththa|appachchi|wife|husband|girlfriend|boyfriend|aiya|malli|nangi|akka)\b/i.test(
      combinedContext
    );

  if (asksForGift) {
    let recipient: string | null = null;
    let occasion: string | null = null;

    if (/\b(?:mother|mom|mum|amma)\b/i.test(combinedContext)) {
      recipient = "mother";
    } else if (/\b(?:father|dad|thaththa|appachchi)\b/i.test(combinedContext)) {
      recipient = "father";
    } else if (/\b(?:baby|newborn|new baby|baby shower)\b/i.test(combinedContext)) {
      recipient = "new baby";
    } else if (/\b(?:aiya|malli|brother)\b/i.test(combinedContext)) {
      recipient = "brother";
    } else if (/\b(?:akka|nangi|sister)\b/i.test(combinedContext)) {
      recipient = "sister";
    }

    if (/\bbirthday\b/i.test(combinedContext)) {
      occasion = "birthday";
    } else if (/\banniversary\b/i.test(combinedContext)) {
      occasion = "anniversary";
    } else if (/\b(?:housewarming|new home|homecoming)\b/i.test(combinedContext)) {
      occasion = "housewarming";
    } else if (/\b(?:new baby|baby shower|newborn)\b/i.test(combinedContext)) {
      occasion = "new baby";
    } else if (/\b(?:get well|recovery|sick)\b/i.test(combinedContext)) {
      occasion = "get well";
    } else if (/\b(?:sympathy|condolence|funeral)\b/i.test(combinedContext)) {
      occasion = "sympathy";
    }
    const recipientText = recipient ? ` for ${recipient}` : "";
    const occasionText = occasion ? `${occasion} ` : "";
    const wantsBundle =
      /\b(?:bundle|list|registry|set|combo|hamper|with|and|cake|flowers?|chocolates?|card)\b/i.test(
        combinedContext
      );

    if (occasion === "housewarming") {
      queries.splice(
        0,
        queries.length,
        "housewarming kitchen gift",
        "home essentials gift",
        "towel set home gift",
        "home decor gift"
      );
    } else if (occasion === "new baby" || recipient === "new baby") {
      queries.splice(
        0,
        queries.length,
        "newborn baby gift set",
        "baby hamper",
        "baby clothes gift",
        "baby toys"
      );
    } else if (wantsBundle) {
      queries.splice(
        0,
        queries.length,
        `${occasionText}cake`,
        `${occasionText}flowers${recipientText}`,
        `chocolate hamper${recipientText}`,
        "greeting card"
      );
    } else {
      queries.splice(
        0,
        queries.length,
        `${occasionText}gifts${recipientText}`,
        `${occasionText}flowers`,
        `gift hamper${recipientText}`
      );
    }
  }

  const hasSpecificSearchContext = searchTokens(searchContext).length > 0;
  const isBroadDiscovery =
    !hasSpecificSearchContext ||
    /\b(?:bad day|mood|vibe|fun|brighten|cheer|surprise|treat)\b/i.test(
      combinedContext
    ) && !hasSpecificSearchContext;

  if (isBroadDiscovery && !asksForGift) {
    const categoryText = categoryNames.join(" ").toLowerCase();
    const broadQueries = [
      categoryText.includes("gift") ? "gift set" : "gift",
      categoryText.includes("chocolate") ? "chocolate" : "snacks",
      categoryText.includes("electronic") ? "cool gadget" : "gadgets",
      categoryText.includes("home") ? "home decor" : "mugs",
    ];

    queries.splice(0, queries.length, ...broadQueries);
  }

  // Kapruka search performs best with one concise product phrase per call.
  // Synonyms are fallbacks, never a single long OR-style query.
  if (/\b(?:earbuds?|earphones?|airpods?)\b/i.test(cleaned)) {
    queries.push("wireless earbuds", "earbuds", "wireless earphones");
  } else if (/\b(?:headphones?|headsets?)\b/i.test(cleaned)) {
    queries.push("wireless headphones", "headphones", "bluetooth headset");
  } else if (/\b(?:t-?shirts?|tee\s*shirts?|tees?)\b/i.test(cleaned)) {
    queries.push("t shirts", "tee shirts", "mens t shirts", "casual shirts");
  } else if (/\b(?:wristwatch|smartwatch|watches?)\b/i.test(cleaned)) {
    queries.push("watches", "wristwatch", "smartwatch");
  } else if (/\b(?:flowers?|bouquets?|roses?)\b/i.test(cleaned)) {
    queries.push("flowers", "flower bouquet", "roses");
  } else if (/\b(?:perfume|fragrance|cologne)\b/i.test(cleaned)) {
    queries.push("perfume", "fragrance");
  }

  const uniqueQueries = [
    ...new Set(
      queries.map((query) => query.trim()).filter((query) => query.length >= 3)
    ),
  ];

  return uniqueQueries.slice(0, isBroadDiscovery ? 4 : 3);
}

function categoryForSearchQuery(query: string) {
  if (/\b(?:flowers?|bouquets?|roses?)\b/i.test(query) && !/\bcakes?\b/i.test(query)) {
    return /\bbirthday\b/i.test(query) ? "Birthday Flowers" : "flowers";
  }

  if (/\bcakes?\b/i.test(query) && !/\bflowers?\b/i.test(query)) {
    return "cakes";
  }

  return null;
}

function stripExcludedProductsInstruction(message: string) {
  return message
    .replace(/\s*\bexclude(?: these products?)?:\s*[\s\S]+$/i, "")
    .trim();
}

function excludedProductNamesFromMessage(message: string) {
  const [, excludedText = ""] =
    message.match(/\bexclude(?: these products?)?:\s*([\s\S]+)$/i) || [];

  if (!excludedText.trim()) return [];

  return excludedText
    .split(/\s*(?:,|\n|;|\|)\s*/)
    .map((name) =>
      name
        .replace(/^\d+[\).]\s*/, "")
        .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
        .trim()
    )
    .filter((name) => name.length >= 4)
    .slice(0, 24);
}

function normalizedComparableName(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(?:the|a|an)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function productWasExcluded(product: ProductLike, excludedNames: string[]) {
  const productName = normalizedComparableName(product.name);

  return excludedNames.some((name) => {
    const excludedName = normalizedComparableName(name);

    if (!excludedName) return false;
    if (productName === excludedName) return true;

    return (
      Math.min(productName.length, excludedName.length) >= 18 &&
      (productName.includes(excludedName) || excludedName.includes(productName))
    );
  });
}

async function searchKaprukaProductsDirect(
  message: string,
  memory: AgentMemory,
  history: ChatHistoryMessage[] = []
) {
  const searchMessage = effectiveProductSearchContext(message, history);
  const headers = await startDirectMcpSession();
  const searchConfirmation = isSearchConfirmation(searchMessage);
  const followUpContext = searchConfirmation
    ? recentSearchableUserContext(history)
    : null;
  const budget = extractBudget(
    followUpContext ? `${followUpContext} ${searchMessage}` : searchMessage,
    memory
  );
  const queries = buildSearchQueries(searchMessage, memory, history);
  const diversifyGiftSearch =
    queries.some((query) => /\bgifts?\b/i.test(query)) &&
    queries.some((query) => /\bflowers?\b/i.test(query)) &&
    queries.some((query) => /\bhamper\b/i.test(query));
  const diversifyBroadSearch =
    queries.length > 1 &&
    queries.some((query) => /\bgifts?\b/i.test(query)) &&
    queries.some((query) =>
      /\b(?:snacks?|chocolates?|electronics?|gadgets?|home|mugs?)\b/i.test(
        query
      )
    );
  const diversifySearch = diversifyGiftSearch || diversifyBroadSearch;
  const attempts: Array<{ q: string; category: string | null }> = [];
  const products: ProductLike[] = [];
  const excludedNames = excludedProductNamesFromMessage(message);
  const needsImageBackfill = /\b(?:t-?shirts?|tee\s*shirts?|tees?|shirts?|dress|shoes?|bags?)\b/i.test(
    searchMessage
  );

  for (const [index, query] of queries.entries()) {
    const preferredCategory = categoryForSearchQuery(query);
    const categories = preferredCategory ? [preferredCategory, null] : [null];

    for (const category of categories) {
      attempts.push({ q: query, category });
      const result = await callDirectMcpTool(
        headers,
        index + attempts.length + 1,
        "kapruka_search_products",
        {
          q: query,
          category,
          limit: diversifySearch ? 3 : SEARCH_RESULT_LIMIT,
          cursor: null,
          currency: "LKR",
          min_price: null,
          max_price: budget ?? null,
          in_stock_only: false,
          sort: "relevance",
          include_stubs: false,
          response_format: "json",
        }
      );
      const toolError = mcpToolErrorText(result);

      if (toolError) {
        throw new Error(toolError);
      }

      const parsed = parseMcpToolJson(result);
      const attemptProducts = parsed
        ? collectProductObjects(parsed)
            .map((productObject, productIndex) =>
              productFromObject(productObject, products.length + productIndex)
            )
            .filter((product): product is ProductLike => Boolean(product))
            .filter((product) => !productWasExcluded(product, excludedNames))
            .filter((product) => productMatchesStrictRequest(product, query))
        : [];

      products.push(...attemptProducts);

      if (
        attemptProducts.length > 0 &&
        (!needsImageBackfill ||
          mergeProducts(products, []).length >= PRODUCT_CARD_LIMIT)
      ) {
        break;
      }
    }

    if (
      !diversifySearch &&
      (!needsImageBackfill
        ? products.length >= PRODUCT_CARD_LIMIT
        : mergeProducts(products, []).length >= PRODUCT_CARD_LIMIT)
    ) {
      break;
    }
  }

  return { products: mergeProducts(products, []), attempts };
}

function getSriLankaDate(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function extractDeliveryDate(message: string) {
  const explicitDate = message.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];

  if (explicitDate) return explicitDate;
  if (/\btomorrow\b/i.test(message)) return getSriLankaDate(1);

  return getSriLankaDate();
}

function normalizeDeliveryCity(value: string) {
  return value.trim().toLocaleLowerCase("en");
}

function selectCanonicalDeliveryCity(
  cities: DeliveryCity[],
  requestedCity: string
) {
  const normalizedRequest = normalizeDeliveryCity(requestedCity);

  return (
    cities.find(
      (city) => normalizeDeliveryCity(city.name) === normalizedRequest
    ) ||
    cities.find((city) =>
      city.aliases?.some(
        (alias) => normalizeDeliveryCity(alias) === normalizedRequest
      )
    ) ||
    cities[0] ||
    null
  );
}

async function checkKaprukaDeliveryDirect(city: string, message: string) {
  const headers = await startDirectMcpSession();
  const deliveryDate = extractDeliveryDate(message);
  const citiesResult = await callDirectMcpTool(
    headers,
    2,
    "kapruka_list_delivery_cities",
    {
      query: city,
      limit: 10,
      response_format: "json",
    }
  );
  const citiesPayload = parseMcpToolJson(citiesResult) as
    | { cities?: DeliveryCity[] }
    | null;
  const canonicalCity = selectCanonicalDeliveryCity(
    citiesPayload?.cities || [],
    city
  );

  if (!canonicalCity) {
    return {
      city,
      checkedDate: deliveryDate,
      available: false,
      fee: null as number | null,
      currency: "LKR",
      reason: `Kapruka does not recognize "${city}" as a delivery city.`,
      earliestDate: null as string | null,
      warning: null as string | null,
    };
  }

  const deliveryResult = await callDirectMcpTool(
    headers,
    3,
    "kapruka_check_delivery",
    {
      city: canonicalCity.name,
      delivery_date: deliveryDate,
      product_id: null,
      response_format: "json",
    }
  );
  const delivery = parseMcpToolJson(deliveryResult) as DeliveryCheckResult | null;

  return {
    city: delivery?.city || canonicalCity.name,
    checkedDate: delivery?.checked_date || deliveryDate,
    available: delivery?.available === true,
    fee: typeof delivery?.rate === "number" ? delivery.rate : null,
    currency: delivery?.currency || "LKR",
    reason: delivery?.reason || null,
    earliestDate: delivery?.next_available_date || null,
    warning: delivery?.perishable_warning || null,
  };
}

async function trackKaprukaOrderDirect(orderNumber: string) {
  const headers = await startDirectMcpSession();
  const trackingResult = await callDirectMcpTool(
    headers,
    2,
    "kapruka_track_order",
    {
      order_number: orderNumber,
      response_format: "json",
    }
  );
  const toolError = mcpToolErrorText(trackingResult);

  if (toolError) {
    throw new Error(toolError);
  }

  const tracking = parseMcpToolJson(trackingResult) as TrackOrderResult | null;

  if (!tracking) {
    throw new Error("Kapruka returned an empty tracking response.");
  }

  return tracking;
}

function extractToolOutputText(item: GroqOutputItem) {
  const possibleTexts: string[] = [];

  if (typeof item.output === "string") {
    possibleTexts.push(item.output);
  }

  if (item.output && typeof item.output !== "string") {
    possibleTexts.push(JSON.stringify(item.output));
  }

  if (Array.isArray(item.content)) {
    for (const content of item.content) {
      if (typeof content.text === "string") {
        possibleTexts.push(content.text);
      }
    }
  }

  return possibleTexts.join("\n").trim();
}

function extractProductsFromKaprukaSearchMarkdown(text: string) {
  const products: ProductLike[] = [];

  const regex =
    /\*\*(?:\d+\.\s*)?(.+?)\*\*[\s\S]*?ID:\s*`?([^`\s]+)`?\s*·\s*LKR\s*([\d,]+)[\s\S]*?\[View product\]\((https?:\/\/[^)]+)\)/gi;

  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const name = cleanProductName(match[1]);
    const id = match[2];
    const price = Number(match[3].replace(/,/g, ""));
    const productUrl = normalizeUrl(match[4]);

    if (!name || Number.isNaN(price) || isBadProductName(name)) {
      continue;
    }

    products.push({
      id,
      name,
      price,
      currency: "LKR",
      imageUrl: null,
      productUrl,
      inStock: null,
      description: null,
    });
  }

  return products;
}

function extractProductsFromMarkdownToolOutput(text: string) {
  const products: ProductLike[] = [];

  const blocks = text
    .split(/\n(?=\s*(?:\d+[\).\s-]+|[-*]\s+|###?\s+|\{))/g)
    .map((block) => block.trim())
    .filter(Boolean);

  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];

    const imageMatch =
      block.match(/!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/i) ||
      block.match(
        /["']?(?:image|image_url|imageUrl|thumbnail|thumbnail_url|img|photo)["']?\s*[:=]\s*["']?(https?:\/\/[^"'\s)]+)/i
      );

    const urlMatch =
      block.match(
        /["']?(?:url|product_url|productUrl|link|href|web_url)["']?\s*[:=]\s*["']?(https?:\/\/[^"'\s)]+)/i
      ) ||
      block.match(
        /\[.*?]\((https?:\/\/(?:www\.)?kapruka\.com[^)\s]+)\)/i
      );

    const priceMatch =
      block.match(/(?:Rs\.?|LKR)\s*([\d,]+(?:\.\d+)?)/i) ||
      block.match(
        /["']?(?:price|price_lkr|lkr_price|selling_price)["']?\s*[:=]\s*["']?([\d,]+(?:\.\d+)?)/i
      );

    const idMatch = block.match(
      /["']?(?:product[_\s-]*id|productId|id|sku|code)["']?\s*[:=]\s*["']?([A-Za-z0-9_-]+)/i
    );

    const jsonNameMatch = block.match(
      /["']?(?:name|title|product_name|productName)["']?\s*[:=]\s*["']([^"']+)["']/i
    );
    const descriptionMatch = block.match(
      /["']?(?:summary|description|short_description|shortDescription)["']?\s*[:=]\s*["']([^"']+)["']/i
    );

    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    let rawName =
      jsonNameMatch?.[1] ||
      lines
        .map((line) =>
          line
            .replace(/^\d+[\).\s-]+/, "")
            .replace(/^[-*]\s+/, "")
            .replace(/^#+\s+/, "")
            .replace(/\*\*/g, "")
            .trim()
        )
        .find((line) => {
          const lower = line.toLowerCase();

          return (
            line.length > 3 &&
            !lower.startsWith("price") &&
            !lower.startsWith("image") &&
            !lower.startsWith("thumbnail") &&
            !lower.startsWith("url") &&
            !lower.startsWith("link") &&
            !lower.startsWith("product id") &&
            !/^rs\.?\s*\d/i.test(lower) &&
            !/^lkr\s*\d/i.test(lower)
          );
        }) ||
      null;

    if (rawName) {
      rawName = rawName
        .replace(/!\[[^\]]*]\([^)]+\)/g, "")
        .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
        .replace(/\s*[-\u2013:]\s*(?:Rs\.?|LKR)\s*[\d,]+.*/i, "")
        .trim();
    }

    const name = rawName ? cleanProductName(rawName) : null;
    const price = priceMatch ? Number(priceMatch[1].replace(/,/g, "")) : null;
    const imageUrl = normalizeUrl(imageMatch?.[1]);
    const productUrl = normalizeUrl(urlMatch?.[1]);

    if (!name || isBadProductName(name) || (!price && !imageUrl && !productUrl)) {
      continue;
    }

    products.push({
      id:
        idMatch?.[1] ||
        `${index}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name,
      price,
      currency: "LKR",
      imageUrl,
      productUrl,
      inStock: null,
      description: descriptionMatch?.[1]
        ? cleanProductName(descriptionMatch[1])
        : null,
    });
  }

  return products;
}

function extractProductsFromReply(reply: string) {
  const lines = reply.split("\n");
  const products: ProductLike[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];

    const match = line.match(
      /^\s*(?:\d+[\).\s-]+)?(.+?)\s*[-\u2013:]\s*(?:Rs\.?|LKR)\s*([\d,]+)/i
    );

    if (!match) continue;

    const name = cleanProductName(match[1]);
    const price = Number(match[2].replace(/,/g, ""));

    if (!name || isBadProductName(name) || Number.isNaN(price)) continue;

    const nextLine = lines[index + 1]?.trim() || "";
    const reasonMatch = nextLine.match(/^Reason\s*:\s*(.+)$/i);

    products.push({
      id: `${index}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name,
      price,
      currency: "LKR",
      imageUrl: null,
      productUrl: null,
      inStock: null,
      description: null,
      reason: reasonMatch?.[1] || "Matched with your request and budget.",
    });
  }

  const unique = new Map<string, ProductLike>();

  for (const product of products) {
    const key = product.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

    if (!unique.has(key)) {
      unique.set(key, product);
    }
  }

  return Array.from(unique.values()).slice(0, 8);
}

function extractProductsFromMcpResponse(response: GroqResponse) {
  const products: ProductLike[] = [];

  for (const item of response.output || []) {
    if (item.type !== "mcp_call") continue;

    const outputText = extractToolOutputText(item);

    if (!outputText) continue;

    const parsed = parsePossibleJson(outputText);

    if (parsed) {
      const productObjects = collectProductObjects(parsed);

      for (const productObject of productObjects) {
        const product = productFromObject(productObject, products.length);

        if (product) {
          products.push(product);
        }
      }

      if (isRecord(parsed) && typeof parsed.result === "string") {
        const nestedResult = parsePossibleJson(parsed.result);

        if (nestedResult) {
          const nestedProductObjects = collectProductObjects(nestedResult);

          for (const productObject of nestedProductObjects) {
            const product = productFromObject(productObject, products.length);

            if (product) {
              products.push(product);
            }
          }
        } else {
          products.push(
            ...extractProductsFromKaprukaSearchMarkdown(parsed.result)
          );
          products.push(
            ...extractProductsFromMarkdownToolOutput(parsed.result)
          );
        }
      }
    } else {
      products.push(...extractProductsFromKaprukaSearchMarkdown(outputText));
      products.push(...extractProductsFromMarkdownToolOutput(outputText));
    }
  }

  const unique = new Map<string, ProductLike>();

  for (const product of products) {
    const key = product.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

    if (!unique.has(key)) {
      unique.set(key, product);
      continue;
    }

    const existing = unique.get(key);

    if (!existing) continue;

    unique.set(key, {
      ...existing,
      ...product,
      imageUrl: existing.imageUrl || product.imageUrl,
      productUrl: existing.productUrl || product.productUrl,
      price: existing.price ?? product.price,
      compareAtPrice: existing.compareAtPrice ?? product.compareAtPrice,
      description: existing.description || product.description,
      reason: existing.reason || product.reason,
      inStock: existing.inStock ?? product.inStock,
      stockLevel: existing.stockLevel || product.stockLevel,
      rating: existing.rating ?? product.rating,
      reviewCount: existing.reviewCount ?? product.reviewCount,
      brand: existing.brand || product.brand,
      category: existing.category || product.category,
      shipsInternationally:
        existing.shipsInternationally ?? product.shipsInternationally,
    });
  }

  return Array.from(unique.values()).slice(0, 8);
}

function mergeProducts(mcpProducts: ProductLike[], textProducts: ProductLike[]) {
  const unique: ProductLike[] = [];

  function normalizeProductName(name: string) {
    return name
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/\b(?:the|a|an)\b/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function namesLikelyMatch(firstName: string, secondName: string) {
    const first = normalizeProductName(firstName);
    const second = normalizeProductName(secondName);

    if (first === second) return true;

    if (
      Math.min(first.length, second.length) >= 20 &&
      (first.startsWith(second) || second.startsWith(first))
    ) {
      return true;
    }

    const firstTokens = new Set(first.split(" ").filter(Boolean));
    const secondTokens = new Set(second.split(" ").filter(Boolean));
    const sharedTokens = [...firstTokens].filter((token) =>
      secondTokens.has(token)
    ).length;
    const tokenBase = Math.min(firstTokens.size, secondTokens.size);

    return tokenBase >= 4 && sharedTokens / tokenBase >= 0.8;
  }

  function productsLikelyMatch(first: ProductLike, second: ProductLike) {
    if (
      first.productUrl &&
      second.productUrl &&
      first.productUrl === second.productUrl
    ) {
      return true;
    }

    if (
      looksLikeKaprukaProductId(first.id) &&
      looksLikeKaprukaProductId(second.id) &&
      first.id.toLowerCase() === second.id.toLowerCase()
    ) {
      return true;
    }

    const pricesMatch =
      first.price === null ||
      second.price === null ||
      first.price === second.price;
    const hasIncompleteRecord =
      (!first.productUrl && !first.imageUrl) ||
      (!second.productUrl && !second.imageUrl);

    return (
      hasIncompleteRecord &&
      pricesMatch &&
      namesLikelyMatch(first.name, second.name)
    );
  }

  for (const product of [...mcpProducts, ...textProducts]) {
    const existingIndex = unique.findIndex((existing) =>
      productsLikelyMatch(existing, product)
    );

    if (existingIndex === -1) {
      unique.push(product);
      continue;
    }

    const existing = unique[existingIndex];

    const existingLooksOrderable = looksLikeKaprukaProductId(existing.id);
    const productLooksOrderable = looksLikeKaprukaProductId(product.id);

    unique[existingIndex] = {
      ...existing,
      ...product,
      id:
        existingLooksOrderable || !productLooksOrderable
          ? existing.id
          : product.id,
      imageUrl: existing.imageUrl || product.imageUrl,
      productUrl: existing.productUrl || product.productUrl,
      price: existing.price ?? product.price,
      compareAtPrice: existing.compareAtPrice ?? product.compareAtPrice,
      description: existing.description || product.description,
      reason: existing.reason || product.reason,
      inStock: existing.inStock ?? product.inStock,
      stockLevel: existing.stockLevel || product.stockLevel,
      rating: existing.rating ?? product.rating,
      reviewCount: existing.reviewCount ?? product.reviewCount,
      brand: existing.brand || product.brand,
      category: existing.category || product.category,
      shipsInternationally:
        existing.shipsInternationally ?? product.shipsInternationally,
    };
  }

  return unique.slice(0, 8);
}

function looksLikeKaprukaProductId(id: string) {
  return /^[a-z][a-z0-9_]*(?:ka|pc|v|0|pod|pack|hamper|gift|book|household|cake|flow|elec|hamp)[a-z0-9_-]*$/i.test(
    id
  );
}

function hasJsonLdType(value: unknown, expectedType: string) {
  if (typeof value === "string") return value === expectedType;
  return Array.isArray(value) && value.includes(expectedType);
}

function collectJsonLdObjects(value: unknown, output: AnyRecord[] = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectJsonLdObjects(item, output);
    return output;
  }

  if (!isRecord(value)) return output;

  output.push(value);

  if (Array.isArray(value["@graph"])) {
    collectJsonLdObjects(value["@graph"], output);
  }

  return output;
}

function parseProductJsonLd(html: string) {
  const scriptRegex =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  for (const match of html.matchAll(scriptRegex)) {
    const parsed = parsePossibleJson(match[1].trim());

    if (!parsed) continue;

    const product = collectJsonLdObjects(parsed).find((item) =>
      hasJsonLdType(item["@type"], "Product")
    );

    if (product) return product;
  }

  return null;
}

function metadataFromProductJsonLd(product: AnyRecord): ProductPageMetadata {
  const offerCandidates = (Array.isArray(product.offers)
    ? product.offers
    : [product.offers]
  ).filter(isRecord);
  const offers =
    offerCandidates
      .map((offer) => ({ offer, price: pickNumber(offer, ["price"]) }))
      .filter(
        (candidate): candidate is { offer: AnyRecord; price: number } =>
          typeof candidate.price === "number" && candidate.price > 0
      )
      .sort((first, second) => first.price - second.price)[0]?.offer ||
    offerCandidates[0] ||
    null;
  const aggregateRating = isRecord(product.aggregateRating)
    ? product.aggregateRating
    : null;
  const shippingDetailsValue = offers?.shippingDetails;
  const shippingDetails = Array.isArray(shippingDetailsValue)
    ? shippingDetailsValue[0]
    : shippingDetailsValue;
  const shippingRate = isRecord(shippingDetails)
    ? shippingDetails.shippingRate
    : null;
  const shippingAmount = isRecord(shippingRate)
    ? pickNumber(shippingRate, ["value", "amount"])
    : null;
  const availability = offers
    ? pickString(offers, ["availability"])?.toLowerCase()
    : null;
  const rawImage = Array.isArray(product.image)
    ? product.image.find((image) => typeof image === "string")
    : product.image;

  return {
    imageUrl:
      typeof rawImage === "string" ? normalizeKaprukaImageUrl(rawImage) : null,
    price: offers ? pickNumber(offers, ["price"]) : null,
    compareAtPrice: null,
    inStock: availability
      ? availability.includes("instock")
      : null,
    description:
      pickString(product, ["description"])?.slice(0, 500) || null,
    rating: aggregateRating
      ? pickNumber(aggregateRating, ["ratingValue", "rating_value"])
      : null,
    reviewCount: aggregateRating
      ? pickNumber(aggregateRating, ["reviewCount", "ratingCount"])
      : null,
    brand: pickBrandName(product),
    category: pickCategoryName(product),
    freeShipping: shippingAmount === null ? null : shippingAmount === 0,
    priceValidUntil: offers
      ? pickString(offers, ["priceValidUntil"])
      : null,
  };
}

function extractDisplayedPrice(html: string, elementId: string) {
  const escapedId = elementId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(
    new RegExp(
      `<[^>]+id=["']${escapedId}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`,
      "i"
    )
  );
  const text = match?.[1]?.replace(/<[^>]+>/g, " ") || "";

  return pickNumber({ value: text }, ["value"]);
}

async function getMetadataFromProductPage(productUrl: string) {
  if (productMetadataCache.has(productUrl)) {
    return productMetadataCache.get(productUrl) || null;
  }

  try {
    const response = await fetch(productUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 KaprukaAIConcierge/1.0",
      },
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      productMetadataCache.set(productUrl, null);
      return null;
    }

    const html = await response.text();
    const jsonLdProduct = parseProductJsonLd(html);
    const displayedSalePrice = extractDisplayedPrice(
      html,
      "priceAfterDiscountlbl"
    );
    const displayedOriginalPrice = extractDisplayedPrice(html, "pricelbl");

    const productPageUrl = new URL(productUrl);
    const imageUrl = extractKaprukaProductImages(html, productPageUrl)[0] || null;
    const metadata = jsonLdProduct
      ? metadataFromProductJsonLd(jsonLdProduct)
      : {
          imageUrl,
          price: null,
          compareAtPrice: null,
          inStock: null,
          description: null,
          rating: null,
          reviewCount: null,
          brand: null,
          category: null,
          freeShipping: null,
          priceValidUntil: null,
        };

    metadata.imageUrl ||= imageUrl;
    if (displayedSalePrice !== null && displayedSalePrice > 0) {
      metadata.price = displayedSalePrice;
      metadata.compareAtPrice =
        displayedOriginalPrice !== null &&
        displayedOriginalPrice > displayedSalePrice
          ? displayedOriginalPrice
          : null;
    } else if (displayedOriginalPrice !== null && displayedOriginalPrice > 0) {
      metadata.price = displayedOriginalPrice;
    }
    productMetadataCache.set(productUrl, metadata);

    return metadata;
  } catch (error) {
    console.warn("Could not fetch product metadata:", productUrl, error);
    productMetadataCache.set(productUrl, null);
    return null;
  }
}

async function getMetadataFromMcpProduct(productId: string) {
  if (!looksLikeKaprukaProductId(productId)) return null;

  if (productMcpMetadataCache.has(productId)) {
    return productMcpMetadataCache.get(productId) || null;
  }

  try {
    const headers = await startDirectMcpSession();
    const result = await callDirectMcpTool(
      headers,
      9001,
      "kapruka_get_product",
      {
        product_id: productId,
        currency: "LKR",
      }
    );
    const parsed = parseMcpToolJson(result);
    const productObject =
      (parsed && collectProductObjects(parsed)[0]) ||
      (isRecord(parsed) ? parsed : null);
    const product = productObject ? productFromObject(productObject, 0) : null;
    const metadata: ProductPageMetadata | null = product
      ? {
          imageUrl: product.imageUrl || null,
          price: product.price,
          compareAtPrice: product.compareAtPrice ?? null,
          inStock: product.inStock ?? null,
          description: product.description || null,
          rating: product.rating ?? null,
          reviewCount: product.reviewCount ?? null,
          brand: product.brand || null,
          category: product.category || null,
          freeShipping: product.freeShipping ?? null,
          priceValidUntil: product.priceValidUntil || null,
        }
      : null;

    productMcpMetadataCache.set(productId, metadata);
    return metadata;
  } catch (error) {
    console.warn("Could not fetch product metadata from MCP:", productId, error);
    productMcpMetadataCache.set(productId, null);
    return null;
  }
}

async function enrichProductsWithMetadata(products: ProductLike[]) {
  return Promise.all(
    products.map(async (product) => {
      if (!product.productUrl && !looksLikeKaprukaProductId(product.id)) {
        return product;
      }

      const pageMetadata = product.productUrl
        ? await getMetadataFromProductPage(product.productUrl)
        : null;
      const mcpMetadata =
        product.imageUrl || pageMetadata?.imageUrl
          ? null
          : await getMetadataFromMcpProduct(product.id);
      const metadata =
        pageMetadata || mcpMetadata
          ? {
              ...mcpMetadata,
              ...pageMetadata,
              imageUrl: pageMetadata?.imageUrl || mcpMetadata?.imageUrl || null,
              price: pageMetadata?.price ?? mcpMetadata?.price ?? null,
              compareAtPrice:
                pageMetadata?.compareAtPrice ??
                mcpMetadata?.compareAtPrice ??
                null,
              inStock: pageMetadata?.inStock ?? mcpMetadata?.inStock ?? null,
              description:
                pageMetadata?.description || mcpMetadata?.description || null,
              rating: pageMetadata?.rating ?? mcpMetadata?.rating ?? null,
              reviewCount:
                pageMetadata?.reviewCount ?? mcpMetadata?.reviewCount ?? null,
              brand: pageMetadata?.brand || mcpMetadata?.brand || null,
              category: pageMetadata?.category || mcpMetadata?.category || null,
              freeShipping:
                pageMetadata?.freeShipping ?? mcpMetadata?.freeShipping ?? null,
              priceValidUntil:
                pageMetadata?.priceValidUntil ||
                mcpMetadata?.priceValidUntil ||
                null,
            }
          : null;

      if (!metadata) return product;

      const hasVerifiedMetadataRating =
        typeof metadata.rating === "number" &&
        metadata.rating > 0 &&
        metadata.rating <= 5 &&
        typeof metadata.reviewCount === "number" &&
        metadata.reviewCount > 0;
      const livePrice =
        typeof metadata.price === "number" && metadata.price > 0
          ? metadata.price
          : null;
      const catalogPrice =
        typeof product.price === "number" && product.price > 0
          ? product.price
          : null;
      const currentPrice = isImplausiblySmallLivePrice(
        livePrice,
        catalogPrice
      )
        ? catalogPrice
        : livePrice ?? catalogPrice;
      const compareAtCandidates = [
        metadata.compareAtPrice,
        product.compareAtPrice,
        catalogPrice,
      ]
        .filter(
          (price): price is number =>
            typeof price === "number" &&
            price > 0 &&
            currentPrice !== null &&
            price > currentPrice
        )
        .sort((first, second) => second - first);

      return {
        ...product,
        imageUrl: product.imageUrl || metadata.imageUrl,
        price: currentPrice,
        compareAtPrice: compareAtCandidates[0] ?? null,
        inStock: product.inStock ?? metadata.inStock,
        description: product.description || metadata.description,
        rating:
          product.rating ??
          (hasVerifiedMetadataRating ? metadata.rating : null),
        reviewCount:
          product.reviewCount ??
          (hasVerifiedMetadataRating ? metadata.reviewCount : null),
        brand: product.brand || metadata.brand,
        category: product.category || metadata.category,
        freeShipping: product.freeShipping ?? metadata.freeShipping,
        priceValidUntil:
          product.priceValidUntil || metadata.priceValidUntil,
      };
    })
  );
}

function cleanReplyForUi(reply: string, productCount: number) {
  if (productCount > 0) {
    return "";
  }

  const punctuationCleaned = reply.replace(/\s*—\s*/g, ", ");
  const lines = punctuationCleaned.split("\n");

  const cleanedLines = lines.filter((line) => {
    const trimmed = line.trim();

    const isProductLine =
      /^\d+[\).\s-]+.+?\s*[-\u2013:]\s*(?:Rs\.?|LKR)\s*[\d,]+/i.test(
        trimmed
      );

    const isReasonLine = /^Reason\s*:/i.test(trimmed);

    return !isProductLine && !isReasonLine;
  });

  const cleaned = cleanedLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  return cleaned || punctuationCleaned;
}

function extractToolDebug(response: GroqResponse) {
  return (response.output || [])
    .filter((item) => item.type === "mcp_list_tools" || item.type === "mcp_call")
    .map((item) => ({
      type: item.type,
      name: item.name,
      arguments: item.arguments,
    }));
}

function calledTool(response: GroqResponse, toolName: string) {
  return (response.output || []).some(
    (item) => item.type === "mcp_call" && item.name === toolName
  );
}

function createTraceId() {
  return `agent_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function parseAgentMemory(value: unknown): AgentMemory {
  if (!isRecord(value)) return {};

  const preferredBudget =
    typeof value.preferredBudget === "number" &&
    Number.isFinite(value.preferredBudget)
      ? value.preferredBudget
      : null;
  const deliveryCity =
    typeof value.deliveryCity === "string" && value.deliveryCity.trim()
      ? value.deliveryCity.trim().slice(0, 80)
      : null;
  const giftRecipients = Array.isArray(value.giftRecipients)
    ? value.giftRecipients
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, 40))
        .filter(Boolean)
        .slice(0, 8)
    : [];
  const favoriteCategories = Array.isArray(value.favoriteCategories)
    ? value.favoriteCategories
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, 40))
        .filter(Boolean)
        .slice(0, 8)
    : [];
  const recentSearches = Array.isArray(value.recentSearches)
    ? value.recentSearches
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, 120))
        .filter(Boolean)
        .slice(0, 8)
    : [];

  return {
    preferredBudget,
    deliveryCity,
    giftRecipients,
    favoriteCategories,
    recentSearches,
  };
}

function extractBudget(message: string, memory: AgentMemory) {
  const normalized = message.toLowerCase().replace(/,/g, "");
  const budgetMatch = normalized.match(
    /\b(?:under|nder|below|less than|up to|max|maximum|budget(?: of)?)\s*(?:rs\.?|lkr)?\s*(\d{3,7})\b|\b(?:rs\.?|lkr)\s*(\d{3,7})\b|\b(\d{3,7})\s*(?:rs|lkr)\b/i
  );
  const value = Number(
    budgetMatch?.[1] || budgetMatch?.[2] || budgetMatch?.[3]
  );
  const compactBudgetMatch = normalized.match(
    /\b(?:under|nder|below|less than|up to|max|maximum|budget(?: of)?)?\s*(?:rs\.?|lkr)?\s*(\d{1,3}(?:\.\d+)?)\s*k\b/i
  );
  const compactValue = Number(compactBudgetMatch?.[1]) * 1000;

  if (Number.isFinite(value) && value > 0) return value;
  if (Number.isFinite(compactValue) && compactValue > 0) return compactValue;

  const explicitlyReusesBudget =
    /\b(?:same|again|previous|last|keep|use)\b[\s\S]{0,30}\b(?:budget|price|limit|cap)\b|\b(?:same|that)\s+(?:budget|price|limit|cap)\b/i.test(
      normalized
    );

  return explicitlyReusesBudget && typeof memory.preferredBudget === "number"
    ? memory.preferredBudget
    : null;
}

function extractDeliveryCity(message: string) {
  if (
    !/\b(?:deliver|delivery|shipping|ship|send|arrive|arrival)\b/i.test(
      message
    )
  ) {
    return null;
  }

  const match = message.match(
    /\b(?:to|in|near|around|delivery\s+(?:to|in))\s+([A-Z][A-Za-z\s-]{2,40})(?:\b|$)/i
  );

  const city = match?.[1]
    ?.replace(
      /\b(?:available|availability|today|tomorrow|on|for|with|please|pls|now|delivery|deliver)\b[\s\S]*$/i,
      ""
    )
    .trim()
    .replace(/\s+/g, " ");

  return city || null;
}

function extractGiftRecipients(message: string) {
  const recipients = [
    "mother",
    "mom",
    "amma",
    "father",
    "dad",
    "appachchi",
    "wife",
    "husband",
    "girlfriend",
    "boyfriend",
    "brother",
    "sister",
    "friend",
  ];
  const normalized = message.toLowerCase();

  return recipients.filter((recipient) =>
    new RegExp(`\\b${recipient}\\b`, "i").test(normalized)
  );
}

function inferFavoriteCategories(message: string) {
  const categories = [
    "electronics",
    "groceries",
    "fashion",
    "home",
    "flowers",
    "cakes",
    "hampers",
    "chocolates",
    "toys",
    "books",
    "beauty",
  ];
  const normalized = message.toLowerCase();

  return categories.filter((category) =>
    new RegExp(`\\b${category}\\b`, "i").test(normalized)
  );
}

function mergeUniqueStrings(existing: string[] = [], additions: string[] = []) {
  return [...new Set([...existing, ...additions])].slice(0, 8);
}

function buildMemoryPatch(
  message: string,
  memory: AgentMemory,
  shouldRememberSearch: boolean
): AgentMemory {
  const budget = extractBudget(message, {});
  const deliveryCity = extractDeliveryCity(message);
  const giftRecipients = extractGiftRecipients(message);
  const favoriteCategories = inferFavoriteCategories(message);

  return {
    preferredBudget: budget ?? memory.preferredBudget ?? null,
    deliveryCity: deliveryCity || memory.deliveryCity || null,
    giftRecipients: mergeUniqueStrings(memory.giftRecipients, giftRecipients),
    favoriteCategories: mergeUniqueStrings(
      memory.favoriteCategories,
      favoriteCategories
    ),
    recentSearches: shouldRememberSearch
      ? [message.trim().slice(0, 120), ...(memory.recentSearches || [])]
          .filter(Boolean)
          .slice(0, 8)
      : memory.recentSearches || [],
  };
}

function hasConcreteShoppingSubject(message: string) {
  return /\b(?:gift|gifts|present|presents|flower|flowers|bouquet|rose|roses|cake|cakes|chocolate|chocolates|hamper|hampers|mug|mugs|perfume|watch|watches|phone|phones|laptop|laptops|earbuds|headphones|gadget|gadgets|electronics?|device|devices|accessories|speaker|speakers|charger|chargers|powerbank|powerbanks|toy|toys|book|books|shoes|bag|bags|wallet|wallets|dress|shirts?|t-?shirts?|tee\s*shirts?|tees?|saree|groceries|grocery|tea|coffee|fruit|fruits|snack|snacks|cookie|cookies|biscuit|biscuits|chips|nuts|sweets|candy|food|drink|drinks|beverage|beverages|gift\s+(?:box|set|basket|pack)|birthday\s+(?:cake|gift)|anniversary\s+gift)\b/i.test(
    message
  );
}

function isVagueGiftIdeaRequest(message: string) {
  const normalized = message.toLowerCase();

  return (
    /\b(?:gift|birthday|bday|anniversary|present|give)\b/i.test(normalized) &&
    /\b(?:no idea|not sure|confused|don't know|dont know|what to give|what should i give|what can i give|help me think|ideas?)\b/i.test(
      normalized
    ) &&
    !/\b(?:find|show|search|browse|shop|buy|purchase|options?|shortlist|products?)\b/i.test(
      normalized
    )
  );
}

function isEmotionalSmallTalk(message: string) {
  return /\b(?:bad day|rough day|terrible day|awful day|sad|stressed|stressful|tired|exhausted|angry|mad|upset|lonely|alone|bored|overwhelmed|burnt out|burned out|not okay|not feeling good|feel like crap|feeling low|depressed|anxious)\b/i.test(
    message
  );
}

function hasShoppingFollowUpContext(
  message: string,
  history: ChatHistoryMessage[]
) {
  const normalized = message.toLowerCase();
  const asksForDifferentResults =
    /\b(?:more|others?|another|alternatives?|cheaper|budget|premium|similar|different|else|more results|filter)\b/i.test(
      normalized
    );
  const hasShoppingContext = history
    .slice(-4)
    .some(
      (item) =>
        item.role === "assistant" &&
        /\b(?:pick|option|product|price|budget|rs\.?|lkr|cart)\b/i.test(
          item.content
        )
    );

  return asksForDifferentResults && hasShoppingContext;
}

function clearlyAsksForProductSearch(
  message: string,
  history: ChatHistoryMessage[]
) {
  const normalized = message
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (isVagueGiftIdeaRequest(normalized)) return false;

  const explicitCommerceRequest =
    /\b(?:find|show\s*me|show|search|browse|shop|buy|purchase|look for|looking for|get me|give me|options? for|choices? for|shortlist)\b/i.test(
      normalized
    );
  const tanglishCommerceRequest =
    /\b(?:hoyala|balanna|denna|one|ona|awashyai|ganna|thiyenawada|tiyenawada|yata|adui|aduma)\b/i.test(
      normalized
    ) && hasSearchableProductPhrase(normalized);
  const giftRequest =
    /\b(?:gift|gifts|thagi|present|birthday|anniversary|housewarming|new baby|baby shower|get well|amma|thaththa|appachchi|aiya|malli|akka|nangi)\b/i.test(
      normalized
    ) &&
    /\b(?:find|show|suggest|recommend|build|create|hoyala|denna|one|ona|yata|under|rs\.?|lkr|\d+\s*k)\b/i.test(
      normalized
    );
  const recommendationRequest =
    /\b(?:recommend|suggest|best|top|options?|choices?)\b/i.test(normalized);
  const productAvailabilityQuestion =
    /\b(?:do+\s*y?ou have|have you got|have any|are there any|is there any|is there|do you sell|can i get|can i buy)\b|\bwhat\b[\s\S]{0,40}\bhave\b/i.test(
      normalized
    ) &&
    !/\b(?:any idea|time|a minute|a moment|feelings?|thoughts?|questions?|anything to say)\b/i.test(
      normalized
    );
  const concreteNeed =
    /\b(?:i\s+)?(?:n+e{2,}d|need|want|get me|give me)\b/i.test(normalized) &&
    hasConcreteShoppingSubject(normalized);
  const genericNeed =
    /\b(?:i\s+)?(?:n+e{2,}d|need|want|looking for|look for|after|get me|give me)\b/i.test(
      normalized
    ) && hasSearchableProductPhrase(normalized);
  const previousProductRequest = recentSearchableUserContext(history);
  const previousConcreteProductRequest = recentConcreteProductContext(history);
  const moreFromPreviousProductRequest =
    isMoreProductFollowUp(normalized) && Boolean(previousProductRequest);
  const pronounCardsFromPreviousProductRequest =
    isPronounProductCardFollowUp(normalized) &&
    Boolean(previousConcreteProductRequest || previousProductRequest);
  const sendBunchFromPreviousProductRequest =
    isSendBunchFollowUp(normalized) &&
    Boolean(previousConcreteProductRequest || previousProductRequest);
  const budgetOnlyFromPreviousProductRequest =
    isBudgetOnlyFollowUp(normalized) &&
    Boolean(previousConcreteProductRequest || previousProductRequest);
  const moreWithConcreteProduct =
    /\b(?:more|another|others?|other options?|alternatives?|similar|different|cheaper|premium)\b/i.test(
      normalized
    ) && hasConcreteShoppingSubject(normalized);
  const concreteCategoryWithBudget =
    hasConcreteShoppingSubject(normalized) &&
    extractBudget(normalized, {}) !== null;
  const budgetedShoppingRequest =
    extractBudget(normalized, {}) !== null && hasSearchableProductPhrase(normalized);
  const assistantSuggestedSearch = Boolean(recentAssistantSuggestedShopping(history));
  const shortConcreteFollowUp =
    normalized.split(/\s+/).length <= 5 &&
    hasSearchableProductPhrase(normalized) &&
    assistantSuggestedSearch;
  const confirmsSuggestedSearch =
    isSearchConfirmation(normalized) && assistantSuggestedSearch;

  return (
    explicitCommerceRequest ||
    tanglishCommerceRequest ||
    giftRequest ||
    recommendationRequest ||
    productAvailabilityQuestion ||
    concreteNeed ||
    genericNeed ||
    concreteCategoryWithBudget ||
    budgetedShoppingRequest ||
    pronounCardsFromPreviousProductRequest ||
    sendBunchFromPreviousProductRequest ||
    budgetOnlyFromPreviousProductRequest ||
    shortConcreteFollowUp ||
    confirmsSuggestedSearch ||
    moreFromPreviousProductRequest ||
    moreWithConcreteProduct ||
    hasShoppingFollowUpContext(normalized, history)
  );
}

function inferAgentIntent(message: string, history: ChatHistoryMessage[]) {
  const normalized = message.toLowerCase();
  const asksForProductSearch = clearlyAsksForProductSearch(message, history);
  const orderNumber = extractPlausibleOrderNumber(message);
  const pastedOrderNumberOnly =
    Boolean(orderNumber) &&
    message
      .toUpperCase()
      .split(/[^A-Z0-9]+/)
      .filter(Boolean).length === 1;

  if (
    isOrderTrackingRequest(message) ||
    pastedOrderNumberOnly ||
    (Boolean(orderNumber) && recentlyAskedForOrderNumber(history))
  ) {
    return "order_tracking" as const;
  }
  if (isVagueGiftIdeaRequest(message)) return "small_talk" as const;
  if (/\b(?:checkout|pay|payment|place order|confirm order)\b/i.test(normalized)) {
    return "checkout" as const;
  }
  if (/\b(?:cart|add this|add to cart|remove)\b/i.test(normalized)) {
    return "cart" as const;
  }
  if (/\b(?:compare|versus|vs|which one|better|best value)\b/i.test(normalized)) {
    return "compare" as const;
  }
  if (asksForProductSearch) {
    return "product_search" as const;
  }
  if (/\b(?:deliver|delivery|shipping|ship|arrive|arrival)\b/i.test(normalized)) {
    return "delivery" as const;
  }

  return "small_talk" as const;
}

function buildPlannedActions(
  intent: AgentState["intent"],
  message: string
): AgentAction[] {
  const normalized = message.toLowerCase();

  if (intent === "small_talk") {
    return [{ id: "reply", label: "Reply naturally" }];
  }

  if (intent === "order_tracking") {
    return [
      {
        id: "trackOrder",
        label: "Track paid order",
        toolName: "kapruka_track_order",
      },
    ];
  }

  if (intent === "delivery") {
    return [
      { id: "reply", label: "Identify delivery constraint" },
      {
        id: "checkDelivery",
        label: "Check delivery availability",
        toolName: "kapruka_check_delivery",
      },
    ];
  }

  if (intent === "cart") {
    return [
      { id: "compareProducts", label: "Confirm the best item" },
      {
        id: "prepareCart",
        label: "Prepare cart action",
        needsConfirmation: true,
      },
    ];
  }

  if (intent === "checkout") {
    return [
      { id: "compareProducts", label: "Confirm purchase choice" },
      {
        id: "checkDelivery",
        label: "Verify delivery before checkout",
        toolName: "kapruka_check_delivery",
      },
      {
        id: "prepareCheckout",
        label: "Prepare checkout approval",
        needsConfirmation: true,
      },
    ];
  }

  const actions: AgentAction[] = [
    {
      id: "searchProducts",
      label: "Search Kapruka products",
      toolName: "kapruka_search_products",
    },
    { id: "compareProducts", label: "Compare value and fit" },
  ];

  if (
    intent === "compare" ||
    /\b(?:details?|specs?|warranty|reviews?|rating)\b/i.test(normalized)
  ) {
    actions.push({
      id: "getProductDetails",
      label: "Inspect product details",
      toolName: "kapruka_get_product",
    });
  }

  if (/\b(?:deliver|delivery|tomorrow|today|city|kandy|colombo|galle)\b/i.test(normalized)) {
    actions.push({
      id: "checkDelivery",
      label: "Check delivery if product is clear",
      toolName: "kapruka_check_delivery",
    });
  }

  return actions;
}

function buildMemoryNotes(memory: AgentMemory, message: string) {
  const notes: string[] = [];
  const budget = extractBudget(message, memory);
  const explicitBudget = extractBudget(message, {});
  const explicitCity = extractDeliveryCity(message);
  const normalized = message.toLowerCase();
  const isFollowUp =
    /\b(?:same|again|more like|similar|like that|that one|those|previous|last time|keep it|around the same)\b/i.test(
      normalized
    );

  if (budget && (explicitBudget || isFollowUp)) {
    notes.push(`budget preference around Rs. ${budget.toLocaleString("en-LK")}`);
  }

  if (explicitCity || (isFollowUp && memory.deliveryCity)) {
    notes.push(`usual delivery city: ${memory.deliveryCity}`);
  }

  if (isFollowUp && memory.giftRecipients?.length) {
    notes.push(`gift context: ${memory.giftRecipients.join(", ")}`);
  }

  if (isFollowUp && memory.favoriteCategories?.length) {
    notes.push(`categories user has cared about: ${memory.favoriteCategories.join(", ")}`);
  }

  if (isFollowUp && memory.recentSearches?.[0]) {
    notes.push(`recent search: ${memory.recentSearches[0]}`);
  }

  return notes.slice(0, 5);
}

function buildAgentPlan(
  message: string,
  history: ChatHistoryMessage[],
  memory: AgentMemory
) {
  const intent = inferAgentIntent(message, history);

  return {
    intent,
    goal: inferGoal(message, intent),
    actions: buildPlannedActions(intent, message),
    memoryNotes: buildMemoryNotes(memory, message),
  };
}

function buildAgentSteps(
  intent: AgentState["intent"],
  response?: GroqResponse,
  productCount = 0
): AgentStep[] {
  const usedSearch = response ? calledTool(response, "kapruka_search_products") : false;
  const usedDelivery = response
    ? calledTool(response, "kapruka_check_delivery") ||
      calledTool(response, "kapruka_delivery_check")
    : false;

  function status(id: AgentStep["id"]): AgentStepStatus {
    if (id === "understand") return "completed";
    if (id === "search_products") {
      if (usedSearch || productCount > 0) return "completed";
      return intent === "product_search" || intent === "compare"
        ? "running"
        : "pending";
    }
    if (id === "compare_products") {
      if (productCount > 0) return "completed";
      return intent === "compare" ? "running" : "pending";
    }
    if (id === "check_delivery") {
      if (usedDelivery) return "completed";
      return intent === "delivery" ? "running" : "pending";
    }
    if (id === "recommend") {
      return productCount > 0 ||
        intent === "small_talk" ||
        intent === "order_tracking"
        ? "completed"
        : "pending";
    }
    if (id === "cart") return intent === "cart" ? "blocked" : "pending";
    if (id === "checkout") return intent === "checkout" ? "blocked" : "pending";

    return "pending";
  }

  return [
    { id: "understand", label: "Understand goal", status: status("understand") },
    {
      id: "search_products",
      label: "Search products",
      status: status("search_products"),
    },
    {
      id: "compare_products",
      label: "Compare options",
      status: status("compare_products"),
    },
    {
      id: "check_delivery",
      label: "Check delivery",
      status: status("check_delivery"),
    },
    { id: "recommend", label: "Recommend", status: status("recommend") },
    { id: "cart", label: "Cart confirmation", status: status("cart") },
    { id: "checkout", label: "Checkout approval", status: status("checkout") },
  ];
}

function buildToolTimeline(response: GroqResponse, startedAt: number) {
  let currentStartedAt = startedAt;

  return (response.output || [])
    .filter((item) => item.type === "mcp_call")
    .map<AgentToolCall>((item) => {
      const now = Date.now();
      const latencyMs = Math.max(1, now - currentStartedAt);
      currentStartedAt = now;

      return {
        name: item.name || "unknown_tool",
        status: "called",
        latencyMs,
        arguments: parsePossibleJson(item.arguments || "") || item.arguments,
      };
    });
}

function inferGoal(message: string, intent: AgentState["intent"]) {
  if (intent === "small_talk") return "Handle the conversation naturally.";
  if (intent === "checkout") return "Prepare checkout after user confirmation.";
  if (intent === "cart") return "Help manage cart with explicit user control.";
  if (intent === "delivery") return "Check delivery constraints before recommending.";
  if (intent === "order_tracking") return "Track an existing paid order.";

  return `Find and rank useful Kapruka options for: ${message.trim().slice(0, 160)}`;
}

function tokenizeForRanking(value: string) {
  const stopWords = new Set([
    "the",
    "and",
    "for",
    "with",
    "under",
    "below",
    "show",
    "find",
    "best",
    "good",
    "need",
    "want",
    "give",
    "options",
    "product",
    "products",
    "really",
    "what",
    "have",
    "you",
    "doyou",
    "dooyou",
    "may",
    "maybe",
    "rs",
    "lkr",
  ]);

  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !stopWords.has(token));
}

function productTextForRanking(product: ProductLike) {
  return `${product.name} ${product.description || ""} ${product.brand || ""} ${
    product.category || ""
  }`;
}

function strictRequestAliases(message: string) {
  const normalized = stripExcludedProductsInstruction(message).toLowerCase();
  const aliasGroups: string[][] = [];

  if (/\b(?:watch|watches|wristwatch|smartwatch)\b/i.test(normalized)) {
    aliasGroups.push([
      "watch",
      "watches",
      "wristwatch",
      "smartwatch",
      "timepiece",
      "analog",
      "digital",
    ]);
  }

  if (/\b(?:flower|flowers|bouquet|rose|roses)\b/i.test(normalized)) {
    aliasGroups.push(["flower", "flowers", "bouquet", "rose", "roses"]);
  }

  if (/\b(?:earbuds|headphones|earphones)\b/i.test(normalized)) {
    aliasGroups.push([
      "earbuds",
      "earphones",
      "headphones",
      "headset",
      "wireless",
    ]);
  }

  if (/\b(?:t-?shirts?|tee\s*shirts?|tees?|shirts?)\b/i.test(normalized)) {
    aliasGroups.push([
      "shirt",
      "shirts",
      "tshirt",
      "tshirts",
      "t-shirt",
      "t-shirts",
      "tee",
      "tees",
      "cotton",
    ]);
  }

  if (/\b(?:phone|phones|mobile|smartphone)\b/i.test(normalized)) {
    aliasGroups.push(["phone", "phones", "mobile", "smartphone"]);
  }

  if (
    /\b(?:gadget|gadgets|electronics?|device|devices|accessories|speaker|speakers|charger|chargers|powerbank|powerbanks)\b/i.test(
      normalized
    )
  ) {
    aliasGroups.push([
      "gadget",
      "gadgets",
      "electronics",
      "device",
      "devices",
      "accessories",
      "speaker",
      "speakers",
      "charger",
      "chargers",
      "powerbank",
      "powerbanks",
      "usb",
    ]);
  }

  if (/\b(?:perfume|fragrance|cologne)\b/i.test(normalized)) {
    aliasGroups.push(["perfume", "fragrance", "cologne"]);
  }

  if (
    /\b(?:snacks?|cookies?|biscuits?|chips?|nuts?|chocolates?|sweets?|candy)\b/i.test(
      normalized
    )
  ) {
    aliasGroups.push([
      "snack",
      "snacks",
      "cookie",
      "cookies",
      "biscuit",
      "biscuits",
      "chips",
      "nuts",
      "chocolate",
      "sweets",
      "candy",
    ]);
  }

  return aliasGroups.flat();
}

function productMatchesStrictRequest(product: ProductLike, message: string) {
  const request = stripExcludedProductsInstruction(message) || message;
  const aliases = strictRequestAliases(request);

  if (aliases.length === 0) return true;

  const productText = productTextForRanking(product).toLowerCase();
  const productName = product.name.toLowerCase();
  const asksForWatch = /\b(?:watch|watches|wristwatch|smartwatch)\b/i.test(
    request
  );
  const asksForWatchAccessory =
    /\b(?:box|case|strap|band|charger|protector|stand|holder|storage|display)\b/i.test(
      request
    );
  const asksForEarbuds = /\b(?:earbuds?|earphones?|airpods?)\b/i.test(request);
  const asksForHeadphones = /\b(?:headphones?|headsets?)\b/i.test(request);
  const asksForFlowers = /\b(?:flowers?|bouquets?|roses?)\b/i.test(request);
  const asksForCake = /\b(?:cakes?|cupcakes?)\b/i.test(request);
  const asksForSnack =
    /\b(?:snacks?|cookies?|biscuits?|chips?|nuts?|chocolates?|sweets?|candy)\b/i.test(
      request
    );
  const asksForAudioAccessory =
    /\b(?:holder|stand|case|cover|bag|cable|adapter|earpads?|cushions?|replacement|parts?)\b/i.test(
      message
    );

  if (
    asksForEarbuds &&
    !/\b(?:ear\s*buds?|earphones?|airpods?)\b/i.test(productText)
  ) {
    return false;
  }

  if (
    asksForHeadphones &&
    !asksForAudioAccessory &&
    (!/\b(?:headphones?|headsets?)\b/i.test(productText) ||
      /\b(?:holder|stand|case|cover|bag|cable|adapter|earpads?|cushions?|replacement|parts?)\b/i.test(
        productText
      ))
  ) {
    return false;
  }

  if (
    asksForFlowers &&
    !asksForCake &&
    /\b(?:cakes?|cupcakes?|icing|frosting)\b/i.test(productText)
  ) {
    return false;
  }

  if (
    asksForSnack &&
    (!/\b(?:snacks?|cookies?|biscuits?|chips?|nuts?|chocolates?|sweets?|candy|platter)\b/i.test(
      productName
    ) ||
      /\b(?:plate|plates|bowl|bowls|tray|trays|container|containers)\b/i.test(
        productName
      ))
  ) {
    return false;
  }

  if (
    asksForFlowers &&
    !asksForCake &&
    (!/\b(?:bouquets?|boquets?|roses?|blooms?|flower\s+(?:arrangements?|bunch(?:es)?|baskets?|bouquets?)|floral\s+arrangements?)\b/i.test(
      `${product.name} ${product.description || ""}`
    ) ||
      !/\b(?:flowers?|floral|bouquets?|boquets?|roses?|blooms?)\b/i.test(
        `${product.category || ""} ${product.description || ""} ${product.name}`
      ) ||
      /\b(?:book|novel|story|author|clips?|jewellery|jewelry|earrings?|necklace|dress|shirt|print|decor|decoration|artificial)\b/i.test(
        `${product.name} ${product.category || ""}`
      ))
  ) {
    return false;
  }

  if (
    asksForWatch &&
    !asksForWatchAccessory &&
    /\b(?:storage box|display box|watch box|case|strap|band|charger|protector|holder|stand|cell watch display|sunglasses)\b/i.test(
      productText
    )
  ) {
    return false;
  }

  return aliases.some((alias) =>
    new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(
      productText
    )
  );
}

function sharedRequestTokens(product: ProductLike, message: string) {
  const request = stripExcludedProductsInstruction(message) || message;
  const requestTokens = new Set([
    ...tokenizeForRanking(request),
    ...strictRequestAliases(request),
  ]);
  const productTokens = new Set(tokenizeForRanking(productTextForRanking(product)));

  return [...requestTokens].filter((token) => productTokens.has(token));
}

function scoreProductForAgent(
  product: ProductLike,
  message: string,
  memory: AgentMemory
): ProductRankingSignal {
  const reasons: string[] = [];
  const normalized = productTextForRanking(product).toLowerCase();
  const request = stripExcludedProductsInstruction(message) || message;
  const budget = extractBudget(request, memory);
  const sharedTokens = sharedRequestTokens(product, request);
  let score = 50;

  if (sharedTokens.length > 0) {
    score += Math.min(18, sharedTokens.length * 4);
    reasons.push("matches request");
  } else {
    score -= 35;
    reasons.push("weak request match");
  }

  if (product.price !== null && budget) {
    if (product.price <= budget) {
      const budgetUse = product.price / budget;
      score += budgetUse >= 0.45 && budgetUse <= 0.95 ? 24 : 16;
      reasons.push("inside budget");
    } else {
      const overBudgetRatio = product.price / budget;
      score -= overBudgetRatio > 1.4 ? 28 : 18;
      reasons.push("over budget");
    }
  }

  if (
    product.price !== null &&
    typeof product.compareAtPrice === "number" &&
    product.compareAtPrice > product.price
  ) {
    const discount = (product.compareAtPrice - product.price) / product.compareAtPrice;
    score += Math.min(10, discount * 30);
    reasons.push("discounted");
  }

  if (product.inStock === true) {
    score += 12;
    reasons.push("available");
  } else if (product.inStock === false) {
    score -= 20;
    reasons.push("out of stock");
  }

  if (product.freeShipping) {
    score += 5;
    reasons.push("delivery value");
  }

  if (typeof product.rating === "number" && product.rating > 0) {
    score += Math.min(5, product.rating);
  }

  if (typeof product.reviewCount === "number" && product.reviewCount > 0) {
    score += Math.min(5, Math.log10(product.reviewCount + 1) * 3);
    reasons.push("review signal");
  }

  for (const category of memory.favoriteCategories || []) {
    if (normalized.includes(category.toLowerCase())) {
      score += 8;
      reasons.push(`matches ${category}`);
      break;
    }
  }

  for (const recipient of memory.giftRecipients || []) {
    if (normalized.includes(recipient.toLowerCase())) {
      score += 6;
      reasons.push(`recipient fit`);
      break;
    }
  }

  if (/\b(?:gift|birthday|anniversary|mother|father|wife|husband|friend)\b/i.test(request)) {
    if (/\b(?:flower|cake|chocolate|hamper|gift|card)\b/i.test(normalized)) {
      score += 10;
      reasons.push("gift-friendly");
    }
  }

  if (product.productUrl) score += 5;
  if (product.imageUrl) score += 5;
  if (product.description && product.description.length > 80) {
    score += 4;
    reasons.push("clear details");
  }

  return {
    productId: product.id,
    score: Math.round(Math.max(0, Math.min(100, score))),
    reasons: reasons.slice(0, 4),
  };
}

function rankProductsForAgent(
  products: ProductLike[],
  message: string,
  memory: AgentMemory
) {
  const excludedNames = excludedProductNamesFromMessage(message);
  const uniqueProducts = [
    ...new Map(
      products.map((product) => [
        product.name.toLowerCase().replace(/\s+/g, " ").trim(),
        product,
      ])
    ).values(),
  ];
  const relevantProducts = uniqueProducts
    .filter((product) => !productWasExcluded(product, excludedNames))
    .filter((product) => productMatchesStrictRequest(product, message));
  const pricedProducts = relevantProducts
    .filter(
      (product): product is ProductLike & { price: number } =>
        typeof product.price === "number" && product.price > 0
    )
    .sort((first, second) => first.price - second.price);
  const medianPrice =
    pricedProducts.length >= 5
      ? pricedProducts[Math.floor(pricedProducts.length / 2)].price
      : null;
  const sourceProducts = relevantProducts.filter(
    (product) =>
      medianPrice === null ||
      product.price === null ||
      product.price <= medianPrice * 8
  );
  const ranked = sourceProducts.map((product) => ({
    product,
    ranking: scoreProductForAgent(product, message, memory),
  }));

  ranked.sort((first, second) => second.ranking.score - first.ranking.score);

  return {
    products: ranked.map(({ product, ranking }) => ({
      ...product,
      agentScore: ranking.score,
      rankingReason: ranking.reasons.join(", ") || product.reason,
    })),
    ranking: ranked.map(({ ranking }) => ranking),
  };
}

function buildAgentState({
  traceId,
  message,
  memory,
  plan,
  response,
  products,
  ranking,
  tools,
  startedAt,
}: {
  traceId: string;
  message: string;
  memory: AgentMemory;
  plan: ReturnType<typeof buildAgentPlan>;
  response?: GroqResponse;
  products: ProductLike[];
  ranking: ProductRankingSignal[];
  tools: AgentToolCall[];
  startedAt: number;
}): AgentState {
  const intent = plan.intent;
  const memoryPatch = buildMemoryPatch(message, memory, products.length > 0);
  const steps = buildAgentSteps(intent, response, products.length);
  const currentStep =
    steps.find((step) => step.status === "running" || step.status === "blocked")
      ?.id || "recommend";
  const humanReviewRequired =
    intent === "cart" ||
    intent === "checkout" ||
    /\b(?:checkout|pay|buy it|order it|add to cart)\b/i.test(message);
  const observations = [
    products.length > 0
      ? `Ranked ${products.length} product${products.length === 1 ? "" : "s"} by relevance, price fit, stock, and quality signals.`
      : "No product ranking was needed for this turn.",
    humanReviewRequired
      ? "Payment and checkout actions require explicit user confirmation."
      : "No sensitive purchase action was taken automatically.",
  ];

  if (tools.length > 0) {
    observations.push(`Called ${tools.length} commerce tool${tools.length === 1 ? "" : "s"}.`);
  }

  const agentState: AgentState = {
    traceId,
    goal: plan.goal,
    intent,
    currentStep,
    steps,
    plannedActions: plan.actions,
    tools,
    memoryPatch,
    memoryNotes: plan.memoryNotes,
    ranking,
    humanReviewRequired,
    observations,
  };

  console.info("Agent observability trace", {
    traceId,
    intent,
    goal: agentState.goal,
    durationMs: Date.now() - startedAt,
    toolCalls: tools,
    productCount: products.length,
    humanReviewRequired,
    memoryPatch,
  });

  return agentState;
}

function wantsProductCards(
  message: string,
  history: ChatHistoryMessage[],
  response: GroqResponse
) {
  if (!calledTool(response, "kapruka_search_products")) return false;
  return clearlyAsksForProductSearch(message, history);
}

function formatMemoryForPrompt(memory: AgentMemory, plan: ReturnType<typeof buildAgentPlan>) {
  const lines = [
    ...plan.memoryNotes.map((note) => `- ${note}`),
  ];

  if (lines.length === 0) {
    return "- No stable preference memory yet. Learn gently from this turn.";
  }

  return lines.join("\n");
}

function formatPlanForPrompt(plan: ReturnType<typeof buildAgentPlan>) {
  return plan.actions
    .map((action, index) => {
      const toolText = action.toolName ? ` using ${action.toolName}` : "";
      const confirmationText = action.needsConfirmation
        ? " before asking for confirmation"
        : "";

      return `${index + 1}. ${action.label}${toolText}${confirmationText}`;
    })
    .join("\n");
}

function buildSystemPrompt(
  isRetry: boolean,
  memory: AgentMemory,
  plan: ReturnType<typeof buildAgentPlan>
) {
  return `
You are Kapruka Shopping Buddy, a Sri Lankan AI marketplace shopping assistant.

You help users shop across Kapruka's broad marketplace using real Kapruka MCP tools. Kapruka carries electronics, groceries, fashion, home products, daily essentials, gifts, and products from thousands of third-party sellers.

Core customer model:
- The primary user is shopping for their own everyday needs.
- Do not assume a purchase is a gift, has a recipient, or has an occasion.
- Treat gifting as one important shopping mode only when the user mentions a recipient, celebration, event, or gift intent.
- For gift intent, think in bundles when useful: main gift, small add-on, card/message, and delivery timing. Do not force all four if the user asked for one item.
- For registry-style requests, build a shortlist the user can save to their gift list. Mention budget balance and practical variety instead of pretending a Kapruka registry exists.
- For occasion shortcuts such as birthday, anniversary, new baby, housewarming, get well, or same-day delivery, search directly and return a balanced mix of product types when the user asks to browse or build a bundle.
- For recipient-first gifting, use recipient, occasion, city, date, budget, and gift message when provided. Ask only one missing detail if it would materially change the choice.
- Help users discover products, compare practical tradeoffs, stay within budget, and choose between marketplace options.
- When seller, brand, size, compatibility, quantity, specifications, or delivery details affect the decision, surface those factors or ask one focused question.

Personality and voice:
- You are Kapruka Shopping Buddy: a sharp, modern Sri Lankan shopping companion, not a customer-support script or a product catalogue.
- Feel like a familiar, trustworthy best friend who happens to be excellent at shopping. Be present in the conversation before trying to sell anything.
- Sound warm, relaxed, confident, and observant. React to what the user actually said instead of jumping straight into a search.
- Use current, natural language such as "solid pick", "worth it", "skip this one", or "my pick" when it fits. Never force slang.
- Be lightly witty, never loud, childish, overexcited, or try-hard. Do not call the user "bestie", "bro", or "queen" unless they establish that tone first.
- Do not use emoji.
- Give a point of view. Lead with the verdict, then the reason. Say which option you would choose and what tradeoff the user is making.
- Use short, conversational sentences and contractions. Vary sentence length naturally; do not make every reply follow the same template.
- Notice and reuse details from the recent conversation: budget, recipient, occasion, city, date, style, brand, size, and dislikes. Do not ask for information the user already gave.
- If the user shares a personal problem, respond like a perceptive close friend: acknowledge it in a few words, then offer one concrete next move. Do not turn it into a therapy lecture.
- Use your own judgment about the situation. For emotional small talk, give practical friend-level judgment first. Do not suggest products, gifts, comfort purchases, flowers, snacks, or browsing unless the user asks to buy, send, order, browse, find, or fix it with a gift.
- Do not search during pure greetings or emotional small talk. Once the user asks to see/find/buy/browse, accepts a browse/search suggestion, gives a budget for a thing, or names a purchasable product/category, use live Kapruka product search and show product cards. In user-facing wording, keep tool/search mechanics invisible; say "I'll find something for you" or "I'll find a few good ones" instead.
- For emotional small talk, avoid polished therapy-speak. Good: "Oof, give it a minute before texting. Then keep it simpleâ€”no essay." Bad: "I'm sorry to hear you're experiencing difficulties."
- When using memory, do it like a friend noticing context, not like a database report. Good: "Since you were keeping it around Rs. 10,000..." Bad: "Based on your stored preference..."
- If memory may be stale or sensitive, phrase it softly: "Want me to use Kandy again?" or "Still keeping it under Rs. 10,000?"
- Never state remembered budget, city, recipient, occasion, or delivery need as current fact unless the user mentioned it in the current message or clearly asked to reuse previous context with words like "same", "again", "more like that", or "keep it".
- For a new gift/person/occasion, treat old memory as a quiet preference signal only. Do not say "Since you're looking to spend..." or "need it delivered to..." unless it came from the current user message.
- When the user is unsure, reduce the decision to one easy choice instead of returning a questionnaire.
- When the user names a product/category or asks what is available, search Kapruka immediately. Do not ask for permission, vibe, budget, or confirmation first. Keep the action invisible to the user unless there is a delay.
- If details are missing, show a useful broad shortlist first, then let filter chips handle budget or value refinement.
- Match the user's energy. Keep quick questions quick; become more detailed only when the decision needs it.
- Small talk, opinions, uncertainty, jokes, thanks, and casual conversation should feel like texting a smart Gen-Z friend. Use modern phrasing naturally, but never perform slang or sound like a brand trying to be young.
- It is fine to say "Honestly", "I'd go with...", "That changes things", or "Nah, I'd skip that" when truthful and useful.
- Never claim to be human, have a real life, or be the user's actual best friend. Create warmth through attention, memory, honesty, and useful judgment.
- Avoid cheesy lines like "gifts from the heart are precious" or "choose what resonates".
- Avoid corporate phrases like "memorable birthday celebration", "delightful experience", "perfect choice", unless truly natural.
- Avoid service-desk phrases like "How may I assist you?", "Please provide", and "I apologize for the inconvenience".
- Do not open every reply with "Sure", "Certainly", "Of course", or the user's name.
- Do not end with generic inspirational advice.
- Do not force a question or call to action at the end. End naturally unless one focused next step would genuinely help.
- Finish every sentence and every thought. Never end on a connector or unfinished phrase such as "to", "because", "and", "with", or "the".
- When the user challenges, corrects, or rejects your suggestion, respond to that correction directly. Do not repeat the rejected idea or restart the conversation.
- Acknowledge mistakes once in plain language, then move forward with a useful answer. Avoid canned recovery phrases and long apologies.
- If the user asks "really how?", explain the practical next step instead of restating your previous claim.
- Sound like a perceptive close friend: specific, candid, and useful. Warmth comes from understanding the exact situation, not from filler or forced slang.
- Never leave a reply as setup without payoff. If you say "I'd go with..." or "you want...", complete the recommendation in the same response.
- For casual conversation, default to 25-45 words total and 1-3 short sentences. One sharp thought is better than a complete essay.
- Do not stack validation, explanation, advice, and several questions into one reply. Pick the most useful response for this moment.
- Ask at most one short question. If you already gave a useful next step, a question is optional.
- Go beyond 45 words only when the user explicitly asks for details, steps, or a full explanation; even then, stay under 120 words unless accuracy requires more.
- Read informal spelling and Singlish corrections in context. If a correction can genuinely mean two different things, ask one short clarification instead of confidently guessing.

Good English style:
"Okay, these are the ones worth looking at. My pick is the first pair: better battery life, still under your Rs. 15,000 cap, and no paying extra for features you probably won't use."

Bad English style:
"Certainly! I have found several wonderful products that may suit your requirements. Please review the options below."

Good Singlish style:
"Hari, daily use ekata nam first eka thamai solid pick. Battery life hodai, budget ekath athule - delivery check karannada?"

Bad Singlish style:
"Obata awashya bhanda thoraganeemata mama sahaya wannam."

Language matching rules:
- Detect the user's language style.
- If the user writes in English, reply in English.
- If the user writes in Tanglish or Singlish, reply in natural Singlish/Tanglish.
- If the user writes in Sinhala script, reply in Sinhala script.
- Product names can stay in English exactly as Kapruka returns them.
- Prices, delivery fees, product names, and stock details must stay accurate.
- Do not translate product names badly.

Shopping rules:
- Use Kapruka tools for product search, product details, categories, delivery cities, and delivery availability. Do not expose tool/search wording to the user.
- Follow the internal plan below, but adapt if the user's message clearly changes the job.
- Product cards are a visual aid, not the default response.
- Do not call product search tools for greetings, thanks, small talk, opinions, emotional conversation, general advice, or unclear messages. Reply naturally.
- If the user is exploring an idea but has not asked to see products yet, discuss it or ask one useful question before searching.
- If the user says they have no idea what to give someone, do not immediately list products. First give 2-3 thoughtful gift directions based on the relationship and ask one natural question about style, budget, or delivery timing.
- Search only when the user clearly asks to find, browse, compare, recommend, shortlist, or buy products, or asks for more/different results from an existing search.
- A question about a previously shown item should usually get a direct answer, not the same product list again.
- Never invent product names, prices, stock, delivery availability, product URLs, images, or checkout links.
- Search the full marketplace. Do not steer ordinary requests toward gifts, cakes, flowers, or hampers.
- Assume the user is buying for themselves unless they indicate otherwise.
- Do not invent a recipient. If the user asks for flowers but does not say who they are for, say "flower options" or "these flowers", not "for your sister/mother/wife".
- For electronics, consider specifications, compatibility, warranty, brand, and practical value when data is available.
- For groceries and essentials, consider quantity, pack size, unit value, availability, and delivery practicality when data is available.
- For fashion, ask about size, fit, style, or intended use when necessary.
- For home products, consider dimensions, material, use case, and compatibility when relevant.
- Products may come from third-party sellers. Do not imply Kapruka directly manufactures or sells every item, and do not invent seller ratings or guarantees.
- If user gives budget, respect it.
- If user gives city/date, check delivery when possible.
- If the user asks to add to cart, buy, checkout, pay, or order, pause for explicit confirmation before taking or implying a purchase action.
- Never pretend checkout/payment/cart mutation happened unless the UI or checkout endpoint actually did it.
- If important details are missing, ask one short follow-up question.
- Do not create an order. Checkout will be handled later after explicit user confirmation.
- Checkout produces a guest-checkout payment link. Never ask for card details, suggest test card data, or claim that payment was completed before Kapruka confirms it.
- For order tracking, ask for the actual order number from the paid-order confirmation email or order-complete page, then use kapruka_track_order. If the user needs a sample order number for testing, use ${TRACKING_EXAMPLE_ORDER_NUMBER}.
- Never call kapruka_track_order with placeholders such as "unknown", "none", or an invented number. Call it only when the user has supplied a plausible order number.
- The pre-payment checkout reference is not a trackable order number. If that is all the user has, explain the difference warmly and in one or two sentences.
- When reporting tracking results, lead with the current status and next expected step. Do not unnecessarily repeat the recipient's full phone number or street address.
- Browser coordinates are approximate context only. Do not claim an exact city, address, delivery fee, or delivery availability from coordinates.
- If delivery location matters and the user has not named a city, ask them to confirm their delivery city.

Search quality rules:
- For Tanglish/Sinhala requests, convert the user's intent into strong English search keywords before calling tools.
- Understand common Sri Lankan relationship and gift phrasing: amma/mom/mother, thaththa/appachchi/father, aiya/malli/brother, akka/nangi/sister, thagi/gift, hoyala/find, denna/give, yata/under.
- Preserve product-defining terms such as model numbers, brands, sizes, capacities, colors, pack quantities, and compatibility requirements.
- Use broad marketplace category terms for vague everyday requests, then narrow based on the returned products and user preferences.
- Only apply recipient and occasion search expansion when the request is explicitly about gifting.
- If the recipient is mother, amma, mom, or අම්මා, prefer search keywords like "mother birthday flowers cake chocolate hamper gift".
- If the recipient is father, appachchi, dad, or තාත්තා, prefer search keywords like "father birthday hamper chocolate cake gift".
- If the user asks for brother, aiya, malli, or සහෝදරයා, prefer search keywords like "brother birthday mug hamper chocolate cake gift".
- If the user asks for new baby, baby shower, or newborn gifts, prefer baby gift sets, baby clothes, baby hampers, and soft toys.
- If the user asks for housewarming or new home gifts, prefer home essentials, kitchen items, towel sets, decor, and practical bundles.
- If the user asks for girlfriend, wife, anniversary, or love, prefer flowers, chocolates, cakes, romantic gifts, and greeting cards.
- Avoid irrelevant kids, superhero, boyfriend, girlfriend, or "for him" items unless the user asks for them.
- De-duplicate products before replying.
- Recommend 3 to 5 strong products by default. Show more only when the user asks for breadth.
- Clean messy HTML entities from product names before replying.
- Give a short reason why each product matches the user's stated need, budget, and constraints.
- If the search results are weak, do another better search with improved keywords.
- Request JSON responses from product search so the UI can use each product's real summary, image, price, stock, and URL.
- Only when the user asked to browse or compare products, list them in this exact format so the UI can create product cards:
  1. Product Name - Rs. 2990
     Reason: short reason here

Internal agent plan for this turn:
Intent: ${plan.intent}
Goal: ${plan.goal}
Actions:
${formatPlanForPrompt(plan)}

Useful memory for this turn:
${formatMemoryForPrompt(memory, plan)}

Critical MCP tool argument rules:
- Use native JSON types only.
- Numbers must be numbers, not strings. Correct: 8000. Wrong: "8000".
- Booleans must be booleans, not strings. Correct: false. Wrong: "false".
- Null must be null, not string. Correct: null. Wrong: "null".
- limit must be an integer.
- min_price and max_price must be numbers or null.
- in_stock_only and include_stubs must be booleans.
- category and cursor must be null when not known, not "null".
- Set response_format to "json" for kapruka_search_products.

Correct kapruka_search_products example:
{
  "params": {
    "q": "wireless earbuds bluetooth long battery life",
    "category": null,
    "limit": 10,
    "cursor": null,
    "currency": "LKR",
    "min_price": 0,
    "max_price": 15000,
    "in_stock_only": false,
    "sort": "relevance",
    "include_stubs": false,
    "response_format": "json"
  }
}

Wrong example:
{
  "params": {
    "limit": "10",
    "min_price": "0",
    "max_price": "8000",
    "in_stock_only": "false",
    "category": "null"
  }
}

${isRetry ? "The previous tool call failed because argument types were wrong. Retry carefully using native JSON types only." : ""}
`;
}

function buildConversationSystemPrompt(
  memory: AgentMemory,
  plan: ReturnType<typeof buildAgentPlan>
) {
  return `
You are Kapruka Shopping Buddy, Kapruka's AI shopping agent for Sri Lanka. You are not a general-purpose assistant.

Reply to the latest user message, not with a generic speech.
- HARD LIMIT: default to 35 words or fewer and at most 2 short sentences. Count before answering and rewrite if longer. Never give an essay unless explicitly requested.
- Focus on Kapruka product discovery, comparisons, budgets, delivery, cart, and checkout decisions.
- For unrelated general questions, answer only briefly and connect the useful part to a shopping decision when relevant.
- React to the specific situation in a few natural words, then give one concrete opinion or next move.
- Sound like a chill, sharp Gen Z friend who knows shopping: casual contractions, direct opinions, and zero corporate energy.
- Natural phrases like "oof", "honestly", "yeah", "nah", or "I'd go with" are fine when they fit. Never stack slang or try too hard.
- Avoid therapy language and generic openings such as "Sometimes situations like this can be difficult", "I understand", or "That sounds challenging".
- Ask at most one short question, and only if its answer would change your advice.
- Treat the latest message as the current goal. Reuse previous shopping context only when the user explicitly says "same", "again", "more", "that", or "those".
- Greetings, thanks, and casual questions should receive casual answers only. Never turn them into a product pitch.
- Never ask about delivery before the user selects a product or explicitly asks about delivery, shipping, or arrival.
- Do not pressure, convince, or proactively move the user toward cart or checkout. Help with the current decision only.
- You have shopping instinct, not sales pressure. When the user shares a personal/emotional situation, respond like a sharp close friend first. Do not suggest products, gifts, flowers, comfort food, or a self-treat unless the user asks to buy, send, order, browse, find, or fix it with a gift.
- For tension with someone close, prefer a calm, low-pressure repair over a grand gesture. A small peace offering can support an honest message, but should never replace it.
- If repairing things is not the right move yet, it is fine to suggest cooling off or getting the user something comforting instead.
- Make the judgment yourself from the conversation. Do not mechanically mention gifts in every emotional reply.
- Match English, Singlish, Tanglish, or Sinhala to the user's style.
- Do not use emoji or em dashes. Use commas or separate sentences instead. Do not claim to be human or the user's literal best friend.
- Finish the thought. If the user explicitly asks for detail or steps, you may use up to 80 words.

Conversation goal: ${plan.goal}
Quiet context, only if clearly relevant:
${formatMemoryForPrompt(memory, plan)}
`;
}

function parseLocation(value: unknown): LocationContext | null {
  if (!isRecord(value)) return null;

  const latitude = value.latitude;
  const longitude = value.longitude;
  const accuracy = value.accuracy;

  if (
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    typeof longitude !== "number" ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  return {
    latitude,
    longitude,
    accuracy:
      typeof accuracy === "number" && Number.isFinite(accuracy)
        ? Math.max(0, Math.round(accuracy))
        : null,
  };
}

function buildUserMessage(
  message: string,
  location: LocationContext | null,
  memory: AgentMemory,
  plan: ReturnType<typeof buildAgentPlan>,
  forceProductSearch = false
) {
  const searchInstruction = forceProductSearch
    ? `

Important: This is a product-search turn. You must call kapruka_search_products with response_format "json" before replying. Do not answer from general knowledge only.`
    : "";
  const memoryText = plan.memoryNotes.length
    ? `

Quiet memory context to consider naturally:
${formatMemoryForPrompt(memory, plan)}`
    : "";

  if (!location) return `${message}${searchInstruction}${memoryText}`;

  const accuracyText =
    location.accuracy === null
      ? ""
      : ` Accuracy is approximately ${location.accuracy} meters.`;

  return `${message}

Approximate browser location context: latitude ${location.latitude}, longitude ${location.longitude}.${accuracyText}
Use this only for broad recommendation context. Ask the user to confirm their delivery city before making delivery claims.${searchInstruction}${memoryText}`;
}

async function callGroq(
  message: string,
  isRetry: boolean,
  location: LocationContext | null,
  history: ChatHistoryMessage[],
  memory: AgentMemory,
  plan: ReturnType<typeof buildAgentPlan>,
  forceProductSearch = false,
  timeoutMs = 60_000,
  systemOverride?: string
) {
  return fetch("https://api.groq.com/openai/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      max_output_tokens: 700,
      input: [
        {
          role: "system",
          content:
            systemOverride || buildSystemPrompt(isRetry, memory, plan),
        },
        ...history,
        {
          role: "user",
          content: buildUserMessage(
            message,
            location,
            memory,
            plan,
            forceProductSearch
          ),
        },
      ],
      tools: [
        {
          type: "mcp",
          server_label: "kapruka",
          server_url:
            process.env.KAPRUKA_MCP_URL || "https://mcp.kapruka.com/mcp",
          server_description:
            "Kapruka Sri Lanka shopping tools for product search, product details, categories, delivery cities, delivery checks, and tracking existing paid orders.",
          require_approval: "never",
          allowed_tools: [
            "kapruka_search_products",
            "kapruka_get_product",
            "kapruka_list_categories",
            "kapruka_list_delivery_cities",
            "kapruka_check_delivery",
            "kapruka_track_order",
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function callGroqConversationFallback(
  message: string,
  _location: LocationContext | null,
  history: ChatHistoryMessage[],
  memory: AgentMemory,
  plan: ReturnType<typeof buildAgentPlan>
) {
  if (!process.env.GROQ_API_KEY) return null;

  try {
    const result = await generateText({
      model: groq(
        process.env.GROQ_CHAT_MODEL ||
          process.env.GROQ_MODEL ||
          "openai/gpt-oss-120b"
      ),
      system: buildConversationSystemPrompt(memory, plan),
      messages: [...history, { role: "user", content: message }],
      maxOutputTokens: 140,
      temperature: 0.4,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(8_000),
      providerOptions: {
        groq: {
          reasoningEffort: "low",
          reasoningFormat: "hidden",
        },
      },
    });

    return removeRoboticLines(result.text);
  } catch (error) {
    console.warn("Backup conversation model failed.", error);
  }

  return null;
}

function wantsConversationOnlyPlan(plan: ReturnType<typeof buildAgentPlan>) {
  return !plan.actions.some((action) => action.toolName);
}

function planNeedsProductSearch(plan: ReturnType<typeof buildAgentPlan>) {
  return plan.actions.some((action) => action.id === "searchProducts");
}

function geminiReplyLooksIncomplete(text: string, finishReason: string) {
  const trimmed = text.trim();

  if (!trimmed) return true;
  if (finishReason === "length") return true;
  if (/\b(?:to|and|or|but|because|with|for|the|a|an)\s*$/i.test(trimmed)) {
    return true;
  }

  return trimmed.split(/\s+/).length >= 8 && !/[.!?…'"”’)\]]$/.test(trimmed);
}

async function generateCompleteGeminiReply({
  system,
  history,
  userContent,
  maxOutputTokens = 180,
}: {
  system: string;
  history: ChatHistoryMessage[];
  userContent: string;
  maxOutputTokens?: number;
}) {
  const modelId = process.env.GEMINI_MODEL || "gemini-3.5-flash";
  const messages = [
    ...history.map((item) => ({
      role: item.role,
      content: item.content,
    })),
    {
      role: "user" as const,
      content: userContent,
    },
  ];
  const run = (retry: boolean) =>
    generateText({
      model: google.interactions(modelId),
      system: `${system}${
        retry
          ? "\n\nYour previous draft was incomplete. Answer the latest user message again from scratch in complete, natural sentences. Finish the full thought before stopping."
          : ""
      }`,
      messages,
      maxOutputTokens: retry
        ? Math.min(320, Math.max(maxOutputTokens + 80, maxOutputTokens))
        : maxOutputTokens,
      providerOptions: {
        google: {
          thinkingLevel: "minimal",
          store: false,
        },
      },
    });

  let result = await run(false);
  let text = result.text.trim();

  if (geminiReplyLooksIncomplete(text, result.finishReason)) {
    console.warn("Gemini returned an incomplete reply; retrying.", {
      finishReason: result.finishReason,
      outputTokens: result.usage.outputTokens,
    });
    result = await run(true);
    text = result.text.trim();
  }

  console.info("Gemini conversation completion", {
    model: modelId,
    finishReason: result.finishReason,
    outputTokens: result.usage.outputTokens,
    reasoningTokens: result.usage.reasoningTokens,
  });

  return text;
}

async function callGemini(
  message: string,
  location: LocationContext | null,
  history: ChatHistoryMessage[],
  memory: AgentMemory,
  plan: ReturnType<typeof buildAgentPlan>
) {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is missing in .env.local");
  }

  return generateCompleteGeminiReply({
    system: buildConversationSystemPrompt(memory, plan),
    history,
    userContent: buildUserMessage(message, location, memory, plan),
    maxOutputTokens:
      /\b(?:in detail|detailed|explain fully|full explanation|step by step|deep dive)\b/i.test(
        message
      )
        ? 320
        : 180,
  });
}

async function callGeminiWithDelivery(
  message: string,
  location: LocationContext | null,
  history: ChatHistoryMessage[],
  memory: AgentMemory,
  plan: ReturnType<typeof buildAgentPlan>,
  delivery: Awaited<ReturnType<typeof checkKaprukaDeliveryDirect>>
) {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is missing in .env.local");
  }

  return generateCompleteGeminiReply({
    system: `${buildSystemPrompt(false, memory, plan)}

You already have a live Kapruka delivery result in the user message.
Answer from that result only. Do not invent delivery fees, dates, cities, or availability.
Keep it short and direct, like a real chat reply.
End with a complete sentence. Do not use emoji.`,
    history,
    userContent: `${buildUserMessage(message, location, memory, plan)}

Live Kapruka delivery result:
${JSON.stringify(delivery)}`,
    maxOutputTokens: 180,
  });
}

function fallbackGeminiReply(
  message: string,
  plan: ReturnType<typeof buildAgentPlan>
) {
  if (isEmotionalSmallTalk(message)) {
    return "Oof, that sounds rough. Give it a minute, then keep the next move simple and calm.";
  }

  if (isVagueGiftIdeaRequest(message)) {
    return "That's a nice problem to have. I'd first decide the vibe: romantic, useful, or something she can enjoy slowly. Tell me which one feels more like her and I'll narrow it down.";
  }

  if (plan.intent === "small_talk") {
    const normalized = message.toLowerCase().trim();

    if (/^(?:nothing|idk|i don't know|dont know|not sure|whatever|anything)$/i.test(normalized)) {
      return "No problem. When you're ready, give me a product, budget, recipient, or occasion and I'll narrow it down.";
    }

    return "I'm Kapruka's shopping agent. Tell me what you need, your budget, or who it's for.";
  }

  return "Tell me what you want to find on Kapruka and I'll keep the shortlist focused.";
}

function fallbackDeliveryReply(
  delivery: Awaited<ReturnType<typeof checkKaprukaDeliveryDirect>>
) {
  if (delivery.available) {
    const feeText =
      typeof delivery.fee === "number"
        ? ` The delivery fee is Rs. ${delivery.fee}.`
        : "";

    return `Yes, delivery to ${delivery.city} is available for ${delivery.checkedDate}.${feeText}`;
  }

  const earliestText = delivery.earliestDate
    ? ` Earliest available date is ${delivery.earliestDate}.`
    : "";

  return `Delivery to ${delivery.city} is not available for ${delivery.checkedDate}.${earliestText}`;
}

function latestTrackingStep(tracking: TrackOrderResult) {
  const progress = tracking.progress || [];

  return progress.length > 0 ? progress[progress.length - 1] : null;
}

function formatOrderAmount(amount: TrackOrderResult["amount"]) {
  if (!amount) return null;
  if (typeof amount === "string") return `LKR ${amount}`;

  return `${amount.currency || "LKR"} ${amount.value || ""}`.trim();
}

function fallbackOrderTrackingReply(tracking: TrackOrderResult) {
  const orderNumber = tracking.order_number || "that order";
  const status = tracking.status_display || tracking.status || "Status found";
  const latestStep = latestTrackingStep(tracking);
  const city = tracking.recipient?.city ? ` to ${tracking.recipient.city}` : "";
  const deliveryDate = tracking.delivery_date
    ? ` Delivery date: ${tracking.delivery_date}.`
    : "";
  const amount = formatOrderAmount(tracking.amount);
  const amountText = amount ? ` Amount: ${amount}.` : "";
  const mediaText =
    tracking.has_delivery_photo || tracking.has_delivery_video
      ? " Delivery media is available on Kapruka."
      : "";
  const liveText = tracking.live_tracking_available
    ? " Live tracking is available."
    : "";
  const latestText = latestStep?.step
    ? ` Latest update: ${latestStep.step}${
        latestStep.timestamp ? ` at ${latestStep.timestamp}` : ""
      }.`
    : "";
  const commentText = tracking.comments ? ` ${tracking.comments}` : "";
  return `Order ${orderNumber} is ${status}${city}.${latestText}${deliveryDate}${amountText}${commentText}${liveText}${mediaText}`.replace(
    /\s+/g,
    " "
  );
}

function publicOrderTrackingResult(
  tracking: TrackOrderResult
): OrderTrackingResult {
  const rawAmount = tracking.amount;
  const amount =
    typeof rawAmount === "string"
      ? { value: rawAmount, currency: "LKR" }
      : rawAmount?.value
        ? { value: rawAmount.value, currency: rawAmount.currency || "LKR" }
        : null;

  return {
    orderNumber: tracking.order_number || "",
    status: tracking.status || "",
    statusDisplay:
      tracking.status_display || tracking.status || "Status available",
    orderDate: tracking.order_date || null,
    deliveryDate: tracking.delivery_date || null,
    shippedDate: tracking.shipped_date || null,
    amount,
    comments: tracking.comments || null,
    recipientCity: tracking.recipient?.city || null,
    progress: (tracking.progress || [])
      .filter((item) => item.step || item.timestamp)
      .map((item) => ({
        step: item.step || "Status update",
        timestamp: item.timestamp || "",
      })),
    liveTrackingAvailable: tracking.live_tracking_available === true,
    hasDeliveryVideo: tracking.has_delivery_video === true,
    hasDeliveryPhoto: tracking.has_delivery_photo === true,
  };
}

function isPlainGreeting(message: string) {
  const normalized = message
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (["hellow", "ciao"].includes(normalized)) return true;

  return /^(?:hi|hello|hey|helo|hii|hiii|yo|sup|good morning|good afternoon|good evening|ayubowan|vanakkam|kohomada|mk|mokada|ela|hari|හලෝ|හායි|ආයුබෝවන්)$/.test(
    normalized
  );
}

function isOrderTrackingRequest(message: string) {
  return /\b(?:track|tracking|status|where)\b[\s\S]{0,30}\b(?:order|delivery|package)\b|\b(?:order|delivery|package)\b[\s\S]{0,30}\b(?:track|tracking|status|where)\b/i.test(
    message
  ) || /\b(?:track|tracking|status|where)\b[\s\S]{0,50}\b[A-Z]{2,}\d+[A-Z0-9]*\b/i.test(message);
}

function extractPlausibleOrderNumber(message: string) {
  return message
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .find(
      (token) =>
        token.length >= 8 &&
        token.length <= 24 &&
        /[A-Z]/.test(token) &&
        /\d/.test(token)
    );
}

function hasPlausibleOrderNumber(message: string) {
  return Boolean(extractPlausibleOrderNumber(message));
}

function recentlyAskedForOrderNumber(history: ChatHistoryMessage[]) {
  return /order number|latest status|pull up the latest status/i.test(
    history.at(-1)?.content || ""
  );
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  const traceId = createTraceId();

  try {
    const {
      message,
      location: rawLocation,
      history: rawHistory,
      memory: rawMemory,
      sessionId,
    } = await req.json();
    const location = parseLocation(rawLocation);

    if (!message || typeof message !== "string") {
      return Response.json({ error: "Message is required" }, { status: 400 });
    }

    if (isPlainGreeting(message)) {
      return Response.json({
        reply: "Hey. I'm here. What's going on?",
        products: [],
        debug: [],
      });
    }

    if (isOrderTrackingRequest(message) && !hasPlausibleOrderNumber(message)) {
      return Response.json({
        reply:
          `Yep, I can check it. Send me the actual order number from your confirmation email or order-complete page. You can also try ${TRACKING_EXAMPLE_ORDER_NUMBER}.`,
        products: [],
        debug: [],
      });
    }

    const clientMemory = parseAgentMemory(rawMemory);
    const databaseMemory =
      typeof sessionId === "string"
        ? await getAgentMemoryForSession(sessionId)
        : {};
    const memory = mergeAgentMemoryForPersistence(
      clientMemory,
      databaseMemory
    );
    const history: ChatHistoryMessage[] = Array.isArray(rawHistory)
      ? rawHistory
          .filter(
            (item): item is ChatHistoryMessage =>
              isRecord(item) &&
              (item.role === "user" || item.role === "assistant") &&
              typeof item.content === "string" &&
              item.content.trim().length > 0
          )
          .slice(-8)
          .map((item) => ({
            role: item.role,
            content: item.content.trim().slice(0, 2000),
          }))
      : [];

    const plan = buildAgentPlan(message, history, memory);

    if (isPlainGreeting(message)) {
      return Response.json({
        reply: "Hey 👋\nWhat are we hunting for today?",
        products: [],
        debug: [],
      });
    }

    if (isOrderTrackingRequest(message) && !hasPlausibleOrderNumber(message)) {
      return Response.json({
        reply:
          `Yep, I can check it. Send me the actual order number from your confirmation email or order-complete page. You can also try ${TRACKING_EXAMPLE_ORDER_NUMBER}.`,
        products: [],
        debug: [],
      });
    }

    if (plan.intent === "order_tracking") {
      const orderNumber = extractPlausibleOrderNumber(message);

      if (!orderNumber) {
        return Response.json({
          reply:
            `Yep, I can check it. Send me the actual order number from your confirmation email or order-complete page. You can also try ${TRACKING_EXAMPLE_ORDER_NUMBER}.`,
          products: [],
          debug: [],
        });
      }

      const trackingStartedAt = Date.now();
      const tracking = await trackKaprukaOrderDirect(orderNumber);
      const tools: AgentToolCall[] = [
        {
          name: "kapruka_track_order",
          status: "called",
          latencyMs: Date.now() - trackingStartedAt,
          arguments: {
            order_number: orderNumber,
            response_format: "json",
          },
        },
      ];
      const agentState = buildAgentState({
        traceId,
        message,
        memory,
        plan,
        products: [],
        ranking: [],
        tools,
        startedAt,
      });
      const displayReply = fallbackOrderTrackingReply(tracking);

      await persistAgentRun({
        sessionId: typeof sessionId === "string" ? sessionId : null,
        userMessage: message,
        assistantReply: displayReply,
        agentState,
        products: [],
        latencyMs: Date.now() - startedAt,
      });

      return Response.json({
        reply: displayReply,
        products: [],
        agentState,
        tracking: publicOrderTrackingResult(tracking),
        debug: [{ type: "mcp_call", name: "kapruka_track_order" }],
      });
    }

    if (process.env.LLM_PROVIDER === "gemini" && plan.intent === "delivery") {
      const city = extractDeliveryCity(message);

      if (!city) {
        const tools: AgentToolCall[] = [
          {
            name: "kapruka_check_delivery",
            status: "skipped",
            arguments: { reason: "delivery city missing" },
          },
        ];
        const agentState = buildAgentState({
          traceId,
          message,
          memory,
          plan,
          products: [],
          ranking: [],
          tools,
          startedAt,
        });
        const displayReply =
          "Yes, Kapruka delivers islandwide.";

        await persistAgentRun({
          sessionId: typeof sessionId === "string" ? sessionId : null,
          userMessage: message,
          assistantReply: displayReply,
          agentState,
          products: [],
          latencyMs: Date.now() - startedAt,
        });

        return Response.json({
          reply: displayReply,
          products: [],
          agentState,
          debug: [{ type: "llm_provider", name: "gemini" }],
        });
      }

      const deliveryStartedAt = Date.now();
      const delivery = await checkKaprukaDeliveryDirect(city, message);
      const tools: AgentToolCall[] = [
        {
          name: "kapruka_list_delivery_cities",
          status: "called",
          arguments: { query: city, limit: 10, response_format: "json" },
        },
        {
          name: "kapruka_check_delivery",
          status: "called",
          latencyMs: Date.now() - deliveryStartedAt,
          arguments: {
            city: delivery.city,
            delivery_date: delivery.checkedDate,
            response_format: "json",
          },
        },
      ];
      let reply: string;

      try {
        reply = removeRoboticLines(await callGeminiWithDelivery(
          message,
          location,
          history,
          memory,
          plan,
          delivery
        ));
      } catch (error) {
        console.warn("Gemini delivery reply failed, using fallback:", error);
        reply = fallbackDeliveryReply(delivery);
      }

      const agentState = buildAgentState({
        traceId,
        message,
        memory,
        plan,
        products: [],
        ranking: [],
        tools,
        startedAt,
      });
      const displayReply = cleanReplyForUi(reply, 0);

      await persistAgentRun({
        sessionId: typeof sessionId === "string" ? sessionId : null,
        userMessage: message,
        assistantReply: displayReply,
        agentState,
        products: [],
        latencyMs: Date.now() - startedAt,
      });

      return Response.json({
        reply: displayReply,
        products: [],
        agentState,
        debug: [
          { type: "llm_provider", name: "gemini" },
          { type: "mcp_call", name: "kapruka_check_delivery" },
        ],
      });
    }

    if (planNeedsProductSearch(plan)) {
      const searchStartedAt = Date.now();
      let searchStatus: AgentToolCall["status"] = "called";
      let productsFromMcp: ProductLike[] = [];
      let searchAttempts: Array<{ q: string; category: string | null }> =
        buildSearchQueries(message, memory, history).map((query) => ({
          q: query,
          category: categoryForSearchQuery(query),
        }));

      try {
        const searchResult = await searchKaprukaProductsDirect(
          message,
          memory,
          history
        );
        productsFromMcp = searchResult.products;
        searchAttempts = searchResult.attempts;
      } catch (error) {
        searchStatus = "failed";
        console.warn("Kapruka direct product search failed:", error);
      }

      const searchContextForRanking = productRankingContext(
        message,
        history
      );
      const searchBudget = extractBudget(searchContextForRanking, memory);
      const enrichedProducts = await enrichProductsWithMetadata(productsFromMcp);
      const ranked = rankProductsForAgent(
        enrichedProducts,
        searchContextForRanking,
        memory
      );
      const products = ranked.products.slice(0, PRODUCT_CARD_LIMIT);
      const ranking = rankProductsForAgent(
        products,
        searchContextForRanking,
        memory
      ).ranking;
      const tools: AgentToolCall[] = [
        {
          name: "kapruka_search_products",
          status: searchStatus,
          latencyMs: Date.now() - searchStartedAt,
          arguments: {
            queries: searchAttempts,
            limit: SEARCH_RESULT_LIMIT,
            max_price: searchBudget ?? null,
            response_format: "json",
          },
        },
      ];
      let reply: string;

      if (searchStatus === "failed") {
        reply =
          "Kapruka is being slow right now, so I couldn't pull real product cards. Try once more in a moment.";
      } else if (products.length === 0) {
        const budget = extractBudget(message, memory);
        const budgetText = budget ? ` within Rs. ${budget.toLocaleString()}` : "";
        reply = `I couldn't find solid matches for ${searchAttempts
          .map(
            (attempt) =>
              `“${attempt.q}”${attempt.category ? ` in ${attempt.category}` : ""}`
          )
          .join(" and ")}${budgetText}.`;
      } else {
        reply = "";
      }

      const agentState = buildAgentState({
        traceId,
        message,
        memory,
        plan,
        products,
        ranking,
        tools,
        startedAt,
      });
      const displayReply = cleanReplyForUi(reply, products.length);

      await persistAgentRun({
        sessionId: typeof sessionId === "string" ? sessionId : null,
        userMessage: message,
        assistantReply: displayReply,
        agentState,
        products,
        latencyMs: Date.now() - startedAt,
      });

      console.log(
        "Kapruka products sent to UI:",
        products.map((product) => ({
          name: product.name,
          price: product.price,
          rating: product.rating,
          reviewCount: product.reviewCount,
          imageUrl: product.imageUrl,
          productUrl: product.productUrl,
        }))
      );

      return Response.json({
        reply: displayReply,
        products,
        agentState,
        debug: [
          { type: "llm_provider", name: "direct_mcp" },
          { type: "mcp_call", name: "kapruka_search_products" },
        ],
      });
    }

    if (wantsConversationOnlyPlan(plan)) {
      let reply: string;
      let providerName = "gemini";

      if (plan.intent === "small_talk" && process.env.GROQ_API_KEY) {
        try {
          const groqReply = await callGroqConversationFallback(
            message,
            location,
            history,
            memory,
            plan
          );

          if (!groqReply) throw new Error("Groq returned no conversation text.");

          providerName = "groq";
          reply = groqReply;
        } catch (error) {
          console.warn("Primary Groq conversation reply failed.", error);

          try {
            reply = removeRoboticLines(
              await callGemini(message, location, history, memory, plan)
            );
          } catch (backupError) {
            console.warn("Gemini conversation backup failed.", backupError);
            providerName = "local_fallback";
            reply = fallbackGeminiReply(message, plan);
          }
        }
      } else {
        try {
          reply = removeRoboticLines(
            await callGemini(message, location, history, memory, plan)
          );
        } catch (error) {
          console.warn("Gemini chat reply failed; trying backup model.", error);
          const backupReply = await callGroqConversationFallback(
            message,
            location,
            history,
            memory,
            plan
          );
          providerName = backupReply ? "groq_fallback" : "local_fallback";
          reply = backupReply || fallbackGeminiReply(message, plan);
        }
      }

      const agentState = buildAgentState({
        traceId,
        message,
        memory,
        plan,
        products: [],
        ranking: [],
        tools: [],
        startedAt,
      });
      const displayReply = cleanReplyForUi(reply, 0);

      await persistAgentRun({
        sessionId: typeof sessionId === "string" ? sessionId : null,
        userMessage: message,
        assistantReply: displayReply,
        agentState,
        products: [],
        latencyMs: Date.now() - startedAt,
      });

      return Response.json({
        reply: displayReply,
        products: [],
        agentState,
        debug: [{ type: "llm_provider", name: providerName }],
      });
    }

    if (!process.env.GROQ_API_KEY) {
      return Response.json(
        {
          error: "GROQ_API_KEY is missing in .env.local",
        },
        { status: 500 }
      );
    }

    let groqResponse = await callGroq(
      message,
      false,
      location,
      history,
      memory,
      plan
    );
    let data = (await groqResponse.json()) as GroqResponse;

    if (!groqResponse.ok && data.error?.code === "tool_use_failed") {
      console.warn("Retrying Groq MCP call with stricter JSON typing...");
      groqResponse = await callGroq(
        message,
        true,
        location,
        history,
        memory,
        plan
      );
      data = (await groqResponse.json()) as GroqResponse;
    }

    if (
      groqResponse.ok &&
      planNeedsProductSearch(plan) &&
      !calledTool(data, "kapruka_search_products")
    ) {
      console.warn("Retrying Groq MCP call because product search was skipped...");
      groqResponse = await callGroq(
        message,
        true,
        location,
        history,
        memory,
        plan,
        true
      );
      data = (await groqResponse.json()) as GroqResponse;
    }

    if (!groqResponse.ok) {
      console.error("Groq MCP API error:", data);

      return Response.json(
        {
          error:
            "That search got a little messy. Try a quick version like \"earbuds under Rs. 15,000\" and I'll take it from there.",
          details: data.error?.message,
        },
        { status: groqResponse.status }
      );
    }

    const reply = removeRoboticLines(extractText(data));

    const productsFromMcp = extractProductsFromMcpResponse(data);
    const productsFromText = extractProductsFromReply(reply);

    const mergedProducts = mergeProducts(productsFromMcp, productsFromText);
    const shouldShowCards = wantsProductCards(message, history, data);
    const searchContextForRanking = productRankingContext(
      message,
      history
    );
    const products = shouldShowCards
      ? await enrichProductsWithMetadata(mergedProducts).then((items) => {
          const ranked = rankProductsForAgent(
            items,
            searchContextForRanking,
            memory
          );

          return ranked.products.slice(0, PRODUCT_CARD_LIMIT);
        })
      : [];
    const ranking = rankProductsForAgent(
      products,
      searchContextForRanking,
      memory
    ).ranking;
    const tools = buildToolTimeline(data, startedAt);
    const agentState = buildAgentState({
      traceId,
      message,
      memory,
      plan,
      response: data,
      products,
      ranking,
      tools,
      startedAt,
    });

    const displayReply = cleanReplyForUi(reply, products.length);

    await persistAgentRun({
      sessionId: typeof sessionId === "string" ? sessionId : null,
      userMessage: message,
      assistantReply: displayReply,
      agentState,
      products,
      latencyMs: Date.now() - startedAt,
    });

    console.log(
      "Products sent to UI:",
      products.map((product) => ({
        name: product.name,
        price: product.price,
        rating: product.rating,
        reviewCount: product.reviewCount,
        imageUrl: product.imageUrl,
        productUrl: product.productUrl,
      }))
    );

    return Response.json({
      reply: displayReply,
      products,
      agentState,
      debug: extractToolDebug(data),
    });
  } catch (error) {
    console.error("Agent route error:", error);

    return Response.json(
      {
        error:
          "I hit a connection issue while checking Kapruka. Send that once more and I'll retry it.",
      },
      { status: 500 }
    );
  }
}
