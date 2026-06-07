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

type ProductLike = {
  id: string;
  name: string;
  price: number | null;
  currency: "LKR";
  imageUrl?: string | null;
  productUrl?: string | null;
  inStock?: boolean | null;
  description?: string | null;
  reason?: string;
};

const productImageCache = new Map<string, string | null>();

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

  return "Sorry, I could not generate a response.";
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

  return {
    id: String(rawId),
    name,
    price,
    currency: "LKR",
    imageUrl,
    productUrl,
    inStock,
    description,
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
      description: existing.description || product.description,
      reason: existing.reason || product.reason,
    });
  }

  return Array.from(unique.values()).slice(0, 8);
}

function mergeProducts(mcpProducts: ProductLike[], textProducts: ProductLike[]) {
  const unique = new Map<string, ProductLike>();

  for (const product of [...mcpProducts, ...textProducts]) {
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

    const existingLooksOrderable = looksLikeKaprukaProductId(existing.id);
    const productLooksOrderable = looksLikeKaprukaProductId(product.id);

    unique.set(key, {
      ...existing,
      ...product,
      id:
        existingLooksOrderable || !productLooksOrderable
          ? existing.id
          : product.id,
      imageUrl: existing.imageUrl || product.imageUrl,
      productUrl: existing.productUrl || product.productUrl,
      price: existing.price ?? product.price,
      description: existing.description || product.description,
      reason: existing.reason || product.reason,
    });
  }

  return Array.from(unique.values()).slice(0, 8);
}

function looksLikeKaprukaProductId(id: string) {
  return /^[a-z][a-z0-9_]*(?:ka|pc|v|0|pod|pack|hamper|gift|book|household|cake|flow|elec|hamp)[a-z0-9_-]*$/i.test(
    id
  );
}

async function getImageFromProductPage(productUrl: string) {
  if (productImageCache.has(productUrl)) {
    return productImageCache.get(productUrl) || null;
  }

  try {
    const response = await fetch(productUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 KaprukaAIConcierge/1.0",
      },
    });

    if (!response.ok) {
      productImageCache.set(productUrl, null);
      return null;
    }

    const html = await response.text();

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

    productImageCache.set(productUrl, imageUrl);

    return imageUrl;
  } catch (error) {
    console.warn("Could not fetch product image:", productUrl, error);
    productImageCache.set(productUrl, null);
    return null;
  }
}

async function enrichProductsWithImages(products: ProductLike[]) {
  return Promise.all(
    products.map(async (product) => {
      if (product.imageUrl || !product.productUrl) {
        return product;
      }

      const imageUrl = await getImageFromProductPage(product.productUrl);

      return {
        ...product,
        imageUrl,
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
- You are not a generic chatbot. You are a capable, practical Sri Lankan shopping guide.
- Sound warm, confident, helpful, and slightly witty.
- Give honest opinions. Do not list products neutrally only.
- Use short, human sentences.
- Make the user feel guided, not lectured.
- Avoid cheesy lines like "gifts from the heart are precious" or "choose what resonates".
- Avoid corporate phrases like "memorable birthday celebration", "delightful experience", "perfect choice", unless truly natural.
- Do not end with generic inspirational advice.
- End with a useful next action, like asking which item to add to cart, whether to check delivery, or whether they want a more premium/budget option.

Good English style:
"These earbuds fit your Rs. 15,000 budget. I would prioritize battery life and warranty over flashy extras; the first two are the strongest everyday options."

Bad English style:
"Remember, gifts that come from the heart are always the most precious."

Good Singlish style:
"Hari, daily use ekata nam battery life saha warranty eka balala options compare karamu. Budget eka kiyanna."

Bad Singlish style:
"Hadawathin dena thagga thamai watinma thagga."

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
- Do not call product search tools for greetings, thanks, small talk, or unclear one-word messages. Reply naturally and ask what they want to shop for.
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
- Recommend 6 to 8 good products when available. Avoid duplicates.
- Clean messy HTML entities from product names before replying.
- Give a short reason why each product matches the user's stated need, budget, and constraints.
- If the search results are weak, do another better search with improved keywords.
- Request JSON responses from product search so the UI can use each product's real summary, image, price, stock, and URL.
- When listing products, use this exact format so the UI can create product cards:
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
  location: LocationContext | null
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
            "Kapruka Sri Lanka shopping tools for product search, product details, categories, delivery cities, delivery checks, guest checkout, and order tracking.",
          require_approval: "never",
          allowed_tools: [
            "kapruka_search_products",
            "kapruka_get_product",
            "kapruka_list_categories",
            "kapruka_list_delivery_cities",
            "kapruka_check_delivery",
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

  return /^(?:hi|hello|hey|helo|hii|hiii|yo|sup|good morning|good afternoon|good evening|ayubowan|vanakkam|kohomada|mk|mokada|ela|hari|හලෝ|හායි|ආයුබෝවන්)$/.test(
    normalized
  );
}

export async function POST(req: Request) {
  try {
    const { message, location: rawLocation } = await req.json();
    const location = parseLocation(rawLocation);

    if (!message || typeof message !== "string") {
      return Response.json({ error: "Message is required" }, { status: 400 });
    }

    if (isPlainGreeting(message)) {
      return Response.json({
        reply:
          "Hi. Tell me what you want to shop for, or what problem you’re trying to solve. I can help with products, prices, delivery, and comparisons.",
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

    let groqResponse = await callGroq(message, false, location);
    let data = (await groqResponse.json()) as GroqResponse;

    if (!groqResponse.ok && data.error?.code === "tool_use_failed") {
      console.warn("Retrying Groq MCP call with stricter JSON typing...");
      groqResponse = await callGroq(message, true, location);
      data = (await groqResponse.json()) as GroqResponse;
    }

    if (!groqResponse.ok) {
      console.error("Groq MCP API error:", data);

      return Response.json(
        {
          error:
            "The shopping tool had trouble understanding that request. Try saying it like: Find wireless earbuds under Rs. 15000, or show weekly grocery essentials.",
          details: data.error?.message,
        },
        { status: groqResponse.status }
      );
    }

    const reply = removeRoboticLines(extractText(data));

    const productsFromMcp = extractProductsFromMcpResponse(data);
    const productsFromText = extractProductsFromReply(reply);

    const mergedProducts = mergeProducts(productsFromMcp, productsFromText);
    const products = await enrichProductsWithImages(mergedProducts);

    const displayReply = cleanReplyForUi(reply, products.length);

    console.log(
      "Products sent to UI:",
      products.map((product) => ({
        name: product.name,
        price: product.price,
        imageUrl: product.imageUrl,
        productUrl: product.productUrl,
      }))
    );

    return Response.json({
      reply: displayReply,
      products,
      debug: extractToolDebug(data),
    });
  } catch (error) {
    console.error("Agent route error:", error);

    return Response.json(
      {
        error: "Something went wrong while talking to Kapruka AI Concierge.",
      },
      { status: 500 }
    );
  }
}
