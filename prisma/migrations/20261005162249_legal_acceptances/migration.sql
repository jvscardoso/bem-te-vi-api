-- CreateEnum
CREATE TYPE "LegalDocument" AS ENUM ('terms', 'privacy');

-- CreateTable
CREATE TABLE "legal_acceptances" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "document" "LegalDocument" NOT NULL,
    "version" VARCHAR(50) NOT NULL,
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(300),
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "legal_acceptances_user_id_document_idx" ON "legal_acceptances"("user_id", "document");

-- AddForeignKey
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
