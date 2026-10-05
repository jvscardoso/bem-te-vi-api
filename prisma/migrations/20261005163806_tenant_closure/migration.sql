-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "closure_requested_at" TIMESTAMP(3),
ADD COLUMN     "closure_requested_by_user_id" TEXT;

-- CreateTable
CREATE TABLE "tenant_deletions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "subdomain" VARCHAR(63) NOT NULL,
    "closure_requested_at" TIMESTAMP(3) NOT NULL,
    "deleted_by_user_id" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_deletions_pkey" PRIMARY KEY ("id")
);
