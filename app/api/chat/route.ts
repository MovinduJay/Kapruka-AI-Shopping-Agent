import type {
  AgentMemory,
  AgentState,
  AgentStep,
  AgentStepStatus,
  AgentToolCall,
  ProductRankingSignal,
} from "@/types/agent";

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
  | "inStock"
  | "description"
  | "rating"
  | "reviewCount"
  | "brand"
  | "category"
  | "freeShipping"
  | "priceValidUntil"
>;

const productMetadataCache = new Map<string, ProductPageMetadata | null>();

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  return name
    .replace(/\*\*/g, "")
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

  if (direct) return normalizeUrl(direct);

  const images = obj.images;

  if (Array.isArray(images)) {
    for (const image of images) {
      if (typeof image === "string") {
        const url = normalizeUrl(image);
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

        if (nested) return normalizeUrl(nested);
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

  const rawId =
    pickString(obj, [
      "id",
      "product_id",
      "productId",
      "product_code",
      "productCode",
      "code",
      "item_code",
      "itemCode",
      "sku",
    ]) || `${index}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

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
  const offersValue = Array.isArray(product.offers)
    ? product.offers[0]
    : product.offers;
  const offers = isRecord(offersValue) ? offersValue : null;
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
      typeof rawImage === "string" ? normalizeUrl(rawImage) : null,
    price: offers ? pickNumber(offers, ["price"]) : null,
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

    const imageMatch =
      html.match(
        /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
      ) ||
      html.match(
        /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i
      ) ||
      html.match(
        /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i
      ) ||
      html.match(
        /<img[^>]+src=["']([^"']+)["'][^>]+(?:class|id)=["'][^"']*(?:product|main|large)[^"']*["']/i
      );

    const imageUrl = normalizeUrl(imageMatch?.[1]);
    const metadata = jsonLdProduct
      ? metadataFromProductJsonLd(jsonLdProduct)
      : {
          imageUrl,
          price: null,
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
    productMetadataCache.set(productUrl, metadata);

    return metadata;
  } catch (error) {
    console.warn("Could not fetch product metadata:", productUrl, error);
    productMetadataCache.set(productUrl, null);
    return null;
  }
}

async function enrichProductsWithMetadata(products: ProductLike[]) {
  return Promise.all(
    products.map(async (product) => {
      if (!product.productUrl) {
        return product;
      }

      const metadata = await getMetadataFromProductPage(product.productUrl);

      if (!metadata) return product;

      return {
        ...product,
        imageUrl: product.imageUrl || metadata.imageUrl,
        price: product.price ?? metadata.price,
        inStock: product.inStock ?? metadata.inStock,
        description: product.description || metadata.description,
        rating: product.rating ?? metadata.rating,
        reviewCount: product.reviewCount ?? metadata.reviewCount,
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
  const lines = reply.split("\n");

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

  if (productCount > 0) {
    return cleaned || `I found ${productCount} good options for you.`;
  }

  return cleaned || reply;
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
    /\b(?:under|below|less than|max|maximum|budget|rs\.?|lkr)\s*(\d{3,7})\b|\b(\d{3,7})\s*(?:rs|lkr)\b/i
  );
  const value = Number(budgetMatch?.[1] || budgetMatch?.[2]);

  if (Number.isFinite(value) && value > 0) return value;

  return typeof memory.preferredBudget === "number"
    ? memory.preferredBudget
    : null;
}

function extractDeliveryCity(message: string) {
  const match = message.match(
    /\b(?:to|in|near|around|delivery\s+(?:to|in))\s+([A-Z][A-Za-z\s-]{2,40})(?:\b|$)/i
  );

  return match?.[1]?.trim().replace(/\s+/g, " ") || null;
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

function inferAgentIntent(message: string, history: ChatHistoryMessage[]) {
  const normalized = message.toLowerCase();

  if (isOrderTrackingRequest(message)) return "order_tracking" as const;
  if (/\b(?:checkout|pay|payment|place order|confirm order)\b/i.test(normalized)) {
    return "checkout" as const;
  }
  if (/\b(?:cart|add this|add to cart|remove)\b/i.test(normalized)) {
    return "cart" as const;
  }
  if (/\b(?:deliver|delivery|shipping|arrive|tomorrow|today)\b/i.test(normalized)) {
    return "delivery" as const;
  }
  if (/\b(?:compare|versus|vs|which one|better|best value)\b/i.test(normalized)) {
    return "compare" as const;
  }
  if (
    /\b(?:find|show|recommend|suggest|search|browse|shop|buy|purchase|options?|shortlist|best|under|below|budget|gift)\b/i.test(
      normalized
    ) ||
    history.slice(-4).some((item) => /\bproduct|option|cart\b/i.test(item.content))
  ) {
    return "product_search" as const;
  }

  return "small_talk" as const;
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
      return productCount > 0 || intent === "small_talk" ? "completed" : "pending";
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

function scoreProductForAgent(
  product: ProductLike,
  message: string,
  memory: AgentMemory
): ProductRankingSignal {
  const reasons: string[] = [];
  const normalized = `${message} ${product.name} ${product.description || ""} ${
    product.brand || ""
  } ${product.category || ""}`.toLowerCase();
  const budget = extractBudget(message, memory);
  let score = 50;

  if (product.price !== null && budget) {
    if (product.price <= budget) {
      score += 20;
      reasons.push("inside budget");
    } else {
      score -= 18;
      reasons.push("over budget");
    }
  }

  if (product.inStock === true) {
    score += 12;
    reasons.push("available");
  } else if (product.inStock === false) {
    score -= 20;
    reasons.push("out of stock");
  }

  if (typeof product.rating === "number" && product.rating > 0) {
    score += Math.min(12, product.rating * 2);
    reasons.push("rated");
  }

  if (typeof product.reviewCount === "number" && product.reviewCount > 0) {
    score += Math.min(8, Math.log10(product.reviewCount + 1) * 4);
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

  if (/\b(?:gift|birthday|anniversary|mother|father|wife|husband|friend)\b/i.test(message)) {
    if (/\b(?:flower|cake|chocolate|hamper|gift|card)\b/i.test(normalized)) {
      score += 10;
      reasons.push("gift-friendly");
    }
  }

  if (product.productUrl) score += 5;
  if (product.imageUrl) score += 5;

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
  const ranked = products.map((product) => ({
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
  response,
  products,
  ranking,
  tools,
  startedAt,
  history,
}: {
  traceId: string;
  message: string;
  memory: AgentMemory;
  response?: GroqResponse;
  products: ProductLike[];
  ranking: ProductRankingSignal[];
  tools: AgentToolCall[];
  startedAt: number;
  history: ChatHistoryMessage[];
}): AgentState {
  const intent = inferAgentIntent(message, history);
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
    goal: inferGoal(message, intent),
    intent,
    currentStep,
    steps,
    tools,
    memoryPatch,
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

  const normalized = message
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  const asksToBrowse =
    /\b(?:find|show|recommend|suggest|search|browse|compare|shop|buy|purchase|looking for|look for|options?|choices?|shortlist|best|top|available)\b/i.test(
      normalized
    ) ||
    /\b(?:i need|i want|give me|get me|help me (?:find|choose|pick)|hoyala|pennanna|balanna)\b/i.test(
      normalized
    );

  if (asksToBrowse) return true;

  const asksForDifferentResults =
    /\b(?:more|others?|another|alternatives?|cheaper|budget|premium|similar|different|else)\b/i.test(
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

function buildSystemPrompt(isRetry: boolean) {
  return `
You are Kapruka AI Concierge, a Sri Lankan AI marketplace shopping assistant.

You help users shop across Kapruka's broad marketplace using real Kapruka MCP tools. Kapruka carries electronics, groceries, fashion, home products, daily essentials, gifts, and products from thousands of third-party sellers.

Core customer model:
- The primary user is shopping for their own everyday needs.
- Do not assume a purchase is a gift, has a recipient, or has an occasion.
- Treat gifting as one important shopping mode only when the user mentions a recipient, celebration, event, or gift intent.
- Help users discover products, compare practical tradeoffs, stay within budget, and choose between marketplace options.
- When seller, brand, size, compatibility, quantity, specifications, or delivery details affect the decision, surface those factors or ask one focused question.

Personality and voice:
- You are Kapruka Scout: a sharp, modern Sri Lankan shopping companion, not a customer-support script or a product catalogue.
- Feel like a familiar, trustworthy friend who happens to be excellent at shopping. Be present in the conversation before trying to sell anything.
- Sound warm, relaxed, confident, and observant. React to what the user actually said instead of jumping straight into a search.
- Use current, natural language such as "solid pick", "worth it", "skip this one", or "my pick" when it fits. Never force slang.
- Be lightly witty, never loud, childish, overexcited, or try-hard. Do not call the user "bestie", "bro", or "queen" unless they establish that tone first.
- Give a point of view. Lead with the verdict, then the reason. Say which option you would choose and what tradeoff the user is making.
- Use short, conversational sentences and contractions. Vary sentence length naturally; do not make every reply follow the same template.
- Notice and reuse details from the recent conversation: budget, recipient, occasion, city, date, style, brand, size, and dislikes. Do not ask for information the user already gave.
- When the user is unsure, reduce the decision to one easy choice instead of returning a questionnaire.
- Match the user's energy. Keep quick questions quick; become more detailed only when the decision needs it.
- Small talk, opinions, uncertainty, jokes, thanks, and casual conversation deserve normal human replies with no product pitch.
- It is fine to say "Honestly", "I'd go with...", "That changes things", or "Nah, I'd skip that" when truthful and useful.
- Never claim to be human, have a real life, or be the user's actual best friend. Create warmth through attention, memory, honesty, and useful judgment.
- Avoid cheesy lines like "gifts from the heart are precious" or "choose what resonates".
- Avoid corporate phrases like "memorable birthday celebration", "delightful experience", "perfect choice", unless truly natural.
- Avoid service-desk phrases like "How may I assist you?", "Please provide", and "I apologize for the inconvenience".
- Do not open every reply with "Sure", "Certainly", "Of course", or the user's name.
- Use at most one emoji in a reply, and only when it adds tone.
- Do not end with generic inspirational advice.
- Do not force a question or call to action at the end. End naturally unless one focused next step would genuinely help.

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
- Use Kapruka tools for product search, product details, categories, delivery cities, and delivery availability.
- Product cards are a visual aid, not the default response.
- Do not call product search tools for greetings, thanks, small talk, opinions, emotional conversation, general advice, or unclear messages. Reply naturally.
- If the user is exploring an idea but has not asked to see products yet, discuss it or ask one useful question before searching.
- Search only when the user clearly asks to find, browse, compare, recommend, shortlist, or buy products, or asks for more/different results from an existing search.
- A question about a previously shown item should usually get a direct answer, not the same product list again.
- Never invent product names, prices, stock, delivery availability, product URLs, images, or checkout links.
- Search the full marketplace. Do not steer ordinary requests toward gifts, cakes, flowers, or hampers.
- Assume the user is buying for themselves unless they indicate otherwise.
- For electronics, consider specifications, compatibility, warranty, brand, and practical value when data is available.
- For groceries and essentials, consider quantity, pack size, unit value, availability, and delivery practicality when data is available.
- For fashion, ask about size, fit, style, or intended use when necessary.
- For home products, consider dimensions, material, use case, and compatibility when relevant.
- Products may come from third-party sellers. Do not imply Kapruka directly manufactures or sells every item, and do not invent seller ratings or guarantees.
- If user gives budget, respect it.
- If user gives city/date, check delivery when possible.
- If important details are missing, ask one short follow-up question.
- Do not create an order. Checkout will be handled later after explicit user confirmation.
- For the demo, checkout ends when the guest-checkout payment link is generated. Never ask for card details, suggest test card data, or claim that payment was completed.
- For order tracking, ask for the actual order number from the paid-order confirmation email or order-complete page, then use kapruka_track_order.
- Never call kapruka_track_order with placeholders such as "unknown", "none", or an invented number. Call it only when the user has supplied a plausible order number.
- The pre-payment checkout reference is not a trackable order number. If that is all the user has, explain the difference warmly and in one or two sentences.
- When reporting tracking results, lead with the current status and next expected step. Do not unnecessarily repeat the recipient's full phone number or street address.
- Browser coordinates are approximate context only. Do not claim an exact city, address, delivery fee, or delivery availability from coordinates.
- If delivery location matters and the user has not named a city, ask them to confirm their delivery city.

Search quality rules:
- For Tanglish/Sinhala requests, convert the user's intent into strong English search keywords before calling tools.
- Preserve product-defining terms such as model numbers, brands, sizes, capacities, colors, pack quantities, and compatibility requirements.
- Use broad marketplace category terms for vague everyday requests, then narrow based on the returned products and user preferences.
- Only apply recipient and occasion search expansion when the request is explicitly about gifting.
- If the recipient is mother, amma, mom, or අම්මා, prefer search keywords like "mother birthday flowers cake chocolate hamper gift".
- If the recipient is father, appachchi, dad, or තාත්තා, prefer search keywords like "father birthday hamper chocolate cake gift".
- If the user asks for brother, aiya, malli, or සහෝදරයා, prefer search keywords like "brother birthday mug hamper chocolate cake gift".
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

function buildUserMessage(message: string, location: LocationContext | null) {
  if (!location) return message;

  const accuracyText =
    location.accuracy === null
      ? ""
      : ` Accuracy is approximately ${location.accuracy} meters.`;

  return `${message}

Approximate browser location context: latitude ${location.latitude}, longitude ${location.longitude}.${accuracyText}
Use this only for broad recommendation context. Ask the user to confirm their delivery city before making delivery claims.`;
}

async function callGroq(
  message: string,
  isRetry: boolean,
  location: LocationContext | null,
  history: ChatHistoryMessage[]
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
          content: buildSystemPrompt(isRetry),
        },
        ...history,
        {
          role: "user",
          content: buildUserMessage(message, location),
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
  });
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
  );
}

function hasPlausibleOrderNumber(message: string) {
  return message
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .some(
      (token) =>
        token.length >= 8 &&
        token.length <= 24 &&
        /[A-Z]/.test(token) &&
        /\d/.test(token)
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
    } = await req.json();
    const location = parseLocation(rawLocation);
    const memory = parseAgentMemory(rawMemory);
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

    if (!message || typeof message !== "string") {
      return Response.json({ error: "Message is required" }, { status: 400 });
    }

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
          "Yep, I can check it. Send me the actual order number from your confirmation email or order-complete page - not the checkout reference - and I'll pull up the latest status.",
        products: [],
        debug: [],
      });
    }

    if (!process.env.GROQ_API_KEY) {
      return Response.json(
        { error: "GROQ_API_KEY is missing in .env.local" },
        { status: 500 }
      );
    }

    let groqResponse = await callGroq(message, false, location, history);
    let data = (await groqResponse.json()) as GroqResponse;

    if (!groqResponse.ok && data.error?.code === "tool_use_failed") {
      console.warn("Retrying Groq MCP call with stricter JSON typing...");
      groqResponse = await callGroq(message, true, location, history);
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
    const products = shouldShowCards
      ? await enrichProductsWithMetadata(mergedProducts).then((items) => {
          const ranked = rankProductsForAgent(items, message, memory);

          return ranked.products.slice(0, 5);
        })
      : [];
    const ranking = rankProductsForAgent(products, message, memory).ranking;
    const tools = buildToolTimeline(data, startedAt);
    const agentState = buildAgentState({
      traceId,
      message,
      memory,
      response: data,
      products,
      ranking,
      tools,
      startedAt,
      history,
    });

    const displayReply = cleanReplyForUi(reply, products.length);

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
