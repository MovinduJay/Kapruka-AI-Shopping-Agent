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

export async function POST(req: Request) {
  const payload = await req.json();
  const textId = `assistant-${Date.now().toString(36)}`;
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
          data: { label: "Understanding the shopping goal" },
        });

        await wait(80);

        writer.write({
          type: "data-progress",
          data: { label: "Calling Kapruka commerce tools" },
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
          data: { label: "Ranking price, stock, and fit" },
        });

        await wait(60);

        writer.write({
          type: "text-start",
          id: textId,
        });

        for (const chunk of textChunks(data.reply || "")) {
          writer.write({
            type: "text-delta",
            id: textId,
            delta: chunk,
          });
          await wait(12);
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
