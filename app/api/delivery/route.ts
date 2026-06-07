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

type DeliveryCitiesResponse = {
  cities?: DeliveryCity[];
};

type DeliveryCheckResponse = {
  city?: string;
  checked_date?: string;
  available?: boolean;
  rate?: number;
  currency?: string;
  reason?: string | null;
  next_available_date?: string | null;
  perishable_warning?: string | null;
};

const MCP_URL =
  process.env.KAPRUKA_MCP_URL || "https://mcp.kapruka.com/mcp";

const MCP_HEADERS = {
  Accept: "application/json, text/event-stream",
  "Content-Type": "application/json",
};

function parseMcpResponse<T>(text: string): JsonRpcResponse<T> {
  const dataLines = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);

  if (dataLines.length > 0) {
    return JSON.parse(dataLines.join("\n")) as JsonRpcResponse<T>;
  }

  return JSON.parse(text) as JsonRpcResponse<T>;
}

function parseToolJson<T>(result: McpToolResult): T {
  const text =
    result.structuredContent?.result ||
    result.content?.find((item) => item.type === "text")?.text;

  if (!text) {
    throw new Error("Kapruka returned an empty delivery response.");
  }

  if (result.isError) {
    throw new Error(text);
  }

  return JSON.parse(text) as T;
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
      payload.error?.message || "Could not connect to Kapruka delivery."
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

async function callMcpTool(
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
    signal: AbortSignal.timeout(15_000),
  });

  const payload = parseMcpResponse<McpToolResult>(await response.text());

  if (!response.ok || payload.error || !payload.result) {
    throw new Error(
      payload.error?.message || "Kapruka delivery check failed."
    );
  }

  return payload.result;
}

function getSriLankaDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function normalizeCity(value: string) {
  return value.trim().toLocaleLowerCase("en");
}

function selectCanonicalCity(cities: DeliveryCity[], requestedCity: string) {
  const normalizedRequest = normalizeCity(requestedCity);

  return (
    cities.find((city) => normalizeCity(city.name) === normalizedRequest) ||
    cities.find((city) =>
      city.aliases?.some(
        (alias) => normalizeCity(alias) === normalizedRequest
      )
    ) ||
    cities[0] ||
    null
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      city?: unknown;
      deliveryDate?: unknown;
      productId?: unknown;
    };

    const city = typeof body.city === "string" ? body.city.trim() : "";
    const deliveryDate =
      typeof body.deliveryDate === "string" ? body.deliveryDate.trim() : "";
    const productId =
      typeof body.productId === "string" &&
      body.productId.length >= 3 &&
      body.productId.length <= 80
        ? body.productId
        : null;

    if (city.length < 2) {
      return Response.json(
        { error: "Enter a delivery city." },
        { status: 400 }
      );
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) {
      return Response.json(
        { error: "Choose a valid delivery date." },
        { status: 400 }
      );
    }

    if (deliveryDate < getSriLankaDate()) {
      return Response.json(
        { error: "Delivery date cannot be in the past." },
        { status: 400 }
      );
    }

    const headers = await startMcpSession();
    const citiesResult = await callMcpTool(
      headers,
      2,
      "kapruka_list_delivery_cities",
      {
        query: city,
        limit: 10,
        response_format: "json",
      }
    );
    const cities = parseToolJson<DeliveryCitiesResponse>(citiesResult).cities;
    const canonicalCity = selectCanonicalCity(cities || [], city);

    if (!canonicalCity) {
      return Response.json({
        result: {
          city,
          checkedDate: deliveryDate,
          available: false,
          fee: null,
          currency: "LKR",
          reason: `Kapruka does not recognize "${city}" as a delivery city.`,
          earliestDate: null,
          warning: null,
        },
      });
    }

    const deliveryResult = await callMcpTool(
      headers,
      3,
      "kapruka_check_delivery",
      {
        city: canonicalCity.name,
        delivery_date: deliveryDate,
        product_id: productId,
        response_format: "json",
      }
    );
    const delivery = parseToolJson<DeliveryCheckResponse>(deliveryResult);

    return Response.json({
      result: {
        city: delivery.city || canonicalCity.name,
        checkedDate: delivery.checked_date || deliveryDate,
        available: delivery.available === true,
        fee: typeof delivery.rate === "number" ? delivery.rate : null,
        currency: delivery.currency || "LKR",
        reason: delivery.reason || null,
        earliestDate: delivery.next_available_date || null,
        warning: delivery.perishable_warning || null,
      },
    });
  } catch (error) {
    console.error("Delivery route error:", error);

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not check delivery right now.",
      },
      { status: 502 }
    );
  }
}
