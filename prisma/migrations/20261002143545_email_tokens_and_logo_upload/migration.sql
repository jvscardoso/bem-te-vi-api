-- CreateEnum
CREATE TYPE "UserTokenType" AS ENUM ('password_reset', 'invite');

-- CreateTable
CREATE TABLE "tenant_logos" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "mime_type" VARCHAR(50) NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_logos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "UserTokenType" NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_logos_tenant_id_key" ON "tenant_logos"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_tokens_token_hash_key" ON "user_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "user_tokens_user_id_type_idx" ON "user_tokens"("user_id", "type");

-- AddForeignKey
ALTER TABLE "tenant_logos" ADD CONSTRAINT "tenant_logos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tokens" ADD CONSTRAINT "user_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
