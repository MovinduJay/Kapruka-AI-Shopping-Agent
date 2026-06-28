import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
} from "ai";
import { groq } from "@ai-sdk/groq";
import { cookies, headers } from "next/headers";
import { randomUUID } from "crypto";
import {
  sessionCookieName,
  upsertUserSession,
} from "@/lib/agent-persistence";
import type { AgentChatResponse } from "@/types/agent";

export const maxDuration = 60;

type ChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

const fastConversationSystemPrompt = `
You are Kapruka Shopping Buddy, Kapruka's AI shopping agent for Sri Lanka. You are not a general-purpose assistant.

Reply naturally to the latest message.
- HARD LIMIT: keep every default reply to 35 words or fewer and at most 2 complete sentences. Count before answering and rewrite if it is longer.
- Your job is to help users discover Kapruka products, compare value, work within a budget, check delivery, and move safely toward cart or checkout.
- For unrelated general questions, give only a brief useful answer, then connect it to a shopping decision when relevant. Never produce a general-purpose essay.
- This fast conversation has no live catalogue data. Never invent Kapruka products, prices, stock, discounts, ratings, or delivery claims. If live products are needed, say it softly like "I'll find something for you" instead of mentioning searches or tools.
- React to the user's exact situation instead of giving a generic speech.
- Sound like a chill, sharp Gen Z friend who knows shopping: casual contractions, direct opinions, and zero corporate energy.
- Light phrases like "honestly", "yeah", "nah", or "I'd go with" are fine when natural. Never stack slang or try too hard.
- Never say "I'm functioning properly", "How may I assist you?", or similar customer-service filler.
- If the latest message is casual, answer it casually. Do not turn greetings, thanks, or "how are you" into a sales pitch.
- If the latest message is emotional small talk, respond like a sharp close friend. Do not suggest products, gifts, comfort purchases, flowers, snacks, or browsing unless the user asks to buy, send, order, browse, find, or fix it with a gift.
- Treat the latest message as the current goal. Reuse earlier shopping context only when the user explicitly says "same", "again", "more", "that", or "those".
- Never ask about delivery before the user selects a product or explicitly asks about delivery, arrival, or shipping.
- Do not pressure, convince, or proactively move the user toward checkout. Help with the current decision only.
- Ask at most one question, and only when the answer would materially change your advice.
- Stay recognizably focused on Kapruka shopping without forcing a product recommendation into every greeting.
- Match the user's language style when practical. Do not use emoji.
- Never use an em dash. Use a comma or a new sentence instead.
- Never claim to be human. Finish every sentence and thought.
`;

function parseHistory(value: unknown): ChatHistoryMessage[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter(
      (item): item is ChatHistoryMessage =>
        typeof item === "object" &&
        item !== null &&
        (Reflect.get(item, "role") === "user" ||
          Reflect.get(item, "role") === "assistant") &&
        typeof Reflect.get(item, "content") === "string"
    )
    .slice(-8)
    .map((item) => ({
      role: item.role,
      content: item.content.trim().slice(0, 1500),
    }))
    .filter((item) => item.content.length > 0);
}

function shouldStreamFastConversation(payload: unknown) {
  if (
    !process.env.GROQ_API_KEY ||
    typeof payload !== "object" ||
    payload === null
  ) {
    return false;
  }

  const message = Reflect.get(payload, "message");

  if (typeof message !== "string" || !message.trim()) return false;

  const normalized = message.toLowerCase();
  const commerceSignal =
    /\b(?:buy|shop|shopping|find|show\s*me|show|search|browse|recommend|suggest|need|want|looking for|look for|after|product|item|price|budget|under|below|less than|up to|lkr|rs\.?|delivery|deliver|shipping|stock|available|cart|checkout|payment|order|tracking|track|cake|flowers?|gift|hamper|watch|phone|laptop|headphones?|earbuds?|gadget|gadgets|electronics?|device|devices|accessories|speaker|speakers|charger|chargers|powerbank|powerbanks|grocery|groceries|fashion|dress|shirts?|t-?shirts?|tees?|toy|supplement|vitamin|snacks?|cookies?|biscuits?|chips?|nuts?|chocolates?|sweets?|candy|food|drinks?|beverages?)\b/i;
  const asksWhatIsAvailable =
    /\b(?:do+\s*y?ou|you)\s+have\b|\bwhat\b[\s\S]{0,40}\bhave\b/i.test(
      normalized
    );
  const hasBudgetPhrase =
    /\b(?:under|below|less than|up to|max(?:imum)?|budget|around|about)\s*(?:rs\.?|lkr)?\s*\d+(?:\.\d+)?\s*k?\b/i.test(
      normalized
    );

  if (
    commerceSignal.test(normalized) ||
    asksWhatIsAvailable ||
    hasBudgetPhrase ||
    /\b\d{3,}\b/.test(normalized)
  ) {
    return false;
  }

  const history = parseHistory(Reflect.get(payload, "history"));
  const hasRecentShoppingContext = history.some(
    (item) =>
      commerceSignal.test(item.content) ||
      /\b(?:look up|options?|search Kapruka|want me to search|pull the latest|latest options|find something|find out|give me a sec|running the search|found a few|what kind|what style|what vibe|casual basics|graphic prints|sportier)\b/i.test(
        item.content
      )
  );
  const isShortShoppingRefinement =
    normalized.trim().split(/\s+/).length <= 4 &&
    /\b(?:casual|basic|basics|plain|graphic|print|prints|sporty|sportier|formal|office|cotton|crew|crewneck|crew-neck|white|black|grey|gray|navy|bunch|batch|cards?|them|those|show\s*me|showthem|show them|yeah\s*show\s*me|yes\s*show\s*me|send\s+(?:a\s+)?bunch)\b/i.test(
      normalized
    ) &&
    hasRecentShoppingContext;

  if (isShortShoppingRefinement) {
    return false;
  }

  const isCommerceFollowUp =
    /^(?:\?+|more|another|others?|cheaper|similar|different|the first one|the second one|yes(?: please| pls| plz|\s*show\s*me)?|yeah(?: please| pls| plz|\s*show\s*me)?|yep(?: please| pls| plz|\s*show\s*me)?|sure(?: please| pls| plz|\s*show\s*me)?|okay|ok|please|pls|plz|show\s*me|show them|show me (?:the )?cards(?: of them)?|send them|send (?:a )?bunch|no just send (?:a )?bunch|do it|go ahead|please do|no)$/i.test(
      normalized.trim()
    ) &&
    hasRecentShoppingContext;

  return !isCommerceFollowUp;
}

function limitFastReply(value: string, maxWords = 35) {
  const sentences = value
    .replace(/\s*—\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);
  const accepted: string[] = [];
  let wordCount = 0;

  for (const sentence of sentences) {
    if (accepted.length >= 2) break;

    const sentenceWords = sentence.split(/\s+/).filter(Boolean);

    if (wordCount + sentenceWords.length > maxWords) break;

    accepted.push(sentence);
    wordCount += sentenceWords.length;
  }

  if (accepted.length > 0) return accepted.join(" ");

  const firstSentence = sentences[0] || value.trim();
  const shortened = firstSentence.split(/\s+/).slice(0, maxWords).join(" ");

  return `${shortened.replace(/[,:;\s-]+$/g, "")}.`;
}

async function streamFastConversation(req: Request, payload: object) {
  const message = String(Reflect.get(payload, "message")).trim();
  const history = parseHistory(Reflect.get(payload, "history"));
  let reply: string;

  try {
    const result = await generateText({
      model: groq(
        process.env.GROQ_CHAT_MODEL ||
          process.env.GROQ_MODEL ||
          "openai/gpt-oss-120b"
      ),
      system: fastConversationSystemPrompt,
      messages: [...history, { role: "user", content: message }],
      maxOutputTokens: 160,
      temperature: 0.4,
      maxRetries: 0,
      timeout: 8_000,
      abortSignal: req.signal,
      providerOptions: {
        groq: {
          reasoningEffort: "low",
          reasoningFormat: "hidden",
        },
      },
    });

    reply = limitFastReply(result.text);
  } catch (error) {
    console.error("Fast conversation generation failed:", error);
    reply = "I couldn't answer that quickly. Tell me what you want to find on Kapruka and I'll keep it focused.";
  }

  return createUIMessageStreamResponse({
    stream: createUIMessageStream({
      async execute({ writer }) {
        const textId = `assistant-${Date.now().toString(36)}`;
        const parts = messageParts(reply);
        const firstPart = parts[0] || reply;

        writer.write({ type: "text-start", id: textId });

        for (const chunk of textChunks(firstPart)) {
          writer.write({ type: "text-delta", id: textId, delta: chunk });
          await wait(12);
        }

        writer.write({ type: "text-end", id: textId });

        for (const part of parts.slice(1)) {
          await wait(160);
          writer.write({
            type: "data-message-part",
            data: { content: part },
          });
        }
      },
    }),
  });
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function textChunks(value: string) {
  return value.match(/\S+\s*/g) || [];
}

function messageParts(value: string) {
  return value
    .split(/\n{2,}|\n+|(?<=[.!?])\s+(?=[\p{Lu}\p{Lt}\p{Lo}"'(])/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

function fastCasualReply(message: unknown) {
  if (typeof message !== "string") return null;

  const normalized = message
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (
    /^(?:how are (?:you|u)(?: doing)?|how(?:s| is) it going|what are you doing)$/i.test(
      normalized
    )
  ) {
    return "I'm good, thanks!";
  }

  if (
    /^(?:hi|hello|hey|helo|hii|hiii|yo|sup|good morning|good afternoon|good evening|ayubowan|vanakkam|thanks|thank you|thx|ok|okay)$/.test(
      normalized
    )
  ) {
    if (/^(?:thanks|thank you|thx)$/.test(normalized)) {
      return "You're welcome!";
    }

    if (/^(?:ok|okay)$/.test(normalized)) {
      return "Got it.";
    }

    if (normalized === "good morning") {
      return "Morning! What's up?";
    }

    if (normalized === "good afternoon") {
      return "Hey, good afternoon. What's up?";
    }

    if (normalized === "good evening") {
      return "Evening! What's up?";
    }

    if (normalized === "yo" || normalized === "sup") {
      return "Hey! What's up?";
    }

    if (normalized === "ayubowan") {
      return "Ayubowan. Kapruka eken monawada hoyanne?";
    }

    if (normalized === "vanakkam") {
      return "Vanakkam. Kapruka-la enna thedureenga?";
    }

    return "Hey! What's up?";
  }

  return null;
}

export async function POST(req: Request) {
  const payload = await req.json();
  const textId = `assistant-${Date.now().toString(36)}`;
  const quickReply = fastCasualReply(payload?.message);

  if (quickReply) {
    return createUIMessageStreamResponse({
      stream: createUIMessageStream({
        async execute({ writer }) {
        writer.write({
          type: "text-start",
          id: textId,
        });

        for (const chunk of textChunks(quickReply)) {
            writer.write({
              type: "text-delta",
              id: textId,
              delta: chunk,
            });
            await wait(45);
          }

          writer.write({
            type: "text-end",
            id: textId,
          });
          writer.write({
            type: "data-result",
            data: {
              products: [],
              agentState: undefined,
            },
          });
        },
      }),
    });
  }

  if (shouldStreamFastConversation(payload)) {
    return await streamFastConversation(req, payload);
  }

  const cookieStore = await cookies();
  const headerStore = await headers();
  const sessionToken =
    cookieStore.get(sessionCookieName)?.value || randomUUID();
  const userAgent = headerStore.get("user-agent");
  const session = await upsertUserSession(sessionToken, userAgent);

  cookieStore.set(sessionCookieName, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  return createUIMessageStreamResponse({
    stream: createUIMessageStream({
      async execute({ writer }) {
        const response = await fetch(new URL("/api/chat", req.url), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...payload,
            sessionId: session?.id || null,
          }),
        });

        const data = (await response.json()) as AgentChatResponse;

        if (!response.ok || data.error) {
          writer.write({
            type: "error",
            errorText:
              data.error ||
              "I hit a connection issue while checking Kapruka. Try once more.",
          });
          return;
        }

        if (data.products?.length) {
          writer.write({
            type: "data-result",
            data: {
              products: data.products,
              agentState: data.agentState,
            },
          });
          return;
        }

        const parts = messageParts(data.reply || "");

        for (const [partIndex, part] of parts.entries()) {
          if (partIndex > 0) {
            await wait(260);
            writer.write({
              type: "data-message-part",
              data: { content: part },
            });
            continue;
          }

          writer.write({
            type: "text-start",
            id: textId,
          });

          for (const chunk of textChunks(part)) {
            writer.write({
              type: "text-delta",
              id: textId,
              delta: chunk,
            });
          }
        }

        if (parts.length === 0) {
          writer.write({
            type: "text-start",
            id: textId,
          });
        }

        writer.write({
          type: "text-end",
          id: textId,
        });

        writer.write({
          type: "data-result",
          data: {
            products: data.products || [],
            agentState: data.agentState,
          },
        });
      },
    }),
  });
}
