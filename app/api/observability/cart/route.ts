import { randomUUID } from "crypto";
import { cookies, headers } from "next/headers";
import {
  persistCartSnapshot,
  sessionCookieName,
  upsertUserSession,
} from "@/lib/agent-persistence";
import type { ProductCard } from "@/types/product";

export async function POST(req: Request) {
  const { cart } = (await req.json()) as { cart?: ProductCard[] };
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

  if (session && Array.isArray(cart)) {
    await persistCartSnapshot(session.id, cart.slice(0, 30));
  }

  return Response.json({ ok: true });
}
