-- CreateTable
CREATE TABLE "tenant_configs" (
    "tenant_id" TEXT NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by_user_id" TEXT NOT NULL,

    CONSTRAINT "tenant_configs_pkey" PRIMARY KEY ("tenant_id","key")
);

-- AddForeignKey
ALTER TABLE "tenant_configs" ADD CONSTRAINT "tenant_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
