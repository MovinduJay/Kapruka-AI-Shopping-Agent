import { randomUUID } from "crypto";
import { cookies, headers } from "next/headers";
import {
  sessionCookieName,
  upsertUserSession,
} from "@/lib/agent-persistence";
import { hasDatabaseUrl, prisma } from "@/lib/prisma";

type SavedShoppingChatRow = {
  id: string;
  title: string;
  messagesJson: unknown;
  cartJson: unknown;
  checkedDeliveryJson: unknown;
  checkoutStateJson: unknown;
  shoppingFlowStep: string;
  updatedAt: Date;
};

function jsonString(value: unknown) {
  return JSON.stringify(value ?? null);
}

async function getSession() {
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

  return session;
}

export async function GET() {
  if (!hasDatabaseUrl()) {
    return Response.json({ chats: [] });
  }

  const session = await getSession();

  if (!session) {
    return Response.json({ chats: [] });
  }

  const chats = await prisma.$queryRaw<SavedShoppingChatRow[]>`
    SELECT
      "id",
      "title",
      "messagesJson",
      "cartJson",
      "checkedDeliveryJson",
      "checkoutStateJson",
      "shoppingFlowStep",
      "updatedAt"
    FROM "SavedShoppingChat"
    WHERE "sessionId" = ${session.id}
    ORDER BY "updatedAt" DESC
    LIMIT 20
  `;

  return Response.json({
    chats: chats.map((chat) => ({
      id: chat.id,
      title: chat.title,
      updatedAt: chat.updatedAt.getTime(),
      messages: chat.messagesJson,
      cart: chat.cartJson,
      checkedDelivery: chat.checkedDeliveryJson,
      checkoutState: chat.checkoutStateJson,
      shoppingFlowStep: chat.shoppingFlowStep,
    })),
  });
}

export async function POST(req: Request) {
  if (!hasDatabaseUrl()) {
    return Response.json({ ok: true, stored: false });
  }

  const session = await getSession();

  if (!session) {
    return Response.json({ ok: true, stored: false });
  }

  const body = (await req.json()) as {
    id?: unknown;
    title?: unknown;
    messages?: unknown;
    cart?: unknown;
    checkedDelivery?: unknown;
    checkoutState?: unknown;
    shoppingFlowStep?: unknown;
  };
  const id =
    typeof body.id === "string" && body.id.length <= 120
      ? body.id
      : randomUUID();
  const title =
    typeof body.title === "string" && body.title.trim()
      ? body.title.trim().slice(0, 140)
      : "New shopping chat";

  const messagesJson = jsonString(Array.isArray(body.messages) ? body.messages : []);
  const cartJson = jsonString(Array.isArray(body.cart) ? body.cart : []);
  const checkedDeliveryJson = body.checkedDelivery
    ? jsonString(body.checkedDelivery)
    : null;
  const checkoutStateJson = body.checkoutState
    ? jsonString(body.checkoutState)
    : null;
  const shoppingFlowStep =
    body.shoppingFlowStep === "delivery" ||
    body.shoppingFlowStep === "date" ||
    body.shoppingFlowStep === "checkout"
      ? body.shoppingFlowStep
      : "cart";

  await prisma.$executeRaw`
    INSERT INTO "SavedShoppingChat" (
      "id",
      "sessionId",
      "title",
      "messagesJson",
      "cartJson",
      "checkedDeliveryJson",
      "checkoutStateJson",
      "shoppingFlowStep",
      "updatedAt"
    )
    VALUES (
      ${id},
      ${session.id},
      ${title},
      ${messagesJson}::jsonb,
      ${cartJson}::jsonb,
      ${checkedDeliveryJson}::jsonb,
      ${checkoutStateJson}::jsonb,
      ${shoppingFlowStep},
      NOW()
    )
    ON CONFLICT ("id") DO UPDATE SET
      "title" = EXCLUDED."title",
      "messagesJson" = EXCLUDED."messagesJson",
      "cartJson" = EXCLUDED."cartJson",
      "checkedDeliveryJson" = EXCLUDED."checkedDeliveryJson",
      "checkoutStateJson" = EXCLUDED."checkoutStateJson",
      "shoppingFlowStep" = EXCLUDED."shoppingFlowStep",
      "updatedAt" = NOW()
  `;

  return Response.json({ ok: true, stored: true });
}
