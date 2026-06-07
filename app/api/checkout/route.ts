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

type CheckoutResult = {
  checkout_url: string;
  order_ref: string;
  summary: {
    items_total: number;
    delivery_fee: number;
    addons_total: number;
    grand_total: number;
    currency: string;
  };
  expires_at: string;
};

type CheckoutBody = {
  cart?: unknown;
  recipient?: unknown;
  delivery?: unknown;
  sender?: unknown;
  giftMessage?: unknown;
};

const MCP_URL =
  process.env.KAPRUKA_MCP_URL || "https://mcp.kapruka.com/mcp";

const MCP_HEADERS = {
  Accept: "application/json, text/event-stream",
  "Content-Type": "application/json",
};

function isRecord(value: unknown): value is Record<string, unknown> {
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

function parseToolJson<T>(result: McpToolResult): T {
  const text =
    result.structuredContent?.result ||
    result.content?.find((item) => item.type === "text")?.text;

  if (!text) {
    throw new Error("Kapruka returned an empty checkout response.");
  }

  if (result.isError || /^Error(?:\s|\()/i.test(text)) {
    throw new Error(text);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(text);
  }
}

function pickString(obj: Record<string, unknown>, key: string) {
  const value = obj[key];

  return typeof value === "string" ? value.trim() : "";
}

function normalizePhone(phone: string) {
  return phone.replace(/\s+/g, "");
}

function productIdFromUrl(value: string) {
  try {
    const url = new URL(value);

    if (!["www.kapruka.com", "kapruka.com"].includes(url.hostname)) {
      return null;
    }

    const match = url.pathname.match(/\/kid\/([^/?#]+)/i);

    return match?.[1] || null;
  } catch {
    return null;
  }
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
      payload.error?.message || "Could not connect to Kapruka checkout."
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

async function callCreateOrder(params: Record<string, unknown>) {
  const headers = await startMcpSession();
  const response = await fetch(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "kapruka_create_order",
        arguments: {
          params,
        },
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = parseMcpResponse<McpToolResult>(await response.text());

  if (!response.ok || payload.error || !payload.result) {
    throw new Error(payload.error?.message || "Kapruka checkout failed.");
  }

  return parseToolJson<CheckoutResult>(payload.result);
}

function buildCheckoutParams(body: CheckoutBody) {
  if (!Array.isArray(body.cart) || body.cart.length === 0) {
    throw new Error("Cart is empty.");
  }

  const cart = body.cart.slice(0, 30).map((item) => {
    if (!isRecord(item)) throw new Error("Invalid cart item.");

    const rawProductId = pickString(item, "productId");
    const recoveredProductId = productIdFromUrl(
      pickString(item, "productUrl")
    );
    const productId = /^\d+-/.test(rawProductId)
      ? recoveredProductId || rawProductId
      : rawProductId;
    const quantityValue = item.quantity;
    const quantity =
      typeof quantityValue === "number" && Number.isInteger(quantityValue)
        ? quantityValue
        : 1;
    const icingText = pickString(item, "icingText");

    if (
      productId.length < 3 ||
      productId.length > 80 ||
      /^\d+-/.test(productId)
    ) {
      const name = pickString(item, "name");
      throw new Error(
        `${name || "A cart item"} does not have an orderable Kapruka product ID. Open the product link or search again, then add a product with a valid Kapruka URL.`
      );
    }

    return {
      product_id: productId,
      quantity: Math.min(Math.max(quantity, 1), 99),
      icing_text: icingText || null,
    };
  });

  if (
    !isRecord(body.recipient) ||
    !isRecord(body.delivery) ||
    !isRecord(body.sender)
  ) {
    throw new Error("Checkout details are incomplete.");
  }

  const recipientName = pickString(body.recipient, "name");
  const recipientPhone = normalizePhone(pickString(body.recipient, "phone"));
  const address = pickString(body.delivery, "address");
  const city = pickString(body.delivery, "city");
  const date = pickString(body.delivery, "date");
  const locationType = pickString(body.delivery, "locationType") || "house";
  const instructions = pickString(body.delivery, "instructions");
  const senderName = pickString(body.sender, "name");
  const anonymous = body.sender.anonymous === true;
  const giftMessage =
    typeof body.giftMessage === "string" && body.giftMessage.trim()
      ? body.giftMessage.trim().slice(0, 300)
      : null;

  if (!recipientName || !recipientPhone) {
    throw new Error("Recipient name and phone are required.");
  }

  if (!address || !city || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Delivery address, city, and date are required.");
  }

  if (date < getSriLankaDate()) {
    throw new Error("Delivery date cannot be in the past.");
  }

  if (!senderName) {
    throw new Error("Sender name is required.");
  }

  return {
    cart,
    recipient: {
      name: recipientName.slice(0, 80),
      phone: recipientPhone.slice(0, 30),
    },
    delivery: {
      address: address.slice(0, 250),
      city: city.slice(0, 100),
      location_type: ["house", "apartment", "office", "other"].includes(
        locationType
      )
        ? locationType
        : "house",
      date,
      instructions: instructions ? instructions.slice(0, 250) : null,
    },
    sender: {
      name: senderName.slice(0, 80),
      anonymous,
    },
    gift_message: giftMessage,
    currency: "LKR",
    response_format: "json",
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CheckoutBody;
    const params = buildCheckoutParams(body);
    const result = await callCreateOrder(params);

    return Response.json({ result });
  } catch (error) {
    console.error("Checkout route error:", error);

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not create checkout link.",
      },
      { status: 400 }
    );
  }
}
