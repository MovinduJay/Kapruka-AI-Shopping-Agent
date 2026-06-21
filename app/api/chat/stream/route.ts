import {
  createUIMessageStream,
  createUIMessageStreamResponse,
} from "ai";
import { cookies, headers } from "next/headers";
import { randomUUID } from "crypto";
import {
  sessionCookieName,
  upsertUserSession,
} from "@/lib/agent-persistence";
import type { AgentChatResponse } from "@/types/agent";

export const maxDuration = 60;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function textChunks(value: string) {
  return value.match(/\S+\s*/g) || [];
}

function messageParts(value: string) {
  const parts = value
    .split(/\n{2,}|\n+|(?<=[.!?])\s+(?=[\p{Lu}\p{Lt}\p{Lo}"'(])/u)
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.length > 0 ? parts : [value.trim()].filter(Boolean);
}

function fastCasualReply(message: unknown) {
  if (typeof message !== "string") return null;

  const normalized = message
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (
    /^(?:hi|hello|hey|helo|hii|hiii|yo|sup|good morning|good afternoon|good evening|ayubowan|vanakkam|thanks|thank you|thx|ok|okay)$/.test(
      normalized
    )
  ) {
    if (/^(?:thanks|thank you|thx)$/.test(normalized)) {
      return "Anytime. I got you.";
    }

    if (/^(?:ok|okay)$/.test(normalized)) {
      return "Cool. I'm here if you want to keep talking.";
    }

    if (normalized === "good morning") {
      return "Morning. How's the day starting?";
    }

    if (normalized === "good afternoon") {
      return "Afternoon. What's happening?";
    }

    if (normalized === "good evening") {
      return "Evening. Long day?";
    }

    if (normalized === "yo" || normalized === "sup") {
      return "Yo. What's up?";
    }

    if (normalized === "ayubowan") {
      return "Ayubowan. Mama innawa, kiyanna.";
    }

    if (normalized === "vanakkam") {
      return "Vanakkam. Tell me.";
    }

    return "Hey. I'm here. What's going on?";
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
        writer.write({
          type: "data-progress",
          data: { label: "Figuring out what matters here" },
        });

        writer.write({
          type: "data-progress",
          data: { label: "Checking the right Kapruka shelves" },
        });

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

        writer.write({
          type: "data-progress",
          data: { label: "Comparing value, stock, and fit" },
        });

        const parts = messageParts(data.reply || "");

        for (const [partIndex, part] of parts.entries()) {
          if (partIndex > 0) {
            writer.write({
              type: "data-message-break",
              data: {},
            });
            await wait(420);
          }

          if (partIndex === 0) {
            writer.write({
              type: "text-start",
              id: textId,
            });
          }

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
