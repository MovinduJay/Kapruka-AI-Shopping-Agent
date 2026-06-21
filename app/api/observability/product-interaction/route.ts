import { randomUUID } from "crypto";
import { cookies, headers } from "next/headers";
import {
  persistProductInteraction,
  sessionCookieName,
  upsertUserSession,
} from "@/lib/agent-persistence";
import type { ProductCard } from "@/types/product";

export async function POST(req: Request) {
  const { product, action, metadata } = (await req.json()) as {
    product?: ProductCard;
    action?: string;
    metadata?: unknown;
  };
  const cookieStore = await cookies();
  const headerStore = await headers();
  const sessionToken =
    cookieStore.get(sessionCookieName)?.value || randomUUID();
  const session = await upsertUserSession(
    sessionToken,
    headerStore.get("user-agent")
  );

  cookieStore.set(sessionCookieName, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  if (session && product && action) {
    await persistProductInteraction({
      sessionId: session.id,
      product,
      action: action.slice(0, 60),
      metadata,
    });
  }

  return Response.json({ ok: true });
}
