CREATE TABLE "SavedShoppingChat" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "messagesJson" JSONB NOT NULL,
    "cartJson" JSONB NOT NULL,
    "checkedDeliveryJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedShoppingChat_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SavedShoppingChat_sessionId_updatedAt_idx" ON "SavedShoppingChat"("sessionId", "updatedAt");

ALTER TABLE "SavedShoppingChat" ADD CONSTRAINT "SavedShoppingChat_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "UserSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
