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
  { key: "groceries", query: "grocery essentials" },
  { key: "fashion", query: "women dress" },
  { key: "home", query: "kitchen" },
] as const;

let welcomeProductsCache: {
  expiresAt: number;
  products: WelcomeProduct[];
} | null = null;

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
  query: string
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
      item.image_url.length > 0
  );

  if (!product?.name || !product.image_url) return null;

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
      welcomeProductsCache.expiresAt > Date.now()
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

    for (let index = 0; index < WELCOME_SEARCHES.length; index++) {
      const search = WELCOME_SEARCHES[index];
      const product = await searchRepresentativeProduct(
        headers,
        index + 2,
        search.key,
        search.query
      );

      if (product) products.push(product);
    }

    welcomeProductsCache = {
      expiresAt: Date.now() + 15 * 60 * 1000,
      products,
    };

    return Response.json(
      { products },
      {
        headers: {
          "Cache-Control":
            "public, max-age=900, stale-while-revalidate=86400",
        },
      }
    );
  } catch (error) {
    console.error("Welcome product image error:", error);

    return Response.json({ products: [] });
  }
}
