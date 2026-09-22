-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "custom_domain_verification_token" VARCHAR(64),
ADD COLUMN     "custom_domain_verified_at" TIMESTAMP(3);
