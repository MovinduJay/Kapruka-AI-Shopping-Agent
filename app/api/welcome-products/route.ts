type JsonRpcResponse<T> = {
  result?: T;
  error?: {
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

type SearchProduct = {
  name?: string;
  image_url?: string | null;
  url?: string | null;
};

type SearchResponse = {
  results?: SearchProduct[];
};

type WelcomeProduct = {
  key: string;
  name: string;
  imageUrl: string;
  productUrl: string | null;
};

const MCP_URL =
  process.env.KAPRUKA_MCP_URL || "https://mcp.kapruka.com/mcp";

const MCP_HEADERS = {
  Accept: "application/json, text/event-stream",
  "Content-Type": "application/json",
};

const WELCOME_SEARCHES = [
  { key: "cakes", query: "cake" },
  { key: "flowers", query: "flowers" },
  { key: "electronics", query: "wireless earbuds" },
  { key: "fashion", query: "women dress" },
  { key: "home", query: "kitchen" },
  { key: "birthday-gift", query: "birthday gift hamper" },
  { key: "anniversary-gift", query: "anniversary flowers" },
  { key: "new-baby-gift", query: "newborn baby gift set" },
  { key: "housewarming-gift", query: "housewarming kitchen gift" },
  { key: "groceries", query: "grocery essentials" },
  { key: "gift-bundle", query: "cake flowers chocolate gift" },
] as const;

const FALLBACK_PRODUCTS: WelcomeProduct[] = [
  {
    key: "birthday-gift",
    name: "Cheer Delight Grocery Hamper",
    imageUrl:
      "https://static2.kapruka.com/product-image/width=330,quality=93,f=auto/https://partnercentral.kapruka.com/kapruka-pc/assets/images/product/pc00006/hamp0v18p00017/hamp0v18p00017_1.jpg",
    productUrl:
      "https://www.kapruka.com/buyonline/cheer-delight-grocery-hamper/kid/ef_pc_hamp0v18pod00017p",
  },
  {
    key: "anniversary-gift",
    name: "Candle Flower Bouquet 35 Piece Arrangement",
    imageUrl:
      "https://static2.kapruka.com/product-image/width=330,quality=93,f=auto/https://partnercentral.kapruka.com/kapruka-pc/assets/images/product/pc01519/home0v4477p00022/home0v4477p00022_1.jpg",
    productUrl:
      "https://www.kapruka.com/buyonline/candle-flower-bouquet-35-piece/kid/ef_pc_home0v4477p00022",
  },
  {
    key: "new-baby-gift",
    name: "'Pamper Me' New Born Baby Essential Gift Set",
    imageUrl:
      "https://static2.kapruka.com/product-image/width=330,quality=93,f=auto/shops/babyItems/productImages/babypack00766.jpg",
    productUrl:
      "https://www.kapruka.com/buyonline/pamper-me-new-born-baby-essent/kid/babypack00766",
  },
  {
    key: "housewarming-gift",
    name: "Airtight Ceramic Kitchen Canister",
    imageUrl:
      "https://static2.kapruka.com/product-image/width=330,quality=93,f=auto/shops/specialGifts/productImages/1640586413215_img_0119_m.jpg",
    productUrl:
      "https://www.kapruka.com/buyonline/airtight-ceramic-kitchen-canis/kid/household00498",
  },
  {
    key: "gift-bundle",
    name: "Candle Flower Bouquet 35 Piece Arrangement",
    imageUrl:
      "https://static2.kapruka.com/product-image/width=330,quality=93,f=auto/https://partnercentral.kapruka.com/kapruka-pc/assets/images/product/pc01519/home0v4477p00022/home0v4477p00022_1.jpg",
    productUrl:
      "https://www.kapruka.com/buyonline/candle-flower-bouquet-35-piece/kid/ef_pc_home0v4477p00022",
  },
  {
    key: "cakes",
    name: "Triple Delight Gateau Cake",
    imageUrl:
      "https://static2.kapruka.com/product-image/width=330,quality=93,f=auto/shops/cakes/productImages/zoom/1720431907031_dsc_9125s.jpg",
    productUrl:
      "https://www.kapruka.com/buyonline/triple-delight-gateau-cake/kid/cake00ka001679",
  },
  {
    key: "flowers",
    name: "Candle Flower Bouquet 35 Piece Arrangement",
    imageUrl:
      "https://static2.kapruka.com/product-image/width=330,quality=93,f=auto/https://partnercentral.kapruka.com/kapruka-pc/assets/images/product/pc01519/home0v4477p00022/home0v4477p00022_1.jpg",
    productUrl:
      "https://www.kapruka.com/buyonline/candle-flower-bouquet-35-piece/kid/ef_pc_home0v4477p00022",
  },
  {
    key: "electronics",
    name: "Sony WF-C510 Truly Wireless Earbuds",
    imageUrl:
      "https://static2.kapruka.com/product-image/width=330,quality=93,f=auto/https://partnercentral.kapruka.com/kapruka-pc/assets/images/product/pc01346/elec0v3077p00007/elec0v3077p00007_1.jpg",
    productUrl:
      "https://www.kapruka.com/buyonline/sony-wf-c510-truly-wireless-ea/kid/ef_pc_elec0v3077pod00007p",
  },
  {
    key: "groceries",
    name: "Cheer Delight Grocery Hamper",
    imageUrl:
      "https://static2.kapruka.com/product-image/width=330,quality=93,f=auto/https://partnercentral.kapruka.com/kapruka-pc/assets/images/product/pc00006/hamp0v18p00017/hamp0v18p00017_1.jpg",
    productUrl:
      "https://www.kapruka.com/buyonline/cheer-delight-grocery-hamper/kid/ef_pc_hamp0v18pod00017p",
  },
  {
    key: "fashion",
    name: "Flowery Cloth (MDG)",
    imageUrl:
      "https://static2.kapruka.com/product-image/width=330,quality=93,f=auto/shops/specialGifts/productImages/168498373412622_flowery-cloth-700x754_m.jpg",
    productUrl:
      "https://www.kapruka.com/buyonline/flowery-cloth-mdg/kid/book00903",
  },
  {
    key: "home",
    name: "Airtight Ceramic Kitchen Canister",
    imageUrl:
      "https://static2.kapruka.com/product-image/width=330,quality=93,f=auto/shops/specialGifts/productImages/1640586413215_img_0119_m.jpg",
    productUrl:
      "https://www.kapruka.com/buyonline/airtight-ceramic-kitchen-canis/kid/household00498",
  },
];

let welcomeProductsCache: {
  expiresAt: number;
  products: WelcomeProduct[];
} | null = null;

function hasAllWelcomeProducts(products: WelcomeProduct[]) {
  const productKeys = new Set(products.map((product) => product.key));

  return WELCOME_SEARCHES.every((search) => productKeys.has(search.key));
}

function normalizedImageUrl(value: string) {
  return value.trim().toLowerCase();
}

function hasUniqueWelcomeImages(products: WelcomeProduct[]) {
  const imageUrls = products.map((product) =>
    normalizedImageUrl(product.imageUrl)
  );

  return new Set(imageUrls).size === imageUrls.length;
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

function parseSearchResult(result: McpToolResult) {
  const text =
    result.structuredContent?.result ||
    result.content?.find((item) => item.type === "text")?.text;

  if (!text || result.isError) return null;

  try {
    return JSON.parse(text) as SearchResponse;
  } catch {
    return null;
  }
}

async function startMcpSession() {
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
    throw new Error(
      payload.error?.message || "Could not connect to Kapruka."
    );
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

async function searchRepresentativeProduct(
  headers: Record<string, string>,
  id: number,
  key: string,
  query: string,
  usedImageUrls: Set<string>
) {
  const response = await fetch(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: {
        name: "kapruka_search_products",
        arguments: {
          params: {
            q: query,
            category: null,
            limit: 5,
            cursor: null,
            currency: "LKR",
            min_price: null,
            max_price: null,
            in_stock_only: false,
            sort: "bestseller",
            include_stubs: false,
            response_format: "json",
          },
        },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = parseMcpResponse<McpToolResult>(await response.text());

  if (!response.ok || payload.error || !payload.result) return null;

  const search = parseSearchResult(payload.result);
  const product = search?.results?.find(
    (item) =>
      typeof item.name === "string" &&
      typeof item.image_url === "string" &&
      item.image_url.length > 0 &&
      !usedImageUrls.has(normalizedImageUrl(item.image_url))
  );

  if (!product?.name || !product.image_url) return null;

  usedImageUrls.add(normalizedImageUrl(product.image_url));

  return {
    key,
    name: product.name,
    imageUrl: product.image_url,
    productUrl: typeof product.url === "string" ? product.url : null,
  } satisfies WelcomeProduct;
}

export async function GET() {
  try {
    if (
      welcomeProductsCache &&
      welcomeProductsCache.expiresAt > Date.now() &&
      hasAllWelcomeProducts(welcomeProductsCache.products) &&
      hasUniqueWelcomeImages(welcomeProductsCache.products)
    ) {
      return Response.json(
        { products: welcomeProductsCache.products },
        {
          headers: {
            "Cache-Control":
              "public, max-age=900, stale-while-revalidate=86400",
          },
        }
      );
    }

    const headers = await startMcpSession();
    const products: WelcomeProduct[] = [];
    const usedImageUrls = new Set<string>();

    for (let index = 0; index < WELCOME_SEARCHES.length; index++) {
      const search = WELCOME_SEARCHES[index];
      const product = await searchRepresentativeProduct(
        headers,
        index + 2,
        search.key,
        search.query,
        usedImageUrls
      );

      if (product) products.push(product);
    }

    const responseProducts = WELCOME_SEARCHES.flatMap((search) => {
      const product = products.find((item) => item.key === search.key);

      if (product) return [product];

      const fallback = FALLBACK_PRODUCTS.find((item) => item.key === search.key);

      if (!fallback) return [];

      const imageUrl = normalizedImageUrl(fallback.imageUrl);

      if (usedImageUrls.has(imageUrl)) return [];

      usedImageUrls.add(imageUrl);
      return [fallback];
    });

    if (responseProducts.length > 0) {
      welcomeProductsCache = {
        expiresAt: Date.now() + 15 * 60 * 1000,
        products: responseProducts,
      };
    }

    return Response.json(
      { products: responseProducts },
      {
        headers: {
          "Cache-Control":
            "public, max-age=900, stale-while-revalidate=86400",
        },
      }
    );
  } catch (error) {
    console.error("Welcome product image error:", error);

    return Response.json(
      { products: FALLBACK_PRODUCTS },
      {
        headers: {
          "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
        },
      }
    );
  }
}
