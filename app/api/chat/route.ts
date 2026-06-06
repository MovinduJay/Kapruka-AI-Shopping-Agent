type GroqOutputContent = {
  type?: string;
  text?: string;
};

type GroqOutputItem = {
  type?: string;
  role?: string;
  name?: string;
  arguments?: string;
  output?: string;
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

function extractText(response: GroqResponse): string {
  const output = response.output || [];

  for (let i = output.length - 1; i >= 0; i--) {
    const item = output[i];

    if (item.type === "message" && Array.isArray(item.content)) {
      const text = item.content
        .filter((content) => content.type === "output_text")
        .map((content) => content.text)
        .join("\n")
        .trim();

      if (text) return text;
    }
  }

  return "Sorry, I could not generate a response.";
}

function extractToolDebug(response: GroqResponse) {
  return (response.output || [])
    .filter(
      (item) =>
        item.type === "mcp_list_tools" ||
        item.type === "mcp_call"
    )
    .map((item) => ({
      type: item.type,
      name: item.name,
      arguments: item.arguments,
    }));
}

function buildSystemPrompt(isRetry: boolean) {
  return `
You are Kapruka AI Concierge, a premium Sri Lankan AI shopping assistant.

You help users shop from Kapruka using real Kapruka MCP tools.

Personality:
- Warm, confident, Sri Lankan, helpful.
- Keep answers short and visual-friendly.
- Act like a smart personal shopper, not a generic chatbot.

Language matching rules:
- Detect the user's language style.
- If the user writes in English, reply in English.
- If the user writes in Tanglish or Singlish, reply in natural Singlish/Tanglish.
- If the user writes in Sinhala script, reply in Sinhala script.
- Product names can stay in English exactly as Kapruka returns them.
- Prices, delivery fees, product names, and stock details must stay accurate.
- For Singlish replies, keep the tone friendly and local, but still clear.
- Do not translate product names badly.

Example:
User: Amma ge birthday ekata Rs 8000ta gift ekak one Kandy walata

Correct reply style:
Amma ge birthday ekata Rs 8000 budget eka athule me options tika hondai. Kandy delivery available. Delivery fee eka Rs 1075 wage pennanawa.

Wrong reply style:
Here are some birthday gifts for your mother under Rs 8000.

Shopping rules:
- Use Kapruka tools for product search, product details, categories, delivery cities, and delivery availability.
- Never invent product names, prices, stock, delivery availability, product URLs, or checkout links.
- If user gives budget, respect it.
- If user gives city/date, check delivery when possible.
- If important details are missing, ask one short follow-up question.
- Do not create an order. Checkout will be handled later after explicit user confirmation.

Search quality rules:
- For Tanglish/Sinhala requests, convert the user's intent into strong English search keywords before calling tools.
- If the recipient is mother, amma, mom, or අම්මා, prefer search keywords like "mother birthday flowers cake chocolate hamper gift".
- If the recipient is father, appachchi, dad, or තාත්තා, prefer search keywords like "father birthday hamper chocolate cake gift".
- If the user asks for girlfriend, wife, anniversary, or love, prefer flowers, chocolates, cakes, romantic gifts, and greeting cards.
- Avoid irrelevant kids, superhero, boyfriend, girlfriend, or "for him" items unless the user asks for them.
- De-duplicate products before replying.
- Recommend only the best 5 products, not 10.
- Clean messy HTML entities from product names before replying.
- Give a short reason why each product matches the recipient and occasion.
- If the search results are weak, do another better search with improved keywords.

Critical MCP tool argument rules:
- Use native JSON types only.
- Numbers must be numbers, not strings. Correct: 8000. Wrong: "8000".
- Booleans must be booleans, not strings. Correct: false. Wrong: "false".
- Null must be null, not string. Correct: null. Wrong: "null".
- limit must be an integer.
- min_price and max_price must be numbers or null.
- in_stock_only and include_stubs must be booleans.
- category and cursor must be null when not known, not "null".
- Do not include unsupported fields like response_format.

Correct kapruka_search_products example:
{
  "params": {
    "q": "mother birthday flowers cake chocolate hamper gift",
    "category": null,
    "limit": 6,
    "cursor": null,
    "currency": "LKR",
    "min_price": 0,
    "max_price": 8000,
    "in_stock_only": false,
    "sort": "relevance",
    "include_stubs": false
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

async function callGroq(message: string, isRetry: boolean) {
  return fetch("https://api.groq.com/openai/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      input: [
        {
          role: "system",
          content: buildSystemPrompt(isRetry),
        },
        {
          role: "user",
          content: message,
        },
      ],
      tools: [
        {
          type: "mcp",
          server_label: "kapruka",
          server_url:
            process.env.KAPRUKA_MCP_URL ||
            "https://mcp.kapruka.com/mcp",
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

export async function POST(req: Request) {
  try {
    const { message } = await req.json();

    if (!message || typeof message !== "string") {
      return Response.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    if (!process.env.GROQ_API_KEY) {
      return Response.json(
        { error: "GROQ_API_KEY is missing in .env.local" },
        { status: 500 }
      );
    }

    let groqResponse = await callGroq(message, false);
    let data = (await groqResponse.json()) as GroqResponse;

    if (
      !groqResponse.ok &&
      data.error?.code === "tool_use_failed"
    ) {
      console.warn("Retrying Groq MCP call with stricter JSON typing...");
      groqResponse = await callGroq(message, true);
      data = (await groqResponse.json()) as GroqResponse;
    }

    if (!groqResponse.ok) {
      console.error("Groq MCP API error:", data);

      return Response.json(
        {
          error:
            "The shopping tool had trouble understanding that request. Try saying it like: Find birthday gifts under Rs. 8000 for mother in Kandy.",
          details: data.error?.message,
        },
        { status: groqResponse.status }
      );
    }

    return Response.json({
      reply: extractText(data),
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